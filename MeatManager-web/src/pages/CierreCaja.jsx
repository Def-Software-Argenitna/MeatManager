import React, { useCallback, useEffect, useMemo, useState } from 'react';
import mpLogoText from '../assets/mercado-pago-text.svg';
import {
    Save,
    Calendar as CalendarIcon,
    DollarSign,
    CreditCard,
    Smartphone,
    Landmark,
    AlertCircle,
    Wallet,
    ArrowRightLeft,
} from 'lucide-react';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import DirectionalReveal from '../components/DirectionalReveal';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import './CierreCaja.css';

const OUTFLOW_CATEGORIES = [
    'Retiro de caja',
    'Proveedor',
    'Mercadería Pilar',
    'Inter-Sucursal',
    'Sueldos/Adelantos',
    'Servicios (Luz, Agua, etc)',
    'Impuestos',
    'Gastos Generales',
    'Retiro Socios',
    'Otros'
];

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

const CASH_ACCOUNTS = [
    { value: 'principal', label: 'Caja Principal' },
    { value: 'secondary', label: 'Caja Secundaria' },
];

const normalizeCashAccount = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (['secundaria', 'secondary', 'caja_secundaria'].includes(token)) return 'secondary';
    return 'principal';
};

const isCurrentAccount = (name, type) => {
    const normalizedName = String(name || '').trim().toLowerCase();
    return type === 'cuenta_corriente' || normalizedName === 'cuenta corriente';
};

const toNumber = (value) => Number(value) || 0;

const getMovementSign = (movement) => {
    if (movement.type === 'apertura' || movement.type === 'ingreso' || movement.type === 'venta') return 1;
    if (movement.type === 'egreso' || movement.type === 'retiro' || movement.type === 'anulacion_venta') return -1;
    return toNumber(movement.amount) >= 0 ? 1 : -1;
};

const isAutoSaleMovement = (movement) => (
    movement?.type === 'venta' || movement?.type === 'anulacion_venta'
);

const getDayBounds = (selectedDate) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return {
        start: new Date(y, m - 1, d, 0, 0, 0, 0),
        end: new Date(y, m - 1, d, 23, 59, 59, 999),
    };
};

