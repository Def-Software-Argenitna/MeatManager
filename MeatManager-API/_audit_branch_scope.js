const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const CLIENTS_DB_NAME = process.env.CLIENTS_DB_NAME || 'clients_control';
const CLIENT_BRANCHES_TABLE = process.env.CLIENT_BRANCHES_TABLE || 'branches';

const BRANCH_SCOPED_TABLES = ['ventas', 'caja_movimientos', 'pedidos', 'cash_closures', 'stock', 'promotions'];

const args = process.argv.slice(2);
const getArgValue = (flag) => {
    const found = args.find((arg) => arg.startsWith(`${flag}=`));
    return found ? found.slice(flag.length + 1) : '';
};
const tenantArg = Number(getArgValue('--tenant') || 0);
const APPLY_SINGLE_BRANCH_BACKFILL = args.includes('--apply-single-branch-backfill');

const getOperationalConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: OPERATIONAL_DB_NAME,
});

const getClientsConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: CLIENTS_DB_NAME,
});

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

async function listTenantIds(conn, specificTenantId = null) {
    if (Number.isFinite(specificTenantId) && specificTenantId > 0) {
        return [specificTenantId];
    }

    const tenantIds = new Set();
    for (const table of BRANCH_SCOPED_TABLES) {
        const [rows] = await conn.query(
            `SELECT DISTINCT tenant_id FROM \`${table}\` WHERE tenant_id IS NOT NULL`
        );
        rows.forEach((row) => {
            const tenantId = toFiniteNumber(row?.tenant_id);
            if (tenantId != null && tenantId > 0) tenantIds.add(tenantId);
        });
    }

    return Array.from(tenantIds).sort((a, b) => a - b);
}

async function listActiveBranches(conn, tenantId) {
    const [rows] = await conn.query(
        `SELECT id, name, internalCode, status
         FROM \`${CLIENT_BRANCHES_TABLE}\`
         WHERE clientId = ?
           AND status = 'ACTIVE'
         ORDER BY id ASC`,
        [tenantId]
    );

    return rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || '').trim(),
        internalCode: String(row.internalCode || '').trim(),
        status: String(row.status || '').trim(),
    }));
}

async function getTableBranchStats(conn, tenantId, table) {
    const [totals] = await conn.query(
        `SELECT
            COUNT(*) AS total_rows,
            SUM(branch_id IS NULL) AS null_branch_rows
         FROM \`${table}\`
         WHERE tenant_id = ?`,
        [tenantId]
    );

    const [distribution] = await conn.query(
        `SELECT branch_id, COUNT(*) AS qty
         FROM \`${table}\`
         WHERE tenant_id = ?
         GROUP BY branch_id
         ORDER BY branch_id`,
        [tenantId]
    );

    return {
        totalRows: Number(totals?.[0]?.total_rows || 0),
        nullBranchRows: Number(totals?.[0]?.null_branch_rows || 0),
        distribution: distribution.map((row) => ({
            branchId: row.branch_id == null ? null : Number(row.branch_id),
            qty: Number(row.qty || 0),
        })),
    };
}

async function listInvalidBranchRows(conn, tenantId, table, activeBranchIds = []) {
    if (!activeBranchIds.length) return [];

    const placeholders = activeBranchIds.map(() => '?').join(', ');
    const [rows] = await conn.query(
        `SELECT id, branch_id
         FROM \`${table}\`
         WHERE tenant_id = ?
           AND branch_id IS NOT NULL
           AND branch_id NOT IN (${placeholders})
         ORDER BY id ASC
         LIMIT 50`,
        [tenantId, ...activeBranchIds]
    );

    return rows.map((row) => ({
        id: Number(row.id),
        branchId: Number(row.branch_id),
    }));
}

