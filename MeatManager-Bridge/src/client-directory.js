const mysql = require('mysql2/promise');

function buildClientDirectoryPool(config) {
    return mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 3,
        namedPlaceholders: false,
        multipleStatements: false,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });
}

async function listClients(pool, search = '') {
    const filters = String(search || '').trim();
    const like = `%${filters}%`;
    const [rows] = await pool.query(
        `SELECT
            c.id,
            c.businessName,
            c.taxId,
            c.billingEmail,
            c.status
         FROM clients c
         ${filters ? 'WHERE c.businessName LIKE ? OR c.taxId LIKE ? OR c.billingEmail LIKE ?' : ''}
         ORDER BY c.businessName ASC
         LIMIT 1000`,
        filters ? [like, like, like] : []
    );
    return rows || [];
}

async function getClientById(pool, clientId) {
    if (!Number.isFinite(Number(clientId)) || Number(clientId) <= 0) return null;
    const [rows] = await pool.query(
        `SELECT
            c.id,
            c.businessName,
            c.taxId,
            c.billingEmail,
            c.status
         FROM clients c
         WHERE c.id = ?
         LIMIT 1`,
        [Number(clientId)]
    );
    return rows?.[0] || null;
}

async function listBranches(pool, clientId) {
    if (!Number.isFinite(Number(clientId)) || Number(clientId) <= 0) return [];
    const [rows] = await pool.query(
        `SELECT
            id,
            clientId,
            name,
            internalCode,
            address,
            isBillable,
            status
         FROM branches
         WHERE clientId = ?
           AND status = 'ACTIVE'
         ORDER BY id ASC`,
        [Number(clientId)]
    );
    return rows || [];
}

async function getBranchById(pool, branchId) {
    if (!Number.isFinite(Number(branchId)) || Number(branchId) <= 0) return null;
    const [rows] = await pool.query(
        `SELECT
            id,
            clientId,
            name,
            internalCode,
            address,
            isBillable,
            status
         FROM branches
         WHERE id = ?
         LIMIT 1`,
        [Number(branchId)]
    );
    return rows?.[0] || null;
}

module.exports = {
    buildClientDirectoryPool,
    listClients,
    getClientById,
    listBranches,
    getBranchById,
};
