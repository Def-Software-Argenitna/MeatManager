// ============================================================================
// Diagnóstico SOLO-LECTURA de tickets de balanza "pisados" por colisión de barcode.
//
// Contexto: scale_bridge_ticket_map tenía UNIQUE(ticket_barcode). Como el
// ticket_barcode NO es único (precisión de minuto + checksum truncable, y la
// numeración se reinicia a 000000001 tras cada cierre fn32), dos ventas reales
// del mismo minuto con el mismo ticket_id generaban el mismo barcode y la
// segunda PISABA a la primera en ticket_map → el ticket desaparecía de
// Conciliación y no se podía anular.
//
// scale_sales_log (archivo permanente) NO tiene ese unique, así que ahí
// sobreviven AMBOS tickets. Este script cruza log ↔ ticket_map y lista:
//   1) Barcodes que absorbieron más de un ticket físico (la colisión).
//   2) Tickets "huérfanos": están en scale_sales_log pero NO tienen fila en
//      scale_bridge_ticket_map (los pisados → invisibles / no anulables).
//   3) Para cada huérfano, posibles ventas coincidentes por importe + fecha
//      (heurística: el barcode impreso codifica solo balanza + importe).
//
// NO modifica nada: son todos SELECT.
//
// Uso:
//   node _diag_lost_tickets.js [YYYY-MM-DD] [tenantId]
//   - Sin fecha: usa AYER.
//   - Sin tenantId: revisa todos los tenants.
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || 'mm_operational';

function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let dateArg = null;
    let tenantArg = null;
    for (const a of args) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(a)) dateArg = a;
        else if (/^\d+$/.test(a)) tenantArg = a;
    }
    if (!dateArg) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        dateArg = ymd(y);
    }
    return { day: dateArg, tenantId: tenantArg };
}

