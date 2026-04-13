import React, { useEffect, useMemo, useState } from 'react';
import DirectionalReveal from '../components/DirectionalReveal';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { normalizePromotion, PROMO_END_CONDITIONS, PROMO_STOCK_MODES } from '../utils/promotions';
import './ConfiguracionPromociones.css';

const toNumber = (value, decimals = 2) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const factor = 10 ** decimals;
    return Math.round(parsed * factor) / factor;
};

const formatKg = (value) => toNumber(value, 3).toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatMoney = (value) => toNumber(value, 2).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const endConditionLabel = (value) => {
    if (value === PROMO_END_CONDITIONS.STOCK) return 'Agotar stock promo';
    if (value === PROMO_END_CONDITIONS.SOLD_KG) return 'Hasta kg vendidos';
    if (value === PROMO_END_CONDITIONS.DATE) return 'Hasta fecha';
    return 'Sin fin';
};

const emptyForm = {
    product_id: '',
    product_name: '',
    min_qty_kg: '',
    promo_total_price: '',
    stock_mode: PROMO_STOCK_MODES.ALL,
    stock_cap_kg_limit: '',
    end_condition: PROMO_END_CONDITIONS.NONE,
    sold_kg_limit: '',
    end_date: '',
    active: true,
    notes: '',
};

