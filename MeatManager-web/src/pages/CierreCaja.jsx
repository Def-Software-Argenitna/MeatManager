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
    ArrowDownUp,
    Receipt,
} from 'lucide-react';
import { createCashboxTransfer, fetchCajaSummary, fetchTable, saveCashboxOpening, saveTableRecord } from '../utils/apiClient';
import { EmptyState } from '../components/ui';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import DirectionalReveal from '../components/DirectionalReveal';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import { isDigitalPaymentMethodLike, useHiddenDigitalPaymentFilter } from '../hooks/useHiddenDigitalPayments';
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
    const normalizedType = String(type || '').trim().toLowerCase();
    return normalizedType === 'cuenta_corriente' || normalizedName.includes('cuenta corriente');
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

const isTransferMovement = (movement) => (
    Boolean(movement?.transfer_group_id) || String(movement?.category || '').toLowerCase().includes('transferencia')
);

const getManualMovementPresentation = (movement) => {
    if (isTransferMovement(movement)) {
        return {
            label: movement.type === 'ingreso' ? 'Transferencia recibida' : 'Transferencia enviada',
            note: movement.type === 'ingreso'
                ? 'Ingreso interno desde otra caja. No es venta ni ajuste.'
                : 'Salida interna hacia otra caja. No es gasto ni consumo.',
        };
    }
    if (movement.type === 'ingreso') {
        return { label: movement.category || 'Ingreso manual', note: 'Ingreso manual de caja.' };
    }
    return { label: movement.category || 'Retiro / gasto', note: 'Retiro, gasto o consumo de caja.' };
};

const getDayBounds = (selectedDate) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return {
        start: new Date(y, m - 1, d, 0, 0, 0, 0),
        end: new Date(y, m - 1, d, 23, 59, 59, 999),
    };
};

const formatCurrency = (value) => `$${toNumber(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})}`;

