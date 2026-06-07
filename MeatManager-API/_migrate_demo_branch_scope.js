const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const TENANT_ID = Number((process.argv.find((arg) => arg.startsWith('--tenant=')) || '').split('=')[1] || 4);
const APPLY = process.argv.includes('--apply');
const DEFAULT_BRANCH_ID = Number((process.argv.find((arg) => arg.startsWith('--default-branch=')) || '').split('=')[1] || 5);
const FATIMA_BRANCH_ID = Number((process.argv.find((arg) => arg.startsWith('--fatima-branch=')) || '').split('=')[1] || 7);

const BRANCH_COLUMNS = [
    ['products', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['purchase_items', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['ventas_items', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['compras', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['compras_items', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['animal_lots', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['despostada_logs', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['suppliers', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['menu_digital', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['supplier_item_tax_profiles', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['branch_stock_snapshots', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['prices', '`branch_id` INT NULL AFTER `tenant_id`'],
    ['product_prices', '`branch_id` INT NULL AFTER `tenant_id`'],
];

const BACKUP_TABLES = [
    'products', 'stock', 'ventas_items', 'purchase_items', 'compras', 'compras_items',
    'suppliers', 'supplier_item_tax_profiles', 'caja_movimientos', 'animal_lots',
    'despostada_logs', 'menu_digital', 'branch_stock_snapshots',
    'prices', 'product_prices', 'branch_product_prices',
];

const getConn = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: DB_NAME,
});

async function tableExists(conn, table) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) qty
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [table]
    );
    return Number(row.qty) > 0;
}

async function columnExists(conn, table, column) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) qty
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(row.qty) > 0;
}

async function indexExists(conn, table, indexName) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) qty
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?`,
        [table, indexName]
    );
    return Number(row.qty) > 0;
}

async function getColumns(conn, table) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [table]
    );
    return rows.map((row) => row.COLUMN_NAME);
}

async function ensureBranchColumns(conn) {
    const changes = [];
    for (const [table, definition] of BRANCH_COLUMNS) {
        if (!(await tableExists(conn, table))) continue;
        if (!(await columnExists(conn, table, 'branch_id'))) {
            if (APPLY) await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
            changes.push({ table, action: 'add_branch_id' });
        }
        const indexName = `idx_${table}_tenant_branch`.slice(0, 60);
        if (await columnExists(conn, table, 'tenant_id')) {
            if (!(await indexExists(conn, table, indexName))) {
                if (APPLY) {
                    try {
                        await conn.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (tenant_id, branch_id)`);
                    } catch (error) {
                        if (error?.code !== 'ER_DUP_KEYNAME') throw error;
                    }
                }
                changes.push({ table, action: 'ensure_tenant_branch_index', indexName });
            }
        }
    }
    if (await tableExists(conn, 'products')) {
        if (await indexExists(conn, 'products', 'uniq_products_tenant_canonical')) {
            if (APPLY) await dropIndexIfExists(conn, 'products', 'uniq_products_tenant_canonical');
            changes.push({ table: 'products', action: 'drop_legacy_unique_canonical' });
        }
        if (await indexExists(conn, 'products', 'uniq_products_tenant_plu')) {
            if (APPLY) await dropIndexIfExists(conn, 'products', 'uniq_products_tenant_plu');
            changes.push({ table: 'products', action: 'drop_legacy_unique_plu' });
        }
    }
    return changes;
}

async function backupTables(conn) {
    if (!APPLY) return null;
    const backup = {};
    for (const table of BACKUP_TABLES) {
        if (!(await tableExists(conn, table))) continue;
        const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE tenant_id = ?`, [TENANT_ID]);
        backup[table] = rows;
    }
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupPath = path.join(backupDir, `demo_branch_scope_tenant${TENANT_ID}_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ tenantId: TENANT_ID, generatedAt: new Date().toISOString(), backup }, null, 2), 'utf8');
    return backupPath;
}

async function dropIndexIfExists(conn, table, indexName) {
    if (await indexExists(conn, table, indexName)) {
        await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
    }
}