const ConfiguracionPromociones = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const readOnly = !isAdmin;

    const [products, setProducts] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const [productRows, promotionRows] = await Promise.all([
                fetchTable('products', { orderBy: 'name', direction: 'ASC', limit: 10000 }).catch(() => []),
                fetchTable('promotions', { orderBy: 'id', direction: 'DESC', limit: 5000 }).catch(() => []),
            ]);

            setProducts(Array.isArray(productRows) ? productRows : []);
            setPromotions((Array.isArray(promotionRows) ? promotionRows : []).map(normalizePromotion));
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudieron cargar las promociones.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const productsById = useMemo(() => {
        const map = new Map();
        (products || []).forEach((product) => {
            map.set(Number(product.id), product);
        });
        return map;
    }, [products]);

    const rows = useMemo(() => {
        const list = Array.isArray(promotions) ? promotions : [];
        return list.slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    }, [promotions]);

    const setField = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const selectProduct = (productIdRaw) => {
        const productId = productIdRaw ? Number(productIdRaw) : null;
        if (!productId) {
            setForm((prev) => ({ ...prev, product_id: '', product_name: '' }));
            return;
        }
        const product = productsById.get(productId);
        setForm((prev) => ({
            ...prev,
            product_id: String(productId),
            product_name: String(product?.name || ''),
        }));
    };

    const resetForm = () => {
        setEditingId(null);
        setForm(emptyForm);
    };

    const startEdit = (row) => {
        const isoEndDate = row.end_date ? String(row.end_date).slice(0, 16) : '';
        setEditingId(Number(row.id));
        setForm({
            product_id: row.product_id != null ? String(row.product_id) : '',
            product_name: String(row.product_name || ''),
            min_qty_kg: String(toNumber(row.min_qty_kg, 3)),
            promo_total_price: String(toNumber(row.promo_total_price, 2)),
            stock_mode: row.stock_mode || PROMO_STOCK_MODES.ALL,
            stock_cap_kg_limit: row.stock_cap_kg_limit != null ? String(toNumber(row.stock_cap_kg_limit, 3)) : '',
            end_condition: row.end_condition || PROMO_END_CONDITIONS.NONE,
            sold_kg_limit: row.sold_kg_limit != null ? String(toNumber(row.sold_kg_limit, 3)) : '',
            end_date: isoEndDate,
            active: row.active === true || Number(row.active) === 1,
            notes: String(row.notes || ''),
        });
    };

    const validateForm = () => {
        const minQty = toNumber(form.min_qty_kg, 3);
        const promoTotal = toNumber(form.promo_total_price, 2);
        const productName = String(form.product_name || '').trim();

        if (!productName) throw new Error('Selecciona un articulo para la promo.');
        if (!(minQty > 0)) throw new Error('El minimo en kg debe ser mayor a 0.');
        if (!(promoTotal > 0)) throw new Error('El precio promo debe ser mayor a 0.');

        if (form.stock_mode === PROMO_STOCK_MODES.FIXED) {
            const cap = toNumber(form.stock_cap_kg_limit, 3);
            if (!(cap > 0)) throw new Error('Si el stock promo es fijo, define kg validos.');
        }

        if (form.end_condition === PROMO_END_CONDITIONS.SOLD_KG) {
            const soldLimit = toNumber(form.sold_kg_limit, 3);
            if (!(soldLimit > 0)) throw new Error('Define el tope de kg vendidos para finalizar la promo.');
        }

        if (form.end_condition === PROMO_END_CONDITIONS.DATE) {
            const endDate = new Date(form.end_date);
            if (!form.end_date || Number.isNaN(endDate.getTime())) {
                throw new Error('Define una fecha de finalizacion valida.');
            }
        }
    };

    const savePromotion = async () => {
        try {
            validateForm();
            setSaving(true);
            setStatus(null);

            const payload = {
                product_id: form.product_id ? Number(form.product_id) : null,
                product_name: String(form.product_name || '').trim(),
                min_qty_kg: toNumber(form.min_qty_kg, 3),
                promo_total_price: toNumber(form.promo_total_price, 2),
                stock_mode: form.stock_mode || PROMO_STOCK_MODES.ALL,
                stock_cap_kg_limit: form.stock_mode === PROMO_STOCK_MODES.FIXED
                    ? toNumber(form.stock_cap_kg_limit, 3)
                    : null,
                end_condition: form.end_condition || PROMO_END_CONDITIONS.NONE,
                sold_kg_limit: form.end_condition === PROMO_END_CONDITIONS.SOLD_KG
                    ? toNumber(form.sold_kg_limit, 3)
                    : null,
                end_date: form.end_condition === PROMO_END_CONDITIONS.DATE
                    ? new Date(form.end_date).toISOString()
                    : null,
                active: form.active ? 1 : 0,
                notes: String(form.notes || '').trim() || null,
            };

            if (editingId) {
                await saveTableRecord('promotions', 'update', payload, editingId);
            } else {
                await saveTableRecord('promotions', 'insert', payload);
            }

            await loadData();
            setStatus({ type: 'ok', text: editingId ? 'Promocion actualizada.' : 'Promocion creada.' });
            resetForm();
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo guardar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    const deletePromotion = async (row) => {
        try {
            setSaving(true);
            setStatus(null);
            await saveTableRecord('promotions', 'delete', null, row.id);
            await loadData();
            if (editingId && Number(editingId) === Number(row.id)) {
                resetForm();
            }
            setStatus({ type: 'ok', text: 'Promocion eliminada.' });
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo eliminar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="config-promos-loading">Cargando promociones...</div>;
    }

    return (
        <div className="config-promos-page animate-fade-in">
            <DirectionalReveal className="neo-card config-promos-card" from="left" delay={0.06}>
                <header className="config-promos-header">
                    <h1>Configuracion de Promociones por Kilo</h1>
                    <p>
                        Define combos por peso con vigencia y tope. La promo se aplica automaticamente en Ventas.
                    </p>
                    {!isAdmin ? (
                        <div className="config-promos-readonly">
                            Solo un administrador puede modificar esta configuracion.
                        </div>
                    ) : null}
                </header>

                <section className="config-promos-form">
                    <h2>{editingId ? 'Editar promocion' : 'Nueva promocion'}</h2>
                    <div className="config-promos-grid">
                        <label>
                            Articulo
                            <select
                                value={form.product_id}
                                disabled={readOnly || saving}
                                onChange={(e) => selectProduct(e.target.value)}
                            >
                                <option value="">Seleccionar articulo</option>
                                {products.map((product) => (
                                    <option key={product.id} value={product.id}>
                                        {product.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label>
                            Kg minimo
                            <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={form.min_qty_kg}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('min_qty_kg', e.target.value)}
                                placeholder="2.000"
                            />
                        </label>

                        <label>
                            Precio promo total
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={form.promo_total_price}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('promo_total_price', e.target.value)}
                                placeholder="15000"
                            />
                        </label>

                        <label>
                            Uso de stock promo
                            <select
                                value={form.stock_mode}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('stock_mode', e.target.value)}
                            >
                                <option value={PROMO_STOCK_MODES.ALL}>Usar todo el stock disponible</option>
                                <option value={PROMO_STOCK_MODES.FIXED}>Usar cupo fijo de kg</option>
                            </select>
                        </label>

                        {form.stock_mode === PROMO_STOCK_MODES.FIXED ? (
                            <label>
                                Kg maximos promo (cupo)
                                <input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    value={form.stock_cap_kg_limit}
                                    disabled={readOnly || saving}
                                    onChange={(e) => setField('stock_cap_kg_limit', e.target.value)}
                                    placeholder="100.000"
                                />
                            </label>
                        ) : null}

                        <label>
                            Condicion de finalizacion
                            <select
                                value={form.end_condition}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('end_condition', e.target.value)}
                            >
                                <option value={PROMO_END_CONDITIONS.NONE}>Sin fin</option>
                                <option value={PROMO_END_CONDITIONS.STOCK}>Agotar stock promo</option>
                                <option value={PROMO_END_CONDITIONS.SOLD_KG}>Hasta X kg vendidos</option>
                                <option value={PROMO_END_CONDITIONS.DATE}>Hasta fecha</option>
                            </select>
                        </label>

                        {form.end_condition === PROMO_END_CONDITIONS.SOLD_KG ? (
                            <label>
                                Kg vendidos tope
                                <input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    value={form.sold_kg_limit}
                                    disabled={readOnly || saving}
                                    onChange={(e) => setField('sold_kg_limit', e.target.value)}
                                    placeholder="300.000"
                                />
                            </label>
                        ) : null}

                        {form.end_condition === PROMO_END_CONDITIONS.DATE ? (
                            <label>
                                Fecha de finalizacion
                                <input
                                    type="datetime-local"
                                    value={form.end_date}
                                    disabled={readOnly || saving}
                                    onChange={(e) => setField('end_date', e.target.value)}
                                />
                            </label>
                        ) : null}

                        <label>
                            Notas
                            <input
                                type="text"
                                value={form.notes}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('notes', e.target.value)}
                                placeholder="Opcional"
                            />
                        </label>

                        <label className="config-promos-checkbox">
                            <input
                                type="checkbox"
                                checked={Boolean(form.active)}
                                disabled={readOnly || saving}
                                onChange={(e) => setField('active', e.target.checked)}
                            />
                            <span>Promocion activa</span>
                        </label>
                    </div>

                    <div className="config-promos-actions">
                        <button type="button" className="save-btn" disabled={readOnly || saving} onClick={savePromotion}>
                            {saving ? 'Guardando...' : editingId ? 'Actualizar promocion' : 'Crear promocion'}
                        </button>
                        {editingId ? (
                            <button type="button" className="secondary-btn" disabled={readOnly || saving} onClick={resetForm}>
                                Cancelar edicion
                            </button>
                        ) : null}
                        {status ? (
                            <span className={status.type === 'ok' ? 'status-ok' : 'status-error'}>{status.text}</span>
                        ) : null}
                    </div>
                </section>

                <section className="config-promos-table">
                    <h2>Promociones configuradas</h2>
                    {rows.length === 0 ? (
                        <div className="config-promos-empty">No hay promociones cargadas.</div>
                    ) : (
                        <div className="config-promos-list">
                            {rows.map((row) => (
                                <div key={row.id} className="config-promos-row">
                                    <div>
                                        <strong>{row.product_name}</strong>
                                        <p>
                                            {formatKg(row.min_qty_kg)} kg por ${formatMoney(row.promo_total_price)}
                                        </p>
                                        <p>
                                            Usados: {formatKg(row.used_kg || 0)} kg ·
                                            {' '}Stock promo: {row.stock_mode === PROMO_STOCK_MODES.FIXED
                                                ? `${formatKg(row.stock_cap_kg_limit)} kg`
                                                : 'Todo el stock'}
                                        </p>
                                        <p>
                                            Fin: {endConditionLabel(row.end_condition)}
                                            {row.end_condition === PROMO_END_CONDITIONS.SOLD_KG && row.sold_kg_limit
                                                ? ` (${formatKg(row.sold_kg_limit)} kg)`
                                                : ''}
                                            {row.end_condition === PROMO_END_CONDITIONS.DATE && row.end_date
                                                ? ` (${new Date(row.end_date).toLocaleString('es-AR')})`
                                                : ''}
                                        </p>
                                        {row.notes ? <small>{row.notes}</small> : null}
                                    </div>
                                    <div className="config-promos-row-actions">
                                        <span className={row.active ? 'badge-on' : 'badge-off'}>
                                            {row.active ? 'Activa' : 'Inactiva'}
                                        </span>
                                        <button type="button" disabled={readOnly || saving} onClick={() => startEdit(row)}>
                                            Editar
                                        </button>
                                        <button
                                            type="button"
                                            className="danger"
                                            disabled={readOnly || saving}
                                            onClick={() => deletePromotion(row)}
                                        >
                                            Eliminar
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionPromociones;
