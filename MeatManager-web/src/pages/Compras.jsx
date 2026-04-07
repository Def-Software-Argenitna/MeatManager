import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Calendar, DollarSign, Package, X, Trash2, Save, Scale, ArrowRight, ShieldCheck } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import './Compras.css';

const IVA_OPTIONS = [10.5, 21];

const normalizeLookupValue = (value) => String(value || '').trim().toLowerCase();

const getCategoryNameById = (categories, categoryId) => {
    if (!categoryId || !categories?.length) return '';
    return categories.find((category) => category.id === categoryId)?.name || '';
};

const inferDefaultIvaRate = ({ item, categories }) => {
    const species = normalizeLookupValue(item?.species);
    const type = normalizeLookupValue(item?.type);
    const categoryName = normalizeLookupValue(getCategoryNameById(categories, item?.category_id));
    const itemName = normalizeLookupValue(item?.name);

    if (Number(item?.default_iva_rate) > 0) {
        return Number(item.default_iva_rate);
    }

    if (type === 'despostada' || ['vaca', 'cerdo', 'pollo', 'pescado'].includes(species)) {
        return 10.5;
    }

    if (categoryName.includes('pre') || categoryName.includes('elabor') || itemName.includes('prep') || itemName.includes('milanesa') || itemName.includes('hamburg')) {
        return 21;
    }

    return 21;
};

const calculateIvaAmount = (grossAmount, ivaRate) => {
    const gross = Number(grossAmount) || 0;
    const rate = Number(ivaRate) || 0;
    if (gross <= 0 || rate <= 0) return 0;
    return gross - (gross / (1 + (rate / 100)));
};

const getPurchaseBreakdown = (compra) => {
    const items = compra.items_detail || [];

    return items.reduce((acc, item) => {
        const destination = item.destination || 'venta';
        const subtotal = Number(item.subtotal) || 0;

        if (destination === 'interno') {
            acc.internal += subtotal;
        } else {
            acc.sale += subtotal;
        }

        acc.total += subtotal;
        return acc;
    }, { sale: 0, internal: 0, total: 0 });
};

