import React, { useEffect, useMemo, useState } from 'react';
import {
    Save,
    Calendar as CalendarIcon,
    DollarSign,
    CreditCard,
    Smartphone,
    Landmark,
    AlertCircle,
    Wallet,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import { desktopApi } from '../utils/desktopApi';
import { requestCashWithdrawalAuthorization, verifyCashWithdrawalAuthorization } from '../utils/apiClient';
import './CierreCaja.css';

const OUTFLOW_CATEGORIES = [
    'Retiro de caja',
    'Retiro Socios',
    'Inter-Sucursal',
    'Ajuste negativo',
    'Otros'
];

const WITHDRAWAL_CATEGORIES = new Set([
    'Retiro de caja',
    'Retiro Socios',
    'Inter-Sucursal',
]);

const INFLOW_CATEGORIES = [
    'Cobro Pendientes',
    'Inyección de Capital',
    'Venta Activo',
    'Ajuste positivo',
    'Otros'
];

const METHOD_ICON_MAP = {
    cash: DollarSign,
    card: CreditCard,
    wallet: Smartphone,
    transfer: Landmark,
};

const isCurrentAccount = (name, type) => {
    const normalizedName = String(name || '').trim().toLowerCase();
    return type === 'cuenta_corriente' || normalizedName === 'cuenta corriente';
};

const toNumber = (value) => Number(value) || 0;
const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(toNumber(value));

const getMovementSign = (movement) => {
    if (movement.type === 'apertura' || movement.type === 'ingreso' || movement.type === 'venta') return 1;
    if (movement.type === 'egreso' || movement.type === 'retiro' || movement.type === 'anulacion_venta') return -1;
    return toNumber(movement.amount) >= 0 ? 1 : -1;
};

const getDayBounds = (selectedDate) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return {
        start: new Date(y, m - 1, d, 0, 0, 0, 0),
        end: new Date(y, m - 1, d, 23, 59, 59, 999),
    };
};

