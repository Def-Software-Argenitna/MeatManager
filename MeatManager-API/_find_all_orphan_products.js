// Script para detectar TODOS los productos huérfanos
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'meatmanager';

const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg ? Number(tenantArg.split('=')[1]) : null;

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });

    try {
        console.log(`\n🔍 BUSCAR PRODUCTOS HUÉRFANOS (sin purchase_items)`);
        console.log(`DB: ${OPERATIONAL_DB_NAME}`);
        if (tenantId) console.log(`Tenant: ${tenantId}`);
        console.log('');

        // Productos que NO tienen purchase_items
        const whereOrphan = ['p.id IS NOT NULL'];
        const paramsOrphan = [];
        
        if (tenantId) {
            whereOrphan.push('p.tenant_id = ?');
            paramsOrphan.push(tenantId);
        }

        const [orphanProducts] = await conn.query(
            `SELECT p.id, p.tenant_id, p.name, p.plu, p.current_price, p.category, p.source, p.created_at,
                    COUNT(DISTINCT s.id) as stock_count,
                    COUNT(DISTINCT vi.id) as ventas_count,
                    COUNT(DISTINCT ci.id) as compras_count
             FROM products p
             LEFT JOIN purchase_items pi ON pi.product_id = p.id AND pi.tenant_id = p.tenant_id
             LEFT JOIN stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
             LEFT JOIN ventas_items vi ON vi.product_id = p.id AND vi.tenant_id = p.tenant_id
             LEFT JOIN compras_items ci ON ci.product_id = p.id AND ci.tenant_id = p.tenant_id
             WHERE ${whereOrphan.join(' AND ')}
               AND pi.id IS NULL
             GROUP BY p.id, p.tenant_id, p.name, p.plu, p.current_price, p.category, p.source, p.created_at
             ORDER BY p.created_at DESC`,
            paramsOrphan
        );

        console.log(`📊 PRODUCTOS HUÉRFANOS (${orphanProducts.length}):`);
        console.log('');

        if (orphanProducts.length === 0) {
            console.log('✅ No se encontraron productos huérfanos');
        } else {
            console.log('⚠️  Se encontraron productos que existen en "products" pero NO en "purchase_items":');
            console.log('');
            
            orphanProducts.forEach((p, idx) => {
                const hasMovements = p.stock_count > 0 || p.ventas_count > 0 || p.compras_count > 0;
                const flag = hasMovements ? '🔴 TIENE MOVIMIENTOS' : '🟡 Sin movimientos';
                
                console.log(`${idx + 1}. ${flag}`);
                console.log(`   ID: ${p.id} | Tenant: ${p.tenant_id}`);
                console.log(`   Nombre: "${p.name}"`);
                console.log(`   PLU: ${p.plu || 'sin PLU'} | Precio: $${p.current_price || 0}`);
                console.log(`   Categoría: ${p.category} | Source: ${p.source}`);
                console.log(`   Creado: ${p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : 'N/D'}`);
                console.log(`   Stock: ${p.stock_count} | Ventas: ${p.ventas_count} | Compras: ${p.compras_count}`);
                console.log('');
            });

            // Agrupar por source
            const bySource = {};
            orphanProducts.forEach(p => {
                const src = p.source || 'unknown';
                if (!bySource[src]) bySource[src] = [];
                bySource[src].push(p);
            });

            console.log('📈 AGRUPACIÓN POR SOURCE:');
            Object.entries(bySource).forEach(([source, products]) => {
                console.log(`   ${source}: ${products.length} productos`);
            });
            console.log('');

            const withMovements = orphanProducts.filter(p => p.stock_count > 0 || p.ventas_count > 0 || p.compras_count > 0);
            console.log(`🔴 Productos huérfanos CON movimientos: ${withMovements.length}`);
            console.log(`🟡 Productos huérfanos SIN movimientos: ${orphanProducts.length - withMovements.length}`);
            console.log('');

            console.log('💡 PRÓXIMOS PASOS:');
            console.log('   1. Investigar por qué se crearon sin purchase_items (revisar código de creación)');
            console.log('   2. Para los productos CON movimientos: vincularlos con _link_orphan_products.js');
            console.log('   3. Para los productos SIN movimientos: evaluar si eliminarlos o vincularlos');
        }

        // También buscar el caso inverso: purchase_items sin product
        const [orphanPurchaseItems] = await conn.query(
            `SELECT pi.*, p.id as product_exists
             FROM purchase_items pi
             LEFT JOIN products p ON p.id = pi.product_id AND p.tenant_id = pi.tenant_id
             WHERE ${tenantId ? 'pi.tenant_id = ? AND' : ''} pi.product_id IS NOT NULL AND p.id IS NULL
             ORDER BY pi.id DESC
             LIMIT 50`,
            tenantId ? [tenantId] : []
        );

        console.log('');
        console.log(`🔄 CASO INVERSO: purchase_items con product_id inválido (${orphanPurchaseItems.length}):`);
        if (orphanPurchaseItems.length === 0) {
            console.log('   ✅ No hay purchase_items con product_id inválido');
        } else {
            console.log('   ⚠️  Hay purchase_items que apuntan a productos que no existen:');
            orphanPurchaseItems.forEach(pi => {
                console.log(`   purchase_item #${pi.id} | "${pi.name}" | product_id=${pi.product_id} (NO EXISTE)`);
            });
        }

    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    process.exit(1);
});
