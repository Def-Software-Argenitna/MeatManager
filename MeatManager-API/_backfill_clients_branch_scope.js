const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const CLIENTS_DB_NAME = process.env.CLIENTS_DB_NAME || 'GestionClientes';
const CLIENT_BRANCHES_TABLE = process.env.CLIENT_BRANCHES_TABLE || 'branches';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantArg = Number((args.find((arg) => arg.startsWith('--tenant=')) || '').split('=')[1] || 0);

const getOperationalConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: OPERATIONAL_DB_NAME,
});

const getClientsConnection = async () => mysql.createConnection({
    host: process.env.CLIENTS_DB_HOST || process.env.DB_HOST,
    port: parseInt(process.env.CLIENTS_DB_PORT || process.env.DB_PORT || '3306', 10),
    user: process.env.CLIENTS_DB_USER || process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.CLIENTS_DB_PASS || process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: CLIENTS_DB_NAME,
});

async function ensureClientsBranchColumn(conn) {
    const [[column]] = await conn.query(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'clients'
           AND COLUMN_NAME = 'branch_id'
         LIMIT 1`
    );
    if (!column) {
        await conn.query('ALTER TABLE clients ADD COLUMN branch_id INT NULL AFTER tenant_id');
    }

    const [[indexRow]] = await conn.query(
        `SELECT INDEX_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'clients'
           AND INDEX_NAME = 'idx_clients_tenant_branch'
         LIMIT 1`
    );
    if (!indexRow) {
        await conn.query('CREATE INDEX idx_clients_tenant_branch ON clients (tenant_id, branch_id)');
    }
}

async function listTenantIds(conn) {
    if (Number.isFinite(tenantArg) && tenantArg > 0) return [tenantArg];
    const [rows] = await conn.query('SELECT DISTINCT tenant_id FROM clients WHERE tenant_id IS NOT NULL ORDER BY tenant_id');
    return rows.map((row) => Number(row.tenant_id)).filter((id) => Number.isFinite(id) && id > 0);
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

async function backupNullClients(conn, tenantId) {
    const [rows] = await conn.query(
        'SELECT * FROM clients WHERE tenant_id = ? AND branch_id IS NULL ORDER BY id ASC',
        [tenantId]
    );
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupPath = path.join(backupDir, `clients_branch_backfill_tenant${tenantId}_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ tenantId, generatedAt: new Date().toISOString(), rows }, null, 2), 'utf8');
    return { backupPath, rows: rows.length };
}

async function getBranchCandidates(conn, tenantId) {
    const [rows] = await conn.query(
        `SELECT client_id, branch_id, SUM(weight) AS weight
         FROM (
            SELECT clientId AS client_id, branch_id, COUNT(*) * 10 AS weight
            FROM ventas
            WHERE tenant_id = ?
              AND clientId IS NOT NULL
              AND branch_id IS NOT NULL
            GROUP BY clientId, branch_id
            UNION ALL
            SELECT client_id, branch_id, COUNT(*) * 5 AS weight
            FROM caja_movimientos
            WHERE tenant_id = ?
              AND client_id IS NOT NULL
              AND branch_id IS NOT NULL
            GROUP BY client_id, branch_id
            UNION ALL
            SELECT customer_id AS client_id, branch_id, COUNT(*) AS weight
            FROM pedidos
            WHERE tenant_id = ?
              AND customer_id IS NOT NULL
              AND branch_id IS NOT NULL
            GROUP BY customer_id, branch_id
         ) src
         GROUP BY client_id, branch_id
         ORDER BY client_id, weight DESC, branch_id ASC`,
        [tenantId, tenantId, tenantId]
    );

    const byClient = new Map();
    for (const row of rows) {
        const clientId = Number(row.client_id);
        const branchId = Number(row.branch_id);
        const weight = Number(row.weight || 0);
        if (!Number.isFinite(clientId) || !Number.isFinite(branchId)) continue;
        if (!byClient.has(clientId)) byClient.set(clientId, []);
        byClient.get(clientId).push({ branchId, weight });
    }
    return byClient;
}

async function buildAssignments({ conn, tenantId, activeBranchIds }) {
    const [clients] = await conn.query(
        'SELECT id, name FROM clients WHERE tenant_id = ? AND branch_id IS NULL ORDER BY id ASC',
        [tenantId]
    );
    const candidateMap = await getBranchCandidates(conn, tenantId);
    const activeSet = new Set(activeBranchIds.map(Number));
    const assignments = [];
    const ambiguous = [];
    const unassigned = [];

    for (const client of clients) {
        const candidates = (candidateMap.get(Number(client.id)) || [])
            .filter((candidate) => activeSet.has(Number(candidate.branchId)))
            .sort((a, b) => b.weight - a.weight || a.branchId - b.branchId);

        if (candidates.length === 0) {
            unassigned.push({ id: Number(client.id), name: client.name });
            continue;
        }

        const top = candidates[0];
        const second = candidates[1];
        if (second && Number(second.weight) === Number(top.weight)) {
            ambiguous.push({ id: Number(client.id), name: client.name, candidates });
            continue;
        }

        assignments.push({ id: Number(client.id), name: client.name, branchId: Number(top.branchId), weight: Number(top.weight), candidates });
    }

    return { assignments, ambiguous, unassigned };
}

(async () => {
    const conn = await getOperationalConnection();
    const clientsConn = await getClientsConnection();
    try {
        await ensureClientsBranchColumn(conn);
        const tenantIds = await listTenantIds(conn);
        const report = [];

        for (const tenantId of tenantIds) {
            const branches = await listActiveBranches(clientsConn, tenantId);
            const activeBranchIds = branches.map((branch) => Number(branch.id)).filter((id) => Number.isFinite(id) && id > 0);
            const backup = APPLY ? await backupNullClients(conn, tenantId) : null;
            const { assignments, ambiguous, unassigned } = await buildAssignments({ conn, tenantId, activeBranchIds });

            let updatedRows = 0;
            if (APPLY && assignments.length > 0) {
                await conn.beginTransaction();
                try {
                    for (const assignment of assignments) {
                        const [result] = await conn.query(
                            'UPDATE clients SET branch_id = ? WHERE tenant_id = ? AND id = ? AND branch_id IS NULL',
                            [assignment.branchId, tenantId, assignment.id]
                        );
                        updatedRows += Number(result?.affectedRows || 0);
                    }
                    await conn.commit();
                } catch (error) {
                    try { await conn.rollback(); } catch (_) {}
                    throw error;
                }
            }

            const [distribution] = await conn.query(
                `SELECT IFNULL(CAST(branch_id AS CHAR), 'NULL') AS branch_id, COUNT(*) AS qty
                 FROM clients
                 WHERE tenant_id = ?
                 GROUP BY branch_id
                 ORDER BY branch_id`,
                [tenantId]
            );

            report.push({
                tenantId,
                branches,
                mode: APPLY ? 'apply' : 'dry-run',
                backup,
                updatedRows,
                assignableRows: assignments.length,
                ambiguousRows: ambiguous.length,
                unassignedRows: unassigned.length,
                assignmentsSample: assignments.slice(0, 10),
                ambiguousSample: ambiguous.slice(0, 10),
                unassignedSample: unassigned.slice(0, 10),
                distribution,
            });
        }

        console.log(JSON.stringify(report, null, 2));
    } finally {
        await conn.end();
        await clientsConn.end();
    }
})().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
