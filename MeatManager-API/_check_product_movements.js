// Script para verificar todos los movimientos de un producto
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

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });

    try {
        console.log(`\n📊 VERIFICAR MOVIMIENTOS DE PRODUCTO`);
        console.log(`DB: ${OPERATIONAL_DB_NAME}`);
        if (tenantId) console.log(`Tenant: ${tenantId}`);
        if (pluFilter) console.log(`PLU: ${pluFilter}`);
        if (productId) console.log(`Product ID: ${productId}`);
        console.log('');

        // Buscar el producto
        let whereProduct = [];
        let paramsProduct = [];

        if (tenantId) {
            whereProduct.push('p.tenant_id = ?');
            paramsProduct.push(tenantId);
        }

        if (productId) {
            whereProduct.push('p.id = ?');
            paramsProduct.push(productId);
        } else if (pluFilter) {
            whereProduct.push('p.plu = ?');
            paramsProduct.push(pluFilter);
        }

        const [products] = await conn.query(
            `SELECT p.* FROM products p WHERE ${whereProduct.join(' AND ')}`,
            paramsProduct
        );

        if (products.length === 0) {
            console.log('❌ No se encontró el producto');
            process.exit(0);
        }

        const product = products[0];
        console.log('✅ PRODUCTO:');
        console.log(`   ID: ${product.id}`);
        console.log(`   Tenant: ${product.tenant_id}`);
        console.log(`   Nombre: ${product.name}`);
        console.log(`   PLU: ${product.plu || 'sin PLU'}`);
        console.log(`   Precio actual: $${product.current_price || 0}`);
        console.log('');

        // 1. Stock
        const [stockRecords] = await conn.query(
            `SELECT * FROM stock WHERE tenant_id = ? AND product_id = ? ORDER BY id ASC`,
            [product.tenant_id, product.id]
        );

        console.log(`📦 STOCK (${stockRecords.length} registros):`);
        if (stockRecords.length === 0) {
            console.log('   Sin registros de stock');
        } else {
            let totalStock = 0;
            stockRecords.forEach(s => {
                const qty = Number(s.quantity || 0);
                totalStock += qty;
                console.log(`   #${s.id} | branch=${s.branch_id || 'N/D'} | ${qty} ${s.unit} | nombre="${s.name}"`);
            });
            console.log(`   TOTAL STOCK: ${totalStock.toFixed(3)} ${stockRecords[0]?.unit || 'kg'}`);
        }
        console.log('');

        // 2. Ventas (ventas_items)
        const [saleItems] = await conn.query(
            `SELECT vi.*, v.date as sale_date 
             FROM ventas_items vi
             LEFT JOIN ventas v ON v.id = vi.venta_id AND v.tenant_id = vi.tenant_id
             WHERE vi.tenant_id = ? AND vi.product_id = ?
             ORDER BY vi.id DESC
             LIMIT 20`,
            [product.tenant_id, product.id]
        );

        console.log(`🛒 VENTAS (últimas ${Math.min(saleItems.length, 20)} de ventas_items):`);
        if (saleItems.length === 0) {
            console.log('   Sin ventas registradas');
        } else {
            let totalVentas = 0;
            let totalImporte = 0;
            saleItems.forEach(si => {
                const qty = Number(si.quantity || 0);
                const price = Number(si.price || 0);
                const total = qty * price;
                totalVentas += qty;
                totalImporte += total;
                const date = si.sale_date ? new Date(si.sale_date).toISOString().split('T')[0] : 'N/D';
                const unit = si.product_name || '?';
                console.log(`   #${si.id} | venta=${si.venta_id} | ${date} | "${si.product_name}" | ${qty.toFixed(3)} × $${price} = $${total.toFixed(2)}`);
            });
            console.log(`   TOTALES: ${totalVentas.toFixed(3)} unidades, $${totalImporte.toFixed(2)}`);
        }
        console.log('');

        // 3. Compras (compras_items)
        const [purchaseOrderItems] = await conn.query(
            `SELECT ci.*, c.date as purchase_date, c.supplier
             FROM compras_items ci
             LEFT JOIN compras c ON c.id = ci.purchase_id AND c.tenant_id = ci.tenant_id
             WHERE ci.tenant_id = ? AND ci.product_id = ?
             ORDER BY ci.id DESC
             LIMIT 20`,
            [product.tenant_id, product.id]
        );

        console.log(`📥 COMPRAS (últimas ${Math.min(purchaseOrderItems.length, 20)} de compras_items):`);
        if (purchaseOrderItems.length === 0) {
            console.log('   Sin compras registradas');
        } else {
            let totalCompras = 0;
            let totalCosto = 0;
            purchaseOrderItems.forEach(poi => {
                const qty = Number(poi.quantity || 0);
                const price = Number(poi.unit_price || 0);
                const total = qty * price;
                totalCompras += qty;
                totalCosto += total;
                const date = poi.purchase_date ? new Date(poi.purchase_date).toISOString().split('T')[0] : 'N/D';
                console.log(`   #${poi.id} | compra=${poi.purchase_id} | ${date} | "${poi.supplier || 'N/D'}" | ${qty.toFixed(3)} × $${price} = $${total.toFixed(2)}`);
            });
            console.log(`   TOTALES: ${totalCompras.toFixed(3)} unidades, $${totalCosto.toFixed(2)}`);
        }
        console.log('');

        // 4. Precios históricos
        const [prices] = await conn.query(
            `SELECT * FROM prices WHERE tenant_id = ? AND product_ref_id = ? ORDER BY updated_at DESC LIMIT 10`,
            [product.tenant_id, product.id]
        );

        console.log(`💰 PRECIOS (${prices.length} registros en tabla prices):`);
        if (prices.length === 0) {
            console.log('   Sin registros en tabla prices');
        } else {
            prices.forEach(p => {
                const date = p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : 'N/D';
                console.log(`   #${p.id} | ${date} | product_id="${p.product_id}" | precio=$${p.price} | PLU=${p.plu || 'N/D'}`);
            });
        }
        console.log('');

        // 5. Purchase_items
        const [purchaseItems] = await conn.query(
            `SELECT * FROM purchase_items WHERE tenant_id = ? AND product_id = ?`,
            [product.tenant_id, product.id]
        );

        console.log(`📋 PURCHASE_ITEMS (${purchaseItems.length} registros):`);
        if (purchaseItems.length === 0) {
            console.log('   ❌ NO EXISTE en purchase_items (por eso no aparece en "Productos de Compra")');
        } else {
            purchaseItems.forEach(pi => {
                console.log(`   #${pi.id} | "${pi.name}" | PLU=${pi.plu || 'N/D'} | last_price=$${pi.last_price || 0} | type=${pi.type}`);
            });
        }
        console.log('');

        // Resumen
        console.log('📊 RESUMEN:');
        console.log(`   Stock registros: ${stockRecords.length}`);
        console.log(`   Ventas: ${saleItems.length > 0 ? saleItems.length + (saleItems.length >= 20 ? '+' : '') : '0'}`);
        console.log(`   Compras: ${purchaseOrderItems.length > 0 ? purchaseOrderItems.length + (purchaseOrderItems.length >= 20 ? '+' : '') : '0'}`);
        console.log(`   Precios: ${prices.length}`);
        console.log(`   Purchase_items: ${purchaseItems.length === 0 ? '❌ FALTANTE' : '✅ ' + purchaseItems.length}`);
        console.log('');

        if (purchaseItems.length === 0) {
            console.log('💡 SOLUCIÓN:');
            console.log(`   El producto tiene movimientos pero NO está en purchase_items.`);
            console.log(`   Ejecutar: node _link_orphan_products.js --tenant=${product.tenant_id} --product=${product.id} --commit`);
            console.log('   Esto creará el registro faltante manteniendo toda la data existente.');
        }

    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    process.exit(1);
});
