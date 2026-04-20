const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';

const BRANCH_SCOPED_TABLES = ['ventas', 'caja_movimientos', 'pedidos', 'cash_closures', 'stock', 'promotions'];

const args = process.argv.slice(2);
const getArgValue = (flag) => {
    const found = args.find((arg) => arg.startsWith(`${flag}=`));
    return found ? found.slice(flag.length + 1) : '';
};

const tenantId = Number(getArgValue('--tenant') || 0);
const fromBranchId = Number(getArgValue('--from-branch') || 0);
const toBranchId = Number(getArgValue('--to-branch') || 0);
const apply = args.includes('--apply');
const tablesArg = String(getArgValue('--tables') || '').trim();
const selectedTables = tablesArg
    ? tablesArg.split(',').map((table) => table.trim()).filter(Boolean)
    : BRANCH_SCOPED_TABLES;

const tables = selectedTables.filter((table) => BRANCH_SCOPED_TABLES.includes(table));

if (!Number.isFinite(tenantId) || tenantId <= 0) {
    console.error('ERROR: --tenant es obligatorio y debe ser numérico > 0');
    process.exit(1);
}
if (!Number.isFinite(fromBranchId) || fromBranchId <= 0) {
    console.error('ERROR: --from-branch es obligatorio y debe ser numérico > 0');
    process.exit(1);
}
if (!Number.isFinite(toBranchId) || toBranchId <= 0) {
    console.error('ERROR: --to-branch es obligatorio y debe ser numérico > 0');
    process.exit(1);
}
if (fromBranchId === toBranchId) {
    console.error('ERROR: --from-branch y --to-branch no pueden ser iguales');
    process.exit(1);
}
if (!tables.length) {
    console.error('ERROR: no hay tablas válidas para remapear');
    process.exit(1);
}

const getConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: OPERATIONAL_DB_NAME,
});

(async () => {
    const conn = await getConnection();
    try {
        const dryRunSummary = [];
        for (const table of tables) {
            const [rows] = await conn.query(
                `SELECT COUNT(*) AS qty FROM \`${table}\` WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, fromBranchId]
            );
            dryRunSummary.push({
                table,
                candidateRows: Number(rows?.[0]?.qty || 0),
            });
        }

        if (!apply) {
            console.log(JSON.stringify({
                mode: 'dry-run',
                tenantId,
                fromBranchId,
                toBranchId,
                tables,
                summary: dryRunSummary,
            }, null, 2));
            return;
        }

        const backupPayload = {
            tenantId,
            fromBranchId,
            toBranchId,
            generatedAt: new Date().toISOString(),
            rowsByTable: {},
        };
        for (const table of tables) {
            const [rows] = await conn.query(
                `SELECT * FROM \`${table}\` WHERE tenant_id = ? AND branch_id = ? ORDER BY id ASC`,
                [tenantId, fromBranchId]
            );
            backupPayload.rowsByTable[table] = rows;
        }

        const backupDir = path.join(__dirname, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
        const backupPath = path.join(
            backupDir,
            `branch_remap_tenant${tenantId}_b${fromBranchId}_to_b${toBranchId}_${stamp}.json`
        );
        fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');

        await conn.beginTransaction();
        const updates = [];
        try {
            for (const table of tables) {
                const [result] = await conn.query(
                    `UPDATE \`${table}\`
                     SET branch_id = ?
                     WHERE tenant_id = ?
                       AND branch_id = ?`,
                    [toBranchId, tenantId, fromBranchId]
                );
                updates.push({
                    table,
                    updatedRows: Number(result?.affectedRows || 0),
                });
            }
            await conn.commit();
        } catch (error) {
            try { await conn.rollback(); } catch (_) {}
            throw error;
        }

        console.log(JSON.stringify({
            mode: 'apply',
            tenantId,
            fromBranchId,
            toBranchId,
            tables,
            backupPath,
            updates,
        }, null, 2));
    } finally {
        await conn.end();
    }
})().catch((error) => {
    console.error('ERROR remap branch scope:', error.message || error);
    process.exit(1);
});
