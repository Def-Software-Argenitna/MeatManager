import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
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
import { fetchTable } from '../utils/apiClient';
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
const excelCurrencyFormat = '$ #,##0.00;[Red]-$ #,##0.00';
const excelNumberFormat = '#,##0.00';
const excelIntegerFormat = '#,##0';
const excelPalette = {
    navy: '123047',
    blue: '2563EB',
    cyan: 'DDF4FF',
    green: '16A34A',
    greenLight: 'DCFCE7',
    red: 'DC2626',
    redLight: 'FEE2E2',
    amber: 'F59E0B',
    amberLight: 'FEF3C7',
    gray: '64748B',
    grayLight: 'F1F5F9',
    white: 'FFFFFF',
};
const excelColumns = {
    money: new Set(['Ingresos', 'Egresos', 'Neto', 'Valor', 'Actual', 'Anterior', 'Diferencia', 'Saldo inicial', 'Saldo final', 'Ingreso', 'Egreso', 'Saldo caja', 'Saldo total', 'Diferencias de cierre', 'Delta conciliación', 'Transf. recibidas', 'Transf. enviadas']),
    integer: new Set(['Movimientos', 'ID', 'Venta ID', 'Compra ID', 'Cliente ID', 'Sucursal ID', 'Ticket']),
};
const excelFill = (fgColor) => ({ patternType: 'solid', fgColor: { rgb: fgColor } });
const excelBorder = (color = 'CBD5E1') => ({
    top: { style: 'thin', color: { rgb: color } },
    right: { style: 'thin', color: { rgb: color } },
    bottom: { style: 'thin', color: { rgb: color } },
    left: { style: 'thin', color: { rgb: color } },
});
const excelStyles = {
    title: { font: { bold: true, sz: 18, color: { rgb: excelPalette.white } }, fill: excelFill(excelPalette.navy), alignment: { horizontal: 'left', vertical: 'center' } },
    subtitle: { font: { bold: true, color: { rgb: excelPalette.gray } }, fill: excelFill(excelPalette.grayLight), alignment: { horizontal: 'left', vertical: 'center' } },
    header: { font: { bold: true, color: { rgb: excelPalette.white } }, fill: excelFill(excelPalette.blue), alignment: { horizontal: 'center', vertical: 'center' }, border: excelBorder('1D4ED8') },
    chartHeader: { font: { bold: true, color: { rgb: excelPalette.navy } }, fill: excelFill(excelPalette.cyan), alignment: { horizontal: 'center' }, border: excelBorder() },
    body: { border: excelBorder(), alignment: { vertical: 'top', wrapText: true } },
    muted: { font: { color: { rgb: excelPalette.gray } }, border: excelBorder(), alignment: { vertical: 'top', wrapText: true } },
    income: { font: { bold: true, color: { rgb: excelPalette.green } }, fill: excelFill(excelPalette.greenLight), border: excelBorder(), numFmt: excelCurrencyFormat },
    expense: { font: { bold: true, color: { rgb: excelPalette.red } }, fill: excelFill(excelPalette.redLight), border: excelBorder(), numFmt: excelCurrencyFormat },
    warning: { font: { bold: true, color: { rgb: '92400E' } }, fill: excelFill(excelPalette.amberLight), border: excelBorder() },
    chartBar: { font: { bold: true, color: { rgb: excelPalette.blue } }, border: excelBorder(), alignment: { vertical: 'center' } },
};
const getExcelCell = (sheet, row, col) => sheet[XLSX.utils.encode_cell({ r: row, c: col })];
const setExcelStyle = (sheet, row, col, style) => {
    const cell = getExcelCell(sheet, row, col);
    if (cell) cell.s = style;
};
const compactSheetName = (name) => String(name).replace(/[\\/?*[\]:]/g, '').slice(0, 31);
const getExcelColumns = (rows, preferred = []) => {
    const keys = new Set(preferred);
    rows.forEach((row) => Object.keys(row || {}).forEach((key) => keys.add(key)));
    return Array.from(keys);
};
const makeBar = (value, maxValue, size = 22, formatter = formatCurrency) => {
    const ratio = maxValue > 0 ? Math.max(0, Math.abs(toNumber(value)) / maxValue) : 0;
    const filled = Math.max(1, Math.round(ratio * size));
    return `${'█'.repeat(filled)} ${formatter(value)}`;
};
const topChartRows = (rows, labelKey, valueKey, limit = 8, formatter = formatCurrency) => {
    const validRows = rows
        .map((row) => ({ label: row[labelKey], value: toNumber(row[valueKey]) }))
        .filter((row) => row.label && row.value !== 0)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, limit);
    const maxValue = Math.max(0, ...validRows.map((row) => Math.abs(row.value)));
    return validRows.map((row) => ({
        Concepto: row.label,
        Valor: row.value,
        Gráfico: makeBar(row.value, maxValue, 22, formatter),
        Formato: formatter === formatCurrency ? 'money' : 'number',
    }));
};
const buildStyledSheet = ({ title, subtitle, rows, preferredColumns = [], chartRows = [] }) => {
    const dataRows = rows.length ? rows : [{ Info: 'Sin datos para este período' }];
    const columns = getExcelColumns(dataRows, preferredColumns);
    const body = [
        [title],
        [subtitle],
        [],
        columns,
        ...dataRows.map((row) => columns.map((column) => row[column] ?? '')),
    ];
    const chartStart = body.length + 2;
    if (chartRows.length) {
        body.push([]);
        body.push(['Gráfico rápido', 'Valor', 'Barra']);
        chartRows.forEach((row) => body.push([row.Concepto, row.Valor, row.Gráfico]));
    }

    const sheet = XLSX.utils.aoa_to_sheet(body);
    const lastColumn = Math.max(columns.length, chartRows.length ? 3 : 1) - 1;
    sheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
    ];
    sheet['!cols'] = Array.from({ length: lastColumn + 1 }, (_, index) => {
        const header = columns[index] || '';
        if (['Descripción', 'Detalle', 'Hallazgo', 'Email autorizado'].includes(header)) return { wch: 42 };
        if (['Fecha', 'Período'].includes(header)) return { wch: 22 };
        if (excelColumns.money.has(header)) return { wch: 16 };
        return { wch: Math.max(14, Math.min(28, String(header).length + 5)) };
    });
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: Math.max(3, dataRows.length + 3), c: columns.length - 1 } }) };

    for (let c = 0; c <= lastColumn; c += 1) {
        setExcelStyle(sheet, 0, c, excelStyles.title);
        setExcelStyle(sheet, 1, c, excelStyles.subtitle);
    }
    columns.forEach((column, c) => {
        setExcelStyle(sheet, 3, c, excelStyles.header);
        dataRows.forEach((row, index) => {
            const value = row[column];
            const rowIndex = 4 + index;
            const isMoney = excelColumns.money.has(column);
            const isInteger = excelColumns.integer.has(column);
            const numericValue = toNumber(value);
            let style = excelStyles.body;
            if (isMoney) {
                style = numericValue < 0 || column === 'Egresos' || column === 'Egreso' ? excelStyles.expense : excelStyles.income;
            } else if (column === 'Estado' && ['danger', 'warning'].includes(String(value).toLowerCase())) {
                style = excelStyles.warning;
            } else if (['Descripción', 'Detalle', 'Hallazgo'].includes(column)) {
                style = excelStyles.muted;
            }
            setExcelStyle(sheet, rowIndex, c, {
                ...style,
                numFmt: isMoney ? excelCurrencyFormat : (isInteger ? excelIntegerFormat : style.numFmt),
            });
        });
    });

    if (chartRows.length) {
        for (let c = 0; c < 3; c += 1) setExcelStyle(sheet, chartStart, c, excelStyles.chartHeader);
        chartRows.forEach((row, index) => {
            const rowIndex = chartStart + 1 + index;
            const valueFormat = row.Formato === 'number' ? excelIntegerFormat : excelCurrencyFormat;
            setExcelStyle(sheet, rowIndex, 0, excelStyles.body);
            setExcelStyle(sheet, rowIndex, 1, { ...excelStyles.income, numFmt: valueFormat });
            setExcelStyle(sheet, rowIndex, 2, excelStyles.chartBar);
            if (toNumber(row.Valor) < 0) setExcelStyle(sheet, rowIndex, 1, { ...excelStyles.expense, numFmt: valueFormat });
        });
    }
    return sheet;
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
    const type = String(movement?.type || '').toLowerCase();
    const category = String(movement?.category || '').toLowerCase();
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

