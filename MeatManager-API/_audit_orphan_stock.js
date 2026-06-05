// Script para auditar registros huérfanos en la tabla stock
// Identifica productos en stock que no tienen correspondencia en la tabla products
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'mm_operational';
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg ? Number(tenantArg.split('=')[1]) : null;

const pluArg = process.argv.find((arg) => arg.startsWith('--plu='));
const pluFilter = pluArg ? pluArg.split('=')[1] : null;

const nameArg = process.argv.find((arg) => arg.startsWith('--name='));
const nameFilter = nameArg ? nameArg.split('=')[1] : null;

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: OPERATIONAL_DB_NAME,
    });

    try {
        console.log(`\n📊 AUDITORÍA DE STOCK HUÉRFANO`);
        console.log(`DB: ${OPERATIONAL_DB_NAME}`);
        console.log(`Tenant: ${Number.isFinite(tenantId) && tenantId > 0 ? tenantId : 'todos'}`);
        if (pluFilter) console.log(`Filtro PLU: ${pluFilter}`);
        if (nameFilter) console.log(`Filtro nombre: ${nameFilter}`);
        console.log('');

        // 1. Stock con product_id NULL
        const whereNull = ['s.product_id IS NULL'];
        const paramsNull = [];
        if (Number.isFinite(tenantId) && tenantId > 0) {
            whereNull.push('s.tenant_id = ?');
            paramsNull.push(tenantId);
        }
        if (nameFilter) {
            whereNull.push('s.name LIKE ?');
            paramsNull.push(`%${nameFilter}%`);
        }

        const [nullStocks] = await conn.query(
            `SELECT s.id, s.tenant_id, s.name, s.quantity, s.unit, s.type, s.product_id
             FROM stock s
             WHERE ${whereNull.join(' AND ')}
             ORDER BY s.tenant_id ASC, s.name ASC
             LIMIT 100`,
            paramsNull
        );

        console.log(`\n1️⃣  STOCK CON product_id NULL (${nullStocks.length} registros):`);
        if (nullStocks.length === 0) {
            console.log('   ✅ No hay registros de stock con product_id NULL');
        } else {
            console.log('   ⚠️  Se encontraron registros de stock sin product_id:');
            nullStocks.forEach((row) => {
                console.log(`   #${row.id} | tenant=${row.tenant_id} | "${row.name}" | ${row.quantity} ${row.unit} | tipo=${row.type || 'N/D'}`);
            });
        }

        // 2. Stock con product_id que no existe en products
        const whereOrphan = ['s.product_id IS NOT NULL'];
        const paramsOrphan = [];
        if (Number.isFinite(tenantId) && tenantId > 0) {
            whereOrphan.push('s.tenant_id = ?');
            paramsOrphan.push(tenantId);
        }
        if (nameFilter) {
            whereOrphan.push('s.name LIKE ?');
            paramsOrphan.push(`%${nameFilter}%`);
        }

        const [orphanStocks] = await conn.query(
            `SELECT s.id, s.tenant_id, s.name, s.quantity, s.unit, s.type, s.product_id
             FROM stock s
             LEFT JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
             WHERE ${whereOrphan.join(' AND ')}
               AND p.id IS NULL
             ORDER BY s.tenant_id ASC, s.name ASC
             LIMIT 100`,
            paramsOrphan
        );

        console.log(`\n2️⃣  STOCK CON product_id INVÁLIDO (${orphanStocks.length} registros):`);
        if (orphanStocks.length === 0) {
            console.log('   ✅ No hay registros de stock con product_id inválido');
        } else {
            console.log('   ⚠️  Se encontraron registros de stock con product_id que no existe en products:');
            orphanStocks.forEach((row) => {
                console.log(`   #${row.id} | tenant=${row.tenant_id} | "${row.name}" | product_id=${row.product_id} (NO EXISTE) | ${row.quantity} ${row.unit}`);
            });
        }

        // 3. Buscar si hay productos con el PLU filtrado
        if (pluFilter) {
            const wherePlu = ['p.plu = ?'];
            const paramsPlu = [pluFilter];
            if (Number.isFinite(tenantId) && tenantId > 0) {
                wherePlu.push('p.tenant_id = ?');
                paramsPlu.push(tenantId);
            }

            const [productsByPlu] = await conn.query(
                `SELECT p.id, p.tenant_id, p.name, p.plu, p.current_price, p.category
                 FROM products p
                 WHERE ${wherePlu.join(' AND ')}
                 ORDER BY p.id ASC`,
                paramsPlu
            );

            console.log(`\n3️⃣  PRODUCTOS CON PLU ${pluFilter} (${productsByPlu.length} registros):`);
            if (productsByPlu.length === 0) {
                console.log(`   ⚠️  No existe ningún producto con PLU ${pluFilter}`);
            } else {
                console.log(`   ✅ Se encontraron ${productsByPlu.length} productos con PLU ${pluFilter}:`);
                productsByPlu.forEach((row) => {
                    console.log(`   #${row.id} | tenant=${row.tenant_id} | "${row.name}" | PLU=${row.plu} | precio=${row.current_price} | cat=${row.category}`);
                });
            }

            // Buscar en stock registros que mencionen el PLU en el nombre
            const whereStockPlu = [];
            const paramsStockPlu = [];
            if (Number.isFinite(tenantId) && tenantId > 0) {
                whereStockPlu.push('s.tenant_id = ?');
                paramsStockPlu.push(tenantId);
            }

            const [stockMentions] = await conn.query(
                `SELECT s.id, s.tenant_id, s.name, s.quantity, s.unit, s.product_id,
                        p.id as prod_id, p.name as prod_name, p.plu as prod_plu
                 FROM stock s
                 LEFT JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
                 WHERE ${whereStockPlu.length > 0 ? whereStockPlu.join(' AND ') + ' AND' : ''} s.name LIKE ?
                 ORDER BY s.id ASC
                 LIMIT 50`,
                [...paramsStockPlu, `%${pluFilter}%`]
            );

            console.log(`\n4️⃣  STOCK QUE MENCIONA "${pluFilter}" (${stockMentions.length} registros):`);
            if (stockMentions.length === 0) {
                console.log(`   ✅ No hay registros de stock que mencionen "${pluFilter}"`);
            } else {
                stockMentions.forEach((row) => {
                    const productInfo = row.prod_id 
                        ? `producto #${row.prod_id} "${row.prod_name}" PLU=${row.prod_plu}`
                        : '❌ SIN PRODUCTO VINCULADO';
                    console.log(`   stock #${row.id} | tenant=${row.tenant_id} | "${row.name}" | ${row.quantity} ${row.unit} | ${productInfo}`);
                });
            }
        }

        // 5. Buscar por nombre si se especificó
        if (nameFilter) {
            const whereName = ['p.name LIKE ?'];
            const paramsName = [`%${nameFilter}%`];
            if (Number.isFinite(tenantId) && tenantId > 0) {
                whereName.push('p.tenant_id = ?');
                paramsName.push(tenantId);
            }

            const [productsByName] = await conn.query(
                `SELECT p.id, p.tenant_id, p.name, p.plu, p.current_price, p.category
                 FROM products p
                 WHERE ${whereName.join(' AND ')}
                 ORDER BY p.name ASC
                 LIMIT 50`,
                paramsName
            );

            console.log(`\n5️⃣  PRODUCTOS QUE CONTIENEN "${nameFilter}" (${productsByName.length} registros):`);
            if (productsByName.length === 0) {
                console.log(`   ⚠️  No existe ningún producto con nombre que contenga "${nameFilter}"`);
            } else {
                console.log(`   ✅ Se encontraron ${productsByName.length} productos:`);
                productsByName.forEach((row) => {
                    console.log(`   #${row.id} | tenant=${row.tenant_id} | "${row.name}" | PLU=${row.plu || 'sin PLU'} | precio=${row.current_price || 0}`);
                });
            }
        }

        console.log('\n📋 RESUMEN:');
        console.log(`   - Stock con product_id NULL: ${nullStocks.length}`);
        console.log(`   - Stock con product_id inválido: ${orphanStocks.length}`);
        console.log('\n💡 RECOMENDACIÓN:');
        if (orphanStocks.length > 0 || nullStocks.length > 0) {
            console.log('   1. Revisar los registros de stock huérfanos listados arriba');
            console.log('   2. Si son productos válidos, crear el producto correspondiente en "Productos de Compra"');
            console.log('   3. Si son registros obsoletos, eliminarlos de la tabla stock');
            console.log('   4. Luego, vincular el stock al producto creado usando el product_id');
        } else {
            console.log('   ✅ No se detectaron inconsistencias de stock huérfano');
        }

        console.log('\n📚 USO:');
        console.log('   node _audit_orphan_stock.js --tenant=4 --plu=34 --name=jamón');
        console.log('');

    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error('\n❌ ERROR:', error.message || error);
    process.exit(1);
});
