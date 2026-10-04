import React, { useCallback, useEffect, useState } from 'react';
import { Percent, Plus, Pencil, Trash2, Save, X, AlertTriangle } from 'lucide-react';
import { fetchSpecialDiscounts, saveSpecialDiscount, deleteSpecialDiscount } from '../utils/apiClient';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';

const EMPTY_FORM = { id: null, name: '', percentage: '', active: true };

const formatPct = (value) => Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });

const DescuentosEspeciales = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);

    const [discounts, setDiscounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [form, setForm] = useState(null); // null = formulario cerrado

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setDiscounts(await fetchSpecialDiscounts({ all: true }));
        } catch (e) {
            setError(e.message || 'No se pudieron cargar los descuentos.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (event) => {
        event.preventDefault();
        if (!form || saving) return;
        setSaving(true);
        setError(null);
        try {
            await saveSpecialDiscount({
                id: form.id,
                name: form.name,
                percentage: Number(String(form.percentage).replace(',', '.')),
                active: form.active,
            });
            setForm(null);
            await load();
        } catch (e) {
            setError(e.message || 'No se pudo guardar el descuento.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (discount) => {
        setError(null);
        try {
            await saveSpecialDiscount({ ...discount, active: !discount.active });
            await load();
        } catch (e) {
            setError(e.message || 'No se pudo actualizar el descuento.');
        }
    };

    const handleDelete = async (discount) => {
        if (!window.confirm(`¿Eliminar el descuento "${discount.name}"? Las ventas ya hechas conservan su descuento registrado.`)) return;
        setError(null);
        try {
            await deleteSpecialDiscount(discount.id);
            await load();
        } catch (e) {
            setError(e.message || 'No se pudo eliminar el descuento.');
        }
    };

    const cellStyle = { padding: '0.7rem 0.9rem', borderBottom: '1px solid var(--color-border)' };
    const headStyle = { ...cellStyle, fontWeight: 700, color: 'var(--color-text-muted)', borderBottom: '2px solid var(--color-border)', textAlign: 'left' };

    return (
        <div className="animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Percent size={26} /> Descuentos Especiales
                    </h1>
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--color-text-muted)', maxWidth: 720 }}>
                        Creá tipos de descuento por porcentaje (por ejemplo <strong>Jubilados 10%</strong>). En Ventas, la
                        cajera elige el descuento antes de cobrar; después de cada cobro vuelve a <strong>Ninguno</strong>.
                        No hace falta crear un cliente con cuenta corriente para esto.
                    </p>
                </div>
                {isAdmin && (
                    <button
                        className="neo-button"
                        onClick={() => setForm({ ...EMPTY_FORM })}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        <Plus size={16} /> Nuevo descuento
                    </button>
                )}
            </div>

            {error && (
                <div style={{ padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <AlertTriangle size={18} /> {error}
                </div>
            )}

            {form && (
                <form className="neo-card" onSubmit={handleSave} style={{ padding: '1rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '2 1 220px' }}>
                        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Nombre</label>
                        <input
                            className="neo-input"
                            value={form.name}
                            maxLength={100}
                            placeholder="Ej: Jubilados"
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            autoFocus
                            required
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 120px' }}>
                        <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Porcentaje (%)</label>
                        <input
                            className="neo-input"
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value={form.percentage}
                            placeholder="10"
                            onChange={(e) => setForm((prev) => ({ ...prev, percentage: e.target.value }))}
                            required
                        />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingBottom: '0.55rem' }}>
                        <input
                            type="checkbox"
                            checked={form.active}
                            onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                        />
                        Activo
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="submit" className="neo-button" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Save size={16} /> {saving ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button type="button" className="neo-button" onClick={() => setForm(null)} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <X size={16} /> Cancelar
                        </button>
                    </div>
                </form>
            )}

            <div className="neo-card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: 460 }}>
                    <thead>
                        <tr>
                            <th style={headStyle}>Descuento</th>
                            <th style={{ ...headStyle, width: 120, textAlign: 'right' }}>Porcentaje</th>
                            <th style={{ ...headStyle, width: 110, textAlign: 'center' }}>Estado</th>
                            {isAdmin && <th style={{ ...headStyle, width: 130 }}></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {discounts.map((d) => (
                            <tr key={d.id} style={{ opacity: d.active ? 1 : 0.55 }}>
                                <td style={{ ...cellStyle, fontWeight: 600 }}>{d.name}</td>
                                <td style={{ ...cellStyle, textAlign: 'right', color: '#f59e0b', fontWeight: 700 }}>{formatPct(d.percentage)}%</td>
                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                    {isAdmin ? (
                                        <button
                                            type="button"
                                            className="neo-button"
                                            onClick={() => handleToggleActive(d)}
                                            title={d.active ? 'Desactivar (deja de aparecer en Ventas)' : 'Activar'}
                                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                                        >
                                            {d.active ? 'ACTIVO' : 'INACTIVO'}
                                        </button>
                                    ) : (d.active ? 'ACTIVO' : 'INACTIVO')}
                                </td>
                                {isAdmin && (
                                    <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <button
                                            type="button"
                                            className="neo-button"
                                            onClick={() => setForm({ id: d.id, name: d.name, percentage: String(d.percentage), active: d.active })}
                                            title="Editar"
                                            style={{ padding: '0.3rem 0.5rem', marginRight: 6 }}
                                        >
                                            <Pencil size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            className="neo-button"
                                            onClick={() => handleDelete(d)}
                                            title="Eliminar"
                                            style={{ padding: '0.3rem 0.5rem' }}
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {!loading && discounts.length === 0 && (
                            <tr>
                                <td colSpan={isAdmin ? 4 : 3} style={{ ...cellStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>
                                    Todavía no hay descuentos especiales.{isAdmin ? ' Creá el primero con "Nuevo descuento".' : ''}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {!isAdmin && (
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>
                    Solo un administrador puede crear, editar o eliminar descuentos.
                </p>
            )}
        </div>
    );
};

export default DescuentosEspeciales;
