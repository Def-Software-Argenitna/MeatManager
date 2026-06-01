const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const dbName = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg ? Number(tenantArg.split('=')[1]) : null;

const formatMoney = (value) => Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        database: dbName,
    });

    try {
        const where = ['branch_id IS NULL'];
        const params = [];
        if (Number.isFinite(tenantId) && tenantId > 0) {
            where.push('tenant_id = ?');
            params.push(tenantId);
        }

        const [summary] = await conn.query(
            `SELECT tenant_id, COUNT(*) AS total, SUM(COALESCE(amount, 0)) AS raw_amount
             FROM caja_movimientos
             WHERE ${where.join(' AND ')}
             GROUP BY tenant_id
             ORDER BY tenant_id ASC`,
            params
        );

        const [rows] = await conn.query(
            `SELECT id, tenant_id, date, type, amount, category, description,
                    payment_method, payment_method_type, cash_account, receipt_code, sale_id
             FROM caja_movimientos
             WHERE ${where.join(' AND ')}
             ORDER BY tenant_id ASC, date DESC, id DESC
             LIMIT 500`,
            params
        );

        console.log(`DB: ${dbName}`);
        console.log(`Filtro tenant: ${Number.isFinite(tenantId) && tenantId > 0 ? tenantId : 'todos'}`);
        console.log('\nResumen de movimientos sin branch_id:');
        if (summary.length === 0) {
            console.log('No se encontraron movimientos huerfanos.');
        } else {
            summary.forEach((row) => {
                console.log(`tenant=${row.tenant_id} movimientos=${row.total} importe_bruto=${formatMoney(row.raw_amount)}`);
            });
        }

        console.log('\nUltimos movimientos sin branch_id (max 500):');
        rows.forEach((row) => {
            const date = row.date ? new Date(row.date).toISOString() : 'sin fecha';
            console.log([
                `#${row.id}`,
                `tenant=${row.tenant_id}`,
                date,
                row.type || '-',
                `${row.payment_method || '-'} / ${row.payment_method_type || '-'}`,
                row.cash_account || 'principal',
                `$${formatMoney(row.amount)}`,
                row.receipt_code ? `recibo=${row.receipt_code}` : '',
                row.sale_id ? `venta=${row.sale_id}` : '',
                row.category || '',
            ].filter(Boolean).join(' | '));
        });
    } finally {
        await conn.end();
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