function money(n) {
    return Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

(async () => {
    const { day, tenantId } = parseArgs();
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_PROVISION_USER,
        password: process.env.DB_PROVISION_PASS,
        database: OPERATIONAL_DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
    });

    const tenantFilter = tenantId ? ' AND l.tenant_id = ?' : '';
    const tenantParam = tenantId ? [tenantId] : [];

    try {
        console.log('============================================================');
        console.log(`  DIAGNÓSTICO tickets pisados — día ${day}${tenantId ? ` — tenant ${tenantId}` : ' — TODOS los tenants'}`);
        console.log(`  (solo lectura, no modifica nada)`);
        console.log('============================================================\n');

        // ---- 1) Colisiones de barcode dentro del día ------------------------
        // Distintas identidades (device, ticket, sale_at) que comparten barcode.
        const [collisions] = await pool.query(
            `SELECT l.tenant_id, l.ticket_barcode,
                    COUNT(DISTINCT CONCAT(l.device_id,'|',l.ticket_id,'|',l.sale_at)) AS identidades,
                    GROUP_CONCAT(DISTINCT CONCAT(l.ticket_id,' @ ', DATE_FORMAT(l.sale_at,'%H:%i:%s'),
                                 ' = $', l.total_amount) ORDER BY l.sale_at SEPARATOR '  |  ') AS detalle
             FROM scale_sales_log l
             WHERE DATE(l.sale_at) = ?${tenantFilter}
             GROUP BY l.tenant_id, l.ticket_barcode
             HAVING identidades > 1
             ORDER BY identidades DESC`,
            [day, ...tenantParam]
        );

        console.log(`1) BARCODES CON COLISIÓN (más de un ticket físico bajo el mismo barcode): ${collisions.length}`);
        for (const c of collisions) {
            console.log(`   • tenant ${c.tenant_id}  barcode ${c.ticket_barcode}  → ${c.identidades} tickets`);
            console.log(`       ${c.detalle}`);
        }
        console.log('');

        // ---- 2) Tickets huérfanos: en el log pero SIN fila en ticket_map ----
        const [orphans] = await pool.query(
            `SELECT l.id AS log_id, l.tenant_id, l.branch_id, l.device_id, l.ticket_id,
                    l.ticket_barcode, l.printed_ticket_barcode, l.vendor_name,
                    l.sale_at, l.total_amount, l.item_count
             FROM scale_sales_log l
             LEFT JOIN scale_bridge_ticket_map t
                    ON t.device_id = l.device_id
                   AND t.ticket_id = l.ticket_id
                   AND t.sale_at   = l.sale_at
             WHERE DATE(l.sale_at) = ?${tenantFilter}
               AND t.id IS NULL
             ORDER BY l.tenant_id, l.sale_at`,
            [day, ...tenantParam]
        );

        console.log(`2) TICKETS HUÉRFANOS (en scale_sales_log pero SIN fila en scale_bridge_ticket_map → invisibles en Conciliación / no anulables): ${orphans.length}`);
        if (orphans.length === 0) {
            console.log('   ✅ Ninguno. No hay tickets pisados en esta fecha.\n');
        } else {
            let totalHuerfano = 0;
            for (const o of orphans) {
                totalHuerfano += Number(o.total_amount || 0);
                console.log(`   • tenant ${o.tenant_id} | device ${o.device_id} | ticket ${o.ticket_id} | ${o.sale_at.toISOString?.() || o.sale_at}`);
                console.log(`       vendedor: ${o.vendor_name || '—'} | ítems: ${o.item_count} | TOTAL: $${money(o.total_amount)}`);
                console.log(`       barcode: ${o.ticket_barcode} | impreso: ${o.printed_ticket_barcode || '—'} | log_id: ${o.log_id}`);

                // ¿Quién quedó "dueño" del barcode en ticket_map?
                const [owner] = await pool.query(
                    `SELECT ticket_id, sale_at, total_amount, ticket_status, charged_sale_id, voided_sale_id
                     FROM scale_bridge_ticket_map
                     WHERE device_id = ? AND ticket_barcode = ?
                     LIMIT 5`,
                    [o.device_id, o.ticket_barcode]
                );
                if (owner.length) {
                    for (const w of owner) {
                        console.log(`       ↳ barcode ocupado en ticket_map por: ticket ${w.ticket_id} @ ${w.sale_at.toISOString?.() || w.sale_at} $${money(w.total_amount)} [${w.ticket_status}]${w.charged_sale_id ? ` charged_sale_id=${w.charged_sale_id}` : ''}${w.voided_sale_id ? ` voided_sale_id=${w.voided_sale_id}` : ''}`);
                    }
                } else {
                    console.log(`       ↳ el barcode NO figura en ticket_map (posible falla de INSERT, no colisión)`);
                }

                // Heurística: ventas del mismo día por el mismo importe.
                const [ventas] = await pool.query(
                    `SELECT id, \`date\` AS fecha, total, source
                     FROM ventas
                     WHERE tenant_id = ?
                       AND DATE(\`date\`) = ?
                       AND ABS(total - ?) < 1
                     ORDER BY \`date\`
                     LIMIT 5`,
                    [o.tenant_id, day, o.total_amount]
                ).catch(() => [[]]);
                if (ventas.length) {
                    console.log(`       ↳ ventas del día con ese importe (candidatas a que YA se cobró): ${ventas.map(v => `#${v.id}(${v.source || '—'})`).join(', ')}`);
                } else {
                    console.log(`       ↳ sin venta del día con ese importe → probablemente NO se cobró`);
                }
                console.log('');
            }
            console.log(`   TOTAL importe de tickets huérfanos: $${money(totalHuerfano)}`);
            console.log('');
        }

        // ---- 3) Resumen ----------------------------------------------------
        console.log('------------------------------------------------------------');
        console.log(`  RESUMEN día ${day}: ${collisions.length} barcode(s) en colisión, ${orphans.length} ticket(s) huérfano(s).`);
        console.log('  Los huérfanos son los que "salieron de la balanza" y no aparecen en el sistema.');
        console.log('  Con el fix del índice ya no se pisan más; estos son los que quedaron de antes.');
        console.log('------------------------------------------------------------');
    } catch (err) {
        console.error('❌ ERROR:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