async function getProductBranchWeights(conn) {
    const weights = new Map();
    const add = (productId, branchId, weight) => {
        const p = Number(productId);
        const b = Number(branchId);
        const w = Number(weight || 0);
        if (!Number.isFinite(p) || !Number.isFinite(b) || p <= 0 || b <= 0) return;
        if (!weights.has(p)) weights.set(p, new Map());
        weights.get(p).set(b, (weights.get(p).get(b) || 0) + w);
    };

    const [stockRows] = await conn.query(
        `SELECT product_id, branch_id, COUNT(*) weight
         FROM stock
         WHERE tenant_id = ?
           AND product_id IS NOT NULL
           AND branch_id IS NOT NULL
         GROUP BY product_id, branch_id`,
        [TENANT_ID]
    );
    stockRows.forEach((row) => add(row.product_id, row.branch_id, Number(row.weight) * 10));

    const [saleRows] = await conn.query(
        `SELECT vi.product_id, v.branch_id, COUNT(*) weight
         FROM ventas_items vi
         JOIN ventas v
           ON v.tenant_id = vi.tenant_id
          AND v.id = vi.venta_id
         WHERE vi.tenant_id = ?
           AND vi.product_id IS NOT NULL
           AND v.branch_id IS NOT NULL
         GROUP BY vi.product_id, v.branch_id`,
        [TENANT_ID]
    );
    saleRows.forEach((row) => add(row.product_id, row.branch_id, Number(row.weight) * 5));

    return weights;
}

