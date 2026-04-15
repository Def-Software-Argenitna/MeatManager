const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const TARGET_TENANT_ID = tenantArg ? Number(tenantArg.split('=')[1]) : null;
const pluArg = process.argv.find((arg) => arg.startsWith('--plu='));
const TARGET_PLU = pluArg ? String(pluArg.split('=')[1]).trim() : null;
const keepIdArg = process.argv.find((arg) => arg.startsWith('--keep-id='));
const FORCED_KEEP_ID = keepIdArg ? Number(keepIdArg.split('=')[1]) : null;

const getConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: DB_NAME,
    multipleStatements: false,
});

const getReferencingTables = async (conn) => {
    const [rows] = await conn.query(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
           AND REFERENCED_TABLE_NAME = 'products'
           AND REFERENCED_COLUMN_NAME = 'id'
         ORDER BY TABLE_NAME, COLUMN_NAME`
    );
    return rows.map((row) => ({
        tableName: row.TABLE_NAME,
        columnName: row.COLUMN_NAME,
    }));
};

const getDuplicateGroups = async (conn, tenantId, plu) => {
    const params = [];
    let extraSql = '';
    if (Number.isFinite(tenantId)) {
        extraSql += ' AND tenant_id = ?';
        params.push(tenantId);
    }
    if (plu) {
        extraSql += ' AND CAST(plu AS CHAR) = ?';
        params.push(plu);
    }

    const [groups] = await conn.query(
        `SELECT tenant_id, plu, COUNT(*) AS qty
         FROM products
         WHERE plu IS NOT NULL
           AND TRIM(CAST(plu AS CHAR)) <> ''
           ${extraSql}
         GROUP BY tenant_id, plu
         HAVING COUNT(*) > 1
         ORDER BY tenant_id, CAST(plu AS UNSIGNED), plu`,
        params
    );

    return groups;
};

const getProductsForGroup = async (conn, tenantId, plu) => {
    const [rows] = await conn.query(
        `SELECT id, tenant_id, name, canonical_key, category, current_price, plu, source, created_at, updated_at
         FROM products
         WHERE tenant_id = ? AND plu = ?
         ORDER BY id ASC`,
        [tenantId, plu]
    );
    return rows;
};

const getReferenceCount = async (conn, tableName, columnName, tenantId, productId) => {
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS qty
         FROM \`${tableName}\`
         WHERE tenant_id = ? AND \`${columnName}\` = ?`,
        [tenantId, productId]
    );
    return Number(rows[0]?.qty || 0);
};

const chooseCanonicalProduct = (products, referenceCounts, forcedKeepId) => {
    if (Number.isFinite(forcedKeepId)) {
        const forced = products.find((product) => product.id === forcedKeepId);
        if (forced) return forced;
    }

    return [...products].sort((a, b) => {
        const countDiff = (referenceCounts[b.id] || 0) - (referenceCounts[a.id] || 0);
        if (countDiff !== 0) return countDiff;

        const updatedA = new Date(a.updated_at || a.created_at || 0).getTime();
        const updatedB = new Date(b.updated_at || b.created_at || 0).getTime();
        if (updatedB !== updatedA) return updatedB - updatedA;

        return a.id - b.id;
    })[0];
};

const dedupePricesForTenant = async (conn, tenantId) => {
    const [byRef] = await conn.query(
        `DELETE p1
         FROM prices p1
         JOIN prices p2
           ON p1.tenant_id = p2.tenant_id
          AND p1.product_ref_id = p2.product_ref_id
          AND p1.product_ref_id IS NOT NULL
          AND p1.tenant_id = ?
          AND (
                COALESCE(p1.updated_at, '1970-01-01 00:00:00') < COALESCE(p2.updated_at, '1970-01-01 00:00:00')
             OR (
                    COALESCE(p1.updated_at, '1970-01-01 00:00:00') = COALESCE(p2.updated_at, '1970-01-01 00:00:00')
                AND p1.id < p2.id
             )
          )`,
        [tenantId]
    );

    const [byProductPrices] = await conn.query(
        `DELETE pp1
         FROM product_prices pp1
         JOIN product_prices pp2
           ON pp1.tenant_id = pp2.tenant_id
          AND pp1.product_id = pp2.product_id
          AND pp1.tenant_id = ?
          AND (
                COALESCE(pp1.effective_at, pp1.created_at, '1970-01-01 00:00:00') < COALESCE(pp2.effective_at, pp2.created_at, '1970-01-01 00:00:00')
             OR (
                    COALESCE(pp1.effective_at, pp1.created_at, '1970-01-01 00:00:00') = COALESCE(pp2.effective_at, pp2.created_at, '1970-01-01 00:00:00')
                AND pp1.id < pp2.id
             )
          )`,
        [tenantId]
    );

    return {
        pricesDeleted: Number(byRef.affectedRows || 0),
        productPricesDeleted: Number(byProductPrices.affectedRows || 0),
    };
};

