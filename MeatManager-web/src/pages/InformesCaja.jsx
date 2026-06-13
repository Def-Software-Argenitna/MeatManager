import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import {
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    CalendarDays,
    FileSpreadsheet,
    FileText,
    RefreshCw,
    Scale,
    ShieldCheck,
} from 'lucide-react';
import { fetchCajaReportData } from '../utils/apiClient';
import DirectionalReveal from '../components/DirectionalReveal';
import './InformesCaja.css';

const CASH_ACCOUNTS = [
    { value: 'all', label: 'Todas las cajas' },
    { value: 'principal', label: 'Caja Principal' },
    { value: 'secondary', label: 'Caja Secundaria' },
];

const REPORT_MODES = {
    range: { label: 'Rango exacto', previousLabel: 'rango anterior' },
    day: { label: 'Informe por día', previousLabel: 'día anterior' },
    week: { label: 'Informe por semana', previousLabel: 'semana anterior' },
    month: { label: 'Informe por mes', previousLabel: 'mes anterior' },
    year: { label: 'Informe por año', previousLabel: 'año anterior' },
};

const toNumber = (value) => Number(value) || 0;
const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
const formatCurrency = (value) => `$${round2(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const excelTheme = {
    navy: '123047',
    blue: '2563EB',
    cyan: '06B6D4',
    green: '16A34A',
    red: 'DC2626',
    amber: 'F59E0B',
    gray: '64748B',
    softGray: 'F1F5F9',
    white: 'FFFFFF',
};
const downloadWorkbook = async (workbook, filename) => {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};
const styleExcelSheet = (worksheet) => {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).height = 24;
    worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: excelTheme.white } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: excelTheme.navy } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'D8DEE9' } },
                left: { style: 'thin', color: { argb: 'D8DEE9' } },
                bottom: { style: 'thin', color: { argb: 'D8DEE9' } },
                right: { style: 'thin', color: { argb: 'D8DEE9' } },
            };
            cell.alignment = { vertical: 'top', wrapText: true };
        });
    });
    worksheet.columns.forEach((column) => {
        let max = 12;
        column.eachCell({ includeEmpty: true }, (cell) => {
            max = Math.max(max, Math.min(42, String(cell.value ?? '').length + 2));
        });
        column.width = max;
    });
};
const addRowsSheet = (workbook, name, rows, columns) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns.map((column) => ({
        header: column.header,
        key: column.key,
        width: column.width || 16,
    }));
    rows.forEach((row) => worksheet.addRow(row));
    styleExcelSheet(worksheet);
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, rows.length + 1), column: columns.length },
    };
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        columns.forEach((column, index) => {
            const cell = row.getCell(index + 1);
            if (column.money && typeof cell.value === 'number') {
                cell.numFmt = '$ #,##0.00;[Red]-$ #,##0.00';
                cell.alignment = { horizontal: 'right', vertical: 'top' };
                cell.font = { color: { argb: cell.value < 0 || column.negative ? excelTheme.red : excelTheme.green }, bold: true };
            }
        });
    });
    return worksheet;
};
const drawRoundedRect = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
};
const createChartImage = ({ type, title, rows, width = 760, height = 360 }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const colors = [excelTheme.green, excelTheme.red, excelTheme.blue, excelTheme.cyan, excelTheme.amber, '8B5CF6', '14B8A6'];
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = `#${excelTheme.navy}`;
    ctx.font = '700 22px Arial';
    ctx.fillText(title, 28, 38);
    ctx.font = '12px Arial';

    const data = rows.filter((row) => Math.abs(toNumber(row.value)) > 0).slice(0, 8);
    if (data.length === 0) {
        ctx.fillStyle = `#${excelTheme.gray}`;
        ctx.fillText('Sin datos para graficar en este período.', 28, 82);
        return canvas.toDataURL('image/png');
    }

    if (type === 'pie') {
        const total = data.reduce((sum, row) => sum + Math.abs(toNumber(row.value)), 0);
        let angle = -Math.PI / 2;
        const cx = 205;
        const cy = 190;
        const radius = 118;
        data.forEach((row, index) => {
            const slice = (Math.abs(toNumber(row.value)) / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, angle, angle + slice);
            ctx.closePath();
            ctx.fillStyle = `#${colors[index % colors.length]}`;
            ctx.fill();
            angle += slice;
        });
        data.forEach((row, index) => {
            const y = 88 + index * 30;
            ctx.fillStyle = `#${colors[index % colors.length]}`;
            drawRoundedRect(ctx, 390, y - 12, 16, 16, 4);
            ctx.fill();
            ctx.fillStyle = '#111827';
            ctx.font = '700 13px Arial';
            ctx.fillText(row.label, 416, y);
            ctx.fillStyle = `#${excelTheme.gray}`;
            ctx.font = '12px Arial';
            ctx.fillText(`${formatCurrency(row.value)} (${Math.round((Math.abs(toNumber(row.value)) / total) * 100)}%)`, 416, y + 17);
        });
        return canvas.toDataURL('image/png');
    }

    const max = Math.max(...data.map((row) => Math.abs(toNumber(row.value))));
    const left = 210;
    const top = 78;
    const barWidth = width - left - 55;
    const barHeight = 24;
    data.forEach((row, index) => {
        const y = top + index * 34;
        const value = toNumber(row.value);
        const length = Math.max(6, (Math.abs(value) / max) * barWidth);
        ctx.fillStyle = '#111827';
        ctx.font = '700 12px Arial';
        ctx.fillText(String(row.label).slice(0, 28), 28, y + 17);
        ctx.fillStyle = value < 0 ? `#${excelTheme.red}` : `#${colors[index % colors.length]}`;
        drawRoundedRect(ctx, left, y, length, barHeight, 6);
        ctx.fill();
        ctx.fillStyle = value < 0 ? `#${excelTheme.red}` : `#${excelTheme.blue}`;
        ctx.font = '700 12px Arial';
        ctx.fillText(formatCurrency(value), left + length + 8, y + 17);
    });
    return canvas.toDataURL('image/png');
};
const addDashboardImage = (workbook, worksheet, base64, range) => {
    const imageId = workbook.addImage({ base64, extension: 'png' });
    worksheet.addImage(imageId, range);
};
const formatDateInput = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatMonthInput = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const formatDateTime = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};
const normalizeCashAccount = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (['secondary', 'secundaria', 'caja_secundaria'].includes(token)) return 'secondary';
    return 'principal';
};
const getCashAccountLabel = (value) => (
    CASH_ACCOUNTS.find((item) => item.value === normalizeCashAccount(value))?.label || 'Caja Principal'
);
const getMovementSign = (movement) => {
    if (movement.type === 'apertura' || movement.type === 'ingreso' || movement.type === 'venta') return 1;
    if (movement.type === 'egreso' || movement.type === 'retiro' || movement.type === 'anulacion_venta') return -1;
    return toNumber(movement.amount) >= 0 ? 1 : -1;
};
const isTransferMovement = (movement) => (
    Boolean(movement?.transfer_group_id) || String(movement?.category || '').toLowerCase().includes('transferencia')
);
const getMovementOperation = (movement) => {
    const flowKind = String(movement?.money_flow_kind || '').toLowerCase();
    const type = String(movement?.type || '').toLowerCase();
    const category = String(movement?.category || '').toLowerCase();
    if (flowKind === 'customer_payment') return 'Cobro de cliente';
    if (flowKind === 'supplier_payment') return 'Pago a proveedor';
    if (flowKind === 'internal_purchase_payment') return 'Compra interna';
    if (type === 'apertura') return 'Apertura de caja';
    if (type === 'venta') return 'Cobro de venta';
    if (type === 'anulacion_venta') return 'Anulación de venta';
    if (isTransferMovement(movement)) return type === 'ingreso' ? 'Transferencia recibida entre cajas' : 'Transferencia enviada entre cajas';
    if (category.includes('compra interna')) return 'Compra interna';
    if (type === 'ingreso') return 'Ingreso manual';
    if (type === 'retiro' || type === 'egreso') return 'Retiro / gasto';
    return movement?.category || movement?.type || 'Movimiento';
};
const getMovementClassification = (movement) => {
    const flowKind = String(movement?.money_flow_kind || '').toLowerCase();
    if (flowKind === 'customer_payment') return 'Cobro de cuenta corriente';
    if (flowKind === 'supplier_payment') return 'Pago a proveedor';
    if (flowKind === 'internal_purchase_payment') return 'Compra interna';
    if (isTransferMovement(movement)) return 'Transferencia entre cajas';
    if (movement.type === 'retiro' || movement.type === 'egreso') return 'Retiro / gasto / consumo';
    if (movement.type === 'ingreso') return 'Ingreso manual';
    if (movement.type === 'venta') return 'Cobro de venta';
    if (movement.type === 'anulacion_venta') return 'Anulación de venta';
    if (movement.type === 'apertura') return 'Apertura';
    return 'Otro movimiento';
};
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getPeriodBounds = (mode, value) => {
    if (mode === 'range') {
        const parseInputDate = (input, fallback) => {
            const [year, month, day] = String(input || fallback).split('-').map(Number);
            const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
            return Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
        };
        const today = formatDateInput(new Date());
        const from = parseInputDate(value?.from, today);
        const to = parseInputDate(value?.to, value?.from || today);
        const start = from <= to ? from : to;
        const end = from <= to ? to : from;
        end.setHours(23, 59, 59, 999);
        return {
            start,
            end,
            label: `${formatDateInput(start).split('-').reverse().join('/')} al ${formatDateInput(end).split('-').reverse().join('/')}`,
        };
    }
    if (mode === 'year') {
        const year = Number(value) || new Date().getFullYear();
        return {
            start: new Date(year, 0, 1, 0, 0, 0, 0),
            end: new Date(year, 11, 31, 23, 59, 59, 999),
            label: String(year),
        };
    }
    if (mode === 'month') {
        const [year, month] = String(value || formatMonthInput(new Date())).split('-').map(Number);
        return {
            start: new Date(year, month - 1, 1, 0, 0, 0, 0),
            end: new Date(year, month, 0, 23, 59, 59, 999),
            label: `${String(month).padStart(2, '0')}/${year}`,
        };
    }
    if (mode === 'week') {
        const [year, month, day] = String(value || formatDateInput(new Date())).split('-').map(Number);
        const selected = new Date(year, month - 1, day, 0, 0, 0, 0);
        const dayOfWeek = selected.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const start = new Date(selected);
        start.setDate(selected.getDate() + mondayOffset);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return {
            start,
            end,
            label: `${formatDateInput(start).split('-').reverse().join('/')} al ${formatDateInput(end).split('-').reverse().join('/')}`,
        };
    }
    const [year, month, day] = String(value || formatDateInput(new Date())).split('-').map(Number);
    return {
        start: new Date(year, month - 1, day, 0, 0, 0, 0),
        end: new Date(year, month - 1, day, 23, 59, 59, 999),
        label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    };
};