async function applySingleBranchBackfill({
    operationalConn,
    tenantId,
    targetBranchId,
    tables,
}) {
    const rowsByTable = {};
    for (const table of tables) {
        const [rows] = await operationalConn.query(
            `SELECT * FROM \`${table}\` WHERE tenant_id = ? AND branch_id IS NULL ORDER BY id ASC`,
            [tenantId]
        );
        rowsByTable[table] = rows;
    }

    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupPath = path.join(backupDir, `branch_scope_backfill_tenant${tenantId}_${stamp}.json`);
    fs.writeFileSync(
        backupPath,
        JSON.stringify(
            {
                tenantId,
                targetBranchId,
                generatedAt: new Date().toISOString(),
                rowsByTable,
            },
            null,
            2
        ),
        'utf8'
    );

    await operationalConn.beginTransaction();
    try {
        const updateSummary = [];
        for (const table of tables) {
            const [result] = await operationalConn.query(
                `UPDATE \`${table}\`
                 SET branch_id = ?
                 WHERE tenant_id = ?
                   AND branch_id IS NULL`,
                [targetBranchId, tenantId]
            );
            updateSummary.push({
                table,
                updatedRows: Number(result?.affectedRows || 0),
            });
        }
        await operationalConn.commit();
        return { backupPath, updateSummary };
    } catch (error) {
        try { await operationalConn.rollback(); } catch (_) {}
        throw error;
    }
}

(async () => {
    const operationalConn = await getOperationalConnection();
    const clientsConn = await getClientsConnection();

    try {
        const tenantIds = await listTenantIds(
            operationalConn,
            Number.isFinite(tenantArg) && tenantArg > 0 ? tenantArg : null
        );
        if (!tenantIds.length) {
            console.log('No se encontraron tenants para auditar.');
            return;
        }

        const report = [];
        for (const tenantId of tenantIds) {
            const activeBranches = await listActiveBranches(clientsConn, tenantId);
            const activeBranchIds = activeBranches
                .map((branch) => Number(branch.id))
                .filter((id) => Number.isFinite(id) && id > 0);

            const tableStats = {};
            for (const table of BRANCH_SCOPED_TABLES) {
                const stats = await getTableBranchStats(operationalConn, tenantId, table);
                const invalidSample = await listInvalidBranchRows(
                    operationalConn,
                    tenantId,
                    table,
                    activeBranchIds
                );
                tableStats[table] = {
                    ...stats,
                    invalidBranchRows: invalidSample.length,
                    invalidBranchSample: invalidSample,
                };
            }

            const tenantReport = {
                tenantId,
                activeBranches,
                tables: tableStats,
            };

            if (APPLY_SINGLE_BRANCH_BACKFILL && activeBranchIds.length === 1) {
                const { backupPath, updateSummary } = await applySingleBranchBackfill({
                    operationalConn,
                    tenantId,
                    targetBranchId: activeBranchIds[0],
                    tables: BRANCH_SCOPED_TABLES,
                });
                tenantReport.appliedBackfill = {
                    targetBranchId: activeBranchIds[0],
                    backupPath,
                    updateSummary,
                };
            } else if (APPLY_SINGLE_BRANCH_BACKFILL) {
                tenantReport.appliedBackfill = {
                    skipped: true,
                    reason: `tenant con ${activeBranchIds.length} sucursales activas`,
                };
            }

            report.push(tenantReport);
        }

        console.log(JSON.stringify({
            generatedAt: new Date().toISOString(),
            database: OPERATIONAL_DB_NAME,
            tenantFilter: Number.isFinite(tenantArg) && tenantArg > 0 ? tenantArg : null,
            applySingleBranchBackfill: APPLY_SINGLE_BRANCH_BACKFILL,
            branchScopedTables: BRANCH_SCOPED_TABLES,
            report,
        }, null, 2));
    } finally {
        await operationalConn.end();
        await clientsConn.end();
    }
})().catch((error) => {
    console.error('ERROR audit branch scope:', error.message || error);
    process.exit(1);
});
