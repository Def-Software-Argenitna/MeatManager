import React, { useState } from 'react';
import { Settings, CreditCard, Wallet, DollarSign, TrendingUp, TrendingDown, Save, ChevronDown, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initializePaymentMethods } from '../db';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import './ConfiguracionPagos.css';

// Initialize payment methods once when module loads
initializePaymentMethods();
const ALLOWED_PAYMENT_METHODS = ['Posnet', 'Mercado Pago', 'Cuenta DNI', 'Efectivo', 'Transferencia', 'Cuenta Corriente'];
const DEFAULT_PAYMENT_METHODS = [
    { name: 'Posnet', type: 'card', percentage: 0, enabled: true, icon: '💳', bank: 'posnet' },
    { name: 'Mercado Pago', type: 'wallet', percentage: 0, enabled: true, icon: '💙' },
    { name: 'Cuenta DNI', type: 'wallet', percentage: 0, enabled: true, icon: '🆔' },
    { name: 'Efectivo', type: 'cash', percentage: 0, enabled: true, icon: '💵' },
    { name: 'Transferencia', type: 'transfer', percentage: 0, enabled: true, icon: '🏦' },
    { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: true, icon: '📋' },
];

const ConfiguracionPagos = () => {
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState({});

    // Load payment methods
    const paymentMethods = useLiveQuery(
        async () => {
            const methods = await db.payment_methods.toArray();
            return methods.filter((method) => ALLOWED_PAYMENT_METHODS.includes(method.name));
        },
        []
    );

    const handleEdit = (method) => {
        setEditingId(method.id);
        setEditValue(method.percentage.toString());
    };

    const handleSave = async (id) => {
        await db.payment_methods.update(id, {
            percentage: parseFloat(editValue)
        });
        setEditingId(null);
        setEditValue('');
    };

    const handleToggle = async (id, currentState) => {
        await db.payment_methods.update(id, {
            enabled: !currentState
        });
    };

    const toggleGroup = (type) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [type]: !prev[type]
        }));
    };

    const handleResetPayments = async () => {
        if (confirm('¿Estás seguro? Esto eliminará todos los métodos de pago y los reiniciará.')) {
            await db.payment_methods.clear();
            await db.payment_methods.bulkAdd(DEFAULT_PAYMENT_METHODS);
            alert('✅ Métodos de pago reiniciados correctamente');
        }
    };

    // Group by type
    const groupedMethods = paymentMethods?.reduce((acc, method) => {
        if (!acc[method.type]) {
            acc[method.type] = [];
        }
        acc[method.type].push(method);
        return acc;
    }, {}) || {};

    const typeLabels = {
        cash: { name: 'Efectivo', icon: '💵', color: '#22c55e' },
        debit: { name: 'Tarjetas de Débito', icon: '💳', color: '#3b82f6' },
        credit: { name: 'Tarjetas de Crédito', icon: '💳', color: '#ef4444' },
        wallet: { name: 'Billeteras Virtuales', icon: '📱', color: '#8b5cf6' },
        transfer: { name: 'Transferencias', icon: '🏦', color: '#06b6d4' },
        cuenta_corriente: { name: 'Cuenta Corriente', icon: '📋', color: '#f59e0b' },
        crypto: { name: 'Criptomonedas', icon: '₿', color: '#f59e0b' },
    };

    return (
        <div className="config-pagos-container animate-fade-in">
            <header className="page-header config-pagos-header">
                <div className="config-pagos-header-main">
                    <h1 className="page-title">
                        <Settings size={32} />
                        Configuración de Métodos de Pago
                    </h1>
                    <p className="page-description">
                        Gestiona los recargos y descuentos para cada método de pago
                    </p>
                </div>
                <button
                    className="reset-btn"
                    onClick={handleResetPayments}
                    title="Reiniciar métodos de pago"
                >
                    <Trash2 size={18} />
                    Reiniciar Métodos
                </button>
            </header>

            <div className="info-banner">
                <div className="banner-icon">ℹ️</div>
                <div>
                    <div className="banner-title">Porcentajes de Ajuste</div>
                    <div className="banner-text">
                        • Valores <strong>positivos</strong> aplican <strong>recargo</strong> (ej: 10% para crédito)<br />
                        • Valores <strong>negativos</strong> aplican <strong>descuento</strong> (ej: -5% para crypto)<br />
                        • Valor <strong>0</strong> no aplica ajuste (precio de lista)
                    </div>
                </div>
            </div>

            <div className="payment-groups">
                {Object.entries(groupedMethods).map(([type, methods]) => {
                    const typeInfo = typeLabels[type] || { name: type, icon: '💰', color: '#6b7280' };
                    const isCollapsed = collapsedGroups[type];

                    return (
                        <div key={type} className="payment-group">
                            <div
                                className="group-header clickable"
                                style={{ borderLeftColor: typeInfo.color }}
                                onClick={() => toggleGroup(type)}
                            >
                                <span className="group-icon">{typeInfo.icon}</span>
                                <span className="group-name">{typeInfo.name}</span>
                                <span className="group-count">{methods.length} métodos</span>
                                <ChevronDown
                                    size={20}
                                    className={`chevron ${isCollapsed ? 'collapsed' : ''}`}
                                />
                            </div>

                            <div className={`methods-list-wrapper ${isCollapsed ? 'collapsed' : ''}`}>
                                <div className="methods-list">
                                    {methods.map(method => (
                                        <div
                                            key={method.id}
                                            className={`method-item ${!method.enabled ? 'disabled' : ''}`}
                                        >
                                            <div className="method-info">
                                                <div className="method-icon"><PaymentMethodIcon method={method} size={44} compact /></div>
                                                <div className="method-details">
                                                    <div className="method-name">{method.name}</div>
                                                    {method.bank && (
                                                        <div className="method-bank">{method.bank.toUpperCase()}</div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="method-controls">
                                                {editingId === method.id ? (
                                                    <div className="edit-controls">
                                                        <input
                                                            type="number"
                                                            className="percentage-input"
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            step="0.1"
                                                            autoFocus
                                                        />
                                                        <span className="percentage-symbol">%</span>
                                                        <button
                                                            className="save-btn"
                                                            onClick={() => handleSave(method.id)}
                                                        >
                                                            <Save size={16} />
                                                        </button>
                                                        <button
                                                            className="cancel-btn"
                                                            onClick={() => setEditingId(null)}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <button
                                                            className="percentage-badge"
                                                            onClick={() => handleEdit(method)}
                                                            style={{
                                                                backgroundColor: method.percentage > 0
                                                                    ? 'rgba(239, 68, 68, 0.1)'
                                                                    : method.percentage < 0
                                                                        ? 'rgba(34, 197, 94, 0.1)'
                                                                        : 'rgba(107, 114, 128, 0.1)',
                                                                color: method.percentage > 0
                                                                    ? '#ef4444'
                                                                    : method.percentage < 0
                                                                        ? '#22c55e'
                                                                        : '#6b7280'
                                                            }}
                                                        >
                                                            {method.percentage > 0 && <TrendingUp size={14} />}
                                                            {method.percentage < 0 && <TrendingDown size={14} />}
                                                            <span>{method.percentage > 0 ? '+' : ''}{method.percentage}%</span>
                                                        </button>

                                                        <label className="toggle-switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={method.enabled}
                                                                onChange={() => handleToggle(method.id, method.enabled)}
                                                            />
                                                            <span className="toggle-slider"></span>
                                                        </label>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ConfiguracionPagos;
