const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const TARGET_TENANT_ID = tenantArg ? Number(tenantArg.split('=')[1]) : null;

const getConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: OPERATIONAL_DB_NAME,
    multipleStatements: false,
});

const getNegativeNetStockGroups = async (conn, tenantId) => {
    const params = [];
    let tenantFilter = '';
    if (Number.isFinite(tenantId)) {
        tenantFilter = ' AND s.tenant_id = ?';
        params.push(tenantId);
    }

    const [rows] = await conn.query(
        `SELECT
            agg.tenant_id,
            agg.branch_id,
            agg.product_id,
            agg.net_qty,
            ABS(agg.net_qty) AS adjust_qty,
            COALESCE(NULLIF(TRIM(last_row.unit), ''), 'kg') AS unit_guess,
            COALESCE(NULLIF(TRIM(last_row.name), ''), NULLIF(TRIM(p.name), ''), CONCAT('PRODUCTO ', agg.product_id)) AS name_guess,
            COALESCE(NULLIF(TRIM(last_row.type), ''), NULLIF(TRIM(p.category), ''), 'general') AS type_guess
         FROM (
            SELECT
                s.tenant_id,
                s.branch_id,
                s.product_id,
                SUM(COALESCE(s.quantity, 0)) AS net_qty,
                MAX(s.id) AS last_stock_id
            FROM stock s
            WHERE s.product_id IS NOT NULL
            ${tenantFilter}
            GROUP BY s.tenant_id, s.branch_id, s.product_id
            HAVING SUM(COALESCE(s.quantity, 0)) < 0
         ) agg
         LEFT JOIN stock last_row
           ON last_row.id = agg.last_stock_id
          AND last_row.tenant_id = agg.tenant_id
         LEFT JOIN products p
           ON p.tenant_id = agg.tenant_id
          AND p.id = agg.product_id
         ORDER BY agg.tenant_id, agg.branch_id, agg.product_id`,
        params
    );

    return rows;
};

const getNegativeNetCount = async (conn, tenantId) => {
    const params = [];
    let tenantFilter = '';
    if (Number.isFinite(tenantId)) {
        tenantFilter = ' AND tenant_id = ?';
        params.push(tenantId);
    }

    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS qty
         FROM (
            SELECT tenant_id, branch_id, product_id
            FROM stock
            WHERE product_id IS NOT NULL
            ${tenantFilter}
            GROUP BY tenant_id, branch_id, product_id
            HAVING SUM(COALESCE(quantity, 0)) < 0
         ) x`,
        params
    );

    return Number(row?.qty || 0);
};

const main = async () => {
    const conn = await getConnection();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reference = `saneamiento_stock_${stamp}`;

    try {
        const groups = await getNegativeNetStockGroups(conn, TARGET_TENANT_ID);
        const beforeCount = await getNegativeNetCount(conn, TARGET_TENANT_ID);

        console.log(`DB objetivo: ${OPERATIONAL_DB_NAME}`);
        console.log(`Tenant objetivo: ${Number.isFinite(TARGET_TENANT_ID) ? TARGET_TENANT_ID : 'todos'}`);
        console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
        console.log(`Productos con stock neto negativo (antes): ${beforeCount}`);

        if (!groups.length) {
            console.log('No hay stock neto negativo para corregir.');
            return;
        }

        console.log('\nVista previa de ajustes:');
        for (const row of groups.slice(0, 50)) {
            console.log(
                `- tenant=${row.tenant_id} branch=${row.branch_id ?? 'NULL'} product=${row.product_id}` +
                ` net=${row.net_qty} ajuste=+${row.adjust_qty} unit=${row.unit_guess} name="${row.name_guess}"`
            );
        }
        if (groups.length > 50) {
            console.log(`... y ${groups.length - 50} ajustes más.`);
        }

        if (!APPLY) {
            console.log('\nDry-run finalizado. Para aplicar:');
            console.log(`node _sanitize_negative_stock.js${Number.isFinite(TARGET_TENANT_ID) ? ` --tenant=${TARGET_TENANT_ID}` : ''} --apply`);
            return;
        }

        await conn.beginTransaction();

        let inserted = 0;
        for (const row of groups) {
            const [result] = await conn.query(
                `INSERT INTO stock
                 (tenant_id, branch_id, product_id, name, type, \`usage\`, quantity, unit, reference)
                 VALUES (?, ?, ?, ?, ?, 'ajuste', ?, ?, ?)`,
                [
                    row.tenant_id,
                    row.branch_id,
                    row.product_id,
                    row.name_guess,
                    row.type_guess,
                    row.adjust_qty,
                    row.unit_guess,
                    reference,
                ]
            );
            inserted += Number(result?.affectedRows || 0);
        }

        const afterCount = await getNegativeNetCount(conn, TARGET_TENANT_ID);
        await conn.commit();

        console.log('\nSaneamiento aplicado.');
        console.log(`Asientos compensatorios insertados: ${inserted}`);
        console.log(`Referencia utilizada: ${reference}`);
        console.log(`Productos con stock neto negativo (después): ${afterCount}`);
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('ERROR saneando stock:', error.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
};

main();

