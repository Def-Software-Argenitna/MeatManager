// Script para vincular productos huérfanos a purchase_items
// Soluciona el problema cuando un producto existe en 'products' pero no en 'purchase_items'
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'meatmanager';

const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg ? Number(tenantArg.split('=')[1]) : null;

const pluArg = process.argv.find((arg) => arg.startsWith('--plu='));
const pluFilter = pluArg ? pluArg.split('=')[1] : null;

const productIdArg = process.argv.find((arg) => arg.startsWith('--product='));
const productId = productIdArg ? Number(productIdArg.split('=')[1]) : null;

const dryRun = !process.argv.includes('--commit');

async function main() {
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
        console.error('❌ ERROR: Debes especificar un tenant válido con --tenant=N');
        console.log('\n📚 USO:');
        console.log('   node _link_orphan_products.js --tenant=4 --plu=34 [--commit]');
        console.log('   node _link_orphan_products.js --tenant=4 --product=54 [--commit]');
        console.log('\n   Agregar --commit para aplicar los cambios (sin --commit es modo DRY-RUN)');
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });

    try {
        console.log(`\n🔧 VINCULAR PRODUCTOS HUÉRFANOS A PURCHASE_ITEMS`);
        console.log(`DB: ${OPERATIONAL_DB_NAME}`);
        console.log(`Tenant: ${tenantId}`);
        console.log(`Modo: ${dryRun ? '🔍 DRY-RUN (sin cambios)' : '✍️  COMMIT (aplicar cambios)'}`);
        console.log('');

        // Buscar el producto
        let whereProduct = ['p.tenant_id = ?'];
        let paramsProduct = [tenantId];

        if (productId) {
            whereProduct.push('p.id = ?');
            paramsProduct.push(productId);
        } else if (pluFilter) {
            whereProduct.push('p.plu = ?');
            paramsProduct.push(pluFilter);
        } else {
            console.error('❌ ERROR: Debes especificar --plu=N o --product=N');
            process.exit(1);
        }

        const [products] = await conn.query(
            `SELECT p.* FROM products p WHERE ${whereProduct.join(' AND ')}`,
            paramsProduct
        );

        if (products.length === 0) {
            console.log('❌ No se encontró ningún producto con los criterios especificados');
            process.exit(0);
        }

        if (products.length > 1) {
            console.log('⚠️  Se encontraron múltiples productos:');
            products.forEach(p => console.log(`   #${p.id} | "${p.name}" | PLU=${p.plu}`));
            console.log('\n   Usa --product=N para especificar cuál vincular');
            process.exit(1);
        }

        const product = products[0];
        console.log('✅ Producto encontrado:');
        console.log(`   ID: ${product.id}`);
        console.log(`   Nombre: ${product.name}`);
        console.log(`   PLU: ${product.plu || 'sin PLU'}`);
        console.log(`   Categoría: ${product.category} (ID: ${product.category_id})`);
        console.log(`   Precio: $${product.current_price || 0}`);
        console.log(`   Unidad: ${product.unit}`);
        console.log('');

        // Verificar si ya existe en purchase_items
        const [existingPurchaseItems] = await conn.query(
            `SELECT * FROM purchase_items WHERE tenant_id = ? AND product_id = ?`,
            [tenantId, product.id]
        );

        if (existingPurchaseItems.length > 0) {
            console.log('✅ El producto YA ESTÁ vinculado a purchase_items:');
            existingPurchaseItems.forEach(pi => {
                console.log(`   purchase_item #${pi.id} | "${pi.name}" | PLU=${pi.plu}`);
            });
            console.log('\n   No se requiere ninguna acción.');
            process.exit(0);
        }

        console.log('⚠️  El producto NO está en purchase_items');
        console.log('');

        // Inferir datos para purchase_items basado en el producto
        const speciesMap = {
            'vaca': 'vaca',
            'cerdo': 'cerdo',
            'pollo': 'pollo',
            'cordero': 'cordero',
            'ternera': 'vaca'
        };

        const species = speciesMap[product.category?.toLowerCase()] || 'vaca';
        const type = 'directo'; // Valor por defecto
        
        const purchaseItemData = {
            tenant_id: tenantId,
            name: product.name,
            product_id: product.id,
            category_id: product.category_id,
            last_price: 0, // Se actualizará con las compras futuras
            unit: product.unit || 'kg',
            type: type,
            is_preelaborable: 0,
            species: species,
            usage: null,
            default_iva_rate: 10.50,
            plu: product.plu,
            synced: 0
        };

        console.log('📝 Datos a insertar en purchase_items:');
        console.log(JSON.stringify(purchaseItemData, null, 2));
        console.log('');

        if (dryRun) {
            console.log('🔍 MODO DRY-RUN: No se aplicaron cambios');
            console.log('   Para aplicar los cambios, ejecuta nuevamente con --commit');
        } else {
            console.log('✍️  Insertando registro en purchase_items...');
            
            const [result] = await conn.query(
                `INSERT INTO purchase_items SET ?`,
                purchaseItemData
            );

            console.log(`✅ Registro creado exitosamente en purchase_items (ID: ${result.insertId})`);
            console.log('');
            console.log('✅ SOLUCIÓN APLICADA:');
            console.log(`   El producto "${product.name}" ahora aparecerá en "Productos de Compra"`);
            console.log('   La cliente podrá verlo y editarlo desde la interfaz');
        }

        console.log('');

    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    console.error(error.stack);
    process.exit(1);
});
