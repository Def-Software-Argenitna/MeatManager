import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
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
    day: { label: 'Informe por día', compareLabel: 'Comparar con día anterior' },
    month: { label: 'Informe por mes', compareLabel: 'Comparar con mes anterior' },
    year: { label: 'Informe por año', compareLabel: 'Comparar con año anterior' },
};

const toNumber = (value) => Number(value) || 0;
const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
const formatCurrency = (value) => `$${round2(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
const getMovementOperation = (movement) => {
    const type = String(movement?.type || '').toLowerCase();
    const category = String(movement?.category || '').toLowerCase();
    if (type === 'apertura') return 'Apertura de caja';
    if (type === 'venta') return 'Cobro de venta';
    if (type === 'anulacion_venta') return 'Anulación de venta';
    if (category.includes('transferencia')) return type === 'ingreso' ? 'Transferencia recibida' : 'Transferencia enviada';
    if (category.includes('compra interna')) return 'Compra interna';
    if (type === 'ingreso') return 'Ingreso manual';
    if (type === 'retiro' || type === 'egreso') return 'Retiro / gasto';
    return movement?.category || movement?.type || 'Movimiento';
};
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getPeriodBounds = (mode, value) => {
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
    const [year, month, day] = String(value || formatDateInput(new Date())).split('-').map(Number);
    return {
        start: new Date(year, month - 1, day, 0, 0, 0, 0),
        end: new Date(year, month - 1, day, 23, 59, 59, 999),
        label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    };
};

const getPreviousPeriodBounds = (mode, bounds) => {
    if (mode === 'year') {
        const year = bounds.start.getFullYear() - 1;
        return getPeriodBounds('year', String(year));
    }
    if (mode === 'month') {
        const prev = new Date(bounds.start);
        prev.setMonth(prev.getMonth() - 1);
        return getPeriodBounds('month', formatMonthInput(prev));
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
                return {
                    source: 'Movimiento',
                    id: movement.id,
                    date,
                    fecha: formatDateTime(date),
                    caja: getCashAccountLabel(account),
                    cuentaCaja: account,
                    operacion: getMovementOperation(movement),
                    tipo: movement.type || '',
                    categoria: movement.category || '',
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
            transferenciasEnviadas: round2(acc.transferenciasEnviadas + (row.operacion === 'Transferencia enviada' ? row.egreso : 0)),
            transferenciasRecibidas: round2(acc.transferenciasRecibidas + (row.operacion === 'Transferencia recibida' ? row.ingreso : 0)),
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
                return {
                    key: account,
                    caja: getCashAccountLabel(account),
                    saldoInicial: initialByAccount[account] || 0,
                    ingresos,
                    egresos,
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
            closureDifference: round2(current.closureDifference - previous.closureDifference),
        },
        byOperation: compareGroups(current.byOperation, previous.byOperation),
        byCategory: compareGroups(current.byCategory, previous.byCategory),
        byMethod: compareGroups(current.byMethod, previous.byMethod),
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
    const [mode, setMode] = useState('day');
    const [dayValue, setDayValue] = useState(formatDateInput(now));
    const [monthValue, setMonthValue] = useState(formatMonthInput(now));
    const [yearValue, setYearValue] = useState(String(now.getFullYear()));
    const [cashAccount, setCashAccount] = useState('all');
    const [compareEnabled, setCompareEnabled] = useState(true);
    const [movements, setMovements] = useState([]);
    const [closures, setClosures] = useState([]);
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const selectedValue = mode === 'day' ? dayValue : mode === 'month' ? monthValue : yearValue;

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
        ] : [];
        const accountRows = report.current.byAccount.map((row) => ({
            Caja: row.caja,
            'Saldo inicial': row.saldoInicial,
            Ingresos: row.ingresos,
            Egresos: row.egresos,
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

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resumen');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(problemRows), 'Informe final');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRowsForExport), 'Detalle centavo por centavo');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(accountRows), 'Por caja');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupSheet(report.current.byOperation, 'Operación')), 'Por operación');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupSheet(report.current.byMethod, 'Medio de pago')), 'Por medio');
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupSheet(report.current.byCategory, 'Categoría')), 'Por categoría');
        if (comparisonRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(comparisonRows), 'Comparativa');
        XLSX.writeFile(workbook, `informe_caja_${mode}_${selectedValue}_${cashAccount}.xlsx`);
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
            <tr><td>${escapeHtml(row.caja)}</td><td class="num">${escapeHtml(formatCurrency(row.saldoInicial))}</td><td class="num income">${escapeHtml(formatCurrency(row.ingresos))}</td><td class="num expense">${escapeHtml(formatCurrency(row.egresos))}</td><td class="num">${escapeHtml(formatCurrency(row.saldoFinal))}</td></tr>
        `).join('');
        const findingsHtml = report.problemFindings.map((finding) => `
            <div class="finding ${escapeHtml(finding.severity)}"><strong>${escapeHtml(finding.title)}</strong><span>${escapeHtml(finding.detail)}</span></div>
        `).join('');
        const rowsHtml = report.current.rows.map((row) => `
            <tr>
                <td>${escapeHtml(row.fecha)}</td>
                <td>${escapeHtml(row.caja)}</td>
                <td>${escapeHtml(row.operacion)}</td>
                <td>${escapeHtml(row.categoria)}</td>
                <td>${escapeHtml(row.medioPago)}</td>
                <td>${escapeHtml([row.descripcion, row.proveedor ? `Proveedor: ${row.proveedor}` : '', row.ticket ? `Ticket: ${row.ticket}` : '', row.ventaId ? `Venta: ${row.ventaId}` : '', row.compraId ? `Compra: ${row.compraId}` : '', row.transferenciaId ? `Transferencia: ${row.transferenciaId}` : '', row.cierreTeorico != null ? `Cierre teórico ${formatCurrency(row.cierreTeorico)} contado ${formatCurrency(row.cierreContado)} diferencia ${formatCurrency(row.diferenciaCierre)}` : ''].filter(Boolean).join(' · '))}</td>
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
                    </div>
                    <h2>Informe final</h2>
                    ${findingsHtml}
                    <h2>Resumen por caja</h2>
                    <table><thead><tr><th>Caja</th><th>Saldo inicial</th><th>Ingresos</th><th>Egresos</th><th>Saldo final</th></tr></thead><tbody>${summaryHtml}</tbody></table>
                    <h2>Detalle completo</h2>
                    <table><thead><tr><th>Fecha</th><th>Caja</th><th>Operación</th><th>Categoría</th><th>Medio</th><th>Detalle</th><th>Ingreso</th><th>Egreso</th><th>Saldo caja</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                    <script>window.onload = () => window.print();</script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    const renderPeriodInput = () => {
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
        return (
            <input
                type="date"
                className="neo-input"
                value={dayValue}
                onChange={(event) => setDayValue(event.target.value)}
            />
        );
    };

    const comparisonCards = report.comparison ? [
        { label: 'Ingresos vs anterior', value: report.comparison.totals.ingresos, positiveGood: true },
        { label: 'Egresos vs anterior', value: report.comparison.totals.egresos, positiveGood: false },
        { label: 'Neto vs anterior', value: report.comparison.totals.neto, positiveGood: true },
        { label: 'Compras internas vs anterior', value: report.comparison.totals.comprasInternas, positiveGood: false },
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
                            className={mode === key ? 'active' : ''}
                            onClick={() => setMode(key)}
                            type="button"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <label>
                    <span>Período</span>
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
                <label className="ic-check">
                    <input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} />
                    <span>{REPORT_MODES[mode].compareLabel}</span>
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
                                    <td colSpan="9" className="ic-empty">No hay movimientos en el período seleccionado.</td>
                                </tr>
                            )}
                            {report.current.rows.map((row, index) => (
                                <tr key={`${row.source}-${row.id}-${index}`}>
                                    <td>{row.fecha}</td>
                                    <td>{row.caja}</td>
                                    <td>{row.operacion}</td>
                                    <td>{row.categoria}</td>
                                    <td>{row.medioPago}</td>
                                    <td>
                                        <div className="ic-detail-cell">
                                            <span>{row.descripcion || row.proveedor || 'Sin detalle'}</span>
                                            <small>
                                                {[
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
