const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: 'meatmanager'
    });
    
    const [tables] = await conn.query("SHOW TABLES LIKE '%sale%'");
    console.log('\nTablas relacionadas con "sale":');
    tables.forEach(t => console.log('  -', Object.values(t)[0]));
    
    const [tables2] = await conn.query("SHOW TABLES LIKE '%venta%'");
    console.log('\nTablas relacionadas con "venta":');
    tables2.forEach(t => console.log('  -', Object.values(t)[0]));
    
    await conn.end();
})();
