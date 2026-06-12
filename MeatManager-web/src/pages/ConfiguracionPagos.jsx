import React, { useCallback, useEffect, useState } from 'react';
import { Settings, TrendingUp, TrendingDown, Save, ChevronDown, Trash2, Plus, X, Edit2 } from 'lucide-react';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import DirectionalReveal from '../components/DirectionalReveal';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import { Button, useToast } from '../components/ui';
import './ConfiguracionPagos.css';

const DEFAULT_PAYMENT_METHODS = [
    { name: 'Posnet',           type: 'card',             percentage: 0, enabled: true },
    { name: 'Mercado Pago',     type: 'wallet',           percentage: 0, enabled: true },
    { name: 'Cuenta DNI',       type: 'wallet',           percentage: 0, enabled: true },
    { name: 'Efectivo',         type: 'cash',             percentage: 0, enabled: true },
    { name: 'Transferencia',    type: 'transfer',         percentage: 0, enabled: true },
    { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: true },
    { name: 'Mixto',            type: 'mixto',            percentage: 0, enabled: true },
];

const TYPE_LABELS = {
    cash:             { name: 'Efectivo',             icon: '\uD83D\uDCB5', color: '#22c55e' },
    card:             { name: 'Tarjetas / POS',        icon: '\uD83D\uDCB3', color: '#6366f1' },
    debit:            { name: 'Tarjetas de D\u00e9bito',  icon: '\uD83D\uDCB3', color: '#3b82f6' },
    credit:           { name: 'Tarjetas de Cr\u00e9dito', icon: '\uD83D\uDCB3', color: '#ef4444' },
    wallet:           { name: 'Billeteras Virtuales',  icon: '\uD83D\uDCF1', color: '#8b5cf6' },
    transfer:         { name: 'Transferencias',        icon: '\uD83C\uDFE6', color: '#06b6d4' },
    cuenta_corriente: { name: 'Cuenta Corriente',      icon: '\uD83D\uDCCB', color: '#f59e0b' },
    mixto:            { name: 'Pago Mixto',            icon: '\uD83D\uDD00', color: '#0ea5e9' },
    crypto:           { name: 'Criptomonedas',         icon: '\u20BF',       color: '#d97706' },
    other:            { name: 'Otros',                 icon: '\uD83D\uDCB0', color: '#6b7280' },
};

const EMPTY_NEW = { name: '', type: 'cash', percentage: 0 };

