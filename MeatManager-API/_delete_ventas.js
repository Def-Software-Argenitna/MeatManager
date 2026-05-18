// Script para borrar TODAS las ventas de la base de datos
// ⚠️ PRECAUCIÓN: Esta acción es IRREVERSIBLE
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const readline = require('readline');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'mm_operational';

async function askConfirmation(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 's' || answer.toLowerCase() === 'si' || answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
        });
    });
}

(async () => {
    let conn;
    try {
        console.log('🔌 Conectando a la base de datos...');
        
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_PROVISION_USER,
            password: process.env.DB_PROVISION_PASS,
            database: OPERATIONAL_DB_NAME,
            waitForConnections: true,
            connectionLimit: 5
        });

        conn = await pool.getConnection();
        
        // Contar ventas actuales
        const [ventasCount] = await conn.query(`SELECT COUNT(*) as total FROM ventas`);
        const [itemsCount] = await conn.query(`SELECT COUNT(*) as total FROM ventas_items`);
        
        console.log('\n📊 ESTADO ACTUAL:');
        console.log(`   - Ventas: ${ventasCount[0].total}`);
        console.log(`   - Items de ventas: ${itemsCount[0].total}`);
        
        if (ventasCount[0].total === 0) {
            console.log('\n✅ No hay ventas para borrar.');
            await conn.release();
            await pool.end();
            process.exit(0);
        }
        
        // Mostrar algunas ventas de ejemplo
        const [sampleVentas] = await conn.query(`
            SELECT id, tenant_id, date, total, payment_method 
            FROM ventas 
            ORDER BY date DESC 
            LIMIT 5
        `);
        
        console.log('\n📋 Últimas 5 ventas:');
        sampleVentas.forEach(v => {
            console.log(`   - ID: ${v.id}, Tenant: ${v.tenant_id}, Fecha: ${v.date}, Total: $${v.total}`);
        });
        
        console.log('\n⚠️  ADVERTENCIA: Esta acción eliminará TODAS las ventas y no se puede deshacer.');
        console.log('⚠️  Solo se borrarán las tablas: ventas, ventas_items');
        console.log('⚠️  NO se tocarán: productos, stock, clientes, compras, usuarios, etc.\n');
        
        const confirmed = await askConfirmation('¿Estás seguro de que quieres borrar TODAS las ventas? (s/n): ');
        
        if (!confirmed) {
            console.log('\n❌ Operación cancelada.');
            await conn.release();
            await pool.end();
            process.exit(0);
        }
        
        console.log('\n🗑️  Iniciando borrado de ventas...');
        
        // Iniciar transacción
        await conn.beginTransaction();
        
        try {
            // 1. Borrar items de ventas primero (por foreign keys)
            console.log('   - Borrando items de ventas...');
            const [deleteItems] = await conn.query(`DELETE FROM ventas_items`);
            console.log(`   ✅ ${deleteItems.affectedRows} items borrados`);
            
            // 2. Borrar ventas
            console.log('   - Borrando ventas...');
            const [deleteVentas] = await conn.query(`DELETE FROM ventas`);
            console.log(`   ✅ ${deleteVentas.affectedRows} ventas borradas`);
            
            // Confirmar transacción
            await conn.commit();
            console.log('\n✅ OPERACIÓN COMPLETADA EXITOSAMENTE');
            console.log('✅ Todas las ventas han sido eliminadas de la base de datos.');
            
        } catch (err) {
            // Revertir si hay error
            await conn.rollback();
            console.error('\n❌ ERROR durante el borrado:', err.message);
            console.log('🔄 Transacción revertida. No se realizaron cambios.');
            throw err;
        }
        
        await conn.release();
        await pool.end();
        process.exit(0);
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        if (conn) {
            try {
                await conn.release();
            } catch (_) {}
        }
        process.exit(1);
    }
})();
