// Links products that exist in `products` but are missing from `purchase_items`.
// Default mode is dry-run. Add --commit to write changes.
//
// Examples:
//   node _link_orphan_products.js --tenant=4
//   node _link_orphan_products.js --tenant=4 --source=catalogo_compra
//   node _link_orphan_products.js --tenant=4 --product=54 --commit
//   node _link_orphan_products.js --tenant=4 --plu=34 --commit

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'meatmanager';

const getArg = (name) => {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
};

const tenantId = Number(getArg('tenant'));
const pluFilter = getArg('plu');
const sourceFilter = getArg('source');
const productId = Number(getArg('product'));
const limit = Number(getArg('limit') || 500);
const includeLegacy = process.argv.includes('--include-legacy');
const dryRun = !process.argv.includes('--commit');

const DEFAULT_ALLOWED_SOURCES = new Set([
    'catalogo_compra',
    'ventas_quick_create',
    'importacion_balanza',
    'stock_manual',
]);

const normalizeCategory = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');

const inferSpecies = (category) => {
    const normalized = normalizeCategory(category);
    if (['vaca', 'cerdo', 'pollo', 'pescado', 'cordero'].includes(normalized)) return normalized;
    if (normalized === 'ternera') return 'vaca';
    return 'vaca';
};

const inferType = () => 'directo';

const inferUsage = (source) => {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'stock_manual') return 'stock';
    return 'venta';
};

async function getConnection() {
    return mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });
}

function buildWhere() {
    const where = [
        'p.tenant_id = ?',
        'p.deleted_at IS NULL',
        'COALESCE(p.active, 1) = 1',
        'pi.id IS NULL',
    ];
    const params = [tenantId];

    if (Number.isFinite(productId) && productId > 0) {
        where.push('p.id = ?');
        params.push(productId);
    }

    if (pluFilter) {
        where.push('p.plu = ?');
        params.push(pluFilter);
    }

    if (sourceFilter) {
        where.push('p.source = ?');
        params.push(sourceFilter);
    } else if (!includeLegacy) {
        where.push(`COALESCE(p.source, '') IN (${[...DEFAULT_ALLOWED_SOURCES].map(() => '?').join(', ')})`);
        params.push(...DEFAULT_ALLOWED_SOURCES);
    }

    return { where, params };
}

async function findOrphans(conn) {
    const { where, params } = buildWhere();
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 500;

    const [rows] = await conn.query(
        `SELECT
             p.id,
             p.tenant_id,
             p.name,
             p.plu,
             p.category_id,
             p.category,
             p.unit,
             p.current_price,
             p.source,
             p.created_at,
             COUNT(s.id) AS stock_rows,
             COALESCE(SUM(s.quantity), 0) AS stock_quantity
         FROM products p
         LEFT JOIN purchase_items pi
           ON pi.tenant_id = p.tenant_id
          AND pi.product_id = p.id
         LEFT JOIN stock s
           ON s.tenant_id = p.tenant_id
          AND s.product_id = p.id
         WHERE ${where.join(' AND ')}
         GROUP BY p.id, p.tenant_id, p.name, p.plu, p.category_id, p.category, p.unit, p.current_price, p.source, p.created_at
         ORDER BY p.source, p.name
         LIMIT ${safeLimit}`,
        params
    );

    return rows;
}

function buildPurchaseItem(product) {
    return {
        tenant_id: product.tenant_id,
        name: product.name,
        product_id: product.id,
        category_id: product.category_id || null,
        last_price: 0,
        unit: product.unit || 'kg',
        type: inferType(product),
        is_preelaborable: 0,
        species: inferSpecies(product.category),
        usage: inferUsage(product.source),
        default_iva_rate: 10.50,
        plu: product.plu || null,
        synced: 0,
    };
}

function printSummary(rows) {
    const bySource = rows.reduce((acc, row) => {
        const source = row.source || 'sin_source';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
    }, {});

    console.log('');
    console.log('Orphan products found:', rows.length);
    Object.entries(bySource).forEach(([source, count]) => {
        console.log(`  ${source}: ${count}`);
    });
    console.log('');
}

async function main() {
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
        console.error('ERROR: specify a valid tenant with --tenant=N');
        process.exit(1);
    }

    const conn = await getConnection();
    try {
        console.log('');
        console.log('LINK ORPHAN PRODUCTS TO PURCHASE_ITEMS');
        console.log('DB:', OPERATIONAL_DB_NAME);
        console.log('Tenant:', tenantId);
        console.log('Mode:', dryRun ? 'DRY-RUN' : 'COMMIT');
        console.log('Source:', sourceFilter || (includeLegacy ? 'all' : [...DEFAULT_ALLOWED_SOURCES].join(', ')));

        const rows = await findOrphans(conn);
        printSummary(rows);

        if (!rows.length) {
            console.log('No changes needed.');
            return;
        }

        for (const product of rows) {
            const item = buildPurchaseItem(product);
            console.log(
                `#${product.id} "${product.name}" | PLU=${product.plu || '-'} | source=${product.source || '-'} | stock=${Number(product.stock_quantity || 0)}`
            );
            console.log(`  -> purchase_items: unit=${item.unit}, usage=${item.usage}, species=${item.species}`);
        }

        if (dryRun) {
            console.log('');
            console.log('Dry-run only. Add --commit to insert these purchase_items.');
            return;
        }

        await conn.beginTransaction();
        try {
            for (const product of rows) {
                await conn.query('INSERT INTO purchase_items SET ?', [buildPurchaseItem(product)]);
            }
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        }

        console.log('');
        console.log(`Inserted ${rows.length} purchase_items.`);
    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('');
    console.error('ERROR:', error.message || error);
    process.exit(1);
});