const buildReport = ({ movements, closures, mode, value, cashAccount, compareEnabled }) => {
    const bounds = getPeriodBounds(mode, value);
    const previousBounds = getPreviousPeriodBounds(mode, bounds);
    const includeAccount = (account) => cashAccount === 'all' || normalizeCashAccount(account) === cashAccount;

    const buildPeriod = (periodBounds) => {
        const initialByAccount = { principal: 0, secondary: 0 };
        (movements || []).forEach((movement) => {
            const date = new Date(movement.date);
            const account = normalizeCashAccount(movement.cash_account);
            if (!Number.isFinite(date.getTime()) || date >= periodBounds.start || !includeAccount(account)) return;
            initialByAccount[account] = round2(initialByAccount[account] + (Math.abs(toNumber(movement.amount)) * getMovementSign(movement)));
        });

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

    const current = buildPeriod(bounds);
    const previous = compareEnabled ? buildPeriod(previousBounds) : null;

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
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const selectedValue = mode === 'range'
        ? { from: rangeFromValue, to: rangeToValue }
        : mode === 'day'
            ? dayValue
            : mode === 'week'
                ? weekValue
                : mode === 'month'
                    ? monthValue
                    : yearValue;
    const selectedValueForFile = mode === 'range' ? `${rangeFromValue}_a_${rangeToValue}` : selectedValue;

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [movementRows, closureRows] = await Promise.all([
                fetchTable('caja_movimientos', { limit: 30000, orderBy: 'date', direction: 'ASC' }),
                fetchTable('cash_closures', { limit: 5000, orderBy: 'closed_at', direction: 'ASC' }).catch(() => []),
            ]);
            setMovements(Array.isArray(movementRows) ? movementRows : []);
            setClosures(Array.isArray(closureRows) ? closureRows : []);
        } catch (error) {
            console.error('[InformesCaja] loadData error', error);
            setFeedback({ type: 'warning', text: 'No se pudieron cargar los movimientos de caja.' });
        } finally {
            setLoading(false);
        }
    }, []);

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
    }), [cashAccount, closures, compareEnabled, mode, movements, selectedValue]);

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
        'Sucursal ID': row.sucursalId,
        'Transferencia ID': row.transferenciaId,
        'Autorización ID': row.autorizacionId,
        Autorizado: row.autorizado,
        'Email autorizado': row.emailAutorizado,
        'Cierre teórico': row.cierreTeorico,
        'Cierre contado': row.cierreContado,
        'Diferencia cierre': row.diferenciaCierre,
    }));

    const exportExcel = () => {
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
        const findingCounts = findingsForExport.reduce((acc, row) => {
            const key = row.Estado || 'ok';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const maxFindings = Math.max(1, ...Object.values(findingCounts));
        const findingChartRows = Object.entries(findingCounts).map(([label, value]) => ({
            Concepto: label,
            Valor: value,
            Gráfico: makeBar(value, maxFindings, 22, (count) => String(count)),
            Formato: 'number',
        }));
        const detailChartRows = topChartRows(
            detailRowsForExport.map((row) => ({ ...row, Movimiento: `${row.Fecha} - ${row.Operación} #${row.ID}` })),
            'Movimiento',
            'Neto',
            10,
        );
        const summaryChartRows = topChartRows(summaryRows, 'Concepto', 'Valor', 8);

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen ejecutivo de caja',
            subtitle: reportSubtitle,
            rows: summaryRows,
            preferredColumns: ['Concepto', 'Valor'],
            chartRows: summaryChartRows,
        }), compactSheetName('Resumen'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Informe final',
            subtitle: 'Hallazgos, alertas y puntos de conciliación',
            rows: findingsForExport,
            preferredColumns: ['Estado', 'Hallazgo', 'Detalle'],
            chartRows: findingChartRows,
        }), compactSheetName('Informe final'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Detalle centavo por centavo',
            subtitle: reportSubtitle,
            rows: detailRowsForExport,
            preferredColumns: ['Origen', 'ID', 'Fecha', 'Caja', 'Operación', 'Clasificación', 'Movimiento entre cajas', 'Ruta transferencia', 'Caja contraparte', 'Tipo', 'Categoría', 'Medio de pago', 'Descripción', 'Detalle clasificación', 'Ingreso', 'Egreso', 'Neto', 'Saldo caja', 'Saldo total'],
            chartRows: detailChartRows,
        }), compactSheetName('Detalle centavo por centavo'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Transferencias entre cajas',
            subtitle: 'Movimientos internos: no son gastos, consumos, ventas ni ajustes',
            rows: transferRows,
            preferredColumns: ['Fecha', 'Caja', 'Movimiento', 'Ruta', 'Contraparte', 'Medio', 'Ingreso', 'Egreso', 'Neto', 'Detalle', 'Transferencia ID'],
            chartRows: topChartRows(transferRows, 'Ruta', 'Neto'),
        }), compactSheetName('Transferencias cajas'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen por caja',
            subtitle: reportSubtitle,
            rows: accountRows,
            preferredColumns: ['Caja', 'Saldo inicial', 'Ingresos', 'Egresos', 'Transf. recibidas', 'Transf. enviadas', 'Neto', 'Saldo final', 'Movimientos'],
            chartRows: topChartRows(accountRows, 'Caja', 'Neto'),
        }), compactSheetName('Por caja'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen por operación',
            subtitle: reportSubtitle,
            rows: operationRows,
            preferredColumns: ['Operación', 'Movimientos', 'Ingresos', 'Egresos', 'Neto'],
            chartRows: topChartRows(operationRows, 'Operación', 'Neto'),
        }), compactSheetName('Por operación'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen por medio de pago',
            subtitle: reportSubtitle,
            rows: methodRows,
            preferredColumns: ['Medio de pago', 'Movimientos', 'Ingresos', 'Egresos', 'Neto'],
            chartRows: topChartRows(methodRows, 'Medio de pago', 'Neto'),
        }), compactSheetName('Por medio'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen por categoría',
            subtitle: reportSubtitle,
            rows: categoryRows,
            preferredColumns: ['Categoría', 'Movimientos', 'Ingresos', 'Egresos', 'Neto'],
            chartRows: topChartRows(categoryRows, 'Categoría', 'Neto'),
        }), compactSheetName('Por categoría'));
        XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
            title: 'Resumen por clasificación',
            subtitle: reportSubtitle,
            rows: classificationRows,
            preferredColumns: ['Clasificación', 'Movimientos', 'Ingresos', 'Egresos', 'Neto'],
            chartRows: topChartRows(classificationRows, 'Clasificación', 'Neto'),
        }), compactSheetName('Por clasificación'));
        if (comparisonRows.length) {
            XLSX.utils.book_append_sheet(workbook, buildStyledSheet({
                title: 'Comparativa contra período anterior',
                subtitle: `${report.modeLabel} actual vs. ${REPORT_MODES[mode]?.previousLabel || 'período anterior'}`,
                rows: comparisonRows,
                preferredColumns: ['Métrica', 'Actual', 'Anterior', 'Diferencia'],
                chartRows: topChartRows(comparisonRows, 'Métrica', 'Diferencia'),
            }), compactSheetName('Comparativa'));
        }
        XLSX.writeFile(workbook, `informe_caja_${mode}_${selectedValueForFile}_${cashAccount}.xlsx`);
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

            {report.comparison && (
                <DirectionalReveal className="ic-comparison-grid" from="left" delay={0.14}>
                    {comparisonCards.map((card) => {
                        const isGood = card.positiveGood ? card.value >= 0 : card.value <= 0;
                        return (
                            <div key={card.label} className={`ic-compare-card ${isGood ? 'good' : 'bad'}`}>
                                <span>{card.label}</span>
                                <strong>{card.value >= 0 ? '+' : ''}{formatCurrency(card.value)}</strong>
                                {card.value >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                            </div>
                        );
                    })}
                </DirectionalReveal>
            )}

            <div className="ic-grid">
                <DirectionalReveal className="ic-card neo-card" from="left" delay={0.16}>
                    <div className="ic-card-header">
                        <ShieldCheck size={22} />
                        <h2>Informe final</h2>
                    </div>
                    <div className="ic-findings">
                        {report.problemFindings.map((finding) => (
                            <div key={finding.title} className={`ic-finding ${finding.severity}`}>
                                <strong>{finding.title}</strong>
                                <span>{finding.detail}</span>
                            </div>
                        ))}
                    </div>
                    <div className="ic-reconciliation">
                        <div>
                            <span>Conciliación interna</span>
                            <strong>{formatCurrency(report.current.reconciliationDelta)}</strong>
                        </div>
                        <div>
                            <span>Movimientos auditados</span>
                            <strong>{report.current.movementRows.length}</strong>
                        </div>
                        <div>
                            <span>Cierres incluidos</span>
                            <strong>{report.current.closureRows.length}</strong>
                        </div>
                    </div>
                </DirectionalReveal>

                <DirectionalReveal className="ic-card neo-card" from="right" delay={0.18}>
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
                </div>
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
                                <th>Ingreso</th>
                                <th>Egreso</th>
                                <th>Saldo caja</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.current.rows.length === 0 && (
                                <tr>
                                    <td colSpan="11" className="ic-empty">No hay movimientos en el período seleccionado.</td>
                                </tr>
                            )}
                            {report.current.rows.map((row, index) => (
                                <tr key={`${row.source}-${row.id}-${index}`}>
                                    <td>{row.fecha}</td>
                                    <td>{row.caja}</td>
                                    <td>{row.operacion}</td>
                                    <td>{row.clasificacion}</td>
                                    <td>{row.rutaTransferencia || row.movimientoEntreCajas}</td>
                                    <td>{row.categoria}</td>
                                    <td>{row.medioPago}</td>
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
                    </table>
                </div>
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
