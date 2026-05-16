// Script para limpiar las tablas del Scale Bridge
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
        
        // Contar registros actuales
        const [salesCount] = await conn.query(`SELECT COUNT(*) as total FROM scale_bridge_sales_item`);
        const [ticketsCount] = await conn.query(`SELECT COUNT(*) as total FROM scale_bridge_ticket_map`);
        
        console.log('\n📊 ESTADO ACTUAL DE TABLAS DEL BRIDGE:');
        console.log(`   - scale_bridge_sales_item: ${salesCount[0].total} registros`);
        console.log(`   - scale_bridge_ticket_map: ${ticketsCount[0].total} registros`);
        
        if (salesCount[0].total === 0 && ticketsCount[0].total === 0) {
            console.log('\n✅ Las tablas del bridge ya están vacías.');
            await conn.release();
            await pool.end();
            process.exit(0);
        }
        
        console.log('\n⚠️  ADVERTENCIA: Esta acción borrará TODOS los datos del bridge.');
        console.log('⚠️  Las ventas de la báscula deberán ser sincronizadas nuevamente.');
        console.log('⚠️  NO se tocarán: productos, ventas, stock, clientes, etc.\n');
        
        const confirmed = await askConfirmation('¿Estás seguro de que quieres borrar las tablas del bridge? (s/n): ');
        
        if (!confirmed) {
            console.log('\n❌ Operación cancelada.');
            await conn.release();
            await pool.end();
            process.exit(0);
        }
        
        console.log('\n🗑️  Iniciando limpieza de tablas del bridge...');
        
        // Iniciar transacción
        await conn.beginTransaction();
        
        try {
            // 1. Borrar items de ventas del bridge
            console.log('   - Borrando scale_bridge_sales_item...');
            const [deleteSales] = await conn.query(`DELETE FROM scale_bridge_sales_item`);
            console.log(`   ✅ ${deleteSales.affectedRows} registros borrados`);
            
            // 2. Borrar tickets del bridge
            console.log('   - Borrando scale_bridge_ticket_map...');
            const [deleteTickets] = await conn.query(`DELETE FROM scale_bridge_ticket_map`);
            console.log(`   ✅ ${deleteTickets.affectedRows} registros borrados`);
            
            // Confirmar transacción
            await conn.commit();
            console.log('\n✅ OPERACIÓN COMPLETADA EXITOSAMENTE');
            console.log('✅ Las tablas del bridge han sido limpiadas.');
            console.log('💡 Ejecuta una sincronización en el Bridge para repoblar los datos.');
            
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