const Compras = () => {
    const { hasModule } = useLicense();
    const hasDespostadaModule = hasModule('despostada');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [destinationFilter, setDestinationFilter] = useState('all');

    // Advanced Filters State
    const [filters, setFilters] = useState({
        supplier: '',
        month: '',
        year: new Date().getFullYear().toString(),
        day: '',
        invoice_num: ''
    });
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [compras, setCompras] = useState([]);
    const [purchaseItems, setPurchaseItems] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [categories, setCategories] = useState([]);
    const [supplierTaxProfiles, setSupplierTaxProfiles] = useState([]);

    // Form state now includes a list of items instead of a text blob
    const getLocalDateStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; };
    const [newPurchase, setNewPurchase] = useState({
        supplier: '',
        invoice_num: '',
        selectedItems: [],
        total: '',
        date: getLocalDateStr(),
        destination: 'venta',
        payment_method: '',
        is_account: false
    });

    // Current Item Entry State
    const [currentItem, setCurrentItem] = useState({
        name: '',
        quantity: '',
        weight: '',
        unit_price: '',
        unit: 'kg',
        type: 'directo',
        species: 'vaca',
        destination: 'venta',
        iva_rate: 10.5,
        iva_manual: false
    });

    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const isMixedPurchase = newPurchase.destination === 'mixto';

    const loadComprasData = async () => {
        const [comprasRows, comprasItemsRows, purchaseItemsRows, suppliersRows, paymentMethodsRows, categoriesRows, supplierTaxRows] = await Promise.all([
            fetchTable('compras', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
            fetchTable('compras_items', { limit: 5000, orderBy: 'id', direction: 'ASC' }),
            fetchTable('purchase_items', { limit: 2000, orderBy: 'id', direction: 'ASC' }),
            fetchTable('suppliers', { limit: 1000, orderBy: 'name', direction: 'ASC' }),
            fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' }),
            fetchTable('categories', { limit: 500, orderBy: 'id', direction: 'ASC' }),
            fetchTable('supplier_item_tax_profiles', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }).catch(() => []),
        ]);

        const itemsByPurchaseId = new Map();
        (Array.isArray(comprasItemsRows) ? comprasItemsRows : []).forEach((item) => {
            const key = Number(item.purchase_id);
            const list = itemsByPurchaseId.get(key) || [];
            list.push({ ...item, name: item.product_name });
            itemsByPurchaseId.set(key, list);
        });

        setCompras((Array.isArray(comprasRows) ? comprasRows : []).map((compra) => ({
            ...compra,
            items_detail: compra.items_detail || itemsByPurchaseId.get(Number(compra.id)) || [],
        })));
        setPurchaseItems(Array.isArray(purchaseItemsRows) ? purchaseItemsRows : []);
        setSuppliers(Array.isArray(suppliersRows) ? suppliersRows : []);
        setPaymentMethods(Array.isArray(paymentMethodsRows) ? paymentMethodsRows : []);
        setCategories(Array.isArray(categoriesRows) ? categoriesRows : []);
        setSupplierTaxProfiles(Array.isArray(supplierTaxRows) ? supplierTaxRows : []);
    };

    useEffect(() => {
        loadComprasData().catch((error) => {
            console.error('[COMPRAS] No se pudieron cargar datos desde la API', error);
            setCompras([]);
            setPurchaseItems([]);
            setSuppliers([]);
            setPaymentMethods([]);
            setCategories([]);
            setSupplierTaxProfiles([]);
        });
    }, []);

    // Filter suggestions based on input
    useEffect(() => {
        if (currentItem.name && purchaseItems) {
            const matches = purchaseItems.filter(i =>
                i.name.toLowerCase().includes(currentItem.name.toLowerCase())
            );
            setSuggestions(matches);
            setShowSuggestions(matches.length > 0);
        } else {
            setShowSuggestions(false);
        }
    }, [currentItem.name, purchaseItems]);

    useEffect(() => {
        if (!isMixedPurchase) {
            setCurrentItem(prev => ({ ...prev, destination: newPurchase.destination }));
        }
    }, [isMixedPurchase, newPurchase.destination]);

    const getSuggestedIvaRate = useCallback((productName, fallbackItem = null) => {
        const supplierKey = normalizeLookupValue(newPurchase.supplier);
        const productKey = normalizeLookupValue(productName);
        const supplierProfile = supplierTaxProfiles?.find((profile) => (
            normalizeLookupValue(profile.supplier_name) === supplierKey
            && normalizeLookupValue(profile.product_name) === productKey
        ));

        if (supplierProfile?.last_iva_rate != null) {
            return Number(supplierProfile.last_iva_rate);
        }

        const matchedCatalogItem = fallbackItem || purchaseItems?.find((pi) => normalizeLookupValue(pi.name) === productKey);
        return inferDefaultIvaRate({ item: matchedCatalogItem, categories });
    }, [categories, newPurchase.supplier, purchaseItems, supplierTaxProfiles]);

    useEffect(() => {
        if (!currentItem.name || currentItem.iva_manual) return;
        const suggestedRate = getSuggestedIvaRate(currentItem.name);
        if (Number(suggestedRate) > 0 && Number(currentItem.iva_rate) !== Number(suggestedRate)) {
            setCurrentItem((prev) => ({ ...prev, iva_rate: suggestedRate }));
        }
    }, [currentItem.iva_manual, currentItem.iva_rate, currentItem.name, getSuggestedIvaRate]);

    // Helper: Select item from suggestions
    const selectSuggestion = (item) => {
        const suggestedIvaRate = getSuggestedIvaRate(item.name, item);
        setCurrentItem({
            ...currentItem,
            name: item.name,
            unit: item.unit || 'kg',
            type: item.type || 'directo', // Track if it goes to despostada
            species: item.species || 'vaca', // NEW: Take species from catalog
            destination: item.usage || 'venta',
            unit_price: item.last_price || '', // Optional: auto-fill last price
            iva_rate: suggestedIvaRate,
            iva_manual: false
        });
        setShowSuggestions(false);
    };

    const addItemToPurchase = () => {
        if (!currentItem.name || !currentItem.quantity) return;

        const qty = parseFloat(currentItem.quantity) || 0;
        const weight = parseFloat(currentItem.weight) || 0;
        const price = parseFloat(currentItem.unit_price) || 0;

        // NEW: Safety check - if type is missing (manual typing), look it up in catalog
        let itemType = currentItem.type;
        let itemSpecies = currentItem.species;
        let itemDestination = isMixedPurchase
            ? (currentItem.destination || 'venta')
            : newPurchase.destination;
        let itemIvaRate = Number(currentItem.iva_rate) || 0;

        if (!itemType || itemType === 'directo') {
            const matched = purchaseItems?.find(pi => pi.name.toLowerCase() === currentItem.name.toLowerCase());
            if (matched) {
                itemType = matched.type;
                itemSpecies = matched.species;
                itemDestination = isMixedPurchase ? (matched.usage || itemDestination) : newPurchase.destination;
                if (!currentItem.iva_manual) {
                    itemIvaRate = getSuggestedIvaRate(currentItem.name, matched);
                }
            }
        }

        if (!itemIvaRate) {
            itemIvaRate = getSuggestedIvaRate(currentItem.name);
        }

        // Calculate Subtotal based on unit type
        let subtotal = 0;
        if (['kg', 'l'].includes(currentItem.unit)) {
            // Usually price is per kg, so Subtotal = Weight * Price
            // If weight is not provided (rare for meat purchase), maybe fallback to Qty? 
            // Let's assume for KG items, PRICE is PER KG.
            subtotal = (weight > 0 ? weight : qty) * price;
        } else {
            // Unitary items: Subtotal = Qty * Price
            subtotal = qty * price;
        }

        setNewPurchase(prev => {
            const updatedItems = [...prev.selectedItems, {
                ...currentItem,
                type: itemType,
                species: itemSpecies,
                destination: itemDestination,
                quantity: qty,
                weight: weight,
                unit_price: price,
                iva_rate: itemIvaRate,
                subtotal: subtotal,
                id: Date.now()
            }];

            // Auto-update Grand Total
            const newTotal = updatedItems.reduce((acc, item) => acc + item.subtotal, 0);

            return {
                ...prev,
                selectedItems: updatedItems,
                total: newTotal || prev.total // Update total if we calculated something, else keep manual
            };
        });

        // Reset inputs
        setCurrentItem({
            name: '',
            quantity: '',
            weight: '',
            unit_price: '',
            unit: 'kg',
            type: 'directo',
            species: 'vaca',
            destination: isMixedPurchase ? currentItem.destination : newPurchase.destination,
            iva_rate: 10.5,
            iva_manual: false
        });
    };


    const removeItemFromPurchase = (id) => {
        setNewPurchase(prev => {
            const updatedItems = prev.selectedItems.filter(i => i.id !== id);
            // Re-calc total
            const newTotal = updatedItems.reduce((acc, item) => acc + item.subtotal, 0);
            return {
                ...prev,
                selectedItems: updatedItems,
                total: newTotal
            };
        });
    };

    const handleAddPurchase = async (e) => {
        e.preventDefault();

        if (!newPurchase.supplier) return;

        try {
            const purchaseTotal = parseFloat(newPurchase.total) || 0;
            const purchaseBreakdown = newPurchase.selectedItems.reduce((acc, item) => {
                const subtotal = Number(item.subtotal) || 0;
                if ((item.destination || 'venta') === 'interno') {
                    acc.internal += subtotal;
                } else {
                    acc.sale += subtotal;
                }
                acc.total += subtotal;
                return acc;
            }, { sale: 0, internal: 0, total: 0 });

            const normalizedPaymentMethod = String(newPurchase.payment_method || '').trim().toLowerCase();
            const shouldAffectCash = purchaseBreakdown.internal > 0 && !newPurchase.is_account && normalizedPaymentMethod !== 'cta_cte';

            if (shouldAffectCash && !newPurchase.payment_method) {
                window.alert('Seleccioná el medio de pago para registrar la compra interna y descontarla de caja.');
                return;
            }

            // 1. Save the purchase record
            const purchaseInsert = await saveTableRecord('compras', 'insert', {
                supplier: newPurchase.supplier,
                invoice_num: newPurchase.invoice_num,
                date: newPurchase.date,
                total: purchaseTotal,
                payment_method: newPurchase.payment_method,
                is_account: newPurchase.is_account,
                synced: 0,
                items_detail: newPurchase.selectedItems
            });
            const purchaseId = Number(purchaseInsert?.insertId);

            // 1.1 Normalized Items
            const purchaseItemsNormalized = newPurchase.selectedItems.map(i => ({
                purchase_id: purchaseId,
                product_name: i.name,
                quantity: i.quantity,
                weight: i.weight || 0,
                unit_price: i.unit_price,
                subtotal: i.subtotal,
                iva_rate: Number(i.iva_rate) || 0,
                iva_amount: calculateIvaAmount(i.subtotal, i.iva_rate),
                net_subtotal: (Number(i.subtotal) || 0) - calculateIvaAmount(i.subtotal, i.iva_rate),
                destination: i.destination || 'venta',
                unit: i.unit
            }));
            await Promise.all(purchaseItemsNormalized.map((item) => saveTableRecord('compras_items', 'insert', item)));

            // 2. Logic for Stock and Traceability
            for (const item of newPurchase.selectedItems) {
                // UPDATE LAST PRICE
                const catalogItem = purchaseItems?.find(pi => pi.name.toLowerCase() === item.name.toLowerCase());
                if (catalogItem && item.unit_price > 0) {
                    await saveTableRecord('purchase_items', 'update', {
                        ...catalogItem,
                        last_price: item.unit_price,
                        usage: item.destination || 'venta',
                        default_iva_rate: Number(item.iva_rate) || catalogItem.default_iva_rate || 10.5
                    }, catalogItem.id);
                }

                await saveTableRecord('supplier_item_tax_profiles', 'upsert', {
                    supplier_name: newPurchase.supplier,
                    product_name: item.name,
                    last_iva_rate: Number(item.iva_rate) || 0,
                    updated_at: new Date().toISOString()
                });

                // IF FOR DESPOSTADA -> CREATE ANIMAL_LOTS (ONLY IF PRO)
                // This must happen regardless of sale/internal destination, otherwise
                // media res purchases for internal processing never reach Despostada.
                if (item.type === 'despostada' && hasDespostadaModule) {
                    // Logic: If unit is 'un' (units), we create one lot per unit.
                    // If unit is 'kg' (weight), we create ONE lot with the total weight.

                    const numLots = item.unit === 'un' ? Math.floor(item.quantity) : 1;
                    const weightPerLot = item.unit === 'un' ? (item.weight / (item.quantity || 1)) : item.weight;

                    for (let i = 0; i < numLots; i++) {
                        await saveTableRecord('animal_lots', 'insert', {
                            purchase_id: purchaseId,
                            supplier: newPurchase.supplier,
                            date: newPurchase.date,
                            species: item.species || 'vaca',
                            weight: weightPerLot,
                            status: 'disponible'
                        });
                    }

                    continue;
                }

                if (item.destination === 'interno') {
                    continue;
                }

                // IF DIRECT SALE -> UPDATE STOCK
                await saveTableRecord('stock', 'insert', {
                    name: item.name,
                    type: item.species || 'vaca',
                    quantity: item.unit === 'kg' ? (parseFloat(item.weight) || parseFloat(item.quantity)) : parseFloat(item.quantity),
                    unit: item.unit,
                    updated_at: new Date().toISOString(),
                    synced: 0,
                    reference: `compra_${purchaseId}`
                });
            }

            if (shouldAffectCash) {
                const selectedPaymentMethod = paymentMethods?.find((method) => (
                    method.name === newPurchase.payment_method || String(method.name || '').trim().toLowerCase() === normalizedPaymentMethod
                ));

                await saveTableRecord('caja_movimientos', 'insert', {
                    type: 'egreso',
                    amount: purchaseBreakdown.internal,
                    category: 'Compra interna',
                    description: `${newPurchase.supplier}${newPurchase.invoice_num ? ` · Comprobante ${newPurchase.invoice_num}` : ''}`,
                    payment_method: newPurchase.payment_method || 'Efectivo',
                    payment_method_type: selectedPaymentMethod?.type || (normalizedPaymentMethod === 'transferencia' ? 'transfer' : 'cash'),
                    date: new Date(`${newPurchase.date}T12:00:00`).toISOString(),
                    purchase_id: purchaseId,
                    synced: 0
                });
            }

            await loadComprasData();
            setIsModalOpen(false);
            setNewPurchase({
                supplier: '',
                invoice_num: '',
                selectedItems: [],
                total: '',
                date: getLocalDateStr(),
                destination: 'venta',
                payment_method: '',
                is_account: false
            });
        } catch (error) {
            console.error('Error adding purchase:', error);
        }
    };

    const filteredCompras = compras?.filter(compra => {
        const breakdown = getPurchaseBreakdown(compra);
        const hasInternalItems = breakdown.internal > 0;
        const hasSaleItems = breakdown.sale > 0;
        const matchesSearch = searchTerm === '' ||
            compra.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (compra.items && compra.items.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (compra.invoice_num && compra.invoice_num.toLowerCase().includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        // Date breakdowns
        const cDate = new Date(compra.date);
        const cDay = cDate.getDate().toString();
        const cMonth = (cDate.getMonth() + 1).toString();
        const cYear = cDate.getFullYear().toString();

        if (filters.supplier && compra.supplier !== filters.supplier) return false;
        if (filters.month && cMonth !== filters.month) return false;
        if (filters.year && cYear !== filters.year) return false;
        if (filters.day && cDay !== filters.day) return false;
        if (filters.invoice_num && (!compra.invoice_num || !compra.invoice_num.toLowerCase().includes(filters.invoice_num.toLowerCase()))) return false;
        if (destinationFilter === 'venta' && !hasSaleItems) return false;
        if (destinationFilter === 'interno' && !hasInternalItems) return false;
        if (destinationFilter === 'mixto' && !(hasSaleItems && hasInternalItems)) return false;

        return true;
    });

    const purchasesSummary = React.useMemo(() => {
        if (!filteredCompras) {
            return {
                total: 0,
                sale: 0,
                internal: 0,
                mixedCount: 0
            };
        }

        return filteredCompras.reduce((acc, compra) => {
            const breakdown = getPurchaseBreakdown(compra);

            acc.total += breakdown.total || Number(compra.total || 0);
            acc.sale += breakdown.sale;
            acc.internal += breakdown.internal;
            if (breakdown.sale > 0 && breakdown.internal > 0) acc.mixedCount += 1;
            return acc;
        }, { total: 0, sale: 0, internal: 0, mixedCount: 0 });
    }, [filteredCompras]);

    const months = [
        { v: '1', n: 'Enero' }, { v: '2', n: 'Febrero' }, { v: '3', n: 'Marzo' },
        { v: '4', n: 'Abril' }, { v: '5', n: 'Mayo' }, { v: '6', n: 'Junio' },
        { v: '7', n: 'Julio' }, { v: '8', n: 'Agosto' }, { v: '9', n: 'Septiembre' },
        { v: '10', n: 'Octubre' }, { v: '11', n: 'Noviembre' }, { v: '12', n: 'Diciembre' }
    ];

    return (
        <div className="compras-container animate-fade-in">
            <header className="compras-header">
                <div>
                    <h1 className="page-title">Compras</h1>
                    <p className="page-description">Ingreso de mercadería y control de proveedores</p>
                </div>
                <button className="neo-button" onClick={() => setIsModalOpen(true)}>
                    <Plus size={20} />
                    Registrar Compra
                </button>
            </header>

            <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search className="text-muted" size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            type="text"
                            placeholder="Búsqueda rápida (Proveedor, Producto o N°)..."
                            className="neo-input"
                            style={{ paddingLeft: '3rem', marginBottom: 0 }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        className={`neo-button ${showAdvanced ? 'active' : ''}`}
                        style={{ background: showAdvanced ? 'var(--color-bg-main)' : 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                        Filtros Avanzados
                    </button>
                    {(filters.supplier || filters.month || filters.day || filters.invoice_num) && (
                        <button
                            className="neo-button"
                            style={{ background: '#fee2e2', color: '#ef4444', border: 'none' }}
                            onClick={() => setFilters({ supplier: '', month: '', year: new Date().getFullYear().toString(), day: '', invoice_num: '' })}
                        >
                            Limpiar
                        </button>
                    )}
                </div>

                {showAdvanced && (
                    <div className="advanced-filters-grid animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Proveedor</label>
                            <select className="neo-input" value={filters.supplier} onChange={e => setFilters({ ...filters, supplier: e.target.value })}>
                                <option value="">Todos</option>
                                {suppliers?.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Día</label>
                            <input type="number" min="1" max="31" className="neo-input" placeholder="Día" value={filters.day} onChange={e => setFilters({ ...filters, day: e.target.value })} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Mes</label>
                            <select className="neo-input" value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
                                <option value="">Cualquiera</option>
                                {months.map(m => <option key={m.v} value={m.v}>{m.n}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Año</label>
                            <input type="number" className="neo-input" placeholder="Año" value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem' }}>N° Remito/Factura</label>
                            <input type="text" className="neo-input" placeholder="Ej: 0001-..." value={filters.invoice_num} onChange={e => setFilters({ ...filters, invoice_num: e.target.value })} />
                        </div>
                    </div>
                )}
            </div>

            <div className="purchase-views">
                <button type="button" className={`purchase-view-chip ${destinationFilter === 'all' ? 'active' : ''}`} onClick={() => setDestinationFilter('all')}>
                    Todas
                </button>
                <button type="button" className={`purchase-view-chip ${destinationFilter === 'venta' ? 'active' : ''}`} onClick={() => setDestinationFilter('venta')}>
                    Para vender
                </button>
                <button type="button" className={`purchase-view-chip ${destinationFilter === 'interno' ? 'active' : ''}`} onClick={() => setDestinationFilter('interno')}>
                    Uso interno
                </button>
                <button type="button" className={`purchase-view-chip ${destinationFilter === 'mixto' ? 'active' : ''}`} onClick={() => setDestinationFilter('mixto')}>
                    Mixtas
                </button>
            </div>

            <div className="purchase-summary-grid">
                <div className="neo-card purchase-summary-card">
                    <span className="purchase-summary-label">Total general</span>
                    <strong className="purchase-summary-value">${Number(purchasesSummary.total || 0).toLocaleString()}</strong>
                    <span className="purchase-summary-meta">{filteredCompras?.length || 0} movimientos</span>
                </div>
                <div className="neo-card purchase-summary-card sale">
                    <span className="purchase-summary-label">Compras para vender</span>
                    <strong className="purchase-summary-value">${Number(purchasesSummary.sale || 0).toLocaleString()}</strong>
                    <span className="purchase-summary-meta">Impacta en stock de venta</span>
                </div>
                <div className="neo-card purchase-summary-card internal">
                    <span className="purchase-summary-label">Compras de uso interno</span>
                    <strong className="purchase-summary-value">${Number(purchasesSummary.internal || 0).toLocaleString()}</strong>
                    <span className="purchase-summary-meta">Gasto interno separado</span>
                </div>
                <div className="neo-card purchase-summary-card mixed">
                    <span className="purchase-summary-label">Compras mixtas</span>
                    <strong className="purchase-summary-value">{purchasesSummary.mixedCount}</strong>
                    <span className="purchase-summary-meta">Con ambos destinos</span>
                </div>
            </div>

            <div className="compras-grid">
                {filteredCompras?.map(compra => {
                    const breakdown = getPurchaseBreakdown(compra);
                    const purchaseKind = breakdown.sale > 0 && breakdown.internal > 0
                        ? 'mixta'
                        : breakdown.internal > 0
                            ? 'interno'
                            : 'venta';

                    return (
                    <div key={compra.id} className="neo-card purchase-card">
                        <div className="purchase-header">
                            <div className="purchase-supplier">
                                {compra.supplier}
                                {compra.invoice_num && <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', display: 'block', fontWeight: 'normal' }}>N° {compra.invoice_num}</span>}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                                <div className="purchase-date" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <Calendar size={14} />
                                    {new Date(compra.date).toLocaleDateString()}
                                </div>
                                <span className={`purchase-kind-badge ${purchaseKind}`}>
                                    {purchaseKind === 'mixta' ? 'Compra mixta' : purchaseKind === 'interno' ? 'Uso interno' : 'Para vender'}
                                </span>
                            </div>
                        </div>
                        <div className="purchase-items">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <Package size={16} className="text-primary" />
                                <span>Items:</span>
                            </div>
                            {compra.items_detail ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {compra.items_detail.slice(0, 5).map((d, idx) => (
                                        <span key={idx} className={`purchase-item-chip ${(d.destination || 'venta') === 'interno' ? 'internal' : ''}`}>
                                            {d.quantity} {d.name} {(d.destination || 'venta') === 'interno' ? '• interno' : ''}
                                        </span>
                                    ))}
                                    {compra.items_detail.length > 5 && <span style={{ fontSize: '0.8rem' }}>+{compra.items_detail.length - 5} más</span>}
                                </div>
                            ) : (
                                <p style={{ lineHeight: '1.4' }}>{compra.items}</p>
                            )}
                        </div>
                        <div className="purchase-total">
                            <span>Total Factura:</span>
                            <span>${Number(breakdown.total || 0).toLocaleString()}</span>
                        </div>
                        <div className="purchase-breakdown">
                            <div className="purchase-breakdown-row">
                                <span>Para vender</span>
                                <strong>${Number(breakdown.sale || 0).toLocaleString()}</strong>
                            </div>
                            <div className="purchase-breakdown-row internal">
                                <span>Uso interno</span>
                                <strong>${Number(breakdown.internal || 0).toLocaleString()}</strong>
                            </div>
                        </div>
                    </div>
                )})}
            </div>

            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" style={{ maxWidth: '800px', width: '95%' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyItems: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Ingresar Factura / Remito</h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', marginLeft: 'auto' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleAddPurchase}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem' }}>Proveedor</label>
                                    <select
                                        required
                                        autoFocus
                                        className="neo-input"
                                        value={newPurchase.supplier}
                                        onChange={e => setNewPurchase({ ...newPurchase, supplier: e.target.value })}
                                    >
                                        <option value="">Seleccionar Proveedor...</option>
                                        {suppliers?.map(s => (
                                            <option key={s.id} value={s.name}>{s.name}</option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                        ¿No está en la lista? <span onClick={() => { window.open('#/config/proveedores', '_self') }} style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}>Crear nuevo proveedor</span>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem' }}>N° Remito / Factura</label>
                                    <input
                                        type="text"
                                        className="neo-input"
                                        placeholder="Ej: 0001-000456"
                                        value={newPurchase.invoice_num}
                                        onChange={e => setNewPurchase({ ...newPurchase, invoice_num: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem' }}>Tipo de compra</label>
                                    <select
                                        className="neo-input"
                                        value={newPurchase.destination}
                                        onChange={e => setNewPurchase({ ...newPurchase, destination: e.target.value })}
                                    >
                                        <option value="venta">Compra para vender</option>
                                        <option value="interno">Compra para uso interno</option>
                                        <option value="mixto">Compra mixta</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem' }}>Fecha de Emisión</label>
                                    <input
                                        type="date"
                                        required
                                        className="neo-input"
                                        value={newPurchase.date}
                                        onChange={e => setNewPurchase({ ...newPurchase, date: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* DYNAMIC ITEM ENTRY */}
                            <div style={{ background: 'var(--color-bg-main)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', border: '1px solid var(--color-border)' }}>
                                <label style={{ display: 'block', marginBottom: '0.8rem', fontSize: '0.9rem', color: 'var(--color-primary)', fontWeight: '600' }}>
                                    Agregar Ítem al Remito
                                </label>

                                <div className="purchase-item-entry-grid">

                                    {/* 1. PRODUCT SEARCH */}
                                    <div style={{ position: 'relative' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Producto</label>
                                        <input
                                            type="text"
                                            placeholder="Buscar producto..."
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.name}
                                            onChange={(e) => setCurrentItem({ ...currentItem, name: e.target.value })}
                                            onFocus={() => { if (currentItem.name && suggestions.length > 0) setShowSuggestions(true) }}
                                        />
                                        {showSuggestions && (
                                            <div style={{
                                                position: 'absolute', top: '100%', left: 0, right: 0,
                                                background: 'var(--color-bg-card)', border: '1px solid var(--color-primary)',
                                                zIndex: 50, maxHeight: '200px', overflowY: 'auto', borderRadius: '0 0 4px 4px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
                                            }}>
                                                {suggestions.map(s => (
                                                    <div
                                                        key={s.id}
                                                        style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}
                                                        onMouseDown={() => selectSuggestion(s)}
                                                    >
                                                        <div>
                                                            <div style={{ fontWeight: 'bold' }}>{s.name}</div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                                                {s.unit} • Último precio: {s.last_price > 0 ? `$${s.last_price}` : '-'}
                                                            </div>
                                                        </div>
                                                        {s.type === 'despostada' && hasDespostadaModule && (
                                                            <span style={{ background: 'rgba(234, 179, 8, 0.12)', color: 'var(--color-primary)', padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                                                Despostada
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Tratamiento</label>
                                        <select
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.type}
                                            onChange={(e) => setCurrentItem({ ...currentItem, type: e.target.value })}
                                        >
                                            <option value="directo">Stock directo / insumo</option>
                                            {hasDespostadaModule ? (
                                                <option value="despostada">Animal para despostada</option>
                                            ) : (
                                                <option value="directo" disabled>Animal para despostada (requiere licencia)</option>
                                            )}
                                        </select>
                                    </div>

                                    {isMixedPurchase ? (
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Destino</label>
                                            <select
                                                className="neo-input"
                                                style={{ marginBottom: 0 }}
                                                value={currentItem.destination}
                                                onChange={(e) => setCurrentItem({ ...currentItem, destination: e.target.value })}
                                            >
                                                <option value="venta">Para vender</option>
                                                <option value="interno">Uso interno</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Destino</label>
                                            <div className="purchase-mode-indicator">
                                                {newPurchase.destination === 'interno' ? 'Uso interno' : 'Para vender'}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ opacity: currentItem.type === 'despostada' && hasDespostadaModule ? 1 : 0.45, pointerEvents: currentItem.type === 'despostada' && hasDespostadaModule ? 'auto' : 'none' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Especie</label>
                                        <select
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.species}
                                            onChange={(e) => setCurrentItem({ ...currentItem, species: e.target.value })}
                                        >
                                            <option value="vaca">Vaca / Ternera</option>
                                            <option value="cerdo">Cerdo</option>
                                            <option value="pollo">Pollo / Ave</option>
                                            <option value="pescado">Pescado</option>
                                        </select>
                                    </div>

                                    {/* 2. QUANTITY (Units) */}
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Cant.</label>
                                        <input
                                            type="number"
                                            placeholder="UN"
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.quantity}
                                            onChange={(e) => setCurrentItem({ ...currentItem, quantity: e.target.value })}
                                        />
                                    </div>

                                    {/* 3. WEIGHT (Only for KG/L) */}
                                    <div style={{ opacity: ['kg', 'l'].includes(currentItem.unit) ? 1 : 0.3, pointerEvents: ['kg', 'l'].includes(currentItem.unit) ? 'auto' : 'none' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>Total Kg</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="number"
                                                placeholder="0.00"
                                                step="0.01"
                                                className="neo-input"
                                                style={{ marginBottom: 0, paddingRight: '0.5rem' }}
                                                value={currentItem.weight}
                                                onChange={(e) => setCurrentItem({ ...currentItem, weight: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    {/* 4. PRICE (Per Unit or Per KG) */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>
                                                {['kg', 'l'].includes(currentItem.unit) ? '$ Precio x Kg' : '$ Precio Unit.'}
                                            </label>
                                        <input
                                            type="number"
                                            placeholder="0.00"
                                            step="0.01"
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.unit_price}
                                            onChange={(e) => setCurrentItem({ ...currentItem, unit_price: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItemToPurchase(); } }}
                                        />
                                        </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.2rem', color: 'var(--color-text-muted)' }}>IVA compra</label>
                                        <select
                                            className="neo-input"
                                            style={{ marginBottom: 0 }}
                                            value={currentItem.iva_rate}
                                            onChange={(e) => setCurrentItem({ ...currentItem, iva_rate: parseFloat(e.target.value), iva_manual: true })}
                                        >
                                            {IVA_OPTIONS.map((rate) => (
                                                <option key={rate} value={rate}>{rate}%</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* ADD BUTTON */}
                                    <button
                                        type="button"
                                        onClick={addItemToPurchase}
                                        className="neo-button purchase-item-add-button"
                                        title="Agregar linea"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* ITEM LIST TABLE */}
                            <div style={{ marginBottom: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                    <thead style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                                        <tr>
                                            <th style={{ padding: '0.75rem' }}>Producto</th>
                                            <th style={{ padding: '0.75rem' }}>Destino</th>
                                            <th style={{ padding: '0.75rem' }}>Cant.</th>
                                            <th style={{ padding: '0.75rem' }}>Peso</th>
                                            <th style={{ padding: '0.75rem' }}>Precio Base</th>
                                            <th style={{ padding: '0.75rem' }}>IVA</th>
                                            <th style={{ padding: '0.75rem' }}>Subtotal</th>
                                            <th style={{ padding: '0.75rem', width: '40px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {newPurchase.selectedItems.length === 0 ? (
                                            <tr>
                                                <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                                    Ingresa los ítems del remito arriba ⬆️
                                                </td>
                                            </tr>
                                        ) : (
                                            newPurchase.selectedItems.map(item => (
                                                <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <div style={{ fontWeight: '500' }}>{item.name}</div>
                                                        {item.type === 'despostada' && hasDespostadaModule && (
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                                                ✨ Generará lote trazable ({item.species})
                                                            </div>
                                                        )}
                                                        {item.destination === 'interno' && (
                                                            <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                                                No ingresa al stock de venta directa
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <span className={`purchase-item-chip ${item.destination === 'interno' ? 'internal' : ''}`}>
                                                            {item.destination === 'interno' ? 'Uso interno' : 'Para vender'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        {item.quantity} <span style={{ fontSize: '0.8em', color: 'var(--color-text-muted)' }}>{['kg', 'l'].includes(item.unit) ? 'un' : item.unit}</span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        {item.weight > 0 ? `${item.weight} kg` : '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        ${item.unit_price} <span style={{ fontSize: '0.8em', color: 'var(--color-text-muted)' }}>/ {['kg', 'l'].includes(item.unit) ? 'kg' : 'un'}</span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <span className="purchase-item-chip">
                                                            {Number(item.iva_rate || 0).toFixed(1)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>
                                                        ${Number(item.subtotal || 0).toLocaleString()}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeItemFromPurchase(item.id)}
                                                            className="icon-button-danger"
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                    {newPurchase.selectedItems.length > 0 && (
                                        <tfoot style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg-card)' }}>
                                            <tr>
                                                <td colSpan="6" style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>TOTAL CALCULADO:</td>
                                                <td colSpan="2" style={{ padding: '0.75rem', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--color-primary)' }}>
                                                    ${Number(newPurchase.total || 0).toLocaleString()}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <label>Método de pago:</label>
                                    <select value={newPurchase.payment_method} onChange={e => setNewPurchase(p => ({ ...p, payment_method: e.target.value }))}>
                                        <option value="">Seleccionar</option>
                                        <option value="efectivo">Efectivo</option>
                                        <option value="transferencia">Transferencia</option>
                                        <option value="cta_cte">Cuenta Corriente</option>
                                    </select>
                                    <label style={{ marginLeft: '2rem' }}>
                                        <input type="checkbox" checked={newPurchase.is_account} onChange={e => setNewPurchase(p => ({ ...p, is_account: e.target.checked }))} />
                                        &nbsp;¿A cuenta corriente?
                                    </label>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <div style={{ flex: 1 }}></div>
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                                    >
                                        Cancelar
                                    </button>
                                    <button type="submit" className="neo-button">
                                        <Save size={18} style={{ marginRight: '0.5rem' }} /> Guardar Compra
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Compras;