const main = async () => {
    const conn = await getConnection();
    try {
        const refs = await getReferencingTables(conn);
        const groups = await getDuplicateGroups(conn, TARGET_TENANT_ID, TARGET_PLU);

        console.log(`DB objetivo: ${DB_NAME}`);
        console.log(`Tenant objetivo: ${Number.isFinite(TARGET_TENANT_ID) ? TARGET_TENANT_ID : 'todos'}`);
        console.log(`PLU objetivo: ${TARGET_PLU || 'todos'}`);
        console.log(`Keep-id forzado: ${Number.isFinite(FORCED_KEEP_ID) ? FORCED_KEEP_ID : 'auto'}`);
        console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
        console.log(`Tablas referenciando products.id: ${refs.map((r) => `${r.tableName}.${r.columnName}`).join(', ')}`);

        if (!groups.length) {
            console.log('No se detectaron productos duplicados por PLU.');
            return;
        }

        const plan = [];

        for (const group of groups) {
            const products = await getProductsForGroup(conn, group.tenant_id, group.plu);
            const referenceCounts = {};

            for (const product of products) {
                let totalRefs = 0;
                for (const ref of refs) {
                    totalRefs += await getReferenceCount(conn, ref.tableName, ref.columnName, group.tenant_id, product.id);
                }
                referenceCounts[product.id] = totalRefs;
            }

            const canonical = chooseCanonicalProduct(products, referenceCounts, FORCED_KEEP_ID);
            const duplicates = products.filter((product) => product.id !== canonical.id);

            plan.push({
                tenantId: group.tenant_id,
                plu: String(group.plu),
                canonical,
                duplicates,
                referenceCounts,
            });
        }

        console.log('\nConflictos detectados:');
        for (const item of plan) {
            console.log(`- tenant ${item.tenantId} | PLU ${item.plu} | canónico ${item.canonical.id}:${item.canonical.name}`);
            for (const product of [item.canonical, ...item.duplicates]) {
                console.log(`  * ${product.id}:${product.name} | refs=${item.referenceCounts[product.id] || 0} | precio=${product.current_price ?? 'null'} | categoria=${product.category || 'null'}`);
            }
        }

        if (!APPLY) {
            console.log('\nDry-run finalizado. Para aplicar:');
            console.log(`node _dedupe_products_by_plu.js --tenant=${Number.isFinite(TARGET_TENANT_ID) ? TARGET_TENANT_ID : 4}${TARGET_PLU ? ` --plu=${TARGET_PLU}` : ''}${Number.isFinite(FORCED_KEEP_ID) ? ` --keep-id=${FORCED_KEEP_ID}` : ''} --apply`);
            return;
        }

        await conn.beginTransaction();

        let movedReferences = 0;
        let deletedProducts = 0;

        for (const item of plan) {
            for (const duplicate of item.duplicates) {
                const [[canonicalPrice]] = await conn.query(
                    `SELECT id
                     FROM prices
                     WHERE tenant_id = ? AND product_ref_id = ?
                     LIMIT 1`,
                    [item.tenantId, item.canonical.id]
                );

                if (canonicalPrice?.id) {
                    const [deleteLegacyPrice] = await conn.query(
                        `DELETE FROM prices
                         WHERE tenant_id = ? AND product_ref_id = ?`,
                        [item.tenantId, duplicate.id]
                    );
                    movedReferences += Number(deleteLegacyPrice.affectedRows || 0);
                }

                for (const ref of refs) {
                    if (ref.tableName === 'prices' && ref.columnName === 'product_ref_id') continue;

                    const [result] = await conn.query(
                        `UPDATE \`${ref.tableName}\`
                         SET \`${ref.columnName}\` = ?
                         WHERE tenant_id = ? AND \`${ref.columnName}\` = ?`,
                        [item.canonical.id, item.tenantId, duplicate.id]
                    );
                    movedReferences += Number(result.affectedRows || 0);
                }

                const [renameStockRows] = await conn.query(
                    `UPDATE stock
                     SET name = ?
                     WHERE tenant_id = ? AND product_id = ?`,
                    [item.canonical.name, item.tenantId, item.canonical.id]
                );
                movedReferences += Number(renameStockRows.affectedRows || 0);

                const [deleteResult] = await conn.query(
                    `DELETE FROM products WHERE tenant_id = ? AND id = ?`,
                    [item.tenantId, duplicate.id]
                );
                deletedProducts += Number(deleteResult.affectedRows || 0);
            }

            const [syncCanonicalPrice] = await conn.query(
                `UPDATE products p
                 LEFT JOIN (
                    SELECT product_id, price
                    FROM product_prices
                    WHERE tenant_id = ?
                      AND product_id = ?
                    ORDER BY COALESCE(effective_at, created_at) DESC, id DESC
                    LIMIT 1
                 ) latest ON latest.product_id = p.id
                 SET p.current_price = COALESCE(latest.price, p.current_price)
                 WHERE p.tenant_id = ? AND p.id = ?`,
                [item.tenantId, item.canonical.id, item.tenantId, item.canonical.id]
            );
            movedReferences += Number(syncCanonicalPrice.affectedRows || 0);
        }

        const cleanup = Number.isFinite(TARGET_TENANT_ID)
            ? await dedupePricesForTenant(conn, TARGET_TENANT_ID)
            : { pricesDeleted: 0, productPricesDeleted: 0 };

        await conn.commit();

        console.log('\nAplicación completada.');
        console.log(`Referencias movidas: ${movedReferences}`);
        console.log(`Productos duplicados eliminados: ${deletedProducts}`);
        console.log(`Prices deduplicados: ${cleanup.pricesDeleted}`);
        console.log(`Product prices deduplicados: ${cleanup.productPricesDeleted}`);
    } catch (error) {
        try {
            await conn.rollback();
        } catch (_) {}
        console.error('ERROR deduplicando productos por PLU:', error.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
};

main();
