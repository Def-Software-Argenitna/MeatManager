import React, { useState } from 'react';
import {
    Calculator,
    TrendingUp,
    ArrowDownCircle,
    ArrowUpCircle,
    Save,
    History,
    Calendar as CalendarIcon,
    DollarSign,
    CreditCard,
    Smartphone,
    Wallet,
    AlertCircle
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import './CierreCaja.css';

const EXPENSE_CATEGORIES = [
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

const INCOME_CATEGORIES = [
    'Cobro Pendientes',
    'Inyección de Capital',
    'Venta Activo',
    'Otros'
];

const CierreCaja = () => {
    const _now = new Date();
    const [selectedDate, setSelectedDate] = useState(
        `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`
    );
    const [showExpenseForm, setShowExpenseForm] = useState(false);
    const [movementType, setMovementType] = useState('egreso');

    // Movement Form State
    const [movementAmount, setMovementAmount] = useState('');
    const [movementCategory, setMovementCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [movementDesc, setMovementDesc] = useState('');

    // --- DATA QUERIES ---

    const sales = useLiveQuery(() => {
        const [y, m, d] = selectedDate.split('-').map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0, 0);
        const end   = new Date(y, m - 1, d, 23, 59, 59, 999);
        return db.ventas.where('date').between(start, end).toArray();
    }, [selectedDate]);

    const movements = useLiveQuery(() => {
        const [y, m, d] = selectedDate.split('-').map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0, 0);
        const end   = new Date(y, m - 1, d, 23, 59, 59, 999);
        return db.caja_movimientos.where('date').between(start, end).toArray();
    }, [selectedDate]);

    const paymentMethods = useLiveQuery(() => db.payment_methods.toArray());

    // --- CALCULATIONS ---

    const salesByMethod = React.useMemo(() => {
        if (!sales || !paymentMethods) return [];

        const totals = {};
        sales.forEach(s => {
            if (Array.isArray(s.payment_breakdown) && s.payment_breakdown.length > 0) {
                s.payment_breakdown.forEach((part) => {
                    const methodName = part.method_name || 'Pago Mixto';
                    if (!totals[methodName]) totals[methodName] = 0;
                    totals[methodName] += Number(part.amount_charged || 0);
                });
                return;
            }

            const methodName = s.payment_method || 'Efectivo';
            if (!totals[methodName]) totals[methodName] = 0;
            totals[methodName] += Number(s.total || 0);
        });

        return Object.entries(totals).map(([name, total]) => {
            const method = paymentMethods.find(m => m.name === name);
            return { name, total, method: method || { name, type: 'cash' }, type: method?.type || 'cash' };
        });
    }, [sales, paymentMethods]);

    const totalSales = sales?.reduce((sum, s) => sum + s.total, 0) || 0;
    const totalExpenses = movements?.filter(m => m.type === 'egreso').reduce((sum, m) => sum + m.amount, 0) || 0;
    const totalIncomes = movements?.filter(m => m.type === 'ingreso').reduce((sum, m) => sum + m.amount, 0) || 0;

    const cashSales = salesByMethod.find(m => m.type === 'cash')?.total || 0;
    const netCashInDrawer = cashSales - totalExpenses + totalIncomes;

    // --- ACTIONS ---

    const handleAddMovement = async (e) => {
        e.preventDefault();
        if (!movementAmount || parseFloat(movementAmount) <= 0) return;

        try {
            await db.caja_movimientos.add({
                type: movementType,
                amount: parseFloat(movementAmount),
                category: movementCategory,
                description: movementDesc,
                date: new Date(selectedDate + 'T12:00:00'),
                synced: 0
            });

            setMovementAmount('');
            setMovementDesc('');
            setShowExpenseForm(false);
        } catch (err) {
            console.error('Error saving movement:', err);
            alert('Error al guardar el movimiento');
        }
    };

    return (
        <div className="cierre-container animate-fade-in">
            <header className="cierre-header">
                <div>
                    <h1>Cierre de Caja Diario</h1>
                    <p>Resumen de ventas y control de gastos del día.</p>
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

            <div className="cierre-grid">
                {/* 1. SALES SUMMARY */}
                <div className="cierre-card summary-card neo-card">
                    <div className="card-header">
                        <TrendingUp size={24} color="var(--color-primary)" />
                        <h2>Resumen por Medios de Pago</h2>
                    </div>

                    <div className="methods-list">
                        {salesByMethod.map(m => (
                            <div key={m.name} className="method-item">
                                <div className="method-info">
                                    <span className="method-icon"><PaymentMethodIcon method={m.method} size={36} compact /></span>
                                    <span className="method-name">{m.name}</span>
                                </div>
                                <span className="method-value">${m.total.toLocaleString()}</span>
                            </div>
                        ))}
                        {salesByMethod.length === 0 && (
                            <div className="empty-state">No hay ventas registradas este día.</div>
                        )}
                    </div>

                    <div className="card-footer">
                        <div className="total-row">
                            <span>Ingresos Totales (Bruto)</span>
                            <span className="total-val">${totalSales.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                {/* 2. CASH CONTROL & EXPENSES */}
                <div className="cierre-card cash-card neo-card">
                    <div className="card-header">
                        <DollarSign size={24} color="#22c55e" />
                        <h2>Control de Efectivo</h2>
                    </div>

                    <div className="cash-stats">
                        <div className="stat-box">
                            <span className="label">Ventas Cash</span>
                            <span className="val">${cashSales.toLocaleString()}</span>
                        </div>
                        <div className="stat-box income">
                            <span className="label">Otros Ingresos</span>
                            <span className="val">+${totalIncomes.toLocaleString()}</span>
                        </div>
                        <div className="stat-box expense">
                            <span className="label">Gastos / Retiros</span>
                            <span className="val">-${totalExpenses.toLocaleString()}</span>
                        </div>
                        <div className="stat-box result full">
                            <span className="label">EFECTIVO TOTAL EN CAJA</span>
                            <span className="val">${netCashInDrawer.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="expenses-section">
                        <div className="section-header">
                            <h3>Movimientos Manuales</h3>
                            <button className="cierre-add-btn" onClick={() => setShowExpenseForm(!showExpenseForm)}>
                                {showExpenseForm ? 'Cancelar' : '+ Registrar Movimiento'}
                            </button>
                        </div>

                        {showExpenseForm && (
                            <form className="expense-form animate-slide-down" onSubmit={handleAddMovement}>
                                <div className="form-grid">
                                    <div className="form-group full">
                                        <div className="type-toggle">
                                            <button
                                                type="button"
                                                className={movementType === 'egreso' ? 'active' : ''}
                                                onClick={() => { setMovementType('egreso'); setMovementCategory(EXPENSE_CATEGORIES[0]); }}
                                            >
                                                Gasto (-)
                                            </button>
                                            <button
                                                type="button"
                                                className={movementType === 'ingreso' ? 'active' : ''}
                                                onClick={() => { setMovementType('ingreso'); setMovementCategory(INCOME_CATEGORIES[0]); }}
                                            >
                                                Ingreso (+)
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Monto</label>
                                        <input
                                            type="number"
                                            value={movementAmount}
                                            onChange={e => setMovementAmount(e.target.value)}
                                            placeholder="0.00"
                                            className="neo-input"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Categoría</label>
                                        <select
                                            value={movementCategory}
                                            onChange={e => setMovementCategory(e.target.value)}
                                            className="neo-input"
                                        >
                                            {movementType === 'egreso'
                                                ? EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)
                                                : INCOME_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)
                                            }
                                        </select>
                                    </div>
                                    <div className="form-group full">
                                        <label>Descripción / Concepto</label>
                                        <input
                                            type="text"
                                            value={movementDesc}
                                            onChange={e => setMovementDesc(e.target.value)}
                                            placeholder="Ej: Pago de Luz, Carga de caja Pilar..."
                                            className="neo-input"
                                        />
                                    </div>
                                </div>
                                <button type="submit" className="save-btn">
                                    <Save size={16} /> Guardar Movimiento
                                </button>
                            </form>
                        )}

                        <div className="movements-list">
                            {movements?.map(m => (
                                <div key={m.id} className={`movement-item ${m.type}`}>
                                    <div className="m-info">
                                        <span className="m-cat">{m.category}</span>
                                        <span className="m-desc">{m.description}</span>
                                    </div>
                                    <span className="m-amount">
                                        {m.type === 'egreso' ? '-' : '+'}${m.amount.toLocaleString()}
                                    </span>
                                    <button onClick={() => db.caja_movimientos.delete(m.id)} className="del-btn">×</button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="cierre-tips">
                <AlertCircle size={20} />
                <p><strong>Tip para el cierre:</strong> Sumá todos los comprobantes de tarjetas y billeteras. El sistema te muestra lo que deberías tener según lo cargado en el día.</p>
            </div>
        </div>
    );
};

export default CierreCaja;