const ConfiguracionPagos = () => {
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [editingMethod, setEditingMethod] = useState(null);
    const [collapsedGroups, setCollapsedGroups] = useState({});
    const [paymentMethods, setPaymentMethods] = useState(null);
    const [showNewForm, setShowNewForm] = useState(false);
    const [newMethod, setNewMethod] = useState(EMPTY_NEW);
    const [isSaving, setIsSaving] = useState(false);
    const toast = useToast();

    const loadMethods = useCallback(async () => {
        const rows = await fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' });
        // Sin filtro — todos los métodos de la BD
        setPaymentMethods(Array.isArray(rows) ? rows : []);
    }, []);

    useEffect(() => { loadMethods(); }, [loadMethods]);

    const handleEdit = (method) => {
        setEditingId(method.id);
        setEditValue(method.percentage.toString());
    };

    const handleEditMethod = (method) => {
        setEditingMethod({
            id: method.id,
            name: method.name,
            type: method.type,
            percentage: method.percentage
        });
        setShowNewForm(false);
    };

    const handleSave = async (id) => {
        await saveTableRecord('payment_methods', 'update', { percentage: parseFloat(editValue) }, id);
        setEditingId(null);
        setEditValue('');
        await loadMethods();
    };

    const handleSaveMethod = async (e) => {
        e.preventDefault();
        if (!editingMethod.name.trim()) return;
        if (isSaving) return;
        setIsSaving(true);
        try {
            await saveTableRecord('payment_methods', 'update', {
                name: editingMethod.name.trim(),
                type: editingMethod.type,
                percentage: parseFloat(editingMethod.percentage) || 0,
            }, editingMethod.id);
            setEditingMethod(null);
            await loadMethods();
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggle = async (id, currentState) => {
        await saveTableRecord('payment_methods', 'update', { enabled: !currentState ? 1 : 0 }, id);
        await loadMethods();
    };

    const handleDelete = async (id, name) => {
        if (!window.confirm(`\u00bfEliminar el método "${name}"? Esta acción no se puede deshacer.`)) return;
        await saveTableRecord('payment_methods', 'delete', null, id);
        await loadMethods();
    };

    const handleAddNew = async (e) => {
        e.preventDefault();
        if (!newMethod.name.trim()) return;
        if (isSaving) return;
        setIsSaving(true);
        try {
            await saveTableRecord('payment_methods', 'insert', {
                name: newMethod.name.trim(),
                type: newMethod.type,
                percentage: parseFloat(newMethod.percentage) || 0,
                enabled: 1,
            });
            setNewMethod(EMPTY_NEW);
            setShowNewForm(false);
            await loadMethods();
        } finally {
            setIsSaving(false);
        }
    };

    const toggleGroup = (type) => {
        setCollapsedGroups(prev => ({ ...prev, [type]: !prev[type] }));
    };

    // Agrega solo los predeterminados que NO existen aún por nombre (no destructivo)
    const handleSeedDefaults = async () => {
        const existingNames = new Set((paymentMethods || []).map(m => m.name.toLowerCase()));
        const missing = DEFAULT_PAYMENT_METHODS.filter(m => !existingNames.has(m.name.toLowerCase()));
        if (missing.length === 0) { toast.info('Ya ten\u00e9s todos los m\u00e9todos predeterminados.'); return; }
        for (const method of missing) {
            await saveTableRecord('payment_methods', 'insert', method);
        }
        await loadMethods();
        toast.success(`Se agregaron ${missing.length} m\u00e9todo${missing.length > 1 ? 's' : ''}: ${missing.map(m => m.name).join(', ')}`);
    };

    const handleResetPayments = async () => {
        if (!window.confirm('\u00bfEst\u00e1s seguro? Esto eliminar\u00e1 TODOS los m\u00e9todos y restaurar\u00e1 solo los predeterminados.')) return;
        try {
            for (const method of (paymentMethods || [])) {
                await saveTableRecord('payment_methods', 'delete', null, method.id);
            }
            for (const method of DEFAULT_PAYMENT_METHODS) {
                await saveTableRecord('payment_methods', 'insert', method);
            }
            await loadMethods();
            toast.success('M\u00e9todos de pago reiniciados correctamente');
        } catch (err) {
            toast.error('Error al reiniciar: ' + (err.message || err));
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

    const typeLabels = TYPE_LABELS;

    return (
        <div className="config-pagos-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header config-pagos-header">
                <div className="config-pagos-header-main">
                    <h1 className="page-title">
                        <Settings size={32} />
                        Configuración de Métodos de Pago
                    </h1>
                    <p className="page-description">
                        Gestioná los recargos, descuentos y métodos disponibles
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Button
                        variant="primary"
                        icon={showNewForm ? <X size={16} /> : <Plus size={16} />}
                        onClick={() => {
                            setShowNewForm(f => !f);
                            setEditingMethod(null);
                        }}
                    >
                        {showNewForm ? 'Cancelar' : 'Nuevo m\u00e9todo'}
                    </Button>
                    <Button
                        variant="secondary"
                        icon={<Plus size={16} />}
                        onClick={handleSeedDefaults}
                        title="Agrega los predeterminados faltantes sin borrar nada"
                    >
                        Agregar faltantes
                    </Button>
                    <Button
                        variant="danger"
                        icon={<Trash2 size={18} />}
                        onClick={handleResetPayments}
                        title="Elimina todo y restaura los predeterminados"
                    >
                        Reiniciar todo
                    </Button>
                </div>
            </header>
            </DirectionalReveal>

            <DirectionalReveal className="info-banner" from="left" delay={0.1}>
                <div className="banner-icon">ℹ️</div>
                <div>
                    <div className="banner-title">Porcentajes de Ajuste</div>
                    <div className="banner-text">
                        • Valores <strong>positivos</strong> aplican <strong>recargo</strong> (ej: 10% para crédito)<br />
                        • Valores <strong>negativos</strong> aplican <strong>descuento</strong> (ej: -5% para crypto)<br />
                        • Valor <strong>0</strong> no aplica ajuste (precio de lista)
                    </div>
                </div>
            </DirectionalReveal>

            {showNewForm && (
                <DirectionalReveal from="up" delay={0.12}>
                    <form className="payment-new-form" onSubmit={handleAddNew}>
                        <div className="payment-new-form-header">
                            <h2>Agregar método de pago</h2>
                            <span>Creá un nuevo medio y dejalo disponible en ventas, compras y módulos relacionados.</span>
                        </div>

                        <div className="payment-new-form-grid">
                            <label className="payment-new-field">
                                <span>Nombre</span>
                                <input
                                    type="text"
                                    value={newMethod.name}
                                    onChange={(e) => setNewMethod((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: Transferencia Banco Nación"
                                    maxLength={100}
                                    autoFocus
                                />
                            </label>

                            <label className="payment-new-field">
                                <span>Tipo</span>
                                <select
                                    value={newMethod.type}
                                    onChange={(e) => setNewMethod((prev) => ({ ...prev, type: e.target.value }))}
                                >
                                    {Object.entries(TYPE_LABELS)
                                        .filter(([type]) => type !== 'mixto')
                                        .map(([type, meta]) => (
                                            <option key={type} value={type}>{meta.name}</option>
                                        ))}
                                </select>
                            </label>

                            <label className="payment-new-field">
                                <span>Ajuste (%)</span>
                                <input
                                    type="number"
                                    value={newMethod.percentage}
                                    onChange={(e) => setNewMethod((prev) => ({ ...prev, percentage: e.target.value }))}
                                    step="0.1"
                                    placeholder="0"
                                />
                            </label>
                        </div>

                        <div className="payment-new-form-actions">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setNewMethod(EMPTY_NEW);
                                    setShowNewForm(false);
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="primary"
                                type="submit"
                                icon={<Plus size={16} />}
                                disabled={isSaving || !newMethod.name.trim()}
                            >
                                {isSaving ? 'Guardando...' : 'Agregar método'}
                            </Button>
                        </div>
                    </form>
                </DirectionalReveal>
            )}

            {editingMethod && (
                <DirectionalReveal from="up" delay={0.12}>
                    <form className="payment-new-form" onSubmit={handleSaveMethod}>
                        <div className="payment-new-form-header">
                            <h2>Editar método de pago</h2>
                            <span>Modificá el nombre, tipo o porcentaje de ajuste.</span>
                        </div>

                        <div className="payment-new-form-grid">
                            <label className="payment-new-field">
                                <span>Nombre</span>
                                <input
                                    type="text"
                                    value={editingMethod.name}
                                    onChange={(e) => setEditingMethod((prev) => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: Transferencia Banco Nación"
                                    maxLength={100}
                                    autoFocus
                                />
                            </label>

                            <label className="payment-new-field">
                                <span>Tipo</span>
                                <select
                                    value={editingMethod.type}
                                    onChange={(e) => setEditingMethod((prev) => ({ ...prev, type: e.target.value }))}
                                >
                                    {Object.entries(TYPE_LABELS)
                                        .filter(([type]) => type !== 'mixto')
                                        .map(([type, meta]) => (
                                            <option key={type} value={type}>{meta.name}</option>
                                        ))}
                                </select>
                            </label>

                            <label className="payment-new-field">
                                <span>Ajuste (%)</span>
                                <input
                                    type="number"
                                    value={editingMethod.percentage}
                                    onChange={(e) => setEditingMethod((prev) => ({ ...prev, percentage: e.target.value }))}
                                    step="0.1"
                                    placeholder="0"
                                />
                            </label>
                        </div>

                        <div className="payment-new-form-actions">
                            <Button
                                variant="secondary"
                                onClick={() => setEditingMethod(null)}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="primary"
                                type="submit"
                                icon={<Save size={16} />}
                                disabled={isSaving || !editingMethod.name.trim()}
                            >
                                {isSaving ? 'Guardando...' : 'Guardar cambios'}
                            </Button>
                        </div>
                    </form>
                </DirectionalReveal>
            )}

            <div className="payment-groups">
                {Object.entries(groupedMethods).map(([type, methods]) => {
                    const typeInfo = typeLabels[type] || { name: type, icon: '💰', color: '#6b7280' };
                    const isCollapsed = collapsedGroups[type];
                    const groupIndex = Object.keys(groupedMethods).indexOf(type);

                    return (
                        <DirectionalReveal key={type} className="payment-group" from={groupIndex % 2 === 0 ? 'left' : 'right'} delay={0.16 + (groupIndex * 0.04)}>
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
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            icon={<Save size={16} color="#22c55e" />}
                                                            onClick={() => handleSave(method.id)}
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            icon={<X size={16} color="#ef4444" />}
                                                            onClick={() => setEditingId(null)}
                                                        />
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
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            title="Editar método"
                                                            icon={<Edit2 size={15} />}
                                                            onClick={() => handleEditMethod(method)}
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            title="Eliminar método"
                                                            icon={<Trash2 size={15} />}
                                                            onClick={() => handleDelete(method.id, method.name)}
                                                        />
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </DirectionalReveal>
                    );
                })}
            </div>
        </div>
    );
};

export default ConfiguracionPagos;