const getSalePaymentBreakdown = (sale) => {
    if (!sale?.payment_breakdown) return [];
    if (Array.isArray(sale.payment_breakdown)) return sale.payment_breakdown;
    if (typeof sale.payment_breakdown === 'string') {
        try {
            const parsed = JSON.parse(sale.payment_breakdown);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const buildSaleParts = (sale, { includeCurrentAccount = false } = {}) => {
    const breakdown = getSalePaymentBreakdown(sale);
    if (breakdown.length > 0) {
        return breakdown
            .map((part) => ({
                name: part?.method_name || 'Efectivo',
                type: part?.method_type || 'cash',
                amount: toNumber(part?.amount_charged ?? part?.amount ?? 0),
            }))
            .filter((part) => (
                includeCurrentAccount
                    ? part.amount > 0
                    : (part.amount > 0 && !isCurrentAccount(part.name, part.type))
            ));
    }

    const fallback = {
        name: sale?.payment_method || 'Efectivo',
        type: 'cash',
        amount: toNumber(sale?.total),
    };
    if (!includeCurrentAccount && isCurrentAccount(fallback.name, fallback.type)) return [];
    return fallback.amount > 0 ? [fallback] : [];
};

const CierreCaja = () => {
    const now = new Date();
    const [selectedDate, setSelectedDate] = useState(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    );
    const [showMovementForm, setShowMovementForm] = useState(false);
    const [showOpeningForm, setShowOpeningForm] = useState(false);
    const [movementType, setMovementType] = useState('retiro');
    const [movementAmount, setMovementAmount] = useState('');
    const [movementCategory, setMovementCategory] = useState(OUTFLOW_CATEGORIES[0]);
    const [movementDesc, setMovementDesc] = useState('');
    const [movementPaymentMethod, setMovementPaymentMethod] = useState('Efectivo');
    const [openingDraft, setOpeningDraft] = useState({});
    const [feedback, setFeedback] = useState(null);
    const [selectedCashAccount, setSelectedCashAccount] = useState('principal');
    const [showTransferForm, setShowTransferForm] = useState(false);
    const [transferFromAccount, setTransferFromAccount] = useState('principal');
    const [transferToAccount, setTransferToAccount] = useState('secondary');
    const [transferAmount, setTransferAmount] = useState('');
    const [transferPaymentMethod, setTransferPaymentMethod] = useState('Efectivo');
    const [transferDesc, setTransferDesc] = useState('');

    const [allSales, setAllSales] = useState([]);
    const [allMovements, setAllMovements] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState(null);
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [salesRows, movRows, pmRows] = await Promise.all([
                fetchTable('ventas', { limit: 5000, orderBy: 'id', direction: 'DESC' }),
                fetchTable('caja_movimientos', { limit: 5000, orderBy: 'id', direction: 'DESC' }),
                fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' }),
            ]);
            setAllSales(Array.isArray(salesRows) ? salesRows : []);
            setAllMovements(Array.isArray(movRows) ? movRows : []);
            setPaymentMethods(Array.isArray(pmRows) ? pmRows : []);
        } catch (err) {
            console.error('[CierreCaja] loadData error', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const { start, end } = useMemo(() => getDayBounds(selectedDate), [selectedDate]);

    const parseDate = (val) => {
        if (!val) return null;
        const d = new Date(val);
        return Number.isFinite(d.getTime()) ? d : null;
    };

    const sales = useMemo(() => allSales.filter((s) => {
        const d = parseDate(s.date);
        return d && d >= start && d <= end;
    }), [allSales, start, end]);

    const allSalesUntilDate = useMemo(() => allSales.filter((s) => {
        const d = parseDate(s.date);
        return d && d <= end;
    }), [allSales, end]);

    const movements = useMemo(() => allMovements.filter((m) => {
        const d = parseDate(m.date);
        return d && d >= start && d <= end && normalizeCashAccount(m.cash_account) === selectedCashAccount;
    }), [allMovements, start, end, selectedCashAccount]);

    const allMovementsUntilDate = useMemo(() => allMovements.filter((m) => {
        const d = parseDate(m.date);
        return d && d <= end && normalizeCashAccount(m.cash_account) === selectedCashAccount;
    }), [allMovements, end, selectedCashAccount]);

    const salesMovements = useMemo(() => (
        (movements || []).filter((movement) => movement.type === 'venta' || movement.type === 'anulacion_venta')
    ), [movements]);

    const cashBalanceByAccount = useMemo(() => {
        const balances = { principal: 0, secondary: 0 };
        allMovements.forEach((movement) => {
            const d = parseDate(movement.date);
            if (!d || d > end) return;
            if (isCurrentAccount(movement.payment_method, movement.payment_method_type)) return;
            const account = normalizeCashAccount(movement.cash_account);
            const sign = getMovementSign(movement);
            balances[account] = (balances[account] || 0) + (toNumber(movement.amount) * sign);
        });
        return balances;
    }, [allMovements, end]);

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
        setTransferPaymentMethod((prev) => (
            activePaymentMethods.some((method) => method.name === prev)
                ? prev
                : activePaymentMethods[0]?.name || 'Efectivo'
        ));
    }, [activePaymentMethods]);

    useEffect(() => {
        setTransferFromAccount(selectedCashAccount);
        setTransferToAccount(selectedCashAccount === 'principal' ? 'secondary' : 'principal');
    }, [selectedCashAccount]);

    useEffect(() => {
        setOpeningDraft((prev) => {
            const next = {};
            activePaymentMethods.filter((method) => method.type === 'cash').forEach((method) => {
                next[method.name] = prev[method.name] || '';
            });
            return next;
        });
    }, [activePaymentMethods]);

    const salesByMethod = useMemo(() => {
        const totals = {};
        salesMovements.forEach((movement) => {
            if (isCurrentAccount(movement.payment_method, movement.payment_method_type)) return;
            const sign = movement.type === 'anulacion_venta' ? -1 : 1;
            const methodName = movement.payment_method || 'Efectivo';
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
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
    }, [salesMovements, activePaymentMethods]);

    const salesCountByMethod = useMemo(() => {
        const totals = {};
        salesMovements.forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            if (isCurrentAccount(methodName, movement.payment_method_type)) return;
            totals[methodName] = (totals[methodName] || 0) + 1;
        });
        return totals;
    }, [salesMovements]);

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

    const lastClosingByMethod = useMemo(() => {
        const totals = {};

        activePaymentMethods
            .filter((method) => method.type === 'cash')
            .forEach((method) => {
                totals[method.name] = 0;
            });

        allMovements.forEach((movement) => {
            const movementDate = parseDate(movement.date);
            if (!movementDate || movementDate >= start) return;
            if (normalizeCashAccount(movement.cash_account) !== selectedCashAccount) return;

            const methodName = movement.payment_method || 'Efectivo';
            if (isCurrentAccount(methodName, movement.payment_method_type)) return;
            if (!(methodName in totals)) return;

            const sign = getMovementSign(movement);
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
        });

        return totals;
    }, [activePaymentMethods, allMovements, selectedCashAccount, start]);

    const manualMovements = useMemo(() => (
        (movements || []).filter((movement) => movement.type !== 'apertura' && !isAutoSaleMovement(movement))
    ), [movements]);

    const totalSales = salesMovements
        .filter((movement) => movement.type === 'venta')
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const totalExpenses = manualMovements
        .filter((movement) => movement.type === 'egreso' || movement.type === 'retiro')
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const totalIncomes = manualMovements
        .filter((movement) => movement.type === 'ingreso')
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const currentAccountSales = 0;

    const accumulatedByMethod = useMemo(() => {
        const totals = {};

        activePaymentMethods.forEach((method) => {
            totals[method.name] = 0;
        });

        (allMovementsUntilDate || []).forEach((movement) => {
            const methodName = movement.payment_method || 'Efectivo';
            if (isCurrentAccount(methodName, movement.payment_method_type)) return;
            const sign = getMovementSign(movement);
            totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
        });

        return totals;
    }, [activePaymentMethods, allMovementsUntilDate]);

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
            salesCount: salesCountByMethod[method.name] || 0,
            manualNet: dailyManualNetByMethod[method.name] || 0,
            accumulated: accumulatedByMethod[method.name] || 0,
        }))
    ), [activePaymentMethods, openingByMethod, salesByMethod, salesCountByMethod, dailyManualNetByMethod, accumulatedByMethod]);

    const salesDetails = useMemo(() => {
        const groups = new Map();

        salesMovements.forEach((movement) => {
            const key = movement.sale_id
                ? `sale-${movement.sale_id}`
                : `receipt-${movement.receipt_code || movement.receipt_number || movement.id}`;
            const sign = movement.type === 'anulacion_venta' ? -1 : 1;
            const partAmount = toNumber(movement.amount) * sign;
            const part = {
                name: movement.payment_method || 'Efectivo',
                type: movement.payment_method_type || 'cash',
                amount: partAmount,
            };

            if (!groups.has(key)) {
                groups.set(key, {
                    id: movement.sale_id || movement.id,
                    receiptCode: movement.receipt_code || (movement.receipt_number ? `0001-${String(movement.receipt_number).padStart(6, '0')}` : `Venta #${movement.sale_id || movement.id}`),
                    date: movement.date ? new Date(movement.date) : null,
                    fullParts: [],
                    total: 0,
                    hasReversal: false,
                });
            }

            const group = groups.get(key);
            group.fullParts.push(part);
            group.total += partAmount;
            if (movement.type === 'anulacion_venta') group.hasReversal = true;
        });

        return Array.from(groups.values())
            .map((sale) => {
                const cajaParts = sale.fullParts.filter((part) => !isCurrentAccount(part.name, part.type));
                const cuentaCorrienteParts = sale.fullParts.filter((part) => isCurrentAccount(part.name, part.type));
                const cajaAmount = cajaParts.reduce((sum, part) => sum + toNumber(part.amount), 0);
                const ccAmount = cuentaCorrienteParts.reduce((sum, part) => sum + toNumber(part.amount), 0);
                return {
                    ...sale,
                    isMixed: sale.fullParts.length > 1,
                    cajaParts,
                    cuentaCorrienteParts,
                    cajaAmount,
                    ccAmount,
                };
            })
            .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
    }, [salesMovements]);

    const mixedSalesCount = salesDetails.filter((sale) => sale.isMixed).length;
    const totalSalesIntoCashbox = salesDetails.reduce((sum, sale) => sum + sale.cajaAmount, 0);

    const cashInDrawer = methodCards
        .filter((method) => method.type === 'cash')
        .reduce((sum, method) => sum + method.accumulated, 0);

    const buildOpeningDraft = useCallback((source = {}) => {
        const next = {};

        activePaymentMethods
            .filter((method) => method.type === 'cash')
            .forEach((method) => {
                const amount = toNumber(source[method.name]);
                next[method.name] = amount > 0 ? String(amount) : '';
            });

        return next;
    }, [activePaymentMethods]);

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
            .filter((row) => row.amount > 0);

        if (rows.length === 0 && openingMovements.length === 0) {
            setFeedback({ type: 'warning', text: 'Ingresá al menos un monto de apertura para registrar la caja.' });
            return;
        }

        // Delete old aperturas before inserting new ones to properly "modify" instead of sum.
        for (const mov of openingMovements) {
            await saveTableRecord('caja_movimientos', 'delete', null, mov.id);
        }

        const openingDate = new Date(`${selectedDate}T08:00:00`).toISOString();
        for (const { method, amount } of rows) {
            await saveTableRecord('caja_movimientos', 'insert', {
                type: 'apertura',
                amount,
                category: 'Apertura de caja',
                description: `Apertura inicial ${method.name}`,
                payment_method: method.name,
                payment_method_type: method.type,
                cash_account: selectedCashAccount,
                date: openingDate,
            });
        }

        await loadData();
        setFeedback({ type: 'success', text: 'Apertura de caja actualizada correctamente.' });
        setShowOpeningForm(false);
        setOpeningDraft(buildOpeningDraft());
    };

    const handleAddMovement = async (e) => {
        e.preventDefault();
        if (!movementAmount || parseFloat(movementAmount) <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá un importe válido para guardar el movimiento.' });
            return;
        }

        await saveTableRecord('caja_movimientos', 'insert', {
            type: movementType,
            amount: parseFloat(movementAmount),
            category: movementCategory,
            description: movementDesc,
            payment_method: movementPaymentMethod,
            payment_method_type: activePaymentMethods.find((method) => method.name === movementPaymentMethod)?.type || 'cash',
            cash_account: selectedCashAccount,
            date: new Date().toISOString(),
        });

        await loadData();
        setMovementAmount('');
        setMovementDesc('');
        setShowMovementForm(false);
        setFeedback({ type: 'success', text: 'Movimiento de caja guardado correctamente.' });
    };

    const handleDeleteMovement = async (movementId) => {
        const movement = allMovements.find((item) => Number(item.id) === Number(movementId));
        if (movement?.transfer_group_id) {
            const related = allMovements.filter((item) => item.transfer_group_id === movement.transfer_group_id);
            for (const row of related) {
                await saveTableRecord('caja_movimientos', 'delete', null, row.id);
            }
        } else {
            await saveTableRecord('caja_movimientos', 'delete', null, movementId);
        }
        await loadData();
        setFeedback({ type: 'success', text: 'Movimiento eliminado de la caja.' });
    };

    const handleTransferBetweenCashboxes = async (e) => {
        e.preventDefault();
        const amount = parseFloat(transferAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá un monto válido para transferir.' });
            return;
        }
        if (transferFromAccount === transferToAccount) {
            setFeedback({ type: 'warning', text: 'Elegí cajas diferentes para transferir.' });
            return;
        }
        const available = toNumber(cashBalanceByAccount[transferFromAccount]);
        if (amount > available) {
            setFeedback({ type: 'warning', text: `Saldo insuficiente en caja origen. Disponible: $${available.toLocaleString('es-AR')}` });
            return;
        }

        const transferGroupId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fromLabel = CASH_ACCOUNTS.find((item) => item.value === transferFromAccount)?.label || 'Caja origen';
        const toLabel = CASH_ACCOUNTS.find((item) => item.value === transferToAccount)?.label || 'Caja destino';
        const selectedMethod = activePaymentMethods.find((method) => method.name === transferPaymentMethod);

        await saveTableRecord('caja_movimientos', 'insert', {
            type: 'retiro',
            amount,
            category: 'Transferencia entre cajas',
            description: transferDesc || `Transferencia a ${toLabel}`,
            payment_method: transferPaymentMethod,
            payment_method_type: selectedMethod?.type || 'cash',
            cash_account: transferFromAccount,
            transfer_group_id: transferGroupId,
            date: new Date().toISOString(),
        });

        await saveTableRecord('caja_movimientos', 'insert', {
            type: 'ingreso',
            amount,
            category: 'Transferencia entre cajas',
            description: transferDesc || `Transferencia desde ${fromLabel}`,
            payment_method: transferPaymentMethod,
            payment_method_type: selectedMethod?.type || 'cash',
            cash_account: transferToAccount,
            transfer_group_id: transferGroupId,
            date: new Date().toISOString(),
        });

        await loadData();
        setTransferAmount('');
        setTransferDesc('');
        setShowTransferForm(false);
        setFeedback({ type: 'success', text: `Transferencia registrada: ${fromLabel} → ${toLabel}.` });
    };

    return (
        <div className="cierre-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="cierre-header">
                <div>
                    <h1>Caja y Cierre Diario</h1>
                    <p>Apertura, movimientos, retiros y saldo acumulado por medio de pago.</p>
                </div>
                <div className="date-picker-wrapper">
                    <select
                        className="neo-input"
                        value={selectedCashAccount}
                        onChange={(e) => setSelectedCashAccount(e.target.value)}
                        style={{ marginBottom: 0, minWidth: '180px' }}
                    >
                        {CASH_ACCOUNTS.map((cashbox) => (
                            <option key={cashbox.value} value={cashbox.value}>{cashbox.label}</option>
                        ))}
                    </select>
                    <CalendarIcon size={18} />
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="neo-input"
                    />
                </div>
            </header>
            </DirectionalReveal>

            {feedback && (
                <div className={`cash-feedback ${feedback.type}`}>
                    <AlertCircle size={18} />
                    <span>{feedback.text}</span>
                </div>
            )}

            <DirectionalReveal className="cash-overview-grid" from="left" delay={0.1}>
                <div className="stat-box result">
                    <span className="label">Efectivo acumulado ({selectedCashAccount === 'principal' ? 'Principal' : 'Secundaria'})</span>
                    <span className="val">${cashInDrawer.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box income">
                    <span className="label">Ingresos manuales del día</span>
                    <span className="val">+${totalIncomes.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box expense">
                    <span className="label">Retiros / gastos del día</span>
                    <span className="val">-${totalExpenses.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box">
                    <span className="label">Ventas a cuenta corriente</span>
                    <span className="val">${currentAccountSales.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box income">
                    <span className="label">Cobros por ventas en esta caja</span>
                    <span className="val">+${totalSalesIntoCashbox.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box">
                    <span className="label">Ventas mixtas del día</span>
                    <span className="val">{mixedSalesCount}</span>
                </div>
            </DirectionalReveal>

            <div className="cierre-grid">
                <DirectionalReveal className="cierre-card summary-card neo-card" from="left" delay={0.16}>
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
                                            <span className="method-name">{item.name.toLowerCase().includes('mercado pago') ? <img src={mpLogoText} alt="Mercado Pago" style={{ height: '18px', verticalAlign: 'middle' }} /> : item.name}</span>
                                            <div className="method-breakdown">
                                                <span>Apertura: ${item.opening.toLocaleString('es-AR')}</span>
                                                <span>Ventas hoy: ${item.sales.toLocaleString('es-AR')}</span>
                                                <span>Cobros: {item.salesCount}</span>
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
                        <div className="total-row">
                            <span>Cobros que ingresan a caja</span>
                            <span className="total-val" style={{ fontSize: '1.15rem' }}>+${totalSalesIntoCashbox.toLocaleString('es-AR')}</span>
                        </div>
                    </div>
                </DirectionalReveal>

                <DirectionalReveal className="cierre-card cash-card neo-card" from="right" delay={0.22}>
                    <div className="card-header">
                        <DollarSign size={24} color="#22c55e" />
                        <h2>Apertura y Movimientos</h2>
                    </div>

                    <div className="cash-stats">
                        <div className="stat-box">
                            <span className="label">Apertura registrada</span>
                            <span className="val">${openingMovements.reduce((sum, movement) => sum + toNumber(movement.amount), 0).toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box income">
                            <span className="label">Ingresos extra</span>
                            <span className="val">+${totalIncomes.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="stat-box expense">
                            <span className="label">Retiros y gastos</span>
                            <span className="val">-${totalExpenses.toLocaleString('es-AR')}</span>
                        </div>
                    </div>

                    <div className="expenses-section">
                        <div className="section-header">
                            <h3>Apertura de caja</h3>
                            <button className="cierre-add-btn" onClick={() => {
                                if (!showOpeningForm) {
                                    setOpeningDraft(buildOpeningDraft(
                                        openingMovements.length > 0 ? openingByMethod : lastClosingByMethod
                                    ));
                                } else {
                                    setOpeningDraft(buildOpeningDraft());
                                }
                                setShowOpeningForm((prev) => !prev);
                            }}>
                                {showOpeningForm ? 'Cancelar edición' : openingMovements.length > 0 ? 'Modificar apertura' : 'Registrar apertura'}
                            </button>
                        </div>

                        {openingMovements.length > 0 && !showOpeningForm && (
                            <div className="opening-preview">
                                {methodCards.filter(m => m.type === 'cash').map((item) => (
                                    <div key={item.name} className="opening-chip">
                                        <span>{item.name.toLowerCase().includes('mercado pago') ? <img src={mpLogoText} alt="Mercado Pago" style={{ height: '14px', verticalAlign: 'middle' }} /> : item.name}</span>
                                        <strong>${item.opening.toLocaleString('es-AR')}</strong>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showOpeningForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleSaveOpening}>
                                <div className="form-grid">
                                    {activePaymentMethods.filter(m => m.type === 'cash').map((method) => (
                                        <div className="form-group full" key={method.name}>
                                            <label>{method.name} inicial (Apertura)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={openingDraft[method.name] || ''}
                                                onChange={(e) => handleOpeningChange(method.name, e.target.value)}
                                                placeholder="Ej: 100000"
                                                className="neo-input"
                                            />
                                            {toNumber(lastClosingByMethod[method.name]) > 0 ? (
                                                <small className="opening-suggestion">
                                                    Sugerido según último cierre: ${toNumber(lastClosingByMethod[method.name]).toLocaleString('es-AR')}
                                                </small>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar apertura
                                </button>
                            </form>
                        )}

                        <div className="section-header section-header-secondary">
                            <h3>Transferencia entre cajas</h3>
                            <button className="cierre-add-btn" onClick={() => setShowTransferForm((prev) => !prev)}>
                                {showTransferForm ? 'Cancelar' : 'Transferir fondos'}
                            </button>
                        </div>

                        {showTransferForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleTransferBetweenCashboxes}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Desde caja</label>
                                        <select
                                            className="neo-input"
                                            value={transferFromAccount}
                                            onChange={(e) => setTransferFromAccount(e.target.value)}
                                        >
                                            {CASH_ACCOUNTS.map((cashbox) => (
                                                <option key={cashbox.value} value={cashbox.value}>{cashbox.label}</option>
                                            ))}
                                        </select>
                                        <small style={{ color: 'var(--color-text-muted)' }}>
                                            Disponible: ${toNumber(cashBalanceByAccount[transferFromAccount]).toLocaleString('es-AR')}
                                        </small>
                                    </div>
                                    <div className="form-group">
                                        <label>Hacia caja</label>
                                        <select
                                            className="neo-input"
                                            value={transferToAccount}
                                            onChange={(e) => setTransferToAccount(e.target.value)}
                                        >
                                            {CASH_ACCOUNTS.map((cashbox) => (
                                                <option key={cashbox.value} value={cashbox.value}>{cashbox.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Medio de pago</label>
                                        <select
                                            className="neo-input"
                                            value={transferPaymentMethod}
                                            onChange={(e) => setTransferPaymentMethod(e.target.value)}
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
                                            min="0"
                                            step="0.01"
                                            value={transferAmount}
                                            onChange={(e) => setTransferAmount(e.target.value)}
                                            placeholder="0.00"
                                            className="neo-input"
                                            required
                                        />
                                    </div>
                                    <div className="form-group full">
                                        <label>Detalle</label>
                                        <input
                                            type="text"
                                            className="neo-input"
                                            value={transferDesc}
                                            onChange={(e) => setTransferDesc(e.target.value)}
                                            placeholder="Opcional: motivo de la transferencia"
                                        />
                                    </div>
                                </div>
                                <button type="submit" className="save-btn">
                                    <ArrowRightLeft size={16} /> Confirmar transferencia
                                </button>
                            </form>
                        )}

                        <div className="section-header section-header-secondary">
                            <h3>Retiros e ingresos manuales</h3>
                            <button className="cierre-add-btn" onClick={() => setShowMovementForm((prev) => !prev)}>
                                {showMovementForm ? 'Cancelar' : '+ Registrar movimiento'}
                            </button>
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
                                                    setMovementCategory(OUTFLOW_CATEGORIES[0]);
                                                }}
                                            >
                                                Retiro / Gasto (-)
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
                                            placeholder="Ej: retiro para gastos chicos, ingreso por ajuste, etc."
                                            className="neo-input"
                                        />
                                    </div>
                                </div>
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar movimiento
                                </button>
                            </form>
                        )}

                        <div className="movements-list">
                            {manualMovements.length === 0 && (
                                <div className="empty-state">No hay retiros ni ingresos manuales registrados para esta fecha.</div>
                            )}
                            {manualMovements.map((movement) => (
                                <div key={movement.id} className={`movement-item ${movement.type}`}>
                                    <div className="m-info">
                                        <span className="m-cat">{movement.category}</span>
                                        <span className="m-desc">
                                            {(movement.payment_method || 'Efectivo')} · {movement.description || 'Sin detalle'}
                                            {movement.transfer_group_id ? ' · transferencia interna' : ''}
                                        </span>
                                    </div>
                                    <span className="m-amount">
                                        {getMovementSign(movement) >= 0 ? '+' : '-'}${toNumber(movement.amount).toLocaleString('es-AR')}
                                    </span>
                                    <button onClick={() => handleDeleteMovement(movement.id)} className="del-btn">×</button>
                                </div>
                            ))}
                        </div>

                        <div className="section-header section-header-secondary">
                            <h3>Detalle de cobros de ventas (hoy)</h3>
                        </div>
                        <div className="sales-detail-list">
                            {salesDetails.length === 0 && (
                                <div className="empty-state">No hay ventas registradas en esta fecha.</div>
                            )}
                            {salesDetails.map((sale) => (
                                <div key={sale.id} className="sale-detail-item">
                                    <div className="sale-detail-top">
                                        <div className="sale-detail-main">
                                            <span className="sale-detail-receipt">#{sale.receiptCode}</span>
                                            <span className="sale-detail-time">
                                                {sale.date ? sale.date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                            </span>
                                            {sale.isMixed && <span className="sale-detail-badge">Mixto</span>}
                                        </div>
                                        <div className="sale-detail-total">
                                            Total: ${sale.total.toLocaleString('es-AR')}
                                        </div>
                                    </div>
                                    <div className="sale-detail-parts">
                                        {sale.fullParts.map((part, index) => {
                                            const isCC = isCurrentAccount(part.name, part.type);
                                            return (
                                                <span
                                                    key={`${sale.id}-${part.name}-${index}`}
                                                    className={`sale-part-chip ${isCC ? 'cc' : 'cashbox'}`}
                                                >
                                                    {part.name}: ${toNumber(part.amount).toLocaleString('es-AR')}
                                                    {isCC ? ' (cta cte)' : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div className="sale-detail-foot">
                                        <span>Ingresa en caja: +${sale.cajaAmount.toLocaleString('es-AR')}</span>
                                        {sale.ccAmount > 0 && (
                                            <span>Cuenta corriente: ${sale.ccAmount.toLocaleString('es-AR')}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </DirectionalReveal>
            </div>

            <DirectionalReveal className="cierre-tips" from="down" delay={0.28}>
                <AlertCircle size={20} />
                <p><strong>Tip de conciliación:</strong> la caja acumulada por medio te muestra cuánto debería haber disponible hoy, sumando aperturas, ventas y movimientos manuales, y restando retiros o gastos.</p>
            </DirectionalReveal>
        </div>
    );
};

export default CierreCaja;
