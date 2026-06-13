import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '../context/LicenseContext';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { assertUniqueProductPluLocal, ensureUnifiedProduct, fetchProductsSafe, findProductByIdentity } from '../utils/productCatalog';
import { useAsyncGuard } from '../hooks/useAsyncGuard';
import { useUser } from '../context/UserContext';
import { Button, Modal, EmptyState, useToast } from '../components/ui';

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
    const { accessProfile, activeBranch } = useUser();
    const currentBranchId = Number(activeBranch?.id ?? accessProfile?.branch?.id ?? 0) || null;
    const hasDespostadaModule = hasModule('despostada');
    const { guard: guardSave, isPending: isSaving } = useAsyncGuard();
    const toast = useToast();
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
        use_for_despostada: false,
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
        const requestedPlu = formData.sale_plu.trim();
        const existingProductCandidate = findProductByIdentity(products, {
            id: editingItem?.product_id || null,
            name: nameTrimmed,
            plu: requestedPlu,
        });
        const existingCatalogItem = existingProductCandidate?.id
            ? items.find((item) => Number(item?.product_id || 0) === Number(existingProductCandidate.id)) || null
            : null;

        if (!editingItem && existingCatalogItem) {
            toast.warning(`Este articulo ya existia en el catalogo y ya esta vinculado como "${existingCatalogItem.name}".`);
            return;
        }
        if (!formData.sale_price || !formData.sale_plu) {
            toast.warning('⚠️ Completa el precio y el PLU para ventas.');
            return;
        }

        const salePrice = parseFloat(formData.sale_price);
        if (Number.isNaN(salePrice) || salePrice <= 0) {
            toast.warning('⚠️ El precio de venta debe ser un numero valido.');
            return;
        }

        try {
            assertUniqueProductPluLocal(
                products,
                requestedPlu,
                editingItem?.product_id || existingProductCandidate?.id || null
            );
        } catch (error) {
            toast.warning(`⚠️ ${error.message}`);
            return;
        }

        let purchaseItemId = editingItem?.id || null;
        if (editingItem) {
            await saveTableRecord('purchase_items', 'update', {
                name: nameTrimmed,
                product_id: existingProductCandidate?.id || editingItem?.product_id || null,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                use_for_despostada: formData.use_for_despostada ? 1 : 0,
                is_preelaborable: formData.is_preelaborable ? 1 : 0,
                species: formData.use_for_despostada ? formData.species : null,
                default_iva_rate: Number(formData.default_iva_rate) || 10.5
            }, editingItem.id);
            setEditingItem(null);
        } else {
            const inserted = await saveTableRecord('purchase_items', 'insert', {
                name: nameTrimmed,
                product_id: existingProductCandidate?.id || null,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                use_for_despostada: formData.use_for_despostada ? 1 : 0,
                is_preelaborable: formData.is_preelaborable ? 1 : 0,
                species: formData.use_for_despostada ? formData.species : 'vaca',
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
            plu: requestedPlu,
            source: 'catalogo_compra',
            preferredProductId: editingItem?.product_id || existingProductCandidate?.id || null,
            branchId: currentBranchId,
            useForDespostada: formData.use_for_despostada,
            despostadaSpecies: formData.use_for_despostada ? formData.species : null,
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
                branch_id: currentBranchId || null,
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
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', use_for_despostada: false, is_preelaborable: false, species: 'vaca', default_iva_rate: 10.5, sale_category: 'almacen', sale_price: '', sale_plu: '' });
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Eliminar este producto del catálogo de compras?')) {
            const item = items.find((entry) => Number(entry.id) === Number(id)) || null;
            const productId = Number(item?.product_id || 0);
            if (productId > 0) {
                await saveTableRecord('products', 'delete', null, productId);

                const stockRows = await fetchTable('stock').catch(() => []);
                const emptyStockRows = (Array.isArray(stockRows) ? stockRows : []).filter((row) => (
                    Number(row?.product_id || 0) === productId
                    && Math.abs(Number(row?.quantity || 0)) <= 0.000001
                ));
                for (const row of emptyStockRows) {
                    if (row?.id) {
                        await saveTableRecord('stock', 'delete', null, row.id);
                    }
                }
            }
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
            use_for_despostada: Number(productRecord?.use_for_despostada ?? item.use_for_despostada ?? (item.type === 'despostada' ? 1 : 0)) === 1,
            is_preelaborable: Number(item.is_preelaborable || 0) === 1,
            species: productRecord?.despostada_species || item.species || 'vaca',
            default_iva_rate: item.default_iva_rate ?? ((item.type === 'despostada' || ANIMAL_SALE_CATEGORIES.includes(String(item.species || '').toLowerCase())) ? 10.5 : 21),
            sale_category: existingCategory,
            sale_price: productRecord?.current_price?.toString() || '',
            sale_plu: productRecord?.plu || ''
        });
        setIsModalOpen(true);
    };

    const openNew = () => {
        setEditingItem(null);
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', use_for_despostada: false, is_preelaborable: false, species: 'vaca', default_iva_rate: 10.5, sale_category: 'almacen', sale_price: '', sale_plu: String(nextSuggestedPlu) });
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
                use_for_despostada: Number(productRecord?.use_for_despostada ?? item?.use_for_despostada ?? (item?.type === 'despostada' ? 1 : 0)) === 1 ? 1 : 0,
                despostada_species: productRecord?.despostada_species || item?.species || null,
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
                    <Button variant="primary" icon={<Plus size={20} />} onClick={openNew}>
                        Nuevo Producto
                    </Button>
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
                        <Button variant="secondary" size="sm" onClick={expandAllGroups}>
                            Expandir todo
                        </Button>
                        <Button variant="secondary" size="sm" onClick={collapseAllGroups}>
                            Contraer todo
                        </Button>
                    </div>
                </div>
            </div>

            {groupedItems.length === 0 ? (
                <EmptyState
                    compact
                    icon={Search}
                    title="No hay artículos para mostrar"
                    description="No encontramos artículos con el filtro actual."
                />
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
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nombre</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unidad</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>IVA</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Precio</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PLU</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flags</th>
                                        <th style={{ padding: '0.4rem 0.6rem' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                {group.items.map(item => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <td style={{ padding: '0.45rem 0.6rem', fontWeight: 600, color: 'var(--color-text-main)' }}>{item.name}</td>
                                        <td style={{ padding: '0.45rem 0.6rem', color: 'var(--color-text-muted)' }}>{item.unit}</td>
                                        <td style={{ padding: '0.45rem 0.6rem' }}>
                                            <span style={{ background: 'rgba(59,130,246,0.12)', color: '#93c5fd', padding: '0.15rem 0.45rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(59,130,246,0.25)', whiteSpace: 'nowrap' }}>
                                                {Number(item.default_iva_rate ?? 10.5).toFixed(1)}%
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.45rem 0.6rem' }}>
                                            <span style={{ color: Number(item.current_price) > 0 ? '#fdba74' : '#ef4444', fontWeight: 700 }}>
                                                {Number(item.current_price) > 0
                                                    ? `$${Number(item.current_price).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                                    : 'Sin precio'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.45rem 0.6rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '0.82rem' }}>
                                            {String(item.plu || '').trim() || '—'}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.6rem' }}>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                {Number(item.use_for_despostada || 0) === 1 && (
                                                    <span style={{ background: 'rgba(234,179,8,0.1)', color: 'var(--color-primary)', padding: '0.1rem 0.4rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, border: '1px solid var(--color-primary)', whiteSpace: 'nowrap' }}>DESPOSTADA</span>
                                                )}
                                                {Number(item.is_preelaborable || 0) === 1 && (
                                                    <span style={{ background: 'rgba(34,197,94,0.12)', color: '#86efac', padding: '0.1rem 0.4rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, border: '1px solid rgba(34,197,94,0.25)', whiteSpace: 'nowrap' }}>PRE-ELAB</span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.45rem 0.6rem' }}>
                                            <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                                                <Button variant="ghost" size="sm" icon={<Edit2 size={15} color="#3b82f6" />} onClick={() => openEdit(item)} />
                                                <Button variant="ghost" size="sm" icon={<Trash2 size={15} color="#ef4444" />} onClick={() => handleDelete(item.id)} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                            )}
                        </section>
                    ))}
                </div>
            )}

            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingItem ? 'Editar Producto' : 'Nuevo Producto de Compra'}
            >
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
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Destino por defecto en compras</label>
                                    <select
                                        className="neo-input"
                                        value={formData.type}
                                        onChange={e => setFormData({
                                            ...formData,
                                            type: e.target.value,
                                            use_for_despostada: e.target.value === 'despostada' ? true : formData.use_for_despostada,
                                        })}
                                        disabled={!hasDespostadaModule}
                                    >
                                        <option value="directo">Stock directo / insumo</option>
                                        {hasDespostadaModule ? (
                                            <option value="despostada">Despostada por defecto</option>
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

                            <div style={{ marginBottom: '1.5rem', padding: '0.9rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(234,179,8,0.06)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: hasDespostadaModule ? 'pointer' : 'not-allowed', fontWeight: '700', color: hasDespostadaModule ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.use_for_despostada}
                                        disabled={!hasDespostadaModule}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            use_for_despostada: e.target.checked,
                                            species: e.target.checked ? (formData.species || 'vaca') : formData.species,
                                        })}
                                    />
                                    Artículo multi destino
                                </label>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.45rem' }}>
                                    Al comprarlo vas a poder elegir por cada partida si entra a stock directo o como lote pendiente de despostada.
                                </div>
                                {!hasDespostadaModule && (
                                    <div
                                        onClick={() => navigate('/config/licencia')}
                                        style={{ fontSize: '0.72rem', color: 'var(--color-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.45rem' }}
                                    >
                                        <ShieldCheck size={12} /> Activar modo PRO para despostada
                                    </div>
                                )}
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

                            {(ANIMAL_SALE_CATEGORIES.includes(formData.sale_category) || formData.use_for_despostada) && (
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
                                <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                                <Button variant="primary" type="submit" disabled={isSaving}>{isSaving ? 'Guardando...' : 'Guardar'}</Button>
                            </div>
                </form>
            </Modal>
        </div>
    );
};

export default ProductosCompra;