const getCashAccountLabel = (value) => (
    CASH_ACCOUNTS.find((item) => item.value === normalizeCashAccount(value))?.label || 'Caja Principal'
);
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
    const [transferSubmitting, setTransferSubmitting] = useState(false);
    const [openingSubmitting, setOpeningSubmitting] = useState(false);

    const [allMovements, setAllMovements] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState(null);
    const [cashSummary, setCashSummary] = useState(null);
    const { hiddenDigitalPaymentsOnly } = useHiddenDigitalPaymentFilter();
    const { activeBranch, accessProfile, currentUser, refreshClientBranches, selectActiveBranch } = useUser();
    const [clientBranches, setClientBranches] = useState([]);
    const [branchLoading, setBranchLoading] = useState(false);
    
    // Obtener branchId desde activeBranch directamente
    const activeBranchId = Number(activeBranch?.id || 0);
    const activeBranchName = activeBranch?.name || '';
    const transferBranchId = activeBranchId;
    const canSelectCashboxBranch = isEffectiveAdminUser(currentUser, accessProfile);
    const requiresCashboxBranch = clientBranches.length > 1;

    const handleBranchChange = (branchId) => {
        if (!canSelectCashboxBranch) return;
        const selectedBranch = clientBranches.find((branch) => String(branch.id) === String(branchId)) || null;
        selectActiveBranch(selectedBranch);
        setFeedback(null);
    };

    useEffect(() => {
        let cancelled = false;

        const loadBranches = async () => {
            if (typeof refreshClientBranches !== 'function') return;
            if (!canSelectCashboxBranch) return;
            setBranchLoading(true);
            try {
                const branches = await refreshClientBranches();
                if (cancelled) return;
                const normalizedBranches = Array.isArray(branches) ? branches : [];
                setClientBranches(normalizedBranches);

                // Si hay sucursal activa válida, verificar que exista
                const activeExists = activeBranchId
                    ? normalizedBranches.some((branch) => String(branch.id) === String(activeBranchId))
                    : false;
                if (activeExists) {
                    return;
                }

                // Auto-seleccionar primera sucursal si no hay ninguna activa
                if (!activeBranchId && normalizedBranches.length > 0) {
                    selectActiveBranch(normalizedBranches[0]);
                }
            } catch (error) {
                console.error('[CierreCaja] branch load error', error);
            } finally {
                if (!cancelled) setBranchLoading(false);
            }
        };

        loadBranches();
        return () => { cancelled = true; };
    }, [activeBranchId, canSelectCashboxBranch, refreshClientBranches, selectActiveBranch]);

    const loadData = useCallback(async () => {
        try {
            const [movRows, pmRows, summaryRows] = await Promise.all([
                fetchTable('caja_movimientos', { limit: 5000, orderBy: 'id', direction: 'DESC' }),
                fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' }),
                fetchCajaSummary({
                    date: selectedDate,
                    ...(Number.isFinite(activeBranchId) && activeBranchId > 0 ? { branchId: activeBranchId } : {}),
                }),
            ]);
            setAllMovements(Array.isArray(movRows) ? movRows : []);
            setPaymentMethods(Array.isArray(pmRows) ? pmRows : []);
            setCashSummary(summaryRows || null);
        } catch (err) {
            console.error('[CierreCaja] loadData error', err);
        }
    }, [activeBranchId, selectedDate]);

    useEffect(() => { loadData(); }, [loadData]);

    const { start, end } = useMemo(() => getDayBounds(selectedDate), [selectedDate]);

    const parseDate = (val) => {
        if (!val) return null;
        const d = new Date(val);
        return Number.isFinite(d.getTime()) ? d : null;
    };

    const movements = useMemo(() => allMovements.filter((m) => {
        const d = parseDate(m.date);
        return d && d >= start && d <= end && normalizeCashAccount(m.cash_account) === selectedCashAccount;
    }), [allMovements, start, end, selectedCashAccount]);

    const salesMovements = useMemo(() => (
        (movements || []).filter((movement) => {
            if (!(movement.type === 'venta' || movement.type === 'anulacion_venta')) return false;
            if (!hiddenDigitalPaymentsOnly) return true;
            return isDigitalPaymentMethodLike({
                name: movement.payment_method,
                type: movement.payment_method_type,
            });
        })
    ), [hiddenDigitalPaymentsOnly, movements]);

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

    const cashPaymentMethods = useMemo(() => {
        const methods = activePaymentMethods.filter((method) => method.type === 'cash');
        return methods.length > 0 ? methods : [{ id: 'cash-fallback', name: 'Efectivo', type: 'cash', enabled: true }];
    }, [activePaymentMethods]);

    const primaryCashMethod = cashPaymentMethods[0] || { name: 'Efectivo', type: 'cash' };

    const cashboxCashBalanceByAccount = useMemo(() => {
        const cashMethodNames = new Set(cashPaymentMethods.map((method) => method.name));
        const balances = { principal: 0, secondary: 0 };

        (cashSummary?.byPaymentMethod || []).forEach((row) => {
            const methodName = row.name || 'Efectivo';
            const methodType = String(row.type || '').trim().toLowerCase();
            if (methodType !== 'cash' && !cashMethodNames.has(methodName)) return;

            const account = normalizeCashAccount(row.cashAccount);
            balances[account] = (balances[account] || 0) + toNumber(row.accumulated);
        });

        return balances;
    }, [cashPaymentMethods, cashSummary]);

    useEffect(() => {
        setMovementPaymentMethod((prev) => (
            activePaymentMethods.some((method) => method.name === prev)
                ? prev
                : activePaymentMethods[0]?.name || 'Efectivo'
        ));
        setTransferPaymentMethod((prev) => (
            cashPaymentMethods.some((method) => method.name === prev)
                ? prev
                : primaryCashMethod.name
        ));
    }, [activePaymentMethods, cashPaymentMethods, primaryCashMethod.name]);

    useEffect(() => {
        setTransferFromAccount(selectedCashAccount);
        setTransferToAccount(selectedCashAccount === 'principal' ? 'secondary' : 'principal');
    }, [selectedCashAccount]);

    useEffect(() => {
        setOpeningDraft((prev) => {
            const next = {};
            cashPaymentMethods.forEach((method) => {
                next[method.name] = prev[method.name] || '';
            });
            return next;
        });
    }, [cashPaymentMethods]);

    const summaryRowsForSelectedAccount = useMemo(() => (
        (cashSummary?.byPaymentMethod || [])
            .filter((row) => normalizeCashAccount(row.cashAccount) === selectedCashAccount)
    ), [cashSummary, selectedCashAccount]);

    const selectedCashMethodNames = useMemo(() => (
        new Set(cashPaymentMethods.map((method) => method.name))
    ), [cashPaymentMethods]);

    const selectedCashSummary = useMemo(() => {
        const totals = {
            accumulated: 0,
            opening: 0,
            sales: 0,
            manualIncomes: 0,
            manualExpenses: 0,
            reversals: 0,
            dailyNet: 0,
        };

        summaryRowsForSelectedAccount.forEach((row) => {
            const methodType = String(row.type || '').trim().toLowerCase();
            const methodName = row.name || 'Efectivo';
            if (methodType !== 'cash' && !selectedCashMethodNames.has(methodName)) return;

            totals.accumulated += toNumber(row.accumulated);
            totals.opening += toNumber(row.opening);
            totals.sales += toNumber(row.sales);
            totals.manualIncomes += toNumber(row.manualIncomes);
            totals.manualExpenses += toNumber(row.manualExpenses);
            totals.reversals += toNumber(row.reversals);
            totals.dailyNet += toNumber(row.dailyNet);
        });

        return totals;
    }, [selectedCashMethodNames, summaryRowsForSelectedAccount]);

    const summaryByMethod = useMemo(() => {
        const totals = {};
        summaryRowsForSelectedAccount.forEach((row) => {
            const methodName = row.name || 'Efectivo';
            const existing = totals[methodName] || { ...row, accumulated: 0, opening: 0, sales: 0, reversals: 0, manualNet: 0, dailyNet: 0 };
            existing.accumulated += toNumber(row.accumulated);
            existing.opening += toNumber(row.opening);
            existing.sales += toNumber(row.sales);
            existing.reversals += toNumber(row.reversals);
            existing.manualNet += toNumber(row.manualIncomes) - toNumber(row.manualExpenses);
            existing.dailyNet += toNumber(row.dailyNet);
            totals[methodName] = existing;
        });
        return totals;
    }, [summaryRowsForSelectedAccount]);

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
        Object.entries(summaryByMethod).forEach(([methodName, row]) => {
            totals[methodName] = toNumber(row.opening);
        });
        return totals;
    }, [summaryByMethod]);

    const lastClosingByMethod = useMemo(() => {
        const totals = {};

        cashPaymentMethods.forEach((method) => {
            totals[method.name] = 0;
        });

        Object.entries(summaryByMethod).forEach(([methodName, row]) => {
            if (!(methodName in totals)) return;
            totals[methodName] = toNumber(row.accumulated) - toNumber(row.dailyNet);
        });

        return totals;
    }, [cashPaymentMethods, summaryByMethod]);

    const manualMovements = useMemo(() => (
        (movements || []).filter((movement) => {
            if (movement.type === 'apertura' || isAutoSaleMovement(movement)) return false;
            if (!hiddenDigitalPaymentsOnly) return true;
            return isDigitalPaymentMethodLike({
                name: movement.payment_method,
                type: movement.payment_method_type,
            });
        })
    ), [hiddenDigitalPaymentsOnly, movements]);

    const selectedAccountSummary = useMemo(() => (
        cashSummary?.byCashAccount?.[selectedCashAccount] || {}
    ), [cashSummary, selectedCashAccount]);
    const totalSales = toNumber(selectedAccountSummary.sales);
    const transferOutMovements = manualMovements
        .filter((movement) => isTransferMovement(movement) && movement.type === 'retiro');
    const transferInMovements = manualMovements
        .filter((movement) => isTransferMovement(movement) && movement.type === 'ingreso');
    const totalTransfersOut = transferOutMovements
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const totalTransfersIn = transferInMovements
        .reduce((sum, movement) => sum + toNumber(movement.amount), 0);
    const totalExpenses = Math.max(0, toNumber(selectedAccountSummary.manualExpenses) - totalTransfersOut);
    const totalIncomes = Math.max(0, toNumber(selectedAccountSummary.manualIncomes) - totalTransfersIn);
    const selectedCashAccountLabel = getCashAccountLabel(selectedCashAccount);
    const counterpartCashAccount = selectedCashAccount === 'principal' ? 'secondary' : 'principal';
    const counterpartCashAccountLabel = getCashAccountLabel(counterpartCashAccount);
    const currentAccountSales = toNumber(cashSummary?.currentAccountSales);

    const handleToggleOpeningForm = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        if (!showOpeningForm) {
            setOpeningDraft(buildOpeningDraft(
                openingMovements.length > 0 ? openingByMethod : lastClosingByMethod
            ));
            setShowOpeningForm(true);
            setFeedback(null);
            return;
        }

        setOpeningDraft(buildOpeningDraft());
        setShowOpeningForm(false);
    };

    const accumulatedByMethod = useMemo(() => {
        const totals = {};

        activePaymentMethods.forEach((method) => {
            totals[method.name] = toNumber(summaryByMethod[method.name]?.accumulated);
        });

        return totals;
    }, [activePaymentMethods, summaryByMethod]);

    const dailyManualNetByMethod = useMemo(() => {
        const totals = {};
        activePaymentMethods.forEach((method) => {
            totals[method.name] = 0;
        });

        manualMovements
            .filter((movement) => !isTransferMovement(movement))
            .forEach((movement) => {
                const methodName = movement.payment_method || 'Efectivo';
                const sign = movement.type === 'egreso' || movement.type === 'retiro' ? -1 : 1;
                totals[methodName] = (totals[methodName] || 0) + (toNumber(movement.amount) * sign);
            });

        return totals;
    }, [activePaymentMethods, manualMovements]);

    const methodCards = useMemo(() => (
        activePaymentMethods
            .filter((method) => !hiddenDigitalPaymentsOnly || isDigitalPaymentMethodLike(method))
            .map((method) => ({
            ...method,
            opening: openingByMethod[method.name] || 0,
            sales: toNumber(summaryByMethod[method.name]?.sales),
            reversals: toNumber(summaryByMethod[method.name]?.reversals),
            netSales: toNumber(summaryByMethod[method.name]?.sales) - toNumber(summaryByMethod[method.name]?.reversals),
            salesCount: salesCountByMethod[method.name] || 0,
            manualNet: dailyManualNetByMethod[method.name] || 0,
            accumulated: accumulatedByMethod[method.name] || 0,
        }))
    ), [activePaymentMethods, accumulatedByMethod, dailyManualNetByMethod, hiddenDigitalPaymentsOnly, openingByMethod, salesCountByMethod, summaryByMethod]);

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

        const mappedSales = Array.from(groups.values())
            .map((sale) => {
                const cajaParts = sale.fullParts.filter((part) => !isCurrentAccount(part.name, part.type));
                const cuentaCorrienteParts = sale.fullParts.filter((part) => isCurrentAccount(part.name, part.type));
                const cajaAmount = sale.fullParts
                    .filter((part) => !isCurrentAccount(part.name, part.type))
                    .reduce((sum, part) => sum + toNumber(part.amount), 0);
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
            .filter((sale) => !hiddenDigitalPaymentsOnly || (sale.cajaParts.length > 0 && sale.cajaParts.every((part) => isDigitalPaymentMethodLike(part))))
            .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));

        return mappedSales;
    }, [hiddenDigitalPaymentsOnly, salesMovements]);

    const mixedSalesCount = salesDetails.filter((sale) => sale.isMixed).length;
    const totalReversals = toNumber(selectedAccountSummary.reversals);
    const totalSalesIntoCashbox = totalSales - totalReversals;

    const cashInDrawer = toNumber(selectedCashSummary.accumulated);

    const cashBalanceExplanation = useMemo(() => {
        const previous = toNumber(selectedCashSummary.accumulated) - toNumber(selectedCashSummary.dailyNet);
        const openings = toNumber(selectedCashSummary.opening);
        const sales = toNumber(selectedCashSummary.sales);
        const incomes = Math.max(0, toNumber(selectedCashSummary.manualIncomes) - totalTransfersIn);
        const outflows = Math.max(0, toNumber(selectedCashSummary.manualExpenses) - totalTransfersOut);
        const reversals = toNumber(selectedCashSummary.reversals);
        const parts = {
            previous,
            openings,
            sales,
            incomes,
            transfersIn: totalTransfersIn,
            transfersOut: totalTransfersOut,
            outflows,
            reversals,
            adjustments: 0,
        };

        const available = parts.previous + parts.openings + parts.sales + parts.incomes + parts.transfersIn + Math.max(parts.adjustments, 0);
        const deductions = parts.transfersOut + parts.outflows + parts.reversals + Math.abs(Math.min(parts.adjustments, 0));
        const reason = cashInDrawer < 0
            ? `Está en negativo porque las salidas de efectivo superan los fondos disponibles por ${formatCurrency(Math.abs(cashInDrawer))}.`
            : cashInDrawer > 0
                ? `Está en positivo porque los fondos disponibles superan las salidas por ${formatCurrency(cashInDrawer)}.`
                : 'Está en cero porque los fondos disponibles y las salidas se compensan.';

        return {
            ...parts,
            available,
            deductions,
            reason,
        };
    }, [cashInDrawer, selectedCashSummary, totalTransfersIn, totalTransfersOut]);

    const buildOpeningDraft = useCallback((source = {}) => {
        const next = {};

        cashPaymentMethods.forEach((method) => {
            const amount = toNumber(source[method.name]);
            next[method.name] = amount > 0 ? String(amount) : '';
        });

        return next;
    }, [cashPaymentMethods]);

    const handleOpeningChange = (methodName, value) => {
        setOpeningDraft((prev) => ({
            ...prev,
            [methodName]: value,
        }));
    };

    const handleSaveOpening = async (e) => {
        e.preventDefault();
        if (openingSubmitting) return;
        
        setFeedback({ type: 'warning', text: 'Guardando apertura de caja...' });

        if (requiresCashboxBranch && (!Number.isFinite(activeBranchId) || activeBranchId <= 0)) {
            const message = clientBranches.length > 1 
                ? `Seleccioná una sucursal del selector arriba (${clientBranches.length} disponibles)`
                : 'Seleccioná una sucursal activa antes de iniciar la caja.';
            setFeedback({ type: 'error', text: message });
            return;
        }

        const rows = cashPaymentMethods
            .map((method) => ({
                method,
                amount: parseFloat(openingDraft[method.name]) || 0,
            }))
            .filter((row) => row.amount > 0);

        if (rows.length === 0 && openingMovements.length === 0) {
            setFeedback({ type: 'warning', text: 'Ingresá al menos un monto de apertura para registrar la caja.' });
            return;
        }

        try {
            setOpeningSubmitting(true);
            await saveCashboxOpening({
                date: selectedDate,
                cashAccount: selectedCashAccount,
                branchId: Number.isFinite(activeBranchId) && activeBranchId > 0 ? activeBranchId : null,
                activeBranchId: Number.isFinite(activeBranchId) && activeBranchId > 0 ? activeBranchId : null,
                openings: rows.map(({ method, amount }) => ({
                    amount,
                    paymentMethod: method.name,
                    paymentMethodType: method.type,
                })),
            });
        } catch (error) {
            console.error('[CierreCaja] save opening error', error);
            setFeedback({ type: 'error', text: error.message || 'No se pudo guardar la apertura de caja.' });
            return;
        } finally {
            setOpeningSubmitting(false);
        }

        await loadData();
        setFeedback({ type: 'success', text: 'Apertura de caja actualizada correctamente.' });
        setShowOpeningForm(false);
        setOpeningDraft(buildOpeningDraft());
    };

    const handleAddMovement = async (e) => {
        e.preventDefault();
        if (requiresCashboxBranch && (!Number.isFinite(activeBranchId) || activeBranchId <= 0)) {
            setFeedback({ type: 'warning', text: 'Seleccioná una sucursal activa antes de guardar movimientos de caja.' });
            return;
        }
        if (!movementAmount || parseFloat(movementAmount) <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá un importe válido para guardar el movimiento.' });
            return;
        }

        await saveTableRecord('caja_movimientos', 'insert', {
            type: movementType,
            amount: parseFloat(movementAmount),
            category: movementCategory,
            money_flow_kind: movementType === 'ingreso' ? 'manual_income' : 'manual_expense',
            origin_table: 'cierre_caja',
            origin_group_id: `manual_${selectedDate}_${selectedCashAccount}`,
            description: movementDesc,
            payment_method: movementPaymentMethod,
            payment_method_type: activePaymentMethods.find((method) => method.name === movementPaymentMethod)?.type || 'cash',
            cash_account: selectedCashAccount,
            branch_id: Number.isFinite(activeBranchId) && activeBranchId > 0 ? activeBranchId : null,
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
        if (transferSubmitting) return;
        const amount = parseFloat(transferAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setFeedback({ type: 'warning', text: 'Ingresá un monto válido para transferir.' });
            return;
        }
        if (transferFromAccount === transferToAccount) {
            setFeedback({ type: 'warning', text: 'Elegí cajas diferentes para transferir.' });
            return;
        }
        if (clientBranches.length > 0 && (!Number.isFinite(transferBranchId) || transferBranchId <= 0)) {
            setFeedback({ type: 'warning', text: 'Esta caja necesita una sucursal activa. Cambiá de empresa/sucursal y volvé a ingresar.' });
            return;
        }
        const available = toNumber(cashboxCashBalanceByAccount[transferFromAccount]);
        if (amount > available) {
            setFeedback({ type: 'warning', text: `Efectivo insuficiente en caja origen. Disponible: $${available.toLocaleString('es-AR')}` });
            return;
        }

        const transferGroupId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fromLabel = CASH_ACCOUNTS.find((item) => item.value === transferFromAccount)?.label || 'Caja origen';
        const toLabel = CASH_ACCOUNTS.find((item) => item.value === transferToAccount)?.label || 'Caja destino';
        const selectedMethod = cashPaymentMethods.find((method) => method.name === transferPaymentMethod) || primaryCashMethod;

        try {
            setTransferSubmitting(true);
            await createCashboxTransfer({
                amount,
                fromCashAccount: transferFromAccount,
                toCashAccount: transferToAccount,
                paymentMethod: selectedMethod.name,
                paymentMethodType: 'cash',
                description: transferDesc,
                transferGroupId,
                date: new Date().toISOString(),
                ...(Number.isFinite(transferBranchId) && transferBranchId > 0 ? { branchId: transferBranchId, activeBranchId: transferBranchId } : {}),
            });

            await loadData();
            setTransferAmount('');
            setTransferDesc('');
            setShowTransferForm(false);
            setFeedback({ type: 'success', text: `Transferencia registrada: ${fromLabel} → ${toLabel}.` });
        } catch (error) {
            const detail = error?.details;
            const branchDebug = detail?.code === 'CASHBOX_TRANSFER_BRANCH_REQUIRED'
                ? ` Sucursal enviada: ${detail.receivedBranchId || detail.receivedActiveBranchId || detail.headerActiveBranchId || 'ninguna'}. Sucursales activas: ${Array.isArray(detail.activeBranches) && detail.activeBranches.length ? detail.activeBranches.map((branch) => branch.name || branch.id).join(', ') : 'ninguna'}.`
                : '';
            setFeedback({ type: 'error', text: `${error?.message || 'No se pudo registrar la transferencia entre cajas.'}${branchDebug}` });
        } finally {
            setTransferSubmitting(false);
        }
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
                    {canSelectCashboxBranch && clientBranches.length > 1 && (
                        <select
                            className="neo-input"
                            value={Number.isFinite(activeBranchId) && activeBranchId > 0 ? String(activeBranchId) : ''}
                            onChange={(e) => handleBranchChange(e.target.value)}
                            disabled={branchLoading}
                            style={{ marginBottom: 0, minWidth: '190px' }}
                        >
                            <option value="">Seleccionar sucursal</option>
                            {clientBranches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name || `Sucursal ${branch.id}`}
                                </option>
                            ))}
                        </select>
                    )}
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
                <div className={`stat-box result cash-accumulator ${cashInDrawer < 0 ? 'negative' : cashInDrawer > 0 ? 'positive' : 'neutral'}`}>
                    <span className="label">Efectivo acumulado ({selectedCashAccountLabel})</span>
                    <span className="val">${cashInDrawer.toLocaleString('es-AR')}</span>
                    <span className="cash-result-reason">{cashBalanceExplanation.reason}</span>
                    <div className="cash-result-breakdown">
                        <span>Disponible: {formatCurrency(cashBalanceExplanation.available)}</span>
                        <span>Salidas: {formatCurrency(cashBalanceExplanation.deductions)}</span>
                        <span>Saldo previo: {formatCurrency(cashBalanceExplanation.previous)}</span>
                        <span>Aperturas: {formatCurrency(cashBalanceExplanation.openings)}</span>
                        <span>Ventas efectivo: {formatCurrency(cashBalanceExplanation.sales)}</span>
                        <span>Ingresos: {formatCurrency(cashBalanceExplanation.incomes)}</span>
                        <span>Transf. recibidas: {formatCurrency(cashBalanceExplanation.transfersIn)}</span>
                        <span>Transf. enviadas: -{formatCurrency(cashBalanceExplanation.transfersOut)}</span>
                        <span>Retiros/gastos: -{formatCurrency(cashBalanceExplanation.outflows)}</span>
                        <span>Anulaciones: -{formatCurrency(cashBalanceExplanation.reversals)}</span>
                    </div>
                </div>
                <div className="stat-box income">
                    <span className="label">Ingresos manuales del día</span>
                    <span className="val">+${totalIncomes.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box expense">
                    <span className="label">Retiros / gastos del día</span>
                    <span className="val">-${totalExpenses.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box transfer-out">
                    <span className="label">Transferido a {counterpartCashAccountLabel}</span>
                    <span className="val">-${totalTransfersOut.toLocaleString('es-AR')}</span>
                    <span className="stat-note">{transferOutMovements.length} transferencia{transferOutMovements.length === 1 ? '' : 's'} interna{transferOutMovements.length === 1 ? '' : 's'} del día</span>
                </div>
                <div className="stat-box transfer-in">
                    <span className="label">Recibido desde {counterpartCashAccountLabel}</span>
                    <span className="val">+${totalTransfersIn.toLocaleString('es-AR')}</span>
                    <span className="stat-note">{transferInMovements.length} transferencia{transferInMovements.length === 1 ? '' : 's'} interna{transferInMovements.length === 1 ? '' : 's'} del día</span>
                </div>
                <div className="stat-box">
                    <span className="label">Ventas a cuenta corriente</span>
                    <span className="val">${currentAccountSales.toLocaleString('es-AR')}</span>
                </div>
                <div className="stat-box income">
                    <span className="label">Ventas netas en esta caja</span>
                    <span className="val">+${totalSalesIntoCashbox.toLocaleString('es-AR')}</span>
                    <span className="stat-note">Brutas ${totalSales.toLocaleString('es-AR')} · Anuladas ${totalReversals.toLocaleString('es-AR')}</span>
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
                                                <span>Ventas netas hoy: ${item.netSales.toLocaleString('es-AR')}</span>
                                                <span>Brutas: ${item.sales.toLocaleString('es-AR')} · Anuladas: ${item.reversals.toLocaleString('es-AR')}</span>
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
                            <span>Ventas netas del día</span>
                            <span className="total-val">${totalSalesIntoCashbox.toLocaleString('es-AR')}</span>
                        </div>
                        <div className="total-row">
                            <span>Brutas ${totalSales.toLocaleString('es-AR')} · Anuladas ${totalReversals.toLocaleString('es-AR')}</span>
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
                        <div className="stat-box transfer-out">
                            <span className="label">Transferido a {counterpartCashAccountLabel}</span>
                            <span className="val">-${totalTransfersOut.toLocaleString('es-AR')}</span>
                            <span className="stat-note">{transferOutMovements.length} transferencia{transferOutMovements.length === 1 ? '' : 's'} interna{transferOutMovements.length === 1 ? '' : 's'} del día</span>
                        </div>
                        <div className="stat-box transfer-in">
                            <span className="label">Recibido desde {counterpartCashAccountLabel}</span>
                            <span className="val">+${totalTransfersIn.toLocaleString('es-AR')}</span>
                            <span className="stat-note">{transferInMovements.length} transferencia{transferInMovements.length === 1 ? '' : 's'} interna{transferInMovements.length === 1 ? '' : 's'} del día</span>
                        </div>
                    </div>

                    <div className="expenses-section">
                        <div className="section-header">
                            <h3>Apertura de caja</h3>
                            <button type="button" className="cierre-add-btn" onClick={handleToggleOpeningForm}>
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
                                    {cashPaymentMethods.map((method) => (
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
                                <button type="submit" className="save-btn" disabled={openingSubmitting}>
                                    <Save size={16} /> {openingSubmitting ? 'Guardando...' : 'Guardar apertura'}
                                </button>
                            </form>
                        )}

                        <div className="section-header section-header-secondary">
                            <h3>Transferencia entre cajas</h3>
                            <button type="button" className="cierre-add-btn" onClick={() => setShowTransferForm((prev) => !prev)}>
                                {showTransferForm ? 'Cancelar' : 'Transferir fondos'}
                            </button>
                        </div>

                        {showTransferForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleTransferBetweenCashboxes}>
                                <div className="form-grid">
                                    {clientBranches.length > 0 && Number.isFinite(transferBranchId) && transferBranchId > 0 && (
                                        <div className="form-group full">
                                            <label>Sucursal operativa</label>
                                            <input
                                                className="neo-input"
                                                value={activeBranchName || `Sucursal ${transferBranchId}`}
                                                readOnly
                                            />
                                            <small style={{ color: 'var(--color-text-muted)' }}>
                                                Los movimientos de caja quedan asociados a esta sucursal.
                                            </small>
                                        </div>
                                    )}
                                    {clientBranches.length > 0 && (!Number.isFinite(transferBranchId) || transferBranchId <= 0) && (
                                        <div className="form-group full">
                                            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
                                                <AlertCircle size={18} />
                                                <span>Esta caja está configurada por sucursal. Volvé al ingreso y seleccioná la sucursal operativa.</span>
                                            </div>
                                        </div>
                                    )}
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
                                            Disponible efectivo: ${toNumber(cashboxCashBalanceByAccount[transferFromAccount]).toLocaleString('es-AR')}
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
                                            {cashPaymentMethods.map((method) => (
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
                                <button type="submit" className="save-btn" disabled={transferSubmitting || branchLoading || (clientBranches.length > 0 && (!Number.isFinite(transferBranchId) || transferBranchId <= 0))}>
                                    <ArrowRightLeft size={16} /> {transferSubmitting ? 'Transfiriendo...' : 'Confirmar transferencia'}
                                </button>
                            </form>
                        )}

                        <div className="section-header section-header-secondary">
                            <h3>Retiros e ingresos manuales</h3>
                            <button type="button" className="cierre-add-btn" onClick={() => setShowMovementForm((prev) => !prev)}>
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
                                <EmptyState
                                    compact
                                    icon={ArrowDownUp}
                                    title="Sin movimientos manuales"
                                    description="No hay retiros ni ingresos manuales registrados para esta fecha."
                                />
                            )}
                            {manualMovements.map((movement) => {
                                const presentation = getManualMovementPresentation(movement);
                                return (
                                    <div key={movement.id} className={`movement-item ${movement.type} ${isTransferMovement(movement) ? 'transfer' : ''}`}>
                                        <div className="m-info">
                                            <span className="m-cat">{presentation.label}</span>
                                            <span className="m-desc">
                                                {(movement.payment_method || 'Efectivo')} · {movement.description || 'Sin detalle'} · {presentation.note}
                                            </span>
                                        </div>
                                        <span className="m-amount">
                                            {getMovementSign(movement) >= 0 ? '+' : '-'}${toNumber(movement.amount).toLocaleString('es-AR')}
                                        </span>
                                        <button onClick={() => handleDeleteMovement(movement.id)} className="del-btn">×</button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="section-header section-header-secondary">
                            <h3>Detalle de cobros de ventas (hoy)</h3>
                        </div>
                        <div className="sales-detail-list">
                            {salesDetails.length === 0 && (
                                <EmptyState
                                    compact
                                    icon={Receipt}
                                    title="Sin ventas registradas"
                                    description="No hay ventas registradas en esta fecha."
                                />
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
