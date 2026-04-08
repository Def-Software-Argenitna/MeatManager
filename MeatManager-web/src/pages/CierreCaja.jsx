import React, { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
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

    const { start, end } = useMemo(() => getDayBounds(selectedDate), [selectedDate]);

    const sales = useLiveQuery(() => db.ventas.where('date').between(start, end).toArray(), [start, end]);
    const allSalesUntilDate = useLiveQuery(() => db.ventas.where('date').belowOrEqual(end).toArray(), [end]);
    const movements = useLiveQuery(() => db.caja_movimientos.where('date').between(start, end).toArray(), [start, end]);
    const allMovementsUntilDate = useLiveQuery(() => db.caja_movimientos.where('date').belowOrEqual(end).toArray(), [end]);
    const paymentMethods = useLiveQuery(() => db.payment_methods.toArray(), []);

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

        if (rows.length === 0) {
            setFeedback({ type: 'warning', text: 'Ingresá al menos un monto de apertura para registrar la caja.' });
            return;
        }

        const openingDate = new Date(`${selectedDate}T08:00:00`);
        await db.caja_movimientos.bulkAdd(rows.map(({ method, amount }) => ({
            type: 'apertura',
            amount,
            category: 'Apertura de caja',
            description: `Apertura inicial ${method.name}`,
            payment_method: method.name,
            payment_method_type: method.type,
            date: openingDate,
            synced: 0,
        })));

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

        await db.caja_movimientos.add({
            type: movementType,
            amount: parseFloat(movementAmount),
            category: movementCategory,
            description: movementDesc,
            payment_method: movementPaymentMethod,
            payment_method_type: activePaymentMethods.find((method) => method.name === movementPaymentMethod)?.type || 'cash',
            date: new Date(),
            synced: 0,
        });

        setMovementAmount('');
        setMovementDesc('');
        setShowMovementForm(false);
        setFeedback({ type: 'success', text: 'Movimiento de caja guardado correctamente.' });
    };

    const handleDeleteMovement = async (movementId) => {
        await db.caja_movimientos.delete(movementId);
        setFeedback({ type: 'success', text: 'Movimiento eliminado de la caja.' });
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
                    <span className="label">Efectivo acumulado en caja</span>
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
                            <button className="cierre-add-btn" onClick={() => setShowOpeningForm((prev) => !prev)}>
                                {showOpeningForm ? 'Cancelar' : openingMovements.length > 0 ? 'Registrar ajuste de apertura' : 'Registrar apertura'}
                            </button>
                        </div>

                        {openingMovements.length > 0 && !showOpeningForm && (
                            <div className="opening-preview">
                                {methodCards.map((item) => (
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
                                    {activePaymentMethods.map((method) => (
                                        <div className="form-group" key={method.name}>
                                            <label>{method.name.toLowerCase().includes('mercado pago') ? <img src={mpLogoText} alt="Mercado Pago" style={{ height: '14px', verticalAlign: 'middle' }} /> : method.name}</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={openingDraft[method.name] || ''}
                                                onChange={(e) => handleOpeningChange(method.name, e.target.value)}
                                                placeholder="0.00"
                                                className="neo-input"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar apertura
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
                                        </span>
                                    </div>
                                    <span className="m-amount">
                                        {movement.type === 'ingreso' ? '+' : '-'}${toNumber(movement.amount).toLocaleString('es-AR')}
                                    </span>
                                    <button onClick={() => handleDeleteMovement(movement.id)} className="del-btn">×</button>
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