const getPreviousPeriodBounds = (mode, bounds) => {
    if (mode === 'range') {
        const days = Math.max(1, Math.round((bounds.end - bounds.start) / 86400000) + 1);
        const end = new Date(bounds.start);
        end.setDate(bounds.start.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(end.getDate() - days + 1);
        start.setHours(0, 0, 0, 0);
        return {
            start,
            end,
            label: `${formatDateInput(start).split('-').reverse().join('/')} al ${formatDateInput(end).split('-').reverse().join('/')}`,
        };
    }
    if (mode === 'year') {
        const year = bounds.start.getFullYear() - 1;
        return getPeriodBounds('year', String(year));
    }
    if (mode === 'month') {
        const prev = new Date(bounds.start);
        prev.setMonth(prev.getMonth() - 1);
        return getPeriodBounds('month', formatMonthInput(prev));
    }
    if (mode === 'week') {
        const prev = new Date(bounds.start);
        prev.setDate(prev.getDate() - 7);
        return getPeriodBounds('week', formatDateInput(prev));
    }
    const prev = new Date(bounds.start);
    prev.setDate(prev.getDate() - 1);
    return getPeriodBounds('day', formatDateInput(prev));
};

const buildReport = ({ movements, closures, mode, value, cashAccount, compareEnabled, initialSnapshots = null }) => {
    const bounds = getPeriodBounds(mode, value);
    const previousBounds = getPreviousPeriodBounds(mode, bounds);
    const includeAccount = (account) => cashAccount === 'all' || normalizeCashAccount(account) === cashAccount;

    const buildPeriod = (periodBounds, initialKey) => {
        const snapshot = initialSnapshots?.[initialKey] || {};
        const initialByAccount = {
            principal: round2(snapshot.principal),
            secondary: round2(snapshot.secondary),
        };

        const balancesByAccount = { ...initialByAccount };
        let totalBalance = round2(Object.values(initialByAccount).reduce((sum, value) => sum + value, 0));
        const transferContextById = new Map();

        Object.values((movements || []).reduce((acc, movement) => {
            if (!isTransferMovement(movement)) return acc;
            const groupId = movement.transfer_group_id || `single-${movement.id}`;
            if (!acc[groupId]) acc[groupId] = [];
            acc[groupId].push(movement);
            return acc;
        }, {})).forEach((groupRows) => {
            const outgoing = groupRows.find((item) => getMovementSign(item) < 0) || null;
            const incoming = groupRows.find((item) => getMovementSign(item) > 0) || null;
            const fromAccount = outgoing ? normalizeCashAccount(outgoing.cash_account) : '';
            const toAccount = incoming ? normalizeCashAccount(incoming.cash_account) : '';
            const route = fromAccount && toAccount
                ? `${getCashAccountLabel(fromAccount)} -> ${getCashAccountLabel(toAccount)}`
                : 'Transferencia entre cajas';

            groupRows.forEach((movement) => {
                const sign = getMovementSign(movement);
                const ownAccount = normalizeCashAccount(movement.cash_account);
                const counterpart = sign < 0 ? toAccount : fromAccount;
                transferContextById.set(Number(movement.id), {
                    route,
                    counterpartLabel: counterpart ? getCashAccountLabel(counterpart) : '',
                    movementLabel: sign < 0 ? 'Salida interna hacia otra caja' : 'Entrada interna desde otra caja',
                    detail: sign < 0
                        ? `Transferencia enviada. No es gasto ni consumo. Destino: ${counterpart ? getCashAccountLabel(counterpart) : 'otra caja'}.`
                        : `Transferencia recibida. No es venta ni ajuste. Origen: ${counterpart ? getCashAccountLabel(counterpart) : 'otra caja'}.`,
                    ownAccount,
                });
            });
        });

        const movementRows = (movements || [])
            .map((movement) => ({ movement, date: new Date(movement.date), account: normalizeCashAccount(movement.cash_account) }))
            .filter(({ date, account }) => Number.isFinite(date.getTime()) && date >= periodBounds.start && date <= periodBounds.end && includeAccount(account))
            .sort((a, b) => (a.date - b.date) || (toNumber(a.movement.id) - toNumber(b.movement.id)))
            .map(({ movement, date, account }) => {
                const amount = Math.abs(toNumber(movement.amount));
                const sign = getMovementSign(movement);
                const net = round2(amount * sign);
                balancesByAccount[account] = round2((balancesByAccount[account] || 0) + net);
                totalBalance = round2(totalBalance + net);
                const transferContext = transferContextById.get(Number(movement.id));
                return {
                    source: 'Movimiento',
                    id: movement.id,
                    date,
                    fecha: formatDateTime(date),
                    caja: getCashAccountLabel(account),
                    cuentaCaja: account,
                    operacion: getMovementOperation(movement),
                    tipo: movement.type || '',
                    categoria: transferContext ? 'Transferencia entre cajas' : (movement.category || ''),
                    clasificacion: getMovementClassification(movement),
                    movimientoEntreCajas: transferContext?.movementLabel || '',
                    rutaTransferencia: transferContext?.route || '',
                    cajaContraparte: transferContext?.counterpartLabel || '',
                    detalleClasificacion: transferContext?.detail || '',
                    medioPago: movement.payment_method || 'Efectivo',
                    tipoMedioPago: movement.payment_method_type || '',
                    proveedor: movement.supplier || '',
                    descripcion: movement.description || '',
                    ingreso: sign > 0 ? amount : 0,
                    egreso: sign < 0 ? amount : 0,
                    neto: net,
                    saldoCaja: balancesByAccount[account],
                    saldoTotal: totalBalance,
                    ticket: movement.receipt_code || (movement.receipt_number ? String(movement.receipt_number) : ''),
                    ventaId: movement.sale_id || '',
                    compraId: movement.purchase_id || '',
                    clienteId: movement.client_id || '',
                    tipoFlujo: movement.money_flow_kind || '',
                    origenTabla: movement.origin_table || '',
                    origenId: movement.origin_id || '',
                    origenGrupo: movement.origin_group_id || '',
                    sucursalId: movement.branch_id || '',
                    transferenciaId: movement.transfer_group_id || '',
                    autorizacionId: movement.authorization_id || '',
                    autorizado: movement.authorization_verified ? 'Si' : 'No',
                    emailAutorizado: movement.authorized_recipient_email || '',
                };
            });

        const closureRows = (closures || [])
            .map((closure) => ({ closure, date: new Date(closure.closed_at || closure.closure_date) }))
            .filter(({ date }) => Number.isFinite(date.getTime()) && date >= periodBounds.start && date <= periodBounds.end)
            .sort((a, b) => (a.date - b.date) || (toNumber(a.closure.id) - toNumber(b.closure.id)))
            .map(({ closure, date }) => ({
                source: 'Cierre',
                id: closure.id,
                date,
                fecha: formatDateTime(date),
                caja: closure.branch_id ? `Sucursal ${closure.branch_id}` : 'Cierre general',
                cuentaCaja: '',
                operacion: 'Cierre de caja',
                tipo: 'cierre',
                categoria: 'Cierre',
                medioPago: '',
                tipoMedioPago: '',
                proveedor: '',
                descripcion: closure.notes || '',
                ingreso: 0,
                egreso: 0,
                neto: 0,
                saldoCaja: '',
                saldoTotal: '',
                cierreTeorico: toNumber(closure.theoretical_cash),
                cierreContado: toNumber(closure.counted_cash),
                diferenciaCierre: toNumber(closure.difference),
                ventasCierre: toNumber(closure.total_sales),
                ingresosCierre: toNumber(closure.total_incomes),
                egresosCierre: toNumber(closure.total_expenses),
            }));

        const allRows = [...movementRows, ...closureRows].sort((a, b) => (a.date - b.date) || String(a.source).localeCompare(String(b.source)));
        const totals = movementRows.reduce((acc, row) => ({
            ingresos: round2(acc.ingresos + row.ingreso),
            egresos: round2(acc.egresos + row.egreso),
            neto: round2(acc.neto + row.neto),
            ventas: round2(acc.ventas + (row.operacion === 'Cobro de venta' ? row.ingreso : 0)),
            comprasInternas: round2(acc.comprasInternas + (row.operacion === 'Compra interna' ? row.egreso : 0)),
            transferenciasEnviadas: round2(acc.transferenciasEnviadas + (row.operacion === 'Transferencia enviada entre cajas' ? row.egreso : 0)),
            transferenciasRecibidas: round2(acc.transferenciasRecibidas + (row.operacion === 'Transferencia recibida entre cajas' ? row.ingreso : 0)),
        }), { ingresos: 0, egresos: 0, neto: 0, ventas: 0, comprasInternas: 0, transferenciasEnviadas: 0, transferenciasRecibidas: 0 });

        const groupRows = (keyFn) => Object.values(movementRows.reduce((acc, row) => {
            const key = keyFn(row) || 'Sin clasificar';
            if (!acc[key]) acc[key] = { key, ingresos: 0, egresos: 0, neto: 0, count: 0 };
            acc[key].ingresos = round2(acc[key].ingresos + row.ingreso);
            acc[key].egresos = round2(acc[key].egresos + row.egreso);
            acc[key].neto = round2(acc[key].neto + row.neto);
            acc[key].count += 1;
            return acc;
        }, {})).sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));

        const byAccount = ['principal', 'secondary']
            .map((account) => {
                const rows = movementRows.filter((row) => row.cuentaCaja === account);
                const ingresos = round2(rows.reduce((sum, row) => sum + row.ingreso, 0));
                const egresos = round2(rows.reduce((sum, row) => sum + row.egreso, 0));
                const transferenciasRecibidas = round2(rows.reduce((sum, row) => sum + (row.operacion === 'Transferencia recibida entre cajas' ? row.ingreso : 0), 0));
                const transferenciasEnviadas = round2(rows.reduce((sum, row) => sum + (row.operacion === 'Transferencia enviada entre cajas' ? row.egreso : 0), 0));
                return {
                    key: account,
                    caja: getCashAccountLabel(account),
                    saldoInicial: initialByAccount[account] || 0,
                    ingresos,
                    egresos,
                    transferenciasRecibidas,
                    transferenciasEnviadas,
                    neto: round2(ingresos - egresos),
                    saldoFinal: balancesByAccount[account] || 0,
                    count: rows.length,
                };
            })
            .filter((row) => cashAccount === 'all' || row.key === cashAccount);

        const closureDifference = round2(closureRows.reduce((sum, row) => sum + Math.abs(toNumber(row.diferenciaCierre)), 0));
        const reconciliationDelta = round2(totals.neto - byAccount.reduce((sum, row) => sum + row.neto, 0));

        return {
            bounds: periodBounds,
            initialByAccount,
            balancesByAccount,
            rows: allRows,
            movementRows,
            closureRows,
            totals,
            byAccount,
            byMethod: groupRows((row) => row.medioPago),
            byOperation: groupRows((row) => row.operacion),
            byCategory: groupRows((row) => row.categoria),
            byClassification: groupRows((row) => row.clasificacion),
            transfers: movementRows.filter((row) => row.clasificacion === 'Transferencia entre cajas'),
            closureDifference,
            reconciliationDelta,
        };
    };

    const current = buildPeriod(bounds, 'current');
    const previous = compareEnabled ? buildPeriod(previousBounds, 'previous') : null;

    const compareGroups = (currentRows, previousRows) => {
        const keys = new Set([...currentRows.map((row) => row.key), ...previousRows.map((row) => row.key)]);
        return Array.from(keys).map((key) => {
            const currentRow = currentRows.find((row) => row.key === key) || { ingresos: 0, egresos: 0, neto: 0, count: 0 };
            const previousRow = previousRows.find((row) => row.key === key) || { ingresos: 0, egresos: 0, neto: 0, count: 0 };
            return {
                key,
                actual: currentRow,
                anterior: previousRow,
                deltaNeto: round2(currentRow.neto - previousRow.neto),
                deltaEgresos: round2(currentRow.egresos - previousRow.egresos),
                deltaIngresos: round2(currentRow.ingresos - previousRow.ingresos),
            };
        }).sort((a, b) => Math.abs(b.deltaNeto) - Math.abs(a.deltaNeto));
    };

    const comparison = previous ? {
        totals: {
            ingresos: round2(current.totals.ingresos - previous.totals.ingresos),
            egresos: round2(current.totals.egresos - previous.totals.egresos),
            neto: round2(current.totals.neto - previous.totals.neto),
            comprasInternas: round2(current.totals.comprasInternas - previous.totals.comprasInternas),
            ventas: round2(current.totals.ventas - previous.totals.ventas),
            transferenciasEnviadas: round2(current.totals.transferenciasEnviadas - previous.totals.transferenciasEnviadas),
            transferenciasRecibidas: round2(current.totals.transferenciasRecibidas - previous.totals.transferenciasRecibidas),
            closureDifference: round2(current.closureDifference - previous.closureDifference),
        },
        byOperation: compareGroups(current.byOperation, previous.byOperation),
        byCategory: compareGroups(current.byCategory, previous.byCategory),
        byMethod: compareGroups(current.byMethod, previous.byMethod),
        byClassification: compareGroups(current.byClassification, previous.byClassification),
    } : null;

    const problemFindings = [];
    if (current.reconciliationDelta !== 0) {
        problemFindings.push({
            severity: 'danger',
            title: 'La conciliación no cierra exactamente',
            detail: `La diferencia interna entre movimientos y saldos por caja es ${formatCurrency(current.reconciliationDelta)}. Revisar movimientos sin caja o signos inconsistentes.`,
        });
    }
    if (current.closureDifference > 0) {
        problemFindings.push({
            severity: 'danger',
            title: 'Hay diferencias registradas en cierres',
            detail: `Los cierres del período acumulan diferencias por ${formatCurrency(current.closureDifference)}.`,
        });
    }
    if (comparison && comparison.totals.neto < 0) {
        const operationProblem = comparison.byOperation.find((row) => row.deltaNeto < 0);
        const categoryProblem = comparison.byCategory.find((row) => row.deltaNeto < 0);
        problemFindings.push({
            severity: 'warning',
            title: 'Resultado peor que el período comparado',
            detail: `El neto bajó ${formatCurrency(Math.abs(comparison.totals.neto))}. Principal foco: ${operationProblem?.key || categoryProblem?.key || 'movimientos generales'}.`,
        });
    }
    if (comparison && comparison.totals.egresos > 0) {
        const expenseProblem = comparison.byCategory.find((row) => row.deltaEgresos > 0);
        problemFindings.push({
            severity: 'warning',
            title: 'Subieron los egresos',
            detail: `Los egresos aumentaron ${formatCurrency(comparison.totals.egresos)}. Categoría más relevante: ${expenseProblem?.key || 'sin categoría dominante'}.`,
        });
    }
    if (problemFindings.length === 0) {
        problemFindings.push({
            severity: 'success',
            title: 'Sin pérdidas detectadas por la auditoría',
            detail: 'Los movimientos conciliados cierran con el saldo del período y no hay diferencias negativas relevantes contra la comparación seleccionada.',
        });
    }

    return {
        mode,
        modeLabel: REPORT_MODES[mode].label,
        cashAccount,
        cashAccountLabel: CASH_ACCOUNTS.find((item) => item.value === cashAccount)?.label || 'Todas las cajas',
        bounds,
        previousBounds,
        current,
        previous,
        comparison,
        problemFindings,
    };
};

