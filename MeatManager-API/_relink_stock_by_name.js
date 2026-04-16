const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const TARGET_TENANT_ID = tenantArg ? Number(tenantArg.split('=')[1]) : null;

const getConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: DB_NAME,
});

async function getRelinkCandidates(conn, tenantId) {
    const [rows] = await conn.query(
        `SELECT s.id AS stock_id, s.tenant_id, s.name AS stock_name, s.product_id AS current_product_id,
                p.name AS current_product_name, p2.id AS matched_product_id, p2.name AS matched_product_name
         FROM stock s
         JOIN products p
           ON p.tenant_id = s.tenant_id
          AND p.id = s.product_id
         LEFT JOIN products p2
           ON p2.tenant_id = s.tenant_id
          AND LOWER(TRIM(p2.name)) = LOWER(TRIM(s.name))
         WHERE s.tenant_id = ?
           AND LOWER(TRIM(COALESCE(s.name, ''))) <> LOWER(TRIM(COALESCE(p.name, '')))
         ORDER BY s.id, p2.id`,
        [tenantId]
    );

    const grouped = new Map();
    for (const row of rows) {
        if (!grouped.has(row.stock_id)) grouped.set(row.stock_id, []);
        grouped.get(row.stock_id).push(row);
    }

    return [...grouped.values()]
        .map((matches) => ({
            stockId: matches[0].stock_id,
            tenantId: matches[0].tenant_id,
            stockName: matches[0].stock_name,
            currentProductId: matches[0].current_product_id,
            currentProductName: matches[0].current_product_name,
            candidates: matches
                .filter((row) => row.matched_product_id != null)
                .map((row) => ({ id: row.matched_product_id, name: row.matched_product_name })),
        }))
        .filter((item) => item.candidates.length === 1 && item.candidates[0].id !== item.currentProductId);
}

async function main() {
    if (!Number.isFinite(TARGET_TENANT_ID) || TARGET_TENANT_ID <= 0) {
        throw new Error('Debes indicar --tenant=<id>');
    }

    const conn = await getConnection();
    try {
        const candidates = await getRelinkCandidates(conn, TARGET_TENANT_ID);

        console.log(`DB objetivo: ${DB_NAME}`);
        console.log(`Tenant objetivo: ${TARGET_TENANT_ID}`);
        console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

        if (!candidates.length) {
            console.log('No hay filas de stock para relinkear automáticamente.');
            return;
        }

        console.log('Relinks propuestos:');
        for (const item of candidates) {
            console.log(`- stock ${item.stockId}: "${item.stockName}" | ${item.currentProductId}:${item.currentProductName} -> ${item.candidates[0].id}:${item.candidates[0].name}`);
        }

        if (!APPLY) {
            console.log(`\nPara aplicar: node _relink_stock_by_name.js --tenant=${TARGET_TENANT_ID} --apply`);
            return;
        }

        await conn.beginTransaction();
        let moved = 0;
        for (const item of candidates) {
            const target = item.candidates[0];
            const [result] = await conn.query(
                `UPDATE stock
                 SET product_id = ?, name = ?
                 WHERE tenant_id = ? AND id = ?`,
                [target.id, target.name, item.tenantId, item.stockId]
            );
            moved += Number(result.affectedRows || 0);
        }
        await conn.commit();

        console.log(`Relinks aplicados: ${moved}`);
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('ERROR relinkeando stock por nombre:', error.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
}

main();
