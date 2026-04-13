const config = require('c:/Users/Rodri/OneDrive/Documentos/GitHub/MeatManager/MeatManager-Bridge/src/config.js');
const mysql = require('c:/Users/Rodri/OneDrive/Documentos/GitHub/MeatManager/MeatManager-Bridge/src/mysql.js');

async function test() {
    try {
        const rows = await mysql.query('SELECT * FROM tenant_settings WHERE setting_key = "precio_formato"');
        console.log("precio_formato settings:", rows);
        
        const priceRows = await mysql.query('SELECT id, name, current_price, plu FROM products WHERE plu = 4 OR id = 4');
        console.log("Product PLU 4:", priceRows);
    } catch(e) {
        console.error("DB error:", e.message);
    } finally {
        process.exit(0);
    }
}
test();