const InformesCaja = () => {
    const now = new Date();
    const [mode, setMode] = useState('range');
    const [dayValue, setDayValue] = useState(formatDateInput(now));
    const [weekValue, setWeekValue] = useState(formatDateInput(now));
    const [monthValue, setMonthValue] = useState(formatMonthInput(now));
    const [yearValue, setYearValue] = useState(String(now.getFullYear()));
    const [rangeFromValue, setRangeFromValue] = useState(formatDateInput(now));
    const [rangeToValue, setRangeToValue] = useState(formatDateInput(now));
    const [cashAccount, setCashAccount] = useState('all');
    const [compareEnabled, setCompareEnabled] = useState(true);
    const [movements, setMovements] = useState([]);
    const [closures, setClosures] = useState([]);
    const [initialSnapshots, setInitialSnapshots] = useState({ current: { principal: 0, secondary: 0 }, previous: { principal: 0, secondary: 0 } });
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [rowFilter, setRowFilter] = useState('all');

    const selectedValue = useMemo(() => (mode === 'range'
        ? { from: rangeFromValue, to: rangeToValue }
        : mode === 'day'
            ? dayValue
            : mode === 'week'
                ? weekValue
                : mode === 'month'
                    ? monthValue
                    : yearValue), [dayValue, mode, monthValue, rangeFromValue, rangeToValue, weekValue, yearValue]);
    const selectedValueForFile = mode === 'range' ? `${rangeFromValue}_a_${rangeToValue}` : selectedValue;

    const currentBounds = useMemo(() => getPeriodBounds(mode, selectedValue), [mode, selectedValue]);
    const previousBounds = useMemo(() => getPreviousPeriodBounds(mode, currentBounds), [currentBounds, mode]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const payload = await fetchCajaReportData({
                from: formatDateInput(currentBounds.start),
                to: formatDateInput(currentBounds.end),
                compareFrom: compareEnabled ? formatDateInput(previousBounds.start) : formatDateInput(currentBounds.start),
                cashAccount,
            });
            setMovements(Array.isArray(payload?.movements) ? payload.movements : []);
            setClosures(Array.isArray(payload?.closures) ? payload.closures : []);
            setInitialSnapshots(payload?.initialBalances || { current: { principal: 0, secondary: 0 }, previous: { principal: 0, secondary: 0 } });
        } catch (error) {
            console.error('[InformesCaja] loadData error', error);
            setFeedback({ type: 'warning', text: 'No se pudieron cargar los movimientos de caja.' });
        } finally {
            setLoading(false);
        }
    }, [cashAccount, compareEnabled, currentBounds.end, currentBounds.start, previousBounds.start]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const report = useMemo(() => buildReport({
        movements,
        closures,
        mode,
        value: selectedValue,
        cashAccount,
        compareEnabled,
        initialSnapshots,
    }), [cashAccount, closures, compareEnabled, initialSnapshots, mode, movements, selectedValue]);

    const detailRowsForExport = (report.current.rows || []).map((row) => ({
        Origen: row.source,
        ID: row.id,
        Fecha: row.fecha,
        Caja: row.caja,
        Operación: row.operacion,
        Tipo: row.tipo,
        Categoría: row.categoria,
        Clasificación: row.clasificacion,
        'Movimiento entre cajas': row.movimientoEntreCajas,
        'Ruta transferencia': row.rutaTransferencia,
        'Caja contraparte': row.cajaContraparte,
        'Detalle clasificación': row.detalleClasificacion,
        'Medio de pago': row.medioPago,
        'Tipo medio': row.tipoMedioPago,
        Proveedor: row.proveedor,
        Descripción: row.descripcion,
        Ingreso: row.ingreso,
        Egreso: row.egreso,
        Neto: row.neto,
        'Saldo caja': row.saldoCaja,
        'Saldo total': row.saldoTotal,
        Ticket: row.ticket,
        'Venta ID': row.ventaId,
        'Compra ID': row.compraId,
        'Cliente ID': row.clienteId,
        'Tipo flujo': row.tipoFlujo,
        'Tabla origen': row.origenTabla,
        'ID origen': row.origenId,
        'Grupo origen': row.origenGrupo,
        'Sucursal ID': row.sucursalId,
        'Transferencia ID': row.transferenciaId,
        'Autorización ID': row.autorizacionId,
        Autorizado: row.autorizado,
        'Email autorizado': row.emailAutorizado,
        'Cierre teórico': row.cierreTeorico,
        'Cierre contado': row.cierreContado,
        'Diferencia cierre': row.diferenciaCierre,
    }));

    const exportExcel = async () => {
        if (report.current.rows.length === 0) {
            setFeedback({ type: 'warning', text: 'No hay movimientos para exportar en este informe.' });
            return;
        }

        const summaryRows = [
            { Concepto: 'Tipo de informe', Valor: report.modeLabel },
            { Concepto: 'Período', Valor: report.bounds.label },
            { Concepto: 'Caja', Valor: report.cashAccountLabel },
            { Concepto: 'Ingresos', Valor: report.current.totals.ingresos },
            { Concepto: 'Egresos', Valor: report.current.totals.egresos },
            { Concepto: 'Neto', Valor: report.current.totals.neto },
            { Concepto: 'Transferencias enviadas entre cajas', Valor: report.current.totals.transferenciasEnviadas },
            { Concepto: 'Transferencias recibidas entre cajas', Valor: report.current.totals.transferenciasRecibidas },
            { Concepto: 'Diferencias de cierre', Valor: report.current.closureDifference },
            { Concepto: 'Delta conciliación', Valor: report.current.reconciliationDelta },
        ];
        const problemRows = report.problemFindings.map((finding) => ({
            Estado: finding.severity,
            Hallazgo: finding.title,
            Detalle: finding.detail,
        }));
        const comparisonRows = report.comparison ? [
            { Métrica: 'Ingresos', Actual: report.current.totals.ingresos, Anterior: report.previous.totals.ingresos, Diferencia: report.comparison.totals.ingresos },
            { Métrica: 'Egresos', Actual: report.current.totals.egresos, Anterior: report.previous.totals.egresos, Diferencia: report.comparison.totals.egresos },
            { Métrica: 'Neto', Actual: report.current.totals.neto, Anterior: report.previous.totals.neto, Diferencia: report.comparison.totals.neto },
            { Métrica: 'Compras internas', Actual: report.current.totals.comprasInternas, Anterior: report.previous.totals.comprasInternas, Diferencia: report.comparison.totals.comprasInternas },
            { Métrica: 'Ventas', Actual: report.current.totals.ventas, Anterior: report.previous.totals.ventas, Diferencia: report.comparison.totals.ventas },
            { Métrica: 'Transferencias enviadas', Actual: report.current.totals.transferenciasEnviadas, Anterior: report.previous.totals.transferenciasEnviadas, Diferencia: report.comparison.totals.transferenciasEnviadas },
            { Métrica: 'Transferencias recibidas', Actual: report.current.totals.transferenciasRecibidas, Anterior: report.previous.totals.transferenciasRecibidas, Diferencia: report.comparison.totals.transferenciasRecibidas },
        ] : [];
        const accountRows = report.current.byAccount.map((row) => ({
            Caja: row.caja,
            'Saldo inicial': row.saldoInicial,
            Ingresos: row.ingresos,
            Egresos: row.egresos,
            'Transf. recibidas': row.transferenciasRecibidas,
            'Transf. enviadas': row.transferenciasEnviadas,
            Neto: row.neto,
            'Saldo final': row.saldoFinal,
            Movimientos: row.count,
        }));
        const groupSheet = (rows, label) => rows.map((row) => ({
            [label]: row.key,
            Movimientos: row.count,
            Ingresos: row.ingresos,
            Egresos: row.egresos,
            Neto: row.neto,
        }));
        const reportSubtitle = `${report.modeLabel} - ${report.bounds.label} - ${report.cashAccountLabel} - generado ${formatDateTime(new Date())}`;
        const operationRows = groupSheet(report.current.byOperation, 'Operación');
        const methodRows = groupSheet(report.current.byMethod, 'Medio de pago');
        const categoryRows = groupSheet(report.current.byCategory, 'Categoría');
        const classificationRows = groupSheet(report.current.byClassification, 'Clasificación');
        const transferRows = report.current.transfers.map((row) => ({
            Fecha: row.fecha,
            Caja: row.caja,
            Movimiento: row.movimientoEntreCajas,
            Ruta: row.rutaTransferencia,
            Contraparte: row.cajaContraparte,
            Medio: row.medioPago,
            Ingreso: row.ingreso,
            Egreso: row.egreso,
            Neto: row.neto,
            Detalle: row.detalleClasificacion,
            'Transferencia ID': row.transferenciaId,
        }));
        const findingsForExport = problemRows.length ? problemRows : [{ Estado: 'ok', Hallazgo: 'Sin alertas', Detalle: 'No se detectaron diferencias relevantes en este período.' }];
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'MeatManager';
        workbook.created = new Date();

        const dashboard = workbook.addWorksheet('Dashboard');
        dashboard.columns = Array.from({ length: 12 }, () => ({ width: 13 }));
        dashboard.mergeCells('A1:L1');
        dashboard.getCell('A1').value = 'Informe de caja';
        dashboard.getCell('A1').font = { bold: true, size: 22, color: { argb: excelTheme.white } };
        dashboard.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: excelTheme.navy } };
        dashboard.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
        dashboard.getRow(1).height = 34;
        dashboard.mergeCells('A2:L2');
        dashboard.getCell('A2').value = reportSubtitle;
        dashboard.getCell('A2').font = { bold: true, color: { argb: excelTheme.gray } };
        dashboard.getCell('A2').alignment = { horizontal: 'center' };

        const metricRows = [
            ['Ingresos', report.current.totals.ingresos, 'Egresos', report.current.totals.egresos],
            ['Neto', report.current.totals.neto, 'Diferencias cierre', report.current.closureDifference],
            ['Transf. recibidas', report.current.totals.transferenciasRecibidas, 'Transf. enviadas', report.current.totals.transferenciasEnviadas],
        ];
        metricRows.forEach((row, index) => {
            const excelRow = 4 + index;
            dashboard.getCell(`A${excelRow}`).value = row[0];
            dashboard.getCell(`B${excelRow}`).value = row[1];
            dashboard.getCell(`D${excelRow}`).value = row[2];
            dashboard.getCell(`E${excelRow}`).value = row[3];
            ['A', 'D'].forEach((col) => {
                dashboard.getCell(`${col}${excelRow}`).font = { bold: true, color: { argb: excelTheme.navy } };
                dashboard.getCell(`${col}${excelRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: excelTheme.softGray } };
            });
            ['B', 'E'].forEach((col) => {
                const cell = dashboard.getCell(`${col}${excelRow}`);
                cell.numFmt = '$ #,##0.00;[Red]-$ #,##0.00';
                cell.font = { bold: true, color: { argb: toNumber(cell.value) < 0 ? excelTheme.red : excelTheme.green } };
            });
        });

        const flowChart = createChartImage({
            type: 'pie',
            title: 'Composición del movimiento',
            rows: [
                { label: 'Ingresos', value: report.current.totals.ingresos },
                { label: 'Egresos', value: report.current.totals.egresos },
                { label: 'Transf. recibidas', value: report.current.totals.transferenciasRecibidas },
                { label: 'Transf. enviadas', value: report.current.totals.transferenciasEnviadas },
            ],
        });
        const accountChart = createChartImage({
            type: 'bar',
            title: 'Neto por caja',
            rows: accountRows.map((row) => ({ label: row.Caja, value: row.Neto })),
        });
        const classificationChart = createChartImage({
            type: 'bar',
            title: 'Neto por clasificación',
            rows: classificationRows.map((row) => ({ label: row.Clasificación, value: row.Neto })),
        });
        addDashboardImage(workbook, dashboard, flowChart, { tl: { col: 0, row: 8 }, ext: { width: 570, height: 270 } });
        addDashboardImage(workbook, dashboard, accountChart, { tl: { col: 6, row: 8 }, ext: { width: 570, height: 270 } });
        addDashboardImage(workbook, dashboard, classificationChart, { tl: { col: 0, row: 24 }, ext: { width: 760, height: 300 } });

        addRowsSheet(workbook, 'Resumen', summaryRows, [
            { header: 'Concepto', key: 'Concepto', width: 34 },
            { header: 'Valor', key: 'Valor', money: true, width: 18 },
        ]);
        addRowsSheet(workbook, 'Informe final', findingsForExport, [
            { header: 'Estado', key: 'Estado', width: 14 },
            { header: 'Hallazgo', key: 'Hallazgo', width: 34 },
            { header: 'Detalle', key: 'Detalle', width: 80 },
        ]);
        addRowsSheet(workbook, 'Por caja', accountRows, [
            { header: 'Caja', key: 'Caja', width: 22 },
            { header: 'Saldo inicial', key: 'Saldo inicial', money: true },
            { header: 'Ingresos', key: 'Ingresos', money: true },
            { header: 'Egresos', key: 'Egresos', money: true, negative: true },
            { header: 'Transf. recibidas', key: 'Transf. recibidas', money: true },
            { header: 'Transf. enviadas', key: 'Transf. enviadas', money: true, negative: true },
            { header: 'Neto', key: 'Neto', money: true },
            { header: 'Saldo final', key: 'Saldo final', money: true },
            { header: 'Movimientos', key: 'Movimientos', width: 14 },
        ]);
        addRowsSheet(workbook, 'Por medio de pago', methodRows, [
            { header: 'Medio de pago', key: 'Medio de pago', width: 28 },
            { header: 'Movimientos', key: 'Movimientos', width: 14 },
            { header: 'Ingresos', key: 'Ingresos', money: true },
            { header: 'Egresos', key: 'Egresos', money: true, negative: true },
            { header: 'Neto', key: 'Neto', money: true },
        ]);
        addRowsSheet(workbook, 'Transferencias cajas', transferRows, [
            { header: 'Fecha', key: 'Fecha', width: 20 },
            { header: 'Caja', key: 'Caja', width: 18 },
            { header: 'Movimiento', key: 'Movimiento', width: 28 },
            { header: 'Ruta', key: 'Ruta', width: 34 },
            { header: 'Contraparte', key: 'Contraparte', width: 18 },
            { header: 'Medio', key: 'Medio', width: 16 },
            { header: 'Ingreso', key: 'Ingreso', money: true },
            { header: 'Egreso', key: 'Egreso', money: true, negative: true },
            { header: 'Neto', key: 'Neto', money: true },
            { header: 'Detalle', key: 'Detalle', width: 62 },
            { header: 'Transferencia ID', key: 'Transferencia ID', width: 24 },
        ]);
        addRowsSheet(workbook, 'Por clasificación', classificationRows, [
            { header: 'Clasificación', key: 'Clasificación', width: 30 },
            { header: 'Movimientos', key: 'Movimientos', width: 14 },
            { header: 'Ingresos', key: 'Ingresos', money: true },
            { header: 'Egresos', key: 'Egresos', money: true, negative: true },
            { header: 'Neto', key: 'Neto', money: true },
        ]);
        addRowsSheet(workbook, 'Detalle completo', detailRowsForExport, [
            ...Object.keys(detailRowsForExport[0] || {}).map((key) => ({
                header: key,
                key,
                width: ['Descripción', 'Detalle clasificación'].includes(key) ? 46 : 18,
                money: ['Ingreso', 'Egreso', 'Neto', 'Saldo caja', 'Saldo total'].includes(key),
                negative: ['Egreso'].includes(key),
            })),
        ]);
        if (comparisonRows.length) {
            addRowsSheet(workbook, 'Comparativa', comparisonRows, [
                { header: 'Métrica', key: 'Métrica', width: 28 },
                { header: 'Actual', key: 'Actual', money: true },
                { header: 'Anterior', key: 'Anterior', money: true },
                { header: 'Diferencia', key: 'Diferencia', money: true },
            ]);
        }

        await downloadWorkbook(workbook, `informe_caja_${mode}_${selectedValueForFile}_${cashAccount}.xlsx`);
    };

    const exportPdf = () => {
        if (report.current.rows.length === 0) {
            setFeedback({ type: 'warning', text: 'No hay movimientos para exportar en este informe.' });
            return;
        }
        const printWindow = window.open('', '_blank', 'width=1200,height=900');
        if (!printWindow) {
            setFeedback({ type: 'warning', text: 'El navegador bloqueó la ventana del informe. Permití popups para guardar el PDF.' });
            return;
        }

        const summaryHtml = report.current.byAccount.map((row) => `
            <tr><td>${escapeHtml(row.caja)}</td><td class="num">${escapeHtml(formatCurrency(row.saldoInicial))}</td><td class="num income">${escapeHtml(formatCurrency(row.ingresos))}</td><td class="num expense">${escapeHtml(formatCurrency(row.egresos))}</td><td class="num income">${escapeHtml(formatCurrency(row.transferenciasRecibidas))}</td><td class="num expense">${escapeHtml(formatCurrency(row.transferenciasEnviadas))}</td><td class="num">${escapeHtml(formatCurrency(row.saldoFinal))}</td></tr>
        `).join('');
        const paymentMethodsHtml = report.current.byMethod.map((row) => `
            <tr>
                <td>${escapeHtml(row.key)}</td>
                <td class="num">${escapeHtml(String(row.count))}</td>
                <td class="num income">${escapeHtml(formatCurrency(row.ingresos))}</td>
                <td class="num expense">${escapeHtml(formatCurrency(row.egresos))}</td>
                <td class="num">${escapeHtml(formatCurrency(row.neto))}</td>
            </tr>
        `).join('');
        const findingsHtml = report.problemFindings.map((finding) => `
            <div class="finding ${escapeHtml(finding.severity)}"><strong>${escapeHtml(finding.title)}</strong><span>${escapeHtml(finding.detail)}</span></div>
        `).join('');
        const rowsHtml = report.current.rows.map((row) => `
            <tr>
                <td>${escapeHtml(row.fecha)}</td>
                <td>${escapeHtml(row.caja)}</td>
                <td>${escapeHtml(row.operacion)}</td>
                <td>${escapeHtml(row.clasificacion)}</td>
                <td>${escapeHtml(row.rutaTransferencia || row.movimientoEntreCajas || '')}</td>
                <td>${escapeHtml(row.categoria)}</td>
                <td>${escapeHtml(row.medioPago)}</td>
                <td>${escapeHtml([row.descripcion, row.detalleClasificacion, row.proveedor ? `Proveedor: ${row.proveedor}` : '', row.ticket ? `Ticket: ${row.ticket}` : '', row.ventaId ? `Venta: ${row.ventaId}` : '', row.compraId ? `Compra: ${row.compraId}` : '', row.transferenciaId ? `Transferencia: ${row.transferenciaId}` : '', row.cierreTeorico != null ? `Cierre teórico ${formatCurrency(row.cierreTeorico)} contado ${formatCurrency(row.cierreContado)} diferencia ${formatCurrency(row.diferenciaCierre)}` : ''].filter(Boolean).join(' · '))}</td>
                <td class="num income">${row.ingreso ? escapeHtml(formatCurrency(row.ingreso)) : ''}</td>
                <td class="num expense">${row.egreso ? escapeHtml(formatCurrency(row.egreso)) : ''}</td>
                <td class="num">${row.saldoCaja !== '' ? escapeHtml(formatCurrency(row.saldoCaja)) : ''}</td>
            </tr>
        `).join('');

        printWindow.document.write(`
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8" />
                    <title>Informe de caja ${escapeHtml(report.bounds.label)}</title>
                    <style>
                        body { font-family: Arial, sans-serif; color: #111827; margin: 22px; }
                        h1 { margin: 0 0 6px; font-size: 22px; }
                        h2 { margin: 22px 0 10px; font-size: 16px; }
                        .muted { color: #6b7280; font-size: 12px; }
                        .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
                        .metric, .finding { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
                        .metric span { color: #6b7280; font-size: 11px; text-transform: uppercase; display:block; }
                        .metric strong { font-size: 16px; margin-top: 5px; display:block; }
                        .finding { margin-bottom: 8px; }
                        .finding strong, .finding span { display:block; }
                        .finding span { color:#4b5563; font-size:12px; margin-top:4px; }
                        .finding.danger { border-color:#fca5a5; background:#fef2f2; }
                        .finding.warning { border-color:#fcd34d; background:#fffbeb; }
                        .finding.success { border-color:#86efac; background:#f0fdf4; }
                        table { width:100%; border-collapse:collapse; font-size:10.5px; }
                        th, td { border:1px solid #d1d5db; padding:5px; vertical-align:top; }
                        th { background:#f3f4f6; text-align:left; }
                        .num { text-align:right; white-space:nowrap; }
                        .income { color:#166534; }
                        .expense { color:#b91c1c; }
                        @media print { .no-print { display:none; } tr { page-break-inside: avoid; } body { margin: 10mm; } }
                    </style>
                </head>
                <body>
                    <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:8px 12px;">Imprimir / Guardar PDF</button>
                    <h1>Informe de caja centavo por centavo</h1>
                    <div class="muted">${escapeHtml(report.modeLabel)} · ${escapeHtml(report.bounds.label)} · ${escapeHtml(report.cashAccountLabel)} · Generado ${escapeHtml(formatDateTime(new Date()))}</div>
                    <div class="metrics">
                        <div class="metric"><span>Ingresos</span><strong class="income">${escapeHtml(formatCurrency(report.current.totals.ingresos))}</strong></div>
                        <div class="metric"><span>Egresos</span><strong class="expense">${escapeHtml(formatCurrency(report.current.totals.egresos))}</strong></div>
                        <div class="metric"><span>Neto</span><strong>${escapeHtml(formatCurrency(report.current.totals.neto))}</strong></div>
                        <div class="metric"><span>Diferencias cierre</span><strong>${escapeHtml(formatCurrency(report.current.closureDifference))}</strong></div>
                        <div class="metric"><span>Transf. recibidas</span><strong class="income">${escapeHtml(formatCurrency(report.current.totals.transferenciasRecibidas))}</strong></div>
                        <div class="metric"><span>Transf. enviadas</span><strong class="expense">${escapeHtml(formatCurrency(report.current.totals.transferenciasEnviadas))}</strong></div>
                    </div>
                    <h2>Informe final</h2>
                    ${findingsHtml}
                    <h2>Resumen por caja</h2>
                    <table><thead><tr><th>Caja</th><th>Saldo inicial</th><th>Ingresos</th><th>Egresos</th><th>Transf. recibidas</th><th>Transf. enviadas</th><th>Saldo final</th></tr></thead><tbody>${summaryHtml}</tbody></table>
                    <h2>Resumen por medio de pago</h2>
                    <table><thead><tr><th>Medio de pago</th><th>Movimientos</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr></thead><tbody>${paymentMethodsHtml}</tbody></table>
                    <h2>Detalle completo</h2>
                    <table><thead><tr><th>Fecha</th><th>Caja</th><th>Operación</th><th>Clasificación</th><th>Movimiento entre cajas</th><th>Categoría</th><th>Medio</th><th>Detalle</th><th>Ingreso</th><th>Egreso</th><th>Saldo caja</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                    <script>window.onload = () => window.print();</script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    const renderPeriodInput = () => {
        if (mode === 'range') {
            return (
                <div className="ic-range-inputs">
                    <input
                        type="date"
                        className="neo-input"
                        value={rangeFromValue}
                        onChange={(event) => setRangeFromValue(event.target.value)}
                        aria-label="Desde"
                    />
                    <span>hasta</span>
                    <input
                        type="date"
                        className="neo-input"
                        value={rangeToValue}
                        onChange={(event) => setRangeToValue(event.target.value)}
                        aria-label="Hasta"
                    />
                </div>
            );
        }
        if (mode === 'year') {
            return (
                <input
                    type="number"
                    className="neo-input"
                    min="2020"
                    max="2100"
                    value={yearValue}
                    onChange={(event) => setYearValue(event.target.value)}
                />
            );
        }
        if (mode === 'month') {
            return (
                <input
                    type="month"
                    className="neo-input"
                    value={monthValue}
                    onChange={(event) => setMonthValue(event.target.value)}
                />
            );
        }
        if (mode === 'week') {
            return (
                <input
                    type="date"
                    className="neo-input"
                    value={weekValue}
                    onChange={(event) => setWeekValue(event.target.value)}
                />
            );
        }
        return (
            <input
                type="date"
                className="neo-input"
                value={dayValue}
                onChange={(event) => setDayValue(event.target.value)}
            />
        );
    };

    const previousLabel = REPORT_MODES[mode].previousLabel;
    const comparisonCards = report.comparison ? [
        { label: `Ingresos vs ${previousLabel}`, value: report.comparison.totals.ingresos, positiveGood: true },
        { label: `Egresos vs ${previousLabel}`, value: report.comparison.totals.egresos, positiveGood: false },
        { label: `Neto vs ${previousLabel}`, value: report.comparison.totals.neto, positiveGood: true },
        { label: `Compras internas vs ${previousLabel}`, value: report.comparison.totals.comprasInternas, positiveGood: false },
        { label: `Transf. enviadas vs ${previousLabel}`, value: report.comparison.totals.transferenciasEnviadas, positiveGood: false },
        { label: `Transf. recibidas vs ${previousLabel}`, value: report.comparison.totals.transferenciasRecibidas, positiveGood: true },
    ] : [];

    return (
        <div className="informes-caja-container animate-fade-in">
            <DirectionalReveal className="informes-caja-header" from="up" delay={0.04}>
                <div>
                    <h1>Informes de Caja</h1>
                    <p>Auditoría completa desde apertura hasta cierre, con comparativas y trazabilidad de cada movimiento.</p>
                </div>
                <button className="ic-refresh-btn" onClick={loadData} disabled={loading}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} />
                    Actualizar
                </button>
            </DirectionalReveal>

            {feedback && (
                <div className={`ic-feedback ${feedback.type}`}>
                    <AlertTriangle size={18} />
                    <span>{feedback.text}</span>
                </div>
            )}

            <DirectionalReveal className="ic-controls neo-card" from="up" delay={0.08}>
                <div className="ic-control-group mode">
                    {Object.entries(REPORT_MODES).map(([key, item]) => (
                        <button
                            key={key}
                            className={`ic-mode-btn ${mode === key ? 'active' : ''}`}
                            onClick={() => setMode(key)}
                            type="button"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <label className={mode === 'range' ? 'ic-range-label' : ''}>
                    <span>{mode === 'range' ? 'Desde / Hasta' : 'Período'}</span>
                    {renderPeriodInput()}
                </label>
                <label>
                    <span>Caja</span>
                    <select className="neo-input" value={cashAccount} onChange={(event) => setCashAccount(event.target.value)}>
                        {CASH_ACCOUNTS.map((account) => (
                            <option key={account.value} value={account.value}>{account.label}</option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Comparativa</span>
                    <select
                        className="neo-input"
                        value={compareEnabled ? 'previous' : 'none'}
                        onChange={(event) => setCompareEnabled(event.target.value === 'previous')}
                    >
                        <option value="previous">Comparar con {previousLabel}</option>
                        <option value="none">Sin comparar</option>
                    </select>
                </label>
                <div className="ic-export-actions">
                    <button type="button" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
                    <button type="button" onClick={exportPdf}><FileText size={16} /> PDF</button>
                </div>
            </DirectionalReveal>

            <DirectionalReveal className="ic-metrics-grid" from="left" delay={0.12}>
                <MetricCard label="Ingresos del período" value={formatCurrency(report.current.totals.ingresos)} tone="income" />
                <MetricCard label="Egresos del período" value={formatCurrency(report.current.totals.egresos)} tone="expense" />
                <MetricCard label="Neto del período" value={formatCurrency(report.current.totals.neto)} tone={report.current.totals.neto >= 0 ? 'income' : 'expense'} />
                <MetricCard label="Diferencias de cierre" value={formatCurrency(report.current.closureDifference)} tone={report.current.closureDifference > 0 ? 'danger' : 'neutral'} />
                <MetricCard label="Transferencias recibidas" value={formatCurrency(report.current.totals.transferenciasRecibidas)} tone="income" />
                <MetricCard label="Transferencias enviadas" value={formatCurrency(report.current.totals.transferenciasEnviadas)} tone="expense" />
            </DirectionalReveal>


            <div className="ic-grid">
                <DirectionalReveal className="ic-card neo-card" from="right" delay={0.16}>
                    <div className="ic-card-header">
                        <Scale size={22} />
                        <h2>Resumen por caja</h2>
                    </div>
                    <div className="ic-account-list">
                        {report.current.byAccount.map((row) => (
                            <div key={row.key} className="ic-account-row">
                                <div>
                                    <strong>{row.caja}</strong>
                                    <span>{row.count} movimientos</span>
                                </div>
                                <div className="ic-account-values">
                                    <span>Inicial {formatCurrency(row.saldoInicial)}</span>
                                    <span>Ingresos +{formatCurrency(row.ingresos)}</span>
                                    <span>Egresos -{formatCurrency(row.egresos)}</span>
                                    <span>Transf. recibidas +{formatCurrency(row.transferenciasRecibidas)}</span>
                                    <span>Transf. enviadas -{formatCurrency(row.transferenciasEnviadas)}</span>
                                    <strong>Final {formatCurrency(row.saldoFinal)}</strong>
                                </div>
                            </div>
                        ))}
                    </div>
                </DirectionalReveal>
            </div>

            <DirectionalReveal className="ic-card neo-card" from="up" delay={0.2}>
                <div className="ic-card-header">
                    <CalendarDays size={22} />
                    <h2>Detalle centavo por centavo</h2>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                        {[{ key: 'all', label: 'Todos' }, { key: 'ingresos', label: 'Ingresos' }, { key: 'egresos', label: 'Egresos' }].map(({ key, label }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setRowFilter(key)}
                                style={{
                                    padding: '0.3rem 0.75rem',
                                    borderRadius: '999px',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    border: rowFilter === key
                                        ? `1px solid ${key === 'ingresos' ? 'rgba(34,197,94,0.5)' : key === 'egresos' ? 'rgba(239,68,68,0.5)' : 'rgba(249,115,22,0.5)'}`
                                        : '1px solid rgba(255,255,255,0.1)',
                                    background: rowFilter === key
                                        ? key === 'ingresos' ? 'rgba(34,197,94,0.15)' : key === 'egresos' ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)'
                                        : 'rgba(255,255,255,0.04)',
                                    color: rowFilter === key
                                        ? key === 'ingresos' ? '#4ade80' : key === 'egresos' ? '#f87171' : 'var(--color-primary)'
                                        : 'var(--color-text-muted)',
                                    transition: 'all 0.15s',
                                }}
                            >{label}</button>
                        ))}
                    </div>
                </div>
                {(() => {
                    const filteredRows = report.current.rows.filter((row) => {
                        if (rowFilter === 'ingresos') return toNumber(row.ingreso) > 0;
                        if (rowFilter === 'egresos') return toNumber(row.egreso) > 0;
                        return true;
                    });
                    const totalIngreso = filteredRows.reduce((acc, row) => acc + toNumber(row.ingreso), 0);
                    const totalEgreso = filteredRows.reduce((acc, row) => acc + toNumber(row.egreso), 0);
                    return (
                        <div className="ic-table-wrap">
                            <table className="ic-table">
                                <thead>
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Caja</th>
                                        <th>Operación</th>
                                        <th>Clasificación</th>
                                        <th>Mov. entre cajas</th>
                                        <th>Categoría</th>
                                        <th>Medio</th>
                                        <th>Detalle</th>
                                        <th className="num">Ingreso</th>
                                        <th className="num">Egreso</th>
                                        <th className="num">Saldo caja</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRows.length === 0 && (
                                        <tr>
                                            <td colSpan="11" className="ic-empty">No hay movimientos en el período seleccionado.</td>
                                        </tr>
                                    )}
                                    {filteredRows.map((row, index) => (
                                        <tr key={`${row.source}-${row.id}-${index}`}>
                                            <td style={{ whiteSpace: 'nowrap' }}>{row.fecha}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>{row.caja}</td>
                                            <td>{row.operacion}</td>
                                            <td>{row.clasificacion}</td>
                                            <td>{row.rutaTransferencia || row.movimientoEntreCajas}</td>
                                            <td>{row.categoria}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>{row.medioPago}</td>
                                            <td>
                                                <div className="ic-detail-cell">
                                                    <span>{row.descripcion || row.proveedor || 'Sin detalle'}</span>
                                                    <small>
                                                        {[
                                                            row.detalleClasificacion || '',
                                                            row.ticket ? `Ticket ${row.ticket}` : '',
                                                            row.ventaId ? `Venta ${row.ventaId}` : '',
                                                            row.compraId ? `Compra ${row.compraId}` : '',
                                                            row.transferenciaId ? `Transferencia ${row.transferenciaId}` : '',
                                                            row.cierreTeorico != null ? `Cierre: teórico ${formatCurrency(row.cierreTeorico)}, contado ${formatCurrency(row.cierreContado)}, dif. ${formatCurrency(row.diferenciaCierre)}` : '',
                                                        ].filter(Boolean).join(' · ')}
                                                    </small>
                                                </div>
                                            </td>
                                            <td className="num income">{row.ingreso ? formatCurrency(row.ingreso) : ''}</td>
                                            <td className="num expense">{row.egreso ? formatCurrency(row.egreso) : ''}</td>
                                            <td className="num">{row.saldoCaja !== '' ? formatCurrency(row.saldoCaja) : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {filteredRows.length > 0 && (
                                    <tfoot>
                                        <tr style={{ borderTop: '2px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                                            <td colSpan="8" style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                                                Total — {filteredRows.length} movimiento{filteredRows.length !== 1 ? 's' : ''}
                                            </td>
                                            <td className="num income" style={{ padding: '0.65rem 0.75rem', fontWeight: 800, fontSize: '0.95rem' }}>
                                                {totalIngreso > 0 ? formatCurrency(totalIngreso) : '—'}
                                            </td>
                                            <td className="num expense" style={{ padding: '0.65rem 0.75rem', fontWeight: 800, fontSize: '0.95rem' }}>
                                                {totalEgreso > 0 ? formatCurrency(totalEgreso) : '—'}
                                            </td>
                                            <td className="num" style={{ padding: '0.65rem 0.75rem' }} />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    );
                })()}
            </DirectionalReveal>
        </div>
    );
};

const MetricCard = ({ label, value, tone = 'neutral' }) => (
    <div className={`ic-metric ${tone}`}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

export default InformesCaja;
