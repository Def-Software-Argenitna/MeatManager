const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

const formatMoney = (value) => `$${Number(value || 0).toLocaleString('es-AR')}`;
const formatDate = (value) => {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('es-AR');
};

export const printCurrentAccountA4 = ({
    entityLabel = 'Cliente',
    entityName = '-',
    entityDocument = '',
    title = 'Detalle de Cuenta Corriente',
    subtitle = '',
    rows = [],
    summary = {},
    generatedAt = new Date()
}) => {
    const printWindow = window.open('', '_blank', 'width=1024,height=900');
    if (!printWindow) return;

    const rowsHtml = rows.length > 0
        ? rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatDate(row.date))}</td>
                <td>${escapeHtml(row.concept || '-')}</td>
                <td>${escapeHtml(row.paymentMethod || '-')}</td>
                <td class="num debe">${row.debe > 0 ? escapeHtml(formatMoney(row.debe)) : '-'}</td>
                <td class="num haber">${row.haber > 0 ? escapeHtml(formatMoney(row.haber)) : '-'}</td>
                <td class="num saldo">${escapeHtml(formatMoney(row.balance))}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="6" class="empty">Sin movimientos para el período seleccionado.</td></tr>';

    const summaryHtml = [
        typeof summary.openingBalance === 'number' ? `<div class="chip"><span>Saldo anterior</span><strong>${escapeHtml(formatMoney(summary.openingBalance))}</strong></div>` : '',
        `<div class="chip"><span>Total Debe</span><strong>${escapeHtml(formatMoney(summary.totalDebe))}</strong></div>`,
        `<div class="chip"><span>Total Haber</span><strong>${escapeHtml(formatMoney(summary.totalHaber))}</strong></div>`,
        `<div class="chip"><span>Saldo Final</span><strong>${escapeHtml(formatMoney(summary.saldoFinal))}</strong></div>`
    ].filter(Boolean).join('');

    const generatedLabel = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime())
        ? generatedAt.toLocaleString('es-AR')
        : new Date().toLocaleString('es-AR');

    printWindow.document.write(`
        <!doctype html>
        <html lang="es">
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(title)} · ${escapeHtml(entityName)}</title>
            <style>
                @page { size: A4 portrait; margin: 12mm; }
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    font-family: "Segoe UI", Arial, sans-serif;
                    color: #111827;
                    background: #fff;
                    font-size: 11px;
                }
                .sheet {
                    width: 100%;
                    min-height: calc(297mm - 24mm);
                }
                .header {
                    border-bottom: 2px solid #111827;
                    padding-bottom: 8px;
                    margin-bottom: 10px;
                }
                h1 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 800;
                    letter-spacing: .2px;
                }
                .subtitle {
                    margin-top: 2px;
                    font-size: 12px;
                    color: #4b5563;
                }
                .meta {
                    margin-top: 7px;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 4px 12px;
                    font-size: 11px;
                }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 6px;
                    margin-bottom: 10px;
                }
                .chip {
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    padding: 6px 8px;
                    background: #f9fafb;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .chip span { color: #6b7280; font-size: 10px; }
                .chip strong { font-size: 12px; }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                }
                thead th {
                    border: 1px solid #d1d5db;
                    background: #f3f4f6;
                    padding: 6px;
                    text-align: left;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: .35px;
                }
                tbody td {
                    border: 1px solid #e5e7eb;
                    padding: 6px;
                    vertical-align: top;
                }
                .num { text-align: right; white-space: nowrap; }
                .debe { color: #b91c1c; }
                .haber { color: #065f46; }
                .saldo { font-weight: 700; }
                .empty { text-align: center; color: #6b7280; padding: 12px; }
                .footer {
                    margin-top: 8px;
                    font-size: 10px;
                    color: #6b7280;
                    text-align: right;
                }
            </style>
        </head>
        <body>
            <main class="sheet">
                <section class="header">
                    <h1>${escapeHtml(title)}</h1>
                    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
                    <div class="meta">
                        <div><strong>${escapeHtml(entityLabel)}:</strong> ${escapeHtml(entityName)}</div>
                        <div><strong>Generado:</strong> ${escapeHtml(generatedLabel)}</div>
                        ${entityDocument ? `<div><strong>Documento:</strong> ${escapeHtml(entityDocument)}</div>` : '<div></div>'}
                    </div>
                </section>
                <section class="summary">${summaryHtml}</section>
                <section>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 13%;">Fecha</th>
                                <th style="width: 37%;">Concepto</th>
                                <th style="width: 16%;">Medio</th>
                                <th style="width: 11%;" class="num">Debe</th>
                                <th style="width: 11%;" class="num">Haber</th>
                                <th style="width: 12%;" class="num">Saldo</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </section>
                <div class="footer">Reporte emitido por MeatManager</div>
            </main>
            <script>window.onload = () => window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
};