const buildSaleParts = (sale) => {
    if (Array.isArray(sale.payment_breakdown) && sale.payment_breakdown.length > 0) {
        return sale.payment_breakdown
            .filter((part) => !isCurrentAccount(part.method_name, part.method_type))
            .map((part) => ({
                name: part.method_name || 'Efectivo',
                type: part.method_type || 'cash',
                amount: toNumber(part.amount_charged),
            }));
    }

    if (isCurrentAccount(sale.payment_method)) return [];

    return [{
        name: sale.payment_method || 'Efectivo',
        type: 'cash',
        amount: toNumber(sale.total),
    }];
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CierreCaja = () => {
    const now = new Date();
    const [selectedDate, setSelectedDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    );
    const [showMovementForm, setShowMovementForm] = useState(false);
    const [showOpeningForm, setShowOpeningForm] = useState(false);
    const [movementType, setMovementType] = useState('retiro');
    const [movementAmount, setMovementAmount] = useState('');
    const [movementCategory, setMovementCategory] = useState('Retiro Socios');
    const [movementDesc, setMovementDesc] = useState('');
    const [movementPaymentMethod, setMovementPaymentMethod] = useState('Efectivo');
    const [openingDraft, setOpeningDraft] = useState({});
    const [countedCash, setCountedCash] = useState('');
    const [closureNotes, setClosureNotes] = useState('');
    const [closingDay, setClosingDay] = useState(false);
    const [requestingWithdrawalCode, setRequestingWithdrawalCode] = useState(false);
    const [verifyingWithdrawalCode, setVerifyingWithdrawalCode] = useState(false);
    const [withdrawalAuthorization, setWithdrawalAuthorization] = useState(null);
    const [withdrawalCodeInput, setWithdrawalCodeInput] = useState('');
    const [feedback, setFeedback] = useState(null);

    const { start, end } = useMemo(() => getDayBounds(selectedDate), [selectedDate]);
    const previousDayEnd = useMemo(() => {
        const previous = new Date(start);
        previous.setMilliseconds(previous.getMilliseconds() - 1);
        return previous;
    }, [start]);

    const sales = useLiveQuery(() => db.ventas.where('date').between(start, end).toArray(), [start, end]);
    const allSalesUntilDate = useLiveQuery(() => db.ventas.where('date').belowOrEqual(end).toArray(), [end]);
    const allSalesBeforeDate = useLiveQuery(() => db.ventas.where('date').belowOrEqual(previousDayEnd).toArray(), [previousDayEnd]);
    const movements = useLiveQuery(() => db.caja_movimientos.where('date').between(start, end).toArray(), [start, end]);
    const allMovementsUntilDate = useLiveQuery(() => db.caja_movimientos.where('date').belowOrEqual(end).toArray(), [end]);
    const allMovementsBeforeDate = useLiveQuery(() => db.caja_movimientos.where('date').belowOrEqual(previousDayEnd).toArray(), [previousDayEnd]);
    const paymentMethods = useLiveQuery(() => db.payment_methods.toArray(), []);
    const closureRecord = useLiveQuery(() => db.cash_closures?.where('closure_date').equals(selectedDate).first(), [selectedDate]);
    const reportFolderSetting = useLiveQuery(() => db.settings.get('cash_closure_reports_folder'), []);

    const activePaymentMethods = useMemo(() => {
        const methods = (paymentMethods || [])
            .filter((method) => method.enabled && !isCurrentAccount(method.name, method.type));

        if (methods.length === 0) {
            return [
                { id: 'cash-fallback', name: 'Efectivo', type: 'cash', enabled: true },
                { id: 'card-fallback', name: 'Posnet', type: 'card', enabled: true },
                { id: 'wallet-fallback', name: 'Mercado Pago', type: 'wallet', enabled: true },
                { id: 'transfer-fallback', name: 'Transferencia', type: 'transfer', enabled: true },
            ];
        }

        return methods;
    }, [paymentMethods]);

    useEffect(() => {
        setMovementPaymentMethod((prev) => (
            activePaymentMethods.some((method) => method.name === prev)
                ? prev
                : activePaymentMethods[0]?.name || 'Efectivo'
        ));
    }, [activePaymentMethods]);

    useEffect(() => {
        setOpeningDraft((prev) => {
            const next = {};
            activePaymentMethods.forEach((method) => {
                next[method.name] = prev[method.name] || '';
            });
            return next;
        });
    }, [activePaymentMethods]);

    const salesByMethod = useMemo(() => {
        if (!sales) return [];

        const totals = {};
        sales.forEach((sale) => {
            buildSaleParts(sale).forEach((part) => {
                totals[part.name] = (totals[part.name] || 0) + part.amount;
            });
        });

        return Object.entries(totals).map(([name, total]) => {
            const method = activePaymentMethods.find((item) => item.name === name);
            return {
                name,
                total,
                method: method || { name, type: 'cash' },
                type: method?.type || 'cash',
            };
        });
    }, [sales, activePaymentMethods]);

    const openingMovements = useMemo(() => (
        (movements || []).filter((movement) => movement.type === 'apertura')
    ), [movements]);

    const openingByMethod = useMemo(() => {
        const totals = {};
        openingMovements.forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            totals[methodName] = (totals[methodName] || 0) + toNumber(movement.amount);
        });
        return totals;
    }, [openingMovements]);

    const manualMovements = useMemo(() => (
        (movements || []).filter((movement) => movement.type !== 'apertura')
    ), [movements]);

    const totalSales = (sales || []).reduce((sum, sale) => sum + toNumber(sale.total), 0);
    const totalExpenses = manualMovements
        .filter((movement) => movement.type === 'egreso' || movement.type === 'retiro')
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const totalIncomes = manualMovements
        .filter((movement) => movement.type === 'ingreso')
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const currentAccountSales = (sales || []).reduce((sum, sale) => {
        if (Array.isArray(sale.payment_breakdown) && sale.payment_breakdown.length > 0) {
            const ccPart = sale.payment_breakdown
                .filter((part) => isCurrentAccount(part.method_name, part.method_type))
                .reduce((acc, part) => acc + toNumber(part.amount_charged), 0);
            return sum + ccPart;
        }
        return isCurrentAccount(sale.payment_method) ? sum + toNumber(sale.total) : sum;
    }, 0);

    const withdrawalsTotal = manualMovements
        .filter((movement) => movement.type !== 'ingreso' && WITHDRAWAL_CATEGORIES.has(movement.category))
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

    const expensesOnlyTotal = manualMovements
        .filter((movement) => movement.type !== 'ingreso' && !WITHDRAWAL_CATEGORIES.has(movement.category))
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

    const accumulatedByMethod = useMemo(() => {
        const totals = {};

        activePaymentMethods.forEach((method) => {
            totals[method.name] = 0;
        });

        (allSalesUntilDate || []).forEach((sale) => {
            buildSaleParts(sale).forEach((part) => {
                totals[part.name] = (totals[part.name] || 0) + part.amount;
            });
        });

        (allMovementsUntilDate || []).forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            if (isCurrentAccount(methodName, movement.payment_method_type)) return;
            const sign = getMovementSign(movement);
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
        });

        return totals;
    }, [activePaymentMethods, allSalesUntilDate, allMovementsUntilDate]);

    const previousCloseByMethod = useMemo(() => {
        const totals = {};

        activePaymentMethods.forEach((method) => {
            totals[method.name] = 0;
        });

        (allSalesBeforeDate || []).forEach((sale) => {
            buildSaleParts(sale).forEach((part) => {
                totals[part.name] = (totals[part.name] || 0) + part.amount;
            });
        });

        (allMovementsBeforeDate || []).forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            if (isCurrentAccount(methodName, movement.payment_method_type)) return;
            const sign = getMovementSign(movement);
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
        });

        return totals;
    }, [activePaymentMethods, allSalesBeforeDate, allMovementsBeforeDate]);

    const dailyManualNetByMethod = useMemo(() => {
        const totals = {};
        manualMovements.forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            const sign = getMovementSign(movement);
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
        });
        return totals;
    }, [manualMovements]);

    const methodCards = useMemo(() => (
        activePaymentMethods.map((method) => ({
            ...method,
            opening: openingByMethod[method.name] || 0,
            sales: salesByMethod.find((item) => item.name === method.name)?.total || 0,
            manualNet: dailyManualNetByMethod[method.name] || 0,
            accumulated: accumulatedByMethod[method.name] || 0,
        }))
    ), [activePaymentMethods, openingByMethod, salesByMethod, dailyManualNetByMethod, accumulatedByMethod]);

    const cashInDrawer = methodCards
        .filter((method) => method.type === 'cash')
        .reduce((sum, method) => sum + method.accumulated, 0);

    const countedCashValue = parseFloat(countedCash) || 0;
    const cashDifference = countedCash ? countedCashValue - cashInDrawer : 0;
    const cashDifferenceState = !countedCash
        ? 'neutral'
        : Math.abs(cashDifference) < 0.01
            ? 'match'
            : cashDifference > 0
                ? 'surplus'
                : 'shortage';

    const previousCloseTotal = Object.values(previousCloseByMethod).reduce((sum, amount) => sum + toNumber(amount), 0);
    const previousCashClose = activePaymentMethods
        .filter((method) => method.type === 'cash')
        .reduce((sum, method) => sum + toNumber(previousCloseByMethod[method.name]), 0);
    const reportFolderPath = reportFolderSetting?.value || '';
    const isPartnerWithdrawal = movementType === 'retiro' && movementCategory === 'Retiro Socios';
    const withdrawalPayloadKey = `${movementType}|${movementCategory}|${Number(movementAmount || 0).toFixed(2)}|${movementPaymentMethod}|${movementDesc.trim()}`;

    useEffect(() => {
        if (!withdrawalAuthorization) return;
        if (withdrawalAuthorization.payloadKey !== withdrawalPayloadKey) {
            setWithdrawalAuthorization(null);
            setWithdrawalCodeInput('');
        }
    }, [withdrawalPayloadKey, withdrawalAuthorization]);

    useEffect(() => {
        if (openingMovements.length > 0) return;
        setOpeningDraft((prev) => {
            const next = { ...prev };
            let changed = false;
            activePaymentMethods.forEach((method) => {
                const suggestedAmount = toNumber(previousCloseByMethod[method.name]);
                if (!next[method.name] && suggestedAmount > 0) {
                    next[method.name] = String(suggestedAmount);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [activePaymentMethods, openingMovements.length, previousCloseByMethod]);

    const handleOpeningChange = (methodName, value) => {
        setOpeningDraft((prev) => ({
            ...prev,
            [methodName]: value,
        }));
    };

    const handleSaveOpening = async (e) => {
        e.preventDefault();
        const rows = activePaymentMethods
            .map((method) => ({
                method,
                amount: parseFloat(openingDraft[method.name]) || 0,
            }))
            .filter((row) => row.amount > 0 || toNumber(previousCloseByMethod[row.method.name]) > 0);

        if (rows.length === 0) {
            setFeedback({ type: 'warning', text: 'Ingresá al menos un monto de apertura para registrar la caja.' });
            return;
        }

        const openingDate = new Date(`${selectedDate}T08:00:00`);
        const records = [];

        rows.forEach(({ method, amount }) => {
            const previousAmount = toNumber(previousCloseByMethod[method.name]);
            const actualAmount = toNumber(amount);
            const difference = actualAmount - previousAmount;

            records.push({
                type: 'apertura',
                amount: actualAmount,
                category: 'Apertura de caja',
                description: `Apertura inicial ${method.name}`,
                payment_method: method.name,
                payment_method_type: method.type,
                date: openingDate,
                synced: 0,
            });

            if (difference !== 0) {
                records.push({
                    type: difference > 0 ? 'ingreso' : 'retiro',
                    amount: Math.abs(difference),
                    category: difference > 0 ? 'Sobrante de apertura' : 'Faltante de apertura',
                    description: `Diferencia contra cierre anterior de ${method.name}`,
                    payment_method: method.name,
                    payment_method_type: method.type,
                    date: openingDate,
                    synced: 0,
                });
            }
        });

        await db.caja_movimientos.bulkAdd(records);

        setFeedback({ type: 'success', text: 'Apertura de caja registrada correctamente.' });
        setShowOpeningForm(false);
        setOpeningDraft({});
    };

    const handleAddMovement = async (e) => {
        e.preventDefault();
        if (!movementAmount || parseFloat(movementAmount) <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá un importe válido para guardar el movimiento.' });
            return;
        }

        if (isPartnerWithdrawal) {
            if (!withdrawalAuthorization?.verified) {
                setFeedback({ type: 'warning', text: 'Antes de guardar el retiro de socios tenés que solicitar y validar el código enviado por mail.' });
                return;
            }
        }

        await db.caja_movimientos.add({
            type: movementType,
            amount: parseFloat(movementAmount),
            category: movementCategory,
            description: movementDesc,
            payment_method: movementPaymentMethod,
            payment_method_type: activePaymentMethods.find((method) => method.name === movementPaymentMethod)?.type || 'cash',
            authorization_id: withdrawalAuthorization?.authorizationId || null,
            authorization_verified: withdrawalAuthorization?.verified ? 1 : 0,
            authorized_recipient_email: withdrawalAuthorization?.recipient || null,
            date: new Date(),
            synced: 0,
        });

        setMovementAmount('');
        setMovementDesc('');
        setWithdrawalAuthorization(null);
        setWithdrawalCodeInput('');
        setShowMovementForm(false);
        setFeedback({ type: 'success', text: 'Movimiento de caja guardado correctamente.' });
    };

    const handleRequestWithdrawalCode = async () => {
        if (!movementAmount || parseFloat(movementAmount) <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá primero el monto del retiro societario.' });
            return;
        }

        setRequestingWithdrawalCode(true);
        try {
            const response = await requestCashWithdrawalAuthorization({
                amount: parseFloat(movementAmount),
                paymentMethod: movementPaymentMethod,
                category: movementCategory,
                description: movementDesc,
            });
            setWithdrawalAuthorization({
                authorizationId: response.authorizationId,
                expiresAt: response.expiresAt,
                recipient: response.recipient,
                payloadKey: withdrawalPayloadKey,
                verified: false,
            });
            setWithdrawalCodeInput('');
            setFeedback({ type: 'success', text: `Código enviado a ${response.recipient}. Ingresalo para autorizar el retiro.` });
        } catch (error) {
            setFeedback({ type: 'error', text: error.message });
        } finally {
            setRequestingWithdrawalCode(false);
        }
    };

    const handleVerifyWithdrawalCode = async () => {
        if (!withdrawalAuthorization?.authorizationId) {
            setFeedback({ type: 'warning', text: 'Primero solicitá el código de autorización.' });
            return;
        }

        if (!withdrawalCodeInput.trim()) {
            setFeedback({ type: 'warning', text: 'Ingresá el código que llegó por mail.' });
            return;
        }

        setVerifyingWithdrawalCode(true);
        try {
            const response = await verifyCashWithdrawalAuthorization({
                authorizationId: withdrawalAuthorization.authorizationId,
                code: withdrawalCodeInput.trim(),
                amount: parseFloat(movementAmount),
                paymentMethod: movementPaymentMethod,
                category: movementCategory,
            });
            setWithdrawalAuthorization((prev) => ({
                ...prev,
                verified: true,
                recipient: response.recipient || prev?.recipient || null,
            }));
            setFeedback({ type: 'success', text: 'Retiro societario autorizado correctamente.' });
        } catch (error) {
            setFeedback({ type: 'error', text: error.message });
        } finally {
            setVerifyingWithdrawalCode(false);
        }
    };

    const handleDeleteMovement = async (movementId) => {
        await db.caja_movimientos.delete(movementId);
        setFeedback({ type: 'success', text: 'Movimiento eliminado de la caja.' });
    };

    const handleChooseReportFolder = async () => {
        try {
            const result = await desktopApi.chooseDirectory();
            if (!result?.ok) return;
            await db.settings.put({ key: 'cash_closure_reports_folder', value: result.path });
            setFeedback({ type: 'success', text: `Carpeta de cierres configurada: ${result.path}` });
        } catch (error) {
            setFeedback({ type: 'warning', text: `No se pudo seleccionar la carpeta: ${error.message}` });
        }
    };

    const buildClosureReportHtml = (closure) => {
        const rowsHtml = closure.methods.map((method) => `
            <tr>
                <td>${escapeHtml(method.name)}</td>
                <td>${escapeHtml(formatCurrency(method.previousClose))}</td>
                <td>${escapeHtml(formatCurrency(method.opening))}</td>
                <td>${escapeHtml(formatCurrency(method.sales))}</td>
                <td>${escapeHtml(formatCurrency(method.manualNet))}</td>
                <td>${escapeHtml(formatCurrency(method.accumulated))}</td>
            </tr>
        `).join('');

        const movementsHtml = closure.movements.map((movement) => `
            <tr>
                <td>${escapeHtml(movement.category)}</td>
                <td>${escapeHtml(movement.payment_method || 'Efectivo')}</td>
                <td>${escapeHtml(movement.description || '-')}</td>
                <td>${escapeHtml(movement.type)}</td>
                <td>${escapeHtml(formatCurrency(movement.amount))}</td>
            </tr>
        `).join('');

        return `
            <html>
            <head>
                <meta charset="utf-8" />
                <title>Cierre de Caja ${escapeHtml(closure.closureDate)}</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
                    h1, h2 { margin: 0 0 10px; }
                    .meta, .summary { margin-bottom: 18px; }
                    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 18px; }
                    .box { border: 1px solid #ddd; border-radius: 10px; padding: 10px 12px; }
                    .label { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; }
                    .value { font-size: 18px; font-weight: 700; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
                    th { background: #f5f5f5; }
                    .notes { margin-top: 16px; padding: 12px; border: 1px solid #ddd; border-radius: 10px; }
                </style>
            </head>
            <body>
                <h1>Cierre de Caja</h1>
                <div class="meta">
                    <div><strong>Fecha:</strong> ${escapeHtml(closure.closureDate)}</div>
                    <div><strong>Generado:</strong> ${escapeHtml(new Date(closure.closedAt).toLocaleString('es-AR'))}</div>
                    <div><strong>Carpeta:</strong> ${escapeHtml(reportFolderPath || 'No configurada')}</div>
                </div>
                <div class="summary-grid">
                    <div class="box"><div class="label">Cierre anterior</div><div class="value">${escapeHtml(formatCurrency(closure.previousCloseTotal))}</div></div>
                    <div class="box"><div class="label">Apertura del día</div><div class="value">${escapeHtml(formatCurrency(closure.openingTotal))}</div></div>
                    <div class="box"><div class="label">Ventas del día</div><div class="value">${escapeHtml(formatCurrency(closure.totalSales))}</div></div>
                    <div class="box"><div class="label">Efectivo teórico</div><div class="value">${escapeHtml(formatCurrency(closure.cashInDrawer))}</div></div>
                </div>
                <div class="summary-grid">
                    <div class="box"><div class="label">Efectivo contado</div><div class="value">${escapeHtml(formatCurrency(closure.countedCash))}</div></div>
                    <div class="box"><div class="label">Diferencia</div><div class="value">${escapeHtml(formatCurrency(closure.cashDifference))}</div></div>
                    <div class="box"><div class="label">Retiros</div><div class="value">${escapeHtml(formatCurrency(closure.withdrawalsTotal))}</div></div>
                    <div class="box"><div class="label">Gastos</div><div class="value">${escapeHtml(formatCurrency(closure.expensesOnlyTotal))}</div></div>
                </div>

                <h2>Detalle por medio de pago</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Medio</th>
                            <th>Cierre anterior</th>
                            <th>Apertura</th>
                            <th>Ventas</th>
                            <th>Mov. manuales</th>
                            <th>Saldo actual</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>

                <h2>Movimientos manuales del día</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Categoría</th>
                            <th>Medio</th>
                            <th>Descripción</th>
                            <th>Tipo</th>
                            <th>Importe</th>
                        </tr>
                    </thead>
                    <tbody>${movementsHtml || '<tr><td colspan="5">Sin movimientos manuales.</td></tr>'}</tbody>
                </table>

                <div class="notes">
                    <strong>Observaciones de cierre:</strong><br />
                    ${escapeHtml(closure.notes || 'Sin observaciones')}
                </div>
            </body>
            </html>
        `;
    };

    const handleCloseDay = async () => {
        if (!openingMovements.length) {
            setFeedback({ type: 'warning', text: 'No podés cerrar el día sin registrar primero la apertura de caja.' });
            return;
        }

        if (!countedCash) {
            setFeedback({ type: 'warning', text: 'Ingresá el efectivo contado para poder cerrar la caja.' });
            return;
        }

        if (!reportFolderPath) {
            setFeedback({ type: 'warning', text: 'Primero elegí la carpeta donde se van a guardar los PDF de cierre.' });
            return;
        }

        if (closureRecord) {
            setFeedback({ type: 'warning', text: 'Este día ya tiene un cierre registrado.' });
            return;
        }

        setClosingDay(true);
        try {
            const closurePayload = {
                closureDate: selectedDate,
                closedAt: new Date().toISOString(),
                previousCloseTotal,
                openingTotal: openingMovements.reduce((sum, movement) => sum + toNumber(movement.amount), 0),
                totalSales,
                totalIncomes,
                totalExpenses,
                withdrawalsTotal,
                expensesOnlyTotal,
                cashInDrawer,
                countedCash: countedCashValue,
                cashDifference,
                notes: closureNotes,
                methods: methodCards.map((method) => ({
                    name: method.name,
                    previousClose: toNumber(previousCloseByMethod[method.name]),
                    opening: method.opening,
                    sales: method.sales,
                    manualNet: method.manualNet,
                    accumulated: method.accumulated,
                })),
                movements: manualMovements.map((movement) => ({
                    category: movement.category,
                    payment_method: movement.payment_method,
                    description: movement.description,
                    type: movement.type,
                    amount: toNumber(movement.amount),
                })),
            };

            const fileName = `cierre_caja_${selectedDate}.pdf`;
            const html = buildClosureReportHtml(closurePayload);
            const pdfResult = await desktopApi.saveHtmlPdf({
                html,
                folderPath: reportFolderPath,
                fileName,
            });

            if (!pdfResult?.ok) {
                throw new Error(pdfResult?.error || 'No se pudo generar el PDF del cierre');
            }

            await db.cash_closures.add({
                closure_date: selectedDate,
                closed_at: closurePayload.closedAt,
                theoretical_cash: cashInDrawer,
                counted_cash: countedCashValue,
                difference: cashDifference,
                total_sales: totalSales,
                total_incomes: totalIncomes,
                total_expenses: totalExpenses,
                notes: closureNotes,
                report_path: pdfResult.path,
                snapshot: closurePayload,
            });

            setFeedback({ type: 'success', text: `Cierre guardado correctamente y PDF generado en ${pdfResult.path}` });
        } catch (error) {
            setFeedback({ type: 'warning', text: `No se pudo cerrar la caja: ${error.message}` });
        } finally {
            setClosingDay(false);
        }
    };

    return (
        <div className="cierre-container animate-fade-in">
            <header className="cierre-header">
                <div>
                    <h1>Caja y Cierre Diario</h1>
                    <p>Apertura, movimientos, retiros y saldo acumulado por medio de pago.</p>
                </div>
                <div className="date-picker-wrapper">
                    <CalendarIcon size={18} />
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="neo-input"
                    />
                </div>
            </header>

            {feedback && (
                <div className={`cash-feedback ${feedback.type}`}>
                    <AlertCircle size={18} />
                    <span>{feedback.text}</span>
                </div>
            )}

            <div className="cash-report-bar neo-card">
                <div>
                    <div className="cash-report-title">Carpeta de cierres PDF</div>
                    <div className="cash-report-path">
                        {reportFolderPath || 'Todavía no hay una carpeta configurada para guardar los cierres.'}
                    </div>
                </div>
                <div className="cash-report-actions">
                    <button className="cierre-add-btn" type="button" onClick={handleChooseReportFolder}>
                        {reportFolderPath ? 'Cambiar carpeta' : 'Elegir carpeta'}
                    </button>
                    {closureRecord?.report_path && (
                        <button className="cierre-secondary-btn" type="button" onClick={() => desktopApi.openPath(closureRecord.report_path)}>
                            Abrir PDF
                        </button>
                    )}
                </div>
            </div>

            <div className="cash-overview-grid">
                <div className="stat-box result">
                    <span className="label">Efectivo acumulado en caja</span>
                    <span className="val">${cashInDrawer.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box income">
                    <span className="label">Ingresos manuales del día</span>
                    <span className="val">+${totalIncomes.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box expense">
                    <span className="label">Retiros y gastos del día</span>
                    <span className="val">-${totalExpenses.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box">
                    <span className="label">Ventas a cuenta corriente</span>
                    <span className="val">${currentAccountSales.toLocaleString('es-AR')}</span>
                </div>
            </div>

            <div className="cierre-grid">
                <div className="cierre-card summary-card neo-card">
                    <div className="card-header">
                        <Wallet size={24} color="var(--color-primary)" />
                        <h2>Saldos por Medio de Pago</h2>
                    </div>

                    <div className="methods-list">
                        {methodCards.map((item) => {
                            const Icon = METHOD_ICON_MAP[item.type] || Wallet;
                            return (
                                <div key={item.name} className="method-item method-balance-item">
                                    <div className="method-info">
                                        <span className="method-icon"><PaymentMethodIcon method={item} size={38} compact /></span>
                                        <div className="method-balance-text">
                                            <span className="method-name">{item.name}</span>
                                            <div className="method-breakdown">
                                                <span>Apertura: ${item.opening.toLocaleString('es-AR')}</span>
                                                <span>Ventas hoy: ${item.sales.toLocaleString('es-AR')}</span>
                                                <span>Mov. manuales: {(item.manualNet >= 0 ? '+' : '-')}${Math.abs(item.manualNet).toLocaleString('es-AR')}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="method-balance-total">
                                        <Icon size={16} />
                                        <span>${item.accumulated.toLocaleString('es-AR')}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="card-footer">
                        <div className="total-row">
                            <span>Ventas brutas del día</span>
                            <span className="total-val">${totalSales.toLocaleString('es-AR')}</span>
                        </div>
                    </div>
                </div>

                <div className="cierre-card cash-card neo-card">
                    <div className="card-header">
                        <DollarSign size={24} color="#22c55e" />
                        <h2>Apertura y Movimientos</h2>
                    </div>

                    <div className="cash-stats">
                        <div className="stat-box">
                            <span className="label">Cierre anterior</span>
                            <span className="val">${previousCloseTotal.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box">
                            <span className="label">Efectivo cierre anterior</span>
                            <span className="val">${previousCashClose.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box">
                            <span className="label">Apertura registrada</span>
                            <span className="val">${openingMovements.reduce((sum, movement) => sum + toNumber(movement.amount), 0).toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box income">
                            <span className="label">Ingresos extra</span>
                            <span className="val">+${totalIncomes.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box expense">
                            <span className="label">Retiros</span>
                            <span className="val">-${withdrawalsTotal.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box expense">
                            <span className="label">Gastos</span>
                            <span className="val">-${expensesOnlyTotal.toLocaleString('es-AR')}</span>
                        </div>
                    </div>

                    <div className="cash-reconciliation-card">
                        <div className="cash-reconciliation-header">
                            <h3>Arqueo de efectivo</h3>
                            <span>Compará lo contado con lo teórico del sistema</span>
                        </div>
                        <div className="cash-reconciliation-grid">
                            <div className="reconciliation-box">
                                <span className="label">Efectivo teórico</span>
                                <strong>${cashInDrawer.toLocaleString('es-AR')}</strong>
                            </div>
                            <label className="reconciliation-box reconciliation-input-box">
                                <span className="label">Efectivo contado</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={countedCash}
                                    onChange={(e) => setCountedCash(e.target.value)}
                                    placeholder="0.00"
                                    className="neo-input"
                                />
                            </label>
                            <div className={`reconciliation-box difference ${cashDifferenceState}`}>
                                <span className="label">Diferencia</span>
                                <strong>
                                    {countedCash
                                        ? `${cashDifference > 0 ? '+' : ''}$${cashDifference.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : 'Esperando arqueo'}
                                </strong>
                            </div>
                        </div>
                    </div>

                    <div className="expenses-section">
                        <div className="section-header">
                            <h3>Apertura de caja</h3>
                            <button className="cierre-add-btn" onClick={() => setShowOpeningForm((prev) => !prev)}>
                                {showOpeningForm ? 'Cancelar' : openingMovements.length > 0 ? 'Registrar ajuste de apertura' : 'Registrar apertura'}
                            </button>
                        </div>

                        {!showOpeningForm && (
                            <div className="opening-hint">
                                <strong>Sugerencia:</strong> abrí la caja con el saldo que cerró el día anterior y ajustá solo si hubo cambios reales antes de arrancar.
                            </div>
                        )}

                        {openingMovements.length > 0 && !showOpeningForm && (
                            <div className="opening-preview">
                                {methodCards.map((item) => (
                                    <div key={item.name} className="opening-chip">
                                        <span>{item.name}</span>
                                        <strong>${item.opening.toLocaleString('es-AR')}</strong>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showOpeningForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleSaveOpening}>
                                <div className="form-grid">
                                    {activePaymentMethods.map((method) => (
                                        <div className="form-group" key={method.name}>
                                            <label>{method.name}</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={openingDraft[method.name] || ''}
                                                onChange={(e) => handleOpeningChange(method.name, e.target.value)}
                                                placeholder={toNumber(previousCloseByMethod[method.name]) > 0 ? previousCloseByMethod[method.name].toFixed(2) : '0.00'}
                                                className="neo-input"
                                            />
                                            <small style={{ color: 'var(--color-text-muted)', fontSize: '0.74rem' }}>
                                                Cierre anterior: ${toNumber(previousCloseByMethod[method.name]).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </small>
                                        </div>
                                    ))}
                                </div>
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar apertura
                                </button>
                            </form>
                        )}

                        <div className="section-header section-header-secondary">
                            <h3>Movimientos manuales y societarios</h3>
                            <button className="cierre-add-btn" onClick={() => setShowMovementForm((prev) => !prev)}>
                                {showMovementForm ? 'Cancelar' : '+ Registrar movimiento'}
                            </button>
                        </div>

                        <div className="opening-hint">
                            <strong>Importante:</strong> los gastos o compras internas del negocio deben cargarse desde <strong>Compras</strong>. En esta sección dejá solo retiros societarios, ajustes e ingresos manuales.
                        </div>

                        {showMovementForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleAddMovement}>
                                <div className="form-grid">
                                    <div className="form-group full">
                                        <div className="type-toggle">
                                            <button
                                                type="button"
                                                className={movementType === 'retiro' ? 'active' : ''}
                                                onClick={() => {
                                                    setMovementType('retiro');
                                                    setMovementCategory('Retiro Socios');
                                                }}
                                            >
                                                Retiro / Ajuste (-)
                                            </button>
                                            <button
                                                type="button"
                                                className={movementType === 'ingreso' ? 'active' : ''}
                                                onClick={() => {
                                                    setMovementType('ingreso');
                                                    setMovementCategory(INFLOW_CATEGORIES[0]);
                                                }}
                                            >
                                                Ingreso (+)
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Medio de pago</label>
                                        <select
                                            value={movementPaymentMethod}
                                            onChange={(e) => setMovementPaymentMethod(e.target.value)}
                                            className="neo-input"
                                        >
                                            {activePaymentMethods.map((method) => (
                                                <option key={method.name} value={method.name}>{method.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Monto</label>
                                        <input
                                            type="number"
                                            value={movementAmount}
                                            onChange={(e) => setMovementAmount(e.target.value)}
                                            placeholder="0.00"
                                            className="neo-input"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Categoría</label>
                                        <select
                                            value={movementCategory}
                                            onChange={(e) => setMovementCategory(e.target.value)}
                                            className="neo-input"
                                        >
                                            {(movementType === 'ingreso' ? INFLOW_CATEGORIES : OUTFLOW_CATEGORIES).map((category) => (
                                                <option key={category} value={category}>{category}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group full">
                                        <label>Descripción / concepto</label>
                                        <input
                                            type="text"
                                            value={movementDesc}
                                            onChange={(e) => setMovementDesc(e.target.value)}
                                            placeholder="Ej: retiro de socios, diferencia de caja, ingreso por ajuste, etc."
                                            className="neo-input"
                                        />
                                    </div>
                                </div>

                                {isPartnerWithdrawal && (
                                    <div className="cash-authorization-box">
                                        <div className="cash-authorization-copy">
                                            <strong>Autorización requerida</strong>
                                            <span>
                                                El retiro de socios envía un código temporal por mail y no se puede guardar hasta validarlo.
                                            </span>
                                            {withdrawalAuthorization?.recipient && (
                                                <small>
                                                    Destino: {withdrawalAuthorization.recipient}
                                                    {withdrawalAuthorization.expiresAt ? ` · vence ${new Date(withdrawalAuthorization.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                                </small>
                                            )}
                                        </div>
                                        <div className="cash-authorization-actions">
                                            <button
                                                type="button"
                                                className="cierre-secondary-btn"
                                                onClick={handleRequestWithdrawalCode}
                                                disabled={requestingWithdrawalCode}
                                            >
                                                {requestingWithdrawalCode ? 'Enviando...' : withdrawalAuthorization?.authorizationId ? 'Reenviar código' : 'Enviar código por mail'}
                                            </button>
                                            <input
                                                type="text"
                                                className="neo-input"
                                                value={withdrawalCodeInput}
                                                onChange={(e) => setWithdrawalCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="Código"
                                                maxLength={6}
                                            />
                                            <button
                                                type="button"
                                                className="cierre-secondary-btn"
                                                onClick={handleVerifyWithdrawalCode}
                                                disabled={verifyingWithdrawalCode || !withdrawalAuthorization?.authorizationId}
                                            >
                                                {verifyingWithdrawalCode ? 'Validando...' : withdrawalAuthorization?.verified ? 'Código validado' : 'Validar código'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar movimiento
                                </button>
                            </form>
                        )}

                        <div className="movements-list">
                            {manualMovements.length === 0 && (
                                <div className="empty-state">No hay retiros, ajustes ni ingresos manuales registrados para esta fecha.</div>
                            )}
                            {manualMovements.map((movement) => (
                                <div
                                    key={movement.id}
                                    className={`movement-item ${movement.type} ${WITHDRAWAL_CATEGORIES.has(movement.category) ? 'withdrawal' : movement.type !== 'ingreso' ? 'expense' : ''}`}
                                >
                                    <div className="m-info">
                                        <span className="m-cat">{movement.category}</span>
                                        <span className="m-desc">
                                            {(movement.payment_method || 'Efectivo')} · {movement.description || 'Sin detalle'}
                                            {movement.purchase_id ? ' · Registrado desde Compras' : ''}
                                        </span>
                                    </div>
                                    <span className="m-amount">
                                        {movement.type === 'ingreso' ? '+' : '-'}${toNumber(movement.amount).toLocaleString('es-AR')}
                                    </span>
                                    {!movement.purchase_id && (
                                        <button onClick={() => handleDeleteMovement(movement.id)} className="del-btn">×</button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="cash-close-panel">
                            <div className="cash-close-header">
                                <h3>Cierre del día</h3>
                                {closureRecord && <span className="cash-closed-badge">Cerrado</span>}
                            </div>
                            <textarea
                                value={closureNotes}
                                onChange={(e) => setClosureNotes(e.target.value)}
                                placeholder="Observaciones de cierre, diferencias detectadas, retiros extraordinarios, etc."
                                className="neo-input cash-close-notes"
                                disabled={Boolean(closureRecord)}
                            />
                            <button
                                type="button"
                                className="save-btn"
                                onClick={handleCloseDay}
                                disabled={closingDay || Boolean(closureRecord)}
                            >
                                <Save size={16} /> {closureRecord ? 'Día ya cerrado' : closingDay ? 'Cerrando...' : 'Cerrar día y generar PDF'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="cierre-tips">
                <AlertCircle size={20} />
                <p><strong>Tip de conciliación:</strong> la caja acumulada por medio te muestra cuánto debería haber disponible hoy, sumando aperturas, ventas y movimientos manuales, y restando retiros societarios, ajustes y compras internas registradas desde Compras.</p>
            </div>
        </div>
    );
};

export default CierreCaja;