async function copyProductForBranch(conn, product, branchId) {
    const columns = await getColumns(conn, 'products');
    const insertColumns = columns.filter((column) => column !== 'id');
    const payload = {};
    for (const column of insertColumns) {
        payload[column] = product[column] ?? null;
    }
    payload.branch_id = branchId;
    payload.synced = 0;
    payload.created_at = product.created_at || new Date();
    payload.updated_at = new Date();

    const placeholders = insertColumns.map(() => '?').join(', ');
    const values = insertColumns.map((column) => payload[column]);
    const [result] = await conn.query(
        `INSERT INTO products (${insertColumns.map((column) => `\`${column}\``).join(', ')})
         VALUES (${placeholders})`,
        values
    );
    return Number(result.insertId);
}

async function migrateProducts(conn) {
    if (!(await tableExists(conn, 'products')) || !(await columnExists(conn, 'products', 'branch_id'))) {
        return { skipped: true };
    }

    const weights = await getProductBranchWeights(conn);
    const [products] = await conn.query(
        'SELECT * FROM products WHERE tenant_id = ? AND branch_id IS NULL ORDER BY id ASC',
        [TENANT_ID]
    );

    const productBranchMap = new Map();
    let assignedOriginals = 0;
    let duplicatedProducts = 0;
    let defaultedProducts = 0;

    for (const product of products) {
        const branchWeights = weights.get(Number(product.id)) || new Map();
        const branches = Array.from(branchWeights.entries())
            .map(([branchId, weight]) => ({ branchId: Number(branchId), weight: Number(weight) }))
            .filter((entry) => entry.branchId > 0)
            .sort((a, b) => b.weight - a.weight || a.branchId - b.branchId);

        if (branches.length === 0) {
            branches.push({ branchId: DEFAULT_BRANCH_ID, weight: 0 });
            defaultedProducts += 1;
        }

        const primaryBranchId = branches[0].branchId;
        if (APPLY) {
            await conn.query(
                'UPDATE products SET branch_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ? AND branch_id IS NULL',
                [primaryBranchId, TENANT_ID, product.id]
            );
        }
        assignedOriginals += 1;
        productBranchMap.set(`${product.id}:${primaryBranchId}`, Number(product.id));

        for (const branch of branches.slice(1)) {
            let duplicateId = null;
            if (APPLY) {
                duplicateId = await copyProductForBranch(conn, product, branch.branchId);
            } else {
                duplicateId = -1;
            }
            duplicatedProducts += 1;
            productBranchMap.set(`${product.id}:${branch.branchId}`, duplicateId);
        }
    }

    if (APPLY && productBranchMap.size > 0) {
        const [stockRows] = await conn.query(
            'SELECT id, product_id, branch_id FROM stock WHERE tenant_id = ? AND product_id IS NOT NULL AND branch_id IS NOT NULL',
            [TENANT_ID]
        );
        for (const row of stockRows) {
            const nextProductId = productBranchMap.get(`${row.product_id}:${row.branch_id}`);
            if (nextProductId && Number(nextProductId) !== Number(row.product_id)) {
                await conn.query('UPDATE stock SET product_id = ? WHERE tenant_id = ? AND id = ?', [nextProductId, TENANT_ID, row.id]);
            }
        }

        const [saleRows] = await conn.query(
            'SELECT id, product_id, branch_id FROM ventas_items WHERE tenant_id = ? AND product_id IS NOT NULL AND branch_id IS NOT NULL',
            [TENANT_ID]
        );
        for (const row of saleRows) {
            const nextProductId = productBranchMap.get(`${row.product_id}:${row.branch_id}`);
            if (nextProductId && Number(nextProductId) !== Number(row.product_id)) {
                await conn.query('UPDATE ventas_items SET product_id = ? WHERE tenant_id = ? AND id = ?', [nextProductId, TENANT_ID, row.id]);
            }
        }
    }

    return { assignedOriginals, duplicatedProducts, defaultedProducts };
}

async function migratePrices(conn) {
    const summary = {};

    if (await tableExists(conn, 'prices') && await columnExists(conn, 'prices', 'branch_id')) {
        const [assignPrices] = await conn.query(
            `UPDATE prices pr
             JOIN products p
               ON p.tenant_id = pr.tenant_id
              AND p.id = pr.product_ref_id
             SET pr.branch_id = p.branch_id
             WHERE pr.tenant_id = ?
               AND pr.branch_id IS NULL
               AND p.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.pricesFromProducts = Number(assignPrices.affectedRows || 0);

        const [insertPrices] = await conn.query(
            `INSERT INTO prices (tenant_id, branch_id, product_ref_id, product_id, price, plu, updated_at)
             SELECT
                p.tenant_id,
                p.branch_id,
                p.id,
                COALESCE(NULLIF(TRIM(p.canonical_key), ''), CAST(p.id AS CHAR)),
                COALESCE(p.current_price, 0),
                NULLIF(TRIM(COALESCE(p.plu, '')), ''),
                NOW()
             FROM products p
             LEFT JOIN prices pr
               ON pr.tenant_id = p.tenant_id
              AND pr.product_ref_id = p.id
             WHERE p.tenant_id = ?
               AND p.branch_id IS NOT NULL
               AND pr.id IS NULL`,
            [TENANT_ID]
        );
        summary.missingPricesInserted = Number(insertPrices.affectedRows || 0);
    }

    if (await tableExists(conn, 'product_prices') && await columnExists(conn, 'product_prices', 'branch_id')) {
        const [assignProductPrices] = await conn.query(
            `UPDATE product_prices pp
             JOIN products p
               ON p.tenant_id = pp.tenant_id
              AND p.id = pp.product_id
             SET pp.branch_id = p.branch_id
             WHERE pp.tenant_id = ?
               AND pp.branch_id IS NULL
               AND p.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.productPricesFromProducts = Number(assignProductPrices.affectedRows || 0);

        const [insertProductPrices] = await conn.query(
            `INSERT INTO product_prices (tenant_id, branch_id, product_id, price, plu, source, effective_at, created_at)
             SELECT
                p.tenant_id,
                p.branch_id,
                p.id,
                COALESCE(p.current_price, 0),
                NULLIF(TRIM(COALESCE(p.plu, '')), ''),
                'branch_scope_migration',
                NOW(),
                NOW()
             FROM products p
             LEFT JOIN product_prices pp
               ON pp.tenant_id = p.tenant_id
              AND pp.product_id = p.id
             WHERE p.tenant_id = ?
               AND p.branch_id IS NOT NULL
               AND pp.id IS NULL`,
            [TENANT_ID]
        );
        summary.missingProductPricesInserted = Number(insertProductPrices.affectedRows || 0);
    }

    if (await tableExists(conn, 'branch_product_prices')) {
        const [seedBranchPrices] = await conn.query(
            `INSERT INTO branch_product_prices
                (tenant_id, branch_id, product_id, price, plu, source, effective_at, created_at, updated_at)
             SELECT
                p.tenant_id,
                p.branch_id,
                p.id,
                COALESCE(p.current_price, 0),
                NULLIF(TRIM(COALESCE(p.plu, '')), ''),
                'branch_scope_migration',
                NOW(),
                NOW(),
                NOW()
             FROM products p
             WHERE p.tenant_id = ?
               AND p.branch_id IS NOT NULL
             ON DUPLICATE KEY UPDATE
                price = VALUES(price),
                plu = VALUES(plu),
                source = VALUES(source),
                effective_at = VALUES(effective_at),
                updated_at = VALUES(updated_at)`,
            [TENANT_ID]
        );
        summary.branchProductPricesSeeded = Number(seedBranchPrices.affectedRows || 0);
    }

    return summary;
}

async function runDataBackfill(conn) {
    const summary = {};

    if (await columnExists(conn, 'ventas_items', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE ventas_items vi
             JOIN ventas v
               ON v.tenant_id = vi.tenant_id
              AND v.id = vi.venta_id
             SET vi.branch_id = v.branch_id
             WHERE vi.tenant_id = ?
               AND vi.branch_id IS NULL
               AND v.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.ventasItemsFromVentas = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'compras_items', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE compras_items ci
             JOIN products p
               ON p.tenant_id = ci.tenant_id
              AND p.id = ci.product_id
             SET ci.branch_id = p.branch_id
             WHERE ci.tenant_id = ?
               AND ci.branch_id IS NULL
               AND p.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.comprasItemsFromProducts = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'compras', 'branch_id') && await columnExists(conn, 'compras_items', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE compras c
             JOIN (
                SELECT tenant_id, purchase_id, MIN(branch_id) branch_id, COUNT(DISTINCT branch_id) branch_count
                FROM compras_items
                WHERE tenant_id = ?
                  AND branch_id IS NOT NULL
                GROUP BY tenant_id, purchase_id
             ) src
               ON src.tenant_id = c.tenant_id
              AND src.purchase_id = c.id
             SET c.branch_id = src.branch_id
             WHERE c.tenant_id = ?
               AND c.branch_id IS NULL
               AND src.branch_count = 1`,
            [TENANT_ID, TENANT_ID]
        );
        summary.comprasFromItems = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'stock', 'branch_id') && await columnExists(conn, 'compras', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE stock s
             JOIN compras c
               ON c.tenant_id = s.tenant_id
              AND CONCAT('compra_', c.id) = s.reference
             SET s.branch_id = c.branch_id
             WHERE s.tenant_id = ?
               AND s.branch_id IS NULL
               AND c.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.stockFromCompras = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'stock', 'branch_id') && await columnExists(conn, 'products', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE stock s
             JOIN products p
               ON p.tenant_id = s.tenant_id
              AND p.id = s.product_id
             SET s.branch_id = p.branch_id
             WHERE s.tenant_id = ?
               AND s.branch_id IS NULL
               AND p.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.stockFromProducts = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'purchase_items', 'branch_id') && await columnExists(conn, 'products', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE purchase_items pi
             JOIN products p
               ON p.tenant_id = pi.tenant_id
              AND p.id = pi.product_id
             SET pi.branch_id = p.branch_id
             WHERE pi.tenant_id = ?
               AND pi.branch_id IS NULL
               AND p.branch_id IS NOT NULL`,
            [TENANT_ID]
        );
        summary.purchaseItemsFromProducts = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'suppliers', 'branch_id') && await columnExists(conn, 'compras', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE suppliers s
             JOIN (
                SELECT tenant_id, LOWER(TRIM(supplier)) supplier_key, MIN(branch_id) branch_id, COUNT(DISTINCT branch_id) branch_count
                FROM compras
                WHERE tenant_id = ?
                  AND branch_id IS NOT NULL
                  AND supplier IS NOT NULL
                  AND TRIM(supplier) <> ''
                GROUP BY tenant_id, LOWER(TRIM(supplier))
             ) src
               ON src.tenant_id = s.tenant_id
              AND src.supplier_key = LOWER(TRIM(s.name))
             SET s.branch_id = src.branch_id
             WHERE s.tenant_id = ?
               AND s.branch_id IS NULL
               AND src.branch_count = 1`,
            [TENANT_ID, TENANT_ID]
        );
        summary.suppliersFromCompras = Number(result.affectedRows || 0);
    }

    if (await columnExists(conn, 'supplier_item_tax_profiles', 'branch_id') && await columnExists(conn, 'purchase_items', 'branch_id')) {
        const [result] = await conn.query(
            `UPDATE supplier_item_tax_profiles sitp
             JOIN (
                SELECT tenant_id, name AS product_name, MIN(branch_id) branch_id, COUNT(DISTINCT branch_id) branch_count
                FROM purchase_items
                WHERE tenant_id = ?
                  AND branch_id IS NOT NULL
                GROUP BY tenant_id, name
             ) src
               ON src.tenant_id = sitp.tenant_id
              AND LOWER(TRIM(src.product_name)) = LOWER(TRIM(sitp.product_name))
             SET sitp.branch_id = src.branch_id
             WHERE sitp.tenant_id = ?
               AND sitp.branch_id IS NULL
               AND src.branch_count = 1`,
            [TENANT_ID, TENANT_ID]
        );
        summary.taxProfilesFromPurchaseItems = Number(result.affectedRows || 0);
    }

    const [cashResult] = await conn.query(
        `UPDATE caja_movimientos
         SET branch_id = ?
         WHERE tenant_id = ?
           AND branch_id IS NULL
           AND type = 'apertura'
           AND DATE(date) IN ('2026-05-31', '2026-06-01')`,
        [FATIMA_BRANCH_ID, TENANT_ID]
    );
    summary.fatimaOpeningCash = Number(cashResult.affectedRows || 0);

    const [defaultClients] = await conn.query(
        `UPDATE clients
         SET branch_id = ?
         WHERE tenant_id = ?
           AND branch_id IS NULL
           AND balance = 0`,
        [DEFAULT_BRANCH_ID, TENANT_ID]
    );
    summary.defaultClientsWithoutMovements = Number(defaultClients.affectedRows || 0);

    const [defaultSuppliers] = await conn.query(
        `UPDATE suppliers
         SET branch_id = ?
         WHERE tenant_id = ?
           AND branch_id IS NULL`,
        [DEFAULT_BRANCH_ID, TENANT_ID]
    );
    summary.defaultSuppliersWithoutPurchases = Number(defaultSuppliers.affectedRows || 0);

    const [defaultTaxProfiles] = await conn.query(
        `UPDATE supplier_item_tax_profiles
         SET branch_id = ?
         WHERE tenant_id = ?
           AND branch_id IS NULL`,
        [DEFAULT_BRANCH_ID, TENANT_ID]
    );
    summary.defaultTaxProfilesWithoutCatalogMatch = Number(defaultTaxProfiles.affectedRows || 0);

    return summary;
}

