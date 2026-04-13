import React, { useEffect, useMemo, useState } from 'react';
import {
    FiTag, FiEdit2, FiCopy, FiTrash2, FiSave, FiPlus,
    FiX, FiCheckCircle, FiClock, FiBox, FiMapPin,
    FiInfo, FiActivity, FiXCircle
} from 'react-icons/fi';
import DirectionalReveal from '../components/DirectionalReveal';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchClientBranches, fetchTable, saveTableRecord } from '../utils/apiClient';
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

const KG_PRESETS = ['0.500', '1.000', '1.500', '2.000', '3.000', '5.000'];

const emptyForm = {
    branch_id: '',
    category_id_filter: '',
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
    const [categories, setCategories] = useState([]);
    const [branches, setBranches] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [listBranchFilter, setListBranchFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const [productRows, promotionRows, categoryRows, branchBundle] = await Promise.all([
                fetchTable('products', { orderBy: 'name', direction: 'ASC', limit: 10000 }).catch(() => []),
                fetchTable('promotions', { orderBy: 'id', direction: 'DESC', limit: 5000 }).catch(() => []),
                fetchTable('product_categories', { orderBy: 'name', direction: 'ASC', limit: 5000 }).catch(() => []),
                fetchClientBranches().catch(() => ({ branches: [] })),
            ]);

            setProducts(Array.isArray(productRows) ? productRows : []);
            setPromotions((Array.isArray(promotionRows) ? promotionRows : []).map(normalizePromotion));
            setCategories(Array.isArray(categoryRows) ? categoryRows : []);
            setBranches(Array.isArray(branchBundle?.branches) ? branchBundle.branches : []);
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

    const categoryOptions = useMemo(() => {
        if (!Array.isArray(categories) || categories.length === 0) return [];
        return categories
            .map((category) => ({
                id: Number(category.id),
                name: String(category.name || category.code || `Categoria ${category.id}`),
            }))
            .filter((category) => Number.isFinite(category.id) && category.id > 0 && category.name.trim().length > 0)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }, [categories]);

    const filteredProducts = useMemo(() => {
        const selectedCategoryId = form.category_id_filter ? Number(form.category_id_filter) : null;
        if (!selectedCategoryId) return [];
        return (products || [])
            .filter((product) => Number(product?.category_id || 0) === selectedCategoryId)
            .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es'));
    }, [form.category_id_filter, products]);

    const filteredRows = useMemo(() => {
        const list = Array.isArray(promotions) ? promotions : [];
        const branchId = Number(listBranchFilter || 0);
        return list
            .filter((row) => {
                if (!branchId) return true;
                return Number(row.branch_id || 0) === branchId;
            })
            .slice()
            .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    }, [listBranchFilter, promotions]);

    const activeRows = useMemo(
        () => filteredRows.filter((row) => row.active),
        [filteredRows]
    );

    const inactiveRows = useMemo(
        () => filteredRows.filter((row) => !row.active),
        [filteredRows]
    );

    const branchesById = useMemo(() => {
        const map = new Map();
        (Array.isArray(branches) ? branches : []).forEach((branch) => {
            const id = Number(branch?.id);
            if (Number.isFinite(id) && id > 0) {
                map.set(id, {
                    id,
                    name: String(branch?.name || `Sucursal ${id}`).trim(),
                });
            }
        });
        return map;
    }, [branches]);

    const selectedCategoryName = useMemo(() => {
        if (!form.category_id_filter) return '';
        const found = categoryOptions.find((category) => Number(category.id) === Number(form.category_id_filter));
        return found?.name || '';
    }, [categoryOptions, form.category_id_filter]);

    const selectedProductName = useMemo(() => {
        if (!form.product_id) return '';
        const product = productsById.get(Number(form.product_id));
        return String(product?.name || form.product_name || '');
    }, [form.product_id, form.product_name, productsById]);

    const selectedBranchName = useMemo(() => {
        if (!form.branch_id) return 'Todas las sucursales';
        return branchesById.get(Number(form.branch_id))?.name || 'Sucursal seleccionada';
    }, [branchesById, form.branch_id]);

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
        setStatus(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const startEdit = (row) => {
        const isoEndDate = row.end_date ? String(row.end_date).slice(0, 16) : '';
        setEditingId(Number(row.id));
        setForm({
            branch_id: row.branch_id != null ? String(row.branch_id) : '',
            category_id_filter: row.product_id != null ? String(productsById.get(Number(row.product_id))?.category_id || '') : '',
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
        setStatus(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const duplicatePromotion = (row) => {
        const isoEndDate = row.end_date ? String(row.end_date).slice(0, 16) : '';
        setEditingId(null);
        setForm({
            branch_id: row.branch_id != null ? String(row.branch_id) : '',
            category_id_filter: row.product_id != null ? String(productsById.get(Number(row.product_id))?.category_id || '') : '',
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
        setStatus({ type: 'ok', text: 'Promo duplicada al formulario. Ajusta y guarda.' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const togglePromoStatus = async (row) => {
        try {
            setSaving(true);
            const newActiveStatus = !row.active;
            await saveTableRecord('promotions', 'update', { active: newActiveStatus ? 1 : 0 }, row.id);
            await loadData();
            setStatus({ type: 'ok', text: `Promoción ${newActiveStatus ? 'activada' : 'desactivada'} correctamente.` });
            
            if (editingId && Number(editingId) === Number(row.id)) {
                setForm(prev => ({ ...prev, active: newActiveStatus }));
            }
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo cambiar el estado de la promoción.' });
        } finally {
            setSaving(false);
        }
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

    const previewLine = useMemo(() => {
        const product = selectedProductName || 'Artículo';
        const branchScope = form.branch_id ? `Solo en ${selectedBranchName}` : 'Disponible en todas las sucursales';
        const minKg = form.min_qty_kg ? `${formatKg(form.min_qty_kg)} kg` : 'X kg';
        const promoPrice = form.promo_total_price ? `$${formatMoney(form.promo_total_price)}` : '$X';
        const stockRule = form.stock_mode === PROMO_STOCK_MODES.FIXED
            ? `Cupo promo: ${form.stock_cap_kg_limit ? `${formatKg(form.stock_cap_kg_limit)} kg` : 'X kg'}`
            : '';

        let endRule = 'Sin fin';
        if (form.end_condition === PROMO_END_CONDITIONS.STOCK) endRule = 'Finaliza al agotar stock promo';
        if (form.end_condition === PROMO_END_CONDITIONS.SOLD_KG) endRule = `Finaliza en ${form.sold_kg_limit ? `${formatKg(form.sold_kg_limit)} kg vendidos` : 'X kg vendidos'}`;
        if (form.end_condition === PROMO_END_CONDITIONS.DATE) endRule = `Finaliza el ${form.end_date ? new Date(form.end_date).toLocaleString('es-AR') : 'dd/mm/aaaa hh:mm'}`;

        return (
            <div className="promo-preview-content">
                <strong><FiTag className="icon-mr"/> {product}</strong>: Llevando {minKg} o más, pagás <span className="highlight-price">{promoPrice}</span> el total.
                <div className="preview-badges">
                    <span className="preview-badge"><FiMapPin /> {branchScope}</span>
                    {stockRule && <span className="preview-badge"><FiBox /> {stockRule}</span>}
                    <span className="preview-badge"><FiClock /> {endRule}</span>
                </div>
            </div>
        );
    }, [form.branch_id, form.end_condition, form.end_date, form.min_qty_kg, form.promo_total_price, form.sold_kg_limit, form.stock_cap_kg_limit, form.stock_mode, selectedBranchName, selectedProductName]);

    const savePromotion = async ({ keepCreating = false } = {}) => {
        try {
            validateForm();
            setSaving(true);
            setStatus(null);
            const currentCategoryId = String(form.category_id_filter || '');

            const payload = {
                branch_id: form.branch_id ? Number(form.branch_id) : null,
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

            let saveResult = null;
            if (editingId) {
                saveResult = await saveTableRecord('promotions', 'update', payload, editingId);
            } else {
                saveResult = await saveTableRecord('promotions', 'insert', payload);
            }

            await loadData();
            const queuedBroadcastCount = Number(saveResult?.broadcast?.queued || 0);
            if (keepCreating && !editingId) {
                const baseText = 'Promoción creada exitosamente. Lista para cargar otra.';
                const broadcastText = queuedBroadcastCount > 0 ? ` WhatsApp: ${queuedBroadcastCount} envíos en cola.` : '';
                setStatus({ type: 'ok', text: `${baseText}${broadcastText}` });
                setForm((prev) => ({
                    ...emptyForm,
                    category_id_filter: currentCategoryId || prev.category_id_filter || '',
                    active: true,
                }));
            } else {
                if (editingId) {
                    setStatus({ type: 'ok', text: 'Promoción actualizada con éxito.' });
                } else {
                    const baseText = 'Promoción creada exitosamente.';
                    const broadcastText = queuedBroadcastCount > 0 ? ` WhatsApp: ${queuedBroadcastCount} envíos en cola.` : '';
                    setStatus({ type: 'ok', text: `${baseText}${broadcastText}` });
                }
                resetForm();
            }
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo guardar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    const deletePromotion = async (row) => {
        try {
            if (!window.confirm(`¿Seguro que deseas eliminar la promoción de ${row.product_name}?`)) return;
            setSaving(true);
            setStatus(null);
            await saveTableRecord('promotions', 'delete', null, row.id);
            await loadData();
            if (editingId && Number(editingId) === Number(row.id)) {
                resetForm();
            }
            setStatus({ type: 'ok', text: 'Promoción eliminada.' });
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo eliminar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    const renderPromoCard = (row) => (
        <div key={row.id} className={`promo-card ${row.active ? 'is-active' : 'is-inactive'}`}>
            <div className="promo-card-header">
                <div className="promo-card-title">
                    <FiTag className="promo-icon"/>
                    <h3>{row.product_name}</h3>
                </div>
                <div className="promo-card-status">
                    <span className={`status-badge ${row.active ? 'on' : 'off'}`}>
                        {row.active ? <><FiCheckCircle/> Activa</> : <><FiXCircle/> Inactiva</>}
                    </span>
                </div>
            </div>
            <div className="promo-card-body">
                <div className="promo-detail-main">
                    <span className="promo-price-tag">
                        <strong>{formatKg(row.min_qty_kg)} kg</strong> por <strong>\${formatMoney(row.promo_total_price)}</strong>
                    </span>
                </div>
                <div className="promo-details-grid">
                    <div className="promo-detail-item">
                        <FiMapPin className="text-muted"/>
                        <span>
                            {row.branch_id != null
                                ? (branchesById.get(Number(row.branch_id))?.name || `Sucursal ${row.branch_id}`)
                                : 'Todas las sucursales'}
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiActivity className="text-muted"/>
                        <span>
                            Usados: {formatKg(row.used_kg || 0)} kg
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiBox className="text-muted"/>
                        <span>
                            Stock: {row.stock_mode === PROMO_STOCK_MODES.FIXED
                                ? `Cupo de ${formatKg(row.stock_cap_kg_limit)} kg`
                                : 'Ilimitado'}
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiClock className="text-muted"/>
                        <span>
                            Fin: {endConditionLabel(row.end_condition)}
                            {row.end_condition === PROMO_END_CONDITIONS.SOLD_KG && row.sold_kg_limit
                                ? ` (${formatKg(row.sold_kg_limit)} kg)`
                                : ''}
                            {row.end_condition === PROMO_END_CONDITIONS.DATE && row.end_date
                                ? ` (${new Date(row.end_date).toLocaleString('es-AR')})`
                                : ''}
                        </span>
                    </div>
                </div>
                {row.notes && (
                    <div className="promo-notes">
                        <FiInfo className="text-muted"/> <span>{row.notes}</span>
                    </div>
                )}
            </div>
            <div className="promo-card-footer">
                <button type="button" className="btn-icon" title="Duplicar" disabled={readOnly || saving} onClick={() => duplicatePromotion(row)}>
                    <FiCopy /> <span className="hidden-mobile">Duplicar</span>
                </button>
                <button type="button" className="btn-icon" title="Editar" disabled={readOnly || saving} onClick={() => startEdit(row)}>
                    <FiEdit2 /> <span className="hidden-mobile">Editar</span>
                </button>
                {row.active ? (
                    <button type="button" className="btn-icon orange-text" title="Desactivar" disabled={readOnly || saving} onClick={() => togglePromoStatus(row)}>
                        <FiXCircle /> <span className="hidden-mobile">Desactivar</span>
                    </button>
                ) : (
                    <button type="button" className="btn-icon green-text" title="Activar" disabled={readOnly || saving} onClick={() => togglePromoStatus(row)}>
                        <FiCheckCircle /> <span className="hidden-mobile">Activar</span>
                    </button>
                )}
                <button type="button" className="btn-icon danger-text" title="Eliminar" disabled={readOnly || saving} onClick={() => deletePromotion(row)}>
                    <FiTrash2 /> <span className="hidden-mobile">Eliminar</span>
                </button>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="config-promos-loading">
                <div className="spinner"></div> Cargando promociones...
            </div>
        );
    }

    return (
        <div className="config-promos-page animate-fade-in">
            <DirectionalReveal className="config-promos-wrapper" from="bottom" delay={0.05}>
                
                {/* Cabecera */}
                <header className="page-header">
                    <div className="header-title">
                        <div className="header-icon"><FiTag /></div>
                        <div>
                            <h1>Configuración de Promociones</h1>
                            <p>Gestión de combos por peso, sucursales y vigencias temporales o de stock.</p>
                        </div>
                    </div>
                    {!isAdmin && (
                        <div className="readonly-alert">
                            <FiInfo /> Solo un administrador puede modificar esta configuración.
                        </div>
                    )}
                </header>

                <div className="layout-grid">
                    {/* Formulario */}
                    <section className="form-section neo-card">
                        <div className="section-header">
                            <h2>{editingId ? <><FiEdit2/> Editar Promoción</> : <><FiPlus/> Nueva Promoción</>}</h2>
                        </div>

                        <div className="form-steps">
                            {/* Paso 1 */}
                            <div className="step-card">
                                <div className="step-badge">1</div>
                                <div className="step-content">
                                    <h3>Producto y Sucursal</h3>
                                    <div className="input-group-row">
                                        <div className="input-field">
                                            <label>Sucursal</label>
                                            <div className="select-wrapper">
                                                <FiMapPin className="input-icon"/>
                                                <select
                                                    value={form.branch_id}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('branch_id', e.target.value)}
                                                >
                                                    <option value="">Todas las sucursales</option>
                                                    {Array.isArray(branches) ? branches.map((branch) => (
                                                        <option key={branch.id} value={branch.id}>
                                                            {branch.name}
                                                        </option>
                                                    )) : null}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="input-field">
                                            <label>Categoría</label>
                                            <select
                                                value={form.category_id_filter}
                                                disabled={readOnly || saving}
                                                onChange={(e) => {
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        category_id_filter: e.target.value,
                                                        product_id: '',
                                                        product_name: '',
                                                    }));
                                                }}
                                            >
                                                <option value="">Todas</option>
                                                {categoryOptions.map((cat) => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="input-field">
                                            <label>Artículo</label>
                                            <select
                                                value={form.product_id}
                                                disabled={readOnly || saving || !form.category_id_filter}
                                                onChange={(e) => selectProduct(e.target.value)}
                                            >
                                                <option value="">{form.category_id_filter ? 'Seleccionar artículo' : 'Elige categoría primero'}</option>
                                                {filteredProducts.map((p) => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Paso 2 */}
                            <div className="step-card">
                                <div className="step-badge">2</div>
                                <div className="step-content">
                                    <h3>Regla de Promoción</h3>
                                    <div className="input-group-row two-cols">
                                        <div className="input-field">
                                            <label>Kg Mínimo</label>
                                            <input
                                                type="number"
                                                min="0.001" step="0.001"
                                                value={form.min_qty_kg}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('min_qty_kg', e.target.value)}
                                                placeholder="Ej. 2.000"
                                            />
                                            <div className="preset-tags">
                                                {KG_PRESETS.map((preset) => (
                                                    <span key={preset} className="preset-tag" onClick={() => !readOnly && !saving && setField('min_qty_kg', preset)}>
                                                        {preset} kg
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="input-field">
                                            <label>Precio Promo Total ($)</label>
                                            <input
                                                type="number"
                                                min="0.01" step="0.01"
                                                value={form.promo_total_price}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('promo_total_price', e.target.value)}
                                                placeholder="Ej. 15000"
                                                className="price-input"
                                            />
                                        </div>
                                        <div className="input-field">
                                            <label>Uso de Stock Promo</label>
                                            <select
                                                value={form.stock_mode}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('stock_mode', e.target.value)}
                                            >
                                                <option value={PROMO_STOCK_MODES.ALL}>Stock ilimitado general</option>
                                                <option value={PROMO_STOCK_MODES.FIXED}>Cupo fijo en Kg</option>
                                            </select>
                                        </div>
                                        {form.stock_mode === PROMO_STOCK_MODES.FIXED && (
                                            <div className="input-field fade-in">
                                                <label>Cupo Promo (Kg)</label>
                                                <input
                                                    type="number"
                                                    min="0.001" step="0.001"
                                                    value={form.stock_cap_kg_limit}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('stock_cap_kg_limit', e.target.value)}
                                                    placeholder="Ej. 100.000"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Paso 3 */}
                            <div className="step-card">
                                <div className="step-badge">3</div>
                                <div className="step-content">
                                    <h3>Finalización y Extras</h3>
                                    <div className="input-group-row two-cols">
                                        <div className="input-field">
                                            <label>Condición de Cierre</label>
                                            <select
                                                value={form.end_condition}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('end_condition', e.target.value)}
                                            >
                                                <option value={PROMO_END_CONDITIONS.NONE}>Vigente siempre</option>
                                                <option value={PROMO_END_CONDITIONS.STOCK}>Al agotar stock fijo promo</option>
                                                <option value={PROMO_END_CONDITIONS.SOLD_KG}>Al llegar a X Kg vendidos</option>
                                                <option value={PROMO_END_CONDITIONS.DATE}>Día y hora específica</option>
                                            </select>
                                        </div>
                                        {form.end_condition === PROMO_END_CONDITIONS.SOLD_KG && (
                                            <div className="input-field fade-in">
                                                <label>Tope Kg Vendidos</label>
                                                <input
                                                    type="number"
                                                    min="0.001" step="0.001"
                                                    value={form.sold_kg_limit}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('sold_kg_limit', e.target.value)}
                                                    placeholder="Ej. 250.000"
                                                />
                                            </div>
                                        )}
                                        {form.end_condition === PROMO_END_CONDITIONS.DATE && (
                                            <div className="input-field fade-in">
                                                <label>Fecha de Cierre</label>
                                                <input
                                                    type="datetime-local"
                                                    value={form.end_date}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('end_date', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        <div className="input-field full-width">
                                            <label>Notas internas (opcional)</label>
                                            <input
                                                type="text"
                                                value={form.notes}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('notes', e.target.value)}
                                                placeholder="Revisar stock en freezer..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Vista Previa y Botones */}
                        <div className="form-footer">
                            <div className="preview-box">
                                {previewLine}
                            </div>
                            
                            <div className="toggle-active">
                                <label className="modern-switch">
                                    <input 
                                        type="checkbox" 
                                        checked={Boolean(form.active)}
                                        disabled={readOnly || saving}
                                        onChange={(e) => setField('active', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                                <span className="switch-label">Promoción Activa al Guardar</span>
                            </div>

                            <div className="action-buttons">
                                <button type="button" className="btn-primary" disabled={readOnly || saving} onClick={() => savePromotion()}>
                                    <FiSave /> {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
                                </button>
                                {!editingId && (
                                    <button
                                        type="button"
                                        className="btn-success"
                                        disabled={readOnly || saving}
                                        onClick={() => savePromotion({ keepCreating: true })}
                                    >
                                        <FiPlus /> Guardar y Crear Otra
                                    </button>
                                )}
                                {editingId && (
                                    <button type="button" className="btn-secondary" disabled={readOnly || saving} onClick={resetForm}>
                                        <FiX /> Cancelar
                                    </button>
                                )}
                            </div>

                            {status && (
                                <div className={`status-message ${status.type}`}>
                                    {status.type === 'ok' ? <FiCheckCircle /> : <FiInfo />}
                                    {status.text}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Tabla / Lista de Promociones */}
                    <section className="list-section neo-card">
                        <div className="list-header-bar">
                            <h2><FiBox/> Promociones Registradas</h2>
                            <div className="filter-box">
                                <FiMapPin className="filter-icon" />
                                <select
                                    value={listBranchFilter}
                                    disabled={loading}
                                    onChange={(e) => setListBranchFilter(e.target.value)}
                                >
                                    <option value="">Todas las suc.</option>
                                    {Array.isArray(branches) ? branches.map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </option>
                                    )) : null}
                                </select>
                            </div>
                        </div>

                        {filteredRows.length === 0 ? (
                            <div className="empty-state">
                                <FiBox className="empty-icon" />
                                <p>{listBranchFilter ? 'No hay promociones para esta sucursal.' : 'No se han creado promociones todavía.'}</p>
                            </div>
                        ) : (
                            <div className="promos-container">
                                
                                {activeRows.length > 0 && (
                                    <div className="promo-group">
                                        <div className="group-title green-glow">
                                            <h3><FiCheckCircle/> Activas</h3>
                                            <span className="count-badge">{activeRows.length}</span>
                                        </div>
                                        <div className="promo-grid">
                                            {activeRows.map(renderPromoCard)}
                                        </div>
                                    </div>
                                )}

                                {inactiveRows.length > 0 && (
                                    <div className="promo-group">
                                        <div className="group-title gray-glow">
                                            <h3><FiXCircle/> Inactivas / Finalizadas</h3>
                                            <span className="count-badge">{inactiveRows.length}</span>
                                        </div>
                                        <div className="promo-grid">
                                            {inactiveRows.map(renderPromoCard)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionPromociones;
