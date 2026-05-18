const mysql = require('../src/mysql.js');
const mysql2 = require('mysql2/promise');
const config = require('../src/config.js');

async function test() {
    let connection;
    try {
        console.log("Connecting using config...");
        const pool = mysql2.createPool({
            host: config.mysql.host,
            port: config.mysql.port,
            user: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
        });
        
        await pool.query('TRUNCATE TABLE scale_bridge_product_map');
        console.log("Truncated scale_bridge_product_map. Force resync activated.");
        
    } catch(e) {
        console.error("DB error:", e.message);
    } finally {
        process.exit(0);
    }
}
test();
