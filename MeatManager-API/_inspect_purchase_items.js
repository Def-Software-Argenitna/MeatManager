const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'meatmanager';

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });

    try {
        console.log('\n=== ESTRUCTURA DE purchase_items ===');
        const [cols] = await conn.query('DESCRIBE purchase_items');
        cols.forEach(c => console.log(`${c.Field.padEnd(25)} ${c.Type.padEnd(20)} ${c.Null} ${c.Key} ${c.Default || ''}`));

        console.log('\n=== EJEMPLO DE purchase_items existentes (tenant 4) ===');
        const [sample] = await conn.query('SELECT * FROM purchase_items WHERE tenant_id = 4 LIMIT 3');
        sample.forEach(s => console.log(JSON.stringify(s, null, 2)));

        console.log('\n=== PRODUCTO "JAMON DE CERDO" (PLU 34) ===');
        const [product] = await conn.query('SELECT * FROM products WHERE tenant_id = 4 AND plu = ?', ['34']);
        if (product.length > 0) {
            console.log(JSON.stringify(product[0], null, 2));
        } else {
            console.log('No encontrado');
        }

    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    process.exit(1);
});
