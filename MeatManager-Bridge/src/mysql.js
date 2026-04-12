const mysql = require('mysql2/promise');

function buildMySqlPool(config) {
    return mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 5,
        namedPlaceholders: false,
        multipleStatements: false,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });
}

async function query(pool, sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

async function execute(pool, sql, params = []) {
    const [result] = await pool.execute(sql, params);
    return result;
}

async function withTransaction(pool, handler) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await handler(conn);
        await conn.commit();
        return result;
    } catch (error) {
        try {
            await conn.rollback();
        } catch {
            // noop
        }
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    buildMySqlPool,
    query,
    execute,
    withTransaction,
};
