import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PackageSearch, Plus, Search, Edit2, Trash2, X, FolderOpen, Save, ShieldCheck, ChevronDown, ChevronRight, ArrowUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '../context/LicenseContext';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { assertUniqueProductPluLocal, ensureUnifiedProduct, fetchProductsSafe, findProductByIdentity } from '../utils/productCatalog';
import { useAsyncGuard } from '../hooks/useAsyncGuard';

const IVA_OPTIONS = [10.5, 21];
const ANIMAL_SALE_CATEGORIES = ['vaca', 'cerdo', 'pollo', 'pescado'];
const DEFAULT_SALE_CATEGORY_OPTIONS = [
    { value: 'vaca', label: 'Vaca', group: 'animal' },
    { value: 'cerdo', label: 'Cerdo', group: 'animal' },
    { value: 'pollo', label: 'Pollo', group: 'animal' },
    { value: 'pescado', label: 'Pescado', group: 'animal' },
    { value: 'almacen', label: 'Almacen', group: 'no_animal' },
    { value: 'limpieza', label: 'Limpieza', group: 'no_animal' },
    { value: 'bebidas', label: 'Bebidas', group: 'no_animal' },
    { value: 'insumo', label: 'Insumo General', group: 'no_animal' },
    { value: 'otros', label: 'Otros', group: 'no_animal' },
    { value: 'pre-elaborados', label: 'Pre-elaborados', group: 'no_animal' },
];

