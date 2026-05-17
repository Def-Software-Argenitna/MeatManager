const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_PROVISION_USER,
        password: process.env.DB_PROVISION_PASS
    });
    const [dbs] = await c.query("SHOW DATABASES");
    console.log('Todas las BDs en el servidor:');
    dbs.forEach(r => console.log(' -', Object.values(r)[0]));
    await c.end();
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