async function getDistribution(conn, table) {
    if (!(await tableExists(conn, table))) return null;
    const hasBranch = await columnExists(conn, table, 'branch_id');
    const [[total]] = await conn.query(`SELECT COUNT(*) qty FROM \`${table}\` WHERE tenant_id = ?`, [TENANT_ID]);
    if (!hasBranch) return { total: Number(total.qty), hasBranch: false };
    const [rows] = await conn.query(
        `SELECT IFNULL(CAST(branch_id AS CHAR), 'NULL') branch_id, COUNT(*) qty
         FROM \`${table}\`
         WHERE tenant_id = ?
         GROUP BY branch_id
         ORDER BY branch_id`,
        [TENANT_ID]
    );
    return { total: Number(total.qty), hasBranch: true, distribution: rows };
}

(async () => {
    const conn = await getConn();
    try {
        const backupPath = await backupTables(conn);
        const schemaChanges = await ensureBranchColumns(conn);

        let dataSummary = {};
        let productSummary = {};
        if (APPLY) {
            await conn.beginTransaction();
            try {
                dataSummary = await runDataBackfill(conn);
                productSummary = await migrateProducts(conn);
                dataSummary = { ...dataSummary, ...(await migratePrices(conn)) };
                dataSummary = { ...dataSummary, ...(await runDataBackfill(conn)) };

                try {
                    await conn.query('CREATE UNIQUE INDEX uniq_products_tenant_branch_canonical ON products (tenant_id, branch_id, canonical_key)');
                } catch (error) {
                    if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error?.code)) throw error;
                }
                try {
                    await conn.query('CREATE UNIQUE INDEX uniq_products_tenant_branch_plu ON products (tenant_id, branch_id, plu)');
                } catch (error) {
                    if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error?.code)) throw error;
                }

                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) {}
                throw error;
            }
        }

        const tables = ['clients', 'ventas', 'ventas_items', 'caja_movimientos', 'stock', 'products', 'purchase_items', 'compras', 'compras_items', 'animal_lots', 'despostada_logs', 'suppliers', 'supplier_item_tax_profiles', 'menu_digital', 'branch_stock_snapshots', 'prices', 'product_prices', 'branch_product_prices'];
        const distributions = {};
        for (const table of tables) {
            distributions[table] = await getDistribution(conn, table);
        }

        console.log(JSON.stringify({
            tenantId: TENANT_ID,
            mode: APPLY ? 'apply' : 'dry-run',
            backupPath,
            schemaChanges,
            productSummary,
            dataSummary,
            distributions,
        }, null, 2));
    } finally {
        await conn.end();
    }
})().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