const ProductosCompra = () => {
    const navigate = useNavigate();
    const { hasModule } = useLicense();
    const hasDespostadaModule = hasModule('despostada');
    const { guard: guardSave, isPending: isSaving } = useAsyncGuard();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingItem, setEditingItem] = useState(null);
    const [items, setItems] = useState([]);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [saleCategories, setSaleCategories] = useState([]);
    const [collapsedGroups, setCollapsedGroups] = useState({});

    const loadData = React.useCallback(async () => {
        const [itemsRows, productRows, categoriesRows, saleCategoriesRows] = await Promise.all([
            fetchTable('purchase_items'),
            fetchProductsSafe(),
            fetchTable('categories'),
            fetchTable('product_categories'),
        ]);
        setItems(Array.isArray(itemsRows) ? itemsRows : []);
        setProducts(Array.isArray(productRows) ? productRows : []);
        setCategories(Array.isArray(categoriesRows) ? categoriesRows : []);
        setSaleCategories(Array.isArray(saleCategoriesRows) ? saleCategoriesRows : []);
    }, []);

    useEffect(() => {
        loadData().catch((error) => console.error('Error cargando catálogo de compras:', error));
    }, [loadData]);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        unit: 'kg', // default unit
        type: 'directo', // directo or despostada
        is_preelaborable: false,
        species: 'vaca', // default species for traceability
        default_iva_rate: 10.5,
        sale_category: 'almacen',
        sale_price: '',
        sale_plu: ''
    });

    // Build category map for display
    const categoryMap = React.useMemo(() => {
        if (!categories) return {};
        return categories.reduce((acc, cat) => {
            acc[cat.id] = cat.name;
            return acc;
        }, {});
    }, [categories]);

    // Flat list of categories for dropdown (could be improved with indentation for tree)
    const categoryOptions = React.useMemo(() => {
        if (!categories) return [];
        return categories.sort((a, b) => a.name.localeCompare(b.name));
    }, [categories]);

    const saleCategoryOptions = React.useMemo(() => {
        const dbOptions = (Array.isArray(saleCategories) ? saleCategories : [])
            .map((category) => {
                const value = String(category.code || '').trim().toLowerCase();
                if (!value) return null;
                return {
                    value,
                    label: String(category.name || value).trim(),
                    group: ANIMAL_SALE_CATEGORIES.includes(value) ? 'animal' : 'no_animal',
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.label.localeCompare(right.label));

        if (dbOptions.length > 0) return dbOptions;
        return DEFAULT_SALE_CATEGORY_OPTIONS;
    }, [saleCategories]);

    // Sugerir el próximo PLU correlativo al crear un item nuevo
    const nextSuggestedPlu = React.useMemo(() => {
        const existingPlus = products
            .map(p => parseInt(p?.plu || '', 10))
            .filter(n => Number.isFinite(n) && n > 0);
        return existingPlus.length > 0 ? Math.max(...existingPlus) + 1 : 1;
    }, [products]);

    useEffect(() => {
        if (!saleCategoryOptions.length) return;
        const selectedKey = String(formData.sale_category || '').trim().toLowerCase().replace(/-/g, '_');
        const valid = saleCategoryOptions.some((option) => String(option.value || '').trim().toLowerCase().replace(/-/g, '_') === selectedKey);
        if (valid) return;
        setFormData((prev) => ({ ...prev, sale_category: saleCategoryOptions[0].value }));
    }, [formData.sale_category, saleCategoryOptions]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.name) return;

        const nameTrimmed = formData.name.trim();
        if (!formData.sale_price || !formData.sale_plu) {
            alert('⚠️ Completa el precio y el PLU para ventas.');
            return;
        }

        const salePrice = parseFloat(formData.sale_price);
        if (Number.isNaN(salePrice) || salePrice <= 0) {
            alert('⚠️ El precio de venta debe ser un numero valido.');
            return;
        }

        try {
            assertUniqueProductPluLocal(products, formData.sale_plu, editingItem?.product_id || null);
        } catch (error) {
            alert(`⚠️ ${error.message}`);
            return;
        }

        let purchaseItemId = editingItem?.id || null;
        if (editingItem) {
            await saveTableRecord('purchase_items', 'update', {
                name: nameTrimmed,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                is_preelaborable: formData.is_preelaborable ? 1 : 0,
                species: formData.type === 'despostada' ? formData.species : null,
                default_iva_rate: Number(formData.default_iva_rate) || 10.5
            }, editingItem.id);
            setEditingItem(null);
        } else {
            const inserted = await saveTableRecord('purchase_items', 'insert', {
                name: nameTrimmed,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                is_preelaborable: formData.is_preelaborable ? 1 : 0,
                species: formData.type === 'despostada' ? formData.species : 'vaca',
                last_price: 0,
                default_iva_rate: Number(formData.default_iva_rate) || 10.5
            });
            purchaseItemId = inserted?.insertId || null;
        }

        const selectedCategoryKey = String(formData.sale_category || '').trim().toLowerCase().replace(/-/g, '_');
        const selectedSaleCategory = saleCategoryOptions.find((option) => String(option.value || '').trim().toLowerCase().replace(/-/g, '_') === selectedCategoryKey) || null;
        const selectedSaleCategoryRow = saleCategories.find((row) => String(row.code || '').trim().toLowerCase().replace(/-/g, '_') === selectedCategoryKey) || null;
        const priceRows = await fetchTable('prices', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }).catch(() => []);
        const unifiedProduct = await ensureUnifiedProduct({
            products,
            prices: Array.isArray(priceRows) ? priceRows : [],
            name: nameTrimmed,
            category: formData.sale_category,
            categoryId: selectedSaleCategoryRow?.id || null,
            unit: formData.unit,
            price: salePrice,
            plu: formData.sale_plu.trim(),
            source: 'catalogo_compra',
            preferredProductId: editingItem?.product_id || null,
        });
        const stockRows = await fetchTable('stock');
        const existingStock = (Array.isArray(stockRows) ? stockRows : []).find((item) =>
            Number(item.product_id || 0) === Number(unifiedProduct?.id || 0) ||
            (
                String(item.name || '').trim().toLowerCase() === nameTrimmed.toLowerCase() &&
                String(item.type || '').trim().toLowerCase() === String(formData.sale_category || '').trim().toLowerCase()
            )
        );

        if (!existingStock) {
            await saveTableRecord('stock', 'insert', {
                product_id: unifiedProduct?.id || null,
                name: nameTrimmed,
                type: selectedSaleCategory?.value || formData.sale_category,
                quantity: 0,
                unit: formData.unit,
                updated_at: new Date().toISOString(),
                reference: 'catalogo_compra'
            });
        }

        if (purchaseItemId && unifiedProduct?.id) {
            await saveTableRecord('purchase_items', 'update', {
                product_id: unifiedProduct.id,
            }, purchaseItemId);
        }

        await loadData();
        setIsModalOpen(false);
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', is_preelaborable: false, species: 'vaca', default_iva_rate: 10.5, sale_category: 'almacen', sale_price: '', sale_plu: '' });
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Eliminar este producto del catálogo de compras?')) {
            await saveTableRecord('purchase_items', 'delete', null, id);
            await loadData();
        }
    };

    const openEdit = (item) => {
        const productRecord = findProductByIdentity(products, { id: item.product_id, name: item.name });
        const existingCategory = String(productRecord?.category_code || productRecord?.category || 'almacen').trim().toLowerCase();
        setEditingItem(item);
        setFormData({
            name: item.name,
            category_id: item.category_id || '',
            unit: item.unit || 'kg',
            type: item.type || 'directo',
            is_preelaborable: Number(item.is_preelaborable || 0) === 1,
            species: item.species || 'vaca',
            default_iva_rate: item.default_iva_rate ?? ((item.type === 'despostada' || ANIMAL_SALE_CATEGORIES.includes(String(item.species || '').toLowerCase())) ? 10.5 : 21),
            sale_category: existingCategory,
            sale_price: productRecord?.current_price?.toString() || '',
            sale_plu: productRecord?.plu || ''
        });
        setIsModalOpen(true);
    };

    const openNew = () => {
        setEditingItem(null);
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', is_preelaborable: false, species: 'vaca', default_iva_rate: 10.5, sale_category: 'almacen', sale_price: '', sale_plu: String(nextSuggestedPlu) });
        setIsModalOpen(true);
    };

    const itemsWithSaleData = React.useMemo(() => {
        const source = Array.isArray(items) ? items : [];
        return source.map((item) => {
            const productRecord = findProductByIdentity(products, {
                id: item?.product_id,
                name: item?.name,
                plu: item?.plu,
            });

            return {
                ...item,
                current_price: productRecord?.current_price ?? null,
                plu: productRecord?.plu ?? '',
                product_category: productRecord?.category ?? null,
                product_category_code: productRecord?.category_code ?? null,
            };
        });
    }, [items, products]);

    const filteredItems = React.useMemo(() => {
        const term = String(searchTerm || '').trim().toLowerCase();
        const source = Array.isArray(itemsWithSaleData) ? itemsWithSaleData : [];
        if (!term) return source;
        return source.filter((item) => String(item?.name || '').toLowerCase().includes(term));
    }, [itemsWithSaleData, searchTerm]);

    const groupedItems = React.useMemo(() => {
        const groups = new Map();

        filteredItems.forEach((item) => {
            const hasCategory = Number(item?.category_id || 0) > 0;
            const key = hasCategory ? `cat-${item.category_id}` : 'uncategorized';
            const label = hasCategory && categoryMap[item.category_id]
                ? categoryMap[item.category_id]
                : 'Sin categoría';

            if (!groups.has(key)) {
                groups.set(key, { key, label, items: [] });
            }
            groups.get(key).items.push(item);
        });

        const sortedGroups = Array.from(groups.values()).map((group) => ({
            ...group,
            items: group.items.sort((a, b) =>
                String(a?.name || '').localeCompare(String(b?.name || ''), 'es', { sensitivity: 'base' })
            ),
        }));

        sortedGroups.sort((a, b) => {
            if (a.key === 'uncategorized') return 1;
            if (b.key === 'uncategorized') return -1;
            return String(a.label).localeCompare(String(b.label), 'es', { sensitivity: 'base' });
        });

        return sortedGroups;
    }, [filteredItems, categoryMap]);

    const toggleGroup = (groupKey) => {
        setCollapsedGroups((prev) => ({
            ...prev,
            [groupKey]: !prev[groupKey],
        }));
    };

    const expandAllGroups = () => {
        setCollapsedGroups({});
    };

    const collapseAllGroups = () => {
        const nextState = {};
        groupedItems.forEach((group) => {
            nextState[group.key] = true;
        });
        setCollapsedGroups(nextState);
    };

    React.useEffect(() => {
        setCollapsedGroups((prev) => {
            const next = {};
            groupedItems.forEach((group) => {
                next[group.key] = prev[group.key] ?? false;
            });
            return next;
        });
    }, [groupedItems]);

    const renderSaleCategoryOptions = () => {
        const animal = saleCategoryOptions.filter((option) => option.group === 'animal');
        const nonAnimal = saleCategoryOptions.filter((option) => option.group === 'no_animal');

        return (
            <>
                <optgroup label="Origen Animal">
                    {animal.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </optgroup>
                <optgroup label="Origen No Animal">
                    {nonAnimal.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </optgroup>
            </>
        );
    };

    return (
        <div className="animate-fade-in">
            <header className="page-header">
                <div className="page-header-actions">
                    <button className="neo-button" onClick={openNew}>
                        <Plus size={20} />
                        Nuevo Producto
                    </button>
                </div>
            </header>

            <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 340px' }}>
                        <Search className="text-muted" size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text"
                            placeholder="Buscar producto..."
                            className="neo-input"
                            style={{ paddingLeft: '3rem', marginBottom: 0 }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            type="button"
                            className="neo-button"
                            style={{ padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}
                            onClick={expandAllGroups}
                        >
                            Expandir todo
                        </button>
                        <button
                            type="button"
                            className="neo-button"
                            style={{ padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}
                            onClick={collapseAllGroups}
                        >
                            Contraer todo
                        </button>
                    </div>
                </div>
            </div>

            {groupedItems.length === 0 ? (
                <div className="neo-card" style={{ padding: '1.25rem', color: 'var(--color-text-muted)' }}>
                    No hay artículos para mostrar con el filtro actual.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {groupedItems.map((group) => (
                        <section key={group.key} className="neo-card" style={{ padding: '1rem' }}>
                            <button
                                type="button"
                                onClick={() => toggleGroup(group.key)}
                                style={{
                                    width: '100%',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                            >
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '0.8rem',
                                borderBottom: '1px solid var(--color-border)',
                                paddingBottom: '0.6rem',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {collapsedGroups[group.key] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                                        {group.label}
                                    </h3>
                                </div>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                    {group.items.length} artículo{group.items.length === 1 ? '' : 's'}
                                </span>
                            </div>
                            </button>

                            {!collapsedGroups[group.key] && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                                {group.items.map(item => (
                                    <div key={item.id} className="neo-card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.name}</div>
                                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ background: 'var(--color-bg-main)', padding: '0.15rem 0.35rem', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
                                                    {item.unit}
                                                </span>
                                                <span style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#93c5fd', padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700', border: '1px solid rgba(59, 130, 246, 0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
                                                    IVA {Number(item.default_iva_rate ?? 10.5).toFixed(1)}%
                                                </span>
                                                {item.type === 'despostada' && (
                                                    <span style={{ background: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-primary)', padding: '0.2rem 0.55rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', border: '1px solid var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1, textAlign: 'center' }}>
                                                        PARA DESPOSTAR
                                                    </span>
                                                )}
                                                {Number(item.is_preelaborable || 0) === 1 && (
                                                    <span style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#86efac', padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700', border: '1px solid rgba(34, 197, 94, 0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1, textAlign: 'center' }}>
                                                        INSUMO PRE-ELABORADO
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', fontSize: '0.82rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ background: 'rgba(249, 115, 22, 0.12)', color: '#fdba74', padding: '0.25rem 0.6rem', borderRadius: '999px', fontWeight: '800', border: '1px solid rgba(249, 115, 22, 0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
                                                    {Number(item.current_price) > 0
                                                        ? `$${Number(item.current_price).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                                        : 'Sin precio'}
                                                </span>
                                                <span style={{ background: 'rgba(148, 163, 184, 0.12)', color: '#cbd5e1', padding: '0.25rem 0.6rem', borderRadius: '999px', fontWeight: '700', border: '1px solid rgba(148, 163, 184, 0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
                                                    PLU {String(item.plu || '').trim() || 'sin definir'}
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <button onClick={() => openEdit(item)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}><Edit2 size={18} /></button>
                                            <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={18} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            )}
                        </section>
                    ))}
                </div>
            )}

            {isModalOpen && createPortal(
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                {editingItem ? 'Editar Producto' : 'Nuevo Producto de Compra'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>

                        <form onSubmit={guardSave(handleSave)}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Nombre del Producto</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="neo-input"
                                    placeholder="Ej: Media Res, Pollo Cajón..."
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>

                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Categoría</label>
                                <select
                                    className="neo-input"
                                    value={formData.category_id}
                                    onChange={e => setFormData({ ...formData, category_id: e.target.value })}
                                >
                                    <option value="">Seleccionar Categoría...</option>
                                    {categoryOptions.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                    <a href="#" onClick={(e) => { e.preventDefault(); navigate('/config/categorias'); }} style={{ color: 'var(--color-primary)' }}>Generar nueva categoría</a>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Unidad de Medida</label>
                                    <select
                                        className="neo-input"
                                        value={formData.unit}
                                        onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                    >
                                        <option value="kg">Kilogramos (kg)</option>
                                        <option value="un">Unidad (un)</option>
                                        <option value="l">Litros (l)</option>
                                        <option value="caja">Caja</option>
                                        <option value="bulto">Bulto</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>IVA sugerido de compra</label>
                                    <select
                                        className="neo-input"
                                        value={formData.default_iva_rate}
                                        onChange={e => setFormData({ ...formData, default_iva_rate: parseFloat(e.target.value) })}
                                    >
                                        {IVA_OPTIONS.map((rate) => (
                                            <option key={rate} value={rate}>{rate}%</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Destino / Uso</label>
                                    <select
                                        className="neo-input"
                                        value={formData.type}
                                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                                        disabled={!hasDespostadaModule}
                                    >
                                        <option value="directo">Venta Directa / Insumo</option>
                                        {hasDespostadaModule ? (
                                            <option value="despostada">Animal para Despostada</option>
                                        ) : (
                                            <option value="disabled" disabled>Animal para Despostada (Solo PRO)</option>
                                        )}
                                    </select>
                                    {!hasDespostadaModule && (
                                        <div
                                            onClick={() => navigate('/config/licencia')}
                                            style={{ fontSize: '0.7rem', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: '0.2rem' }}
                                        >
                                            <ShieldCheck size={12} /> Activar modo PRO para despostada
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ marginBottom: '1.5rem', padding: '0.9rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', fontWeight: '600' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.is_preelaborable}
                                        onChange={(e) => setFormData({ ...formData, is_preelaborable: e.target.checked })}
                                    />
                                    Este producto puede usarse como insumo para pre-elaborados
                                </label>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.45rem' }}>
                                    Si lo activás, aparecerá en la pantalla de Pre-elaborados cuando haya stock disponible.
                                </div>
                            </div>

                            <div style={{ marginBottom: '1.5rem', animate: 'fade-in' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Origen del Producto</label>
                                <select
                                    className="neo-input"
                                    value={formData.sale_category}
                                    onChange={e => setFormData({ ...formData, sale_category: e.target.value })}
                                >
                                    {renderSaleCategoryOptions()}
                                </select>
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                                    Define de donde viene el producto para clasificarlo correctamente en ventas y stock.
                                </p>
                            </div>

                            {ANIMAL_SALE_CATEGORIES.includes(formData.sale_category) && (
                            <div style={{ marginBottom: '1.5rem', animate: 'fade-in' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Especie de Animal</label>
                                <select
                                    className="neo-input"
                                    style={{ border: '1px solid var(--color-primary)' }}
                                    value={formData.species || 'ninguna'}
                                    onChange={e => setFormData({ ...formData, species: e.target.value })}
                                >
                                    <option value="ninguna">Ninguna / No aplica</option>
                                    <option value="vaca">Vaca / Ternera</option>
                                    <option value="cerdo">Cerdo</option>
                                    <option value="pollo">Pollo / Ave</option>
                                    <option value="pescado">Pescado</option>
                                </select>
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                                    Categoriza el producto por su origen animal.
                                </p>
                            </div>
                            )}

                            <div style={{ marginBottom: '1.5rem', padding: '0.75rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ fontWeight: '600', marginBottom: '0.75rem' }}>Datos para Ventas</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Categoria de Venta</label>
                                        <select
                                            className="neo-input"
                                            value={formData.sale_category}
                                            onChange={e => setFormData({ ...formData, sale_category: e.target.value })}
                                        >
                                            {renderSaleCategoryOptions()}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>PLU</label>
                                        <input
                                            type="text"
                                            className="neo-input"
                                            placeholder="Ej: 111"
                                            required
                                            value={formData.sale_plu}
                                            onChange={e => setFormData({ ...formData, sale_plu: e.target.value })}
                                        />
                                        {!editingItem && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                                                Sugerido ({nextSuggestedPlu}) — podés cambiarlo
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Precio de Venta</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="neo-input"
                                        placeholder="0"
                                        required
                                        value={formData.sale_price}
                                        onChange={e => setFormData({ ...formData, sale_price: e.target.value })}
                                    />
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                                    Se crea el producto base en Stock con 0 cantidad y el precio/PLU para Ventas.
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" className="neo-button" disabled={isSaving}>{isSaving ? 'Guardando...' : 'Guardar'}</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default ProductosCompra;

