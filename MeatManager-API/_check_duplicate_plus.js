// Script para verificar PLUs duplicados en products
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'mm_operational';

(async () => {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_PROVISION_USER,
            password: process.env.DB_PROVISION_PASS,
            database: OPERATIONAL_DB_NAME,
            waitForConnections: true,
            connectionLimit: 5
        });

        // Buscar PLUs duplicados
        const [duplicates] = await pool.query(`
            SELECT plu, COUNT(*) as count, GROUP_CONCAT(CONCAT(id, ':', name) SEPARATOR ' | ') as products
            FROM products
            WHERE plu IS NOT NULL AND plu != ''
            GROUP BY plu
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `);

        console.log('\n📊 PLUs DUPLICADOS:\n');
        if (duplicates.length === 0) {
            console.log('✅ No hay PLUs duplicados\n');
        } else {
            console.log(`⚠️  Se encontraron ${duplicates.length} PLUs duplicados:\n`);
            duplicates.forEach(row => {
                console.log(`   PLU: ${row.plu} (${row.count} productos)`);
                console.log(`   Productos: ${row.products}`);
                console.log('');
            });
        }

        // Verificar si existe scale_bridge_product_map
        const [tables] = await pool.query(`SHOW TABLES LIKE 'scale_bridge_product_map'`);
        if (tables.length > 0) {
            const [mapCount] = await pool.query(`SELECT COUNT(*) as total FROM scale_bridge_product_map`);
            console.log(`\n📋 Registros en scale_bridge_product_map: ${mapCount[0].total}`);
            
            const [mapSample] = await pool.query(`
                SELECT m.*, p.name as product_name
                FROM scale_bridge_product_map m
                LEFT JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
                LIMIT 10
            `);
            
            console.log('\n📋 Muestra de scale_bridge_product_map:');
            mapSample.forEach(row => {
                console.log(`   Device: ${row.device_id}, PLU: ${row.plu_code}, Product: ${row.product_id} (${row.product_name})`);
            });
        } else {
            console.log('\n⚠️  La tabla scale_bridge_product_map no existe');
        }

        // Ver ventas recientes del bridge
        const [bridgeSales] = await pool.query(`
            SELECT s.*, p.id as matched_product_id, p.name as matched_product_name
            FROM scale_bridge_sales_item s
            LEFT JOIN products p 
              ON p.tenant_id = s.tenant_id
             AND (
                  CAST(p.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                  OR CAST(p.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4)) COLLATE utf8mb4_unicode_ci
             )
            ORDER BY s.sale_at DESC
            LIMIT 10
        `);

        console.log('\n📋 Últimas 10 ventas del bridge y sus productos mapeados:');
        bridgeSales.forEach(row => {
            console.log(`   Ticket: ${row.ticket_id}, PLU: ${row.plu_code}, Producto mapeado: ${row.matched_product_id} (${row.matched_product_name})`);
        });

        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        process.exit(1);
    }
})();
