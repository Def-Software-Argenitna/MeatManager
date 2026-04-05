import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Plus, Search, Calendar, DollarSign, Package, X, Trash2, Save, Scale, ArrowRight, ShieldCheck } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import './Compras.css';

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

    const compras = useLiveQuery(
        async () => {
            const list = await db.compras.orderBy('date').reverse().toArray();
            return Promise.all(list.map(async c => {
                if (c.items_detail) return c; // Compatibility with old data
                const items = await db.compras_items.where('purchase_id').equals(c.id).toArray();
                // Map product_name back to name for UI consistency
                const mappedItems = items.map(i => ({ ...i, name: i.product_name }));
                return { ...c, items_detail: mappedItems };
            }));
        },
        []
    );

    const purchaseItems = useLiveQuery(
        () => db.purchase_items?.toArray()
    );

    const suppliers = useLiveQuery(
        () => db.suppliers?.orderBy('name').toArray()
    );

    const paymentMethods = useLiveQuery(
        () => db.payment_methods?.toArray()
    );

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
        destination: 'venta'
    });

    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const isMixedPurchase = newPurchase.destination === 'mixto';

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

    // Helper: Select item from suggestions
    const selectSuggestion = (item) => {
        setCurrentItem({
            ...currentItem,
            name: item.name,
            unit: item.unit || 'kg',
            type: item.type || 'directo', // Track if it goes to despostada
            species: item.species || 'vaca', // NEW: Take species from catalog
            destination: item.usage || 'venta',
            unit_price: item.last_price || '' // Optional: auto-fill last price
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

        if (!itemType || itemType === 'directo') {
            const matched = purchaseItems?.find(pi => pi.name.toLowerCase() === currentItem.name.toLowerCase());
            if (matched) {
                itemType = matched.type;
                itemSpecies = matched.species;
                itemDestination = isMixedPurchase ? (matched.usage || itemDestination) : newPurchase.destination;
            }
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
            destination: isMixedPurchase ? currentItem.destination : newPurchase.destination
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
            const purchaseId = await db.compras.add({
                supplier: newPurchase.supplier,
                invoice_num: newPurchase.invoice_num,
                date: newPurchase.date,
                total: purchaseTotal,
                payment_method: newPurchase.payment_method,
                is_account: newPurchase.is_account,
                synced: 0
            });

            // 1.1 Normalized Items
            const purchaseItemsNormalized = newPurchase.selectedItems.map(i => ({
                purchase_id: purchaseId,
                product_name: i.name,
                quantity: i.quantity,
                weight: i.weight || 0,
                unit_price: i.unit_price,
                subtotal: i.subtotal,
                destination: i.destination || 'venta',
                unit: i.unit
            }));
            await db.compras_items.bulkAdd(purchaseItemsNormalized);

            // 2. Logic for Stock and Traceability
            for (const item of newPurchase.selectedItems) {
                // UPDATE LAST PRICE
                const catalogItem = purchaseItems?.find(pi => pi.name.toLowerCase() === item.name.toLowerCase());
                if (catalogItem && item.unit_price > 0) {
                    await db.purchase_items.update(catalogItem.id, {
                        last_price: item.unit_price,
                        usage: item.destination || 'venta'
                    });
                }

                // IF FOR DESPOSTADA -> CREATE ANIMAL_LOTS (ONLY IF PRO)
                // This must happen regardless of sale/internal destination, otherwise
                // media res purchases for internal processing never reach Despostada.
                if (item.type === 'despostada' && hasDespostadaModule) {
                    // Logic: If unit is 'un' (units), we create one lot per unit.
                    // If unit is 'kg' (weight), we create ONE lot with the total weight.

                    const numLots = item.unit === 'un' ? Math.floor(item.quantity) : 1;
                    const weightPerLot = item.unit === 'un' ? (item.weight / (item.quantity || 1)) : item.weight;

                    for (let i = 0; i < numLots; i++) {
                        await db.animal_lots.add({
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
                await db.stock.add({
                    name: item.name,
                    type: item.species || 'vaca',
                    quantity: item.unit === 'kg' ? (parseFloat(item.weight) || parseFloat(item.quantity)) : parseFloat(item.quantity),
                    unit: item.unit,
                    updated_at: new Date(),
                    synced: 0,
                    reference: `compra_${purchaseId}`
                });
            }

            if (shouldAffectCash) {
                const selectedPaymentMethod = paymentMethods?.find((method) => (
                    method.name === newPurchase.payment_method || String(method.name || '').trim().toLowerCase() === normalizedPaymentMethod
                ));

                await db.caja_movimientos.add({
                    type: 'egreso',
                    amount: purchaseBreakdown.internal,
                    category: 'Compra interna',
                    description: `${newPurchase.supplier}${newPurchase.invoice_num ? ` · Comprobante ${newPurchase.invoice_num}` : ''}`,
                    payment_method: newPurchase.payment_method || 'Efectivo',
                    payment_method_type: selectedPaymentMethod?.type || (normalizedPaymentMethod === 'transferencia' ? 'transfer' : 'cash'),
                    date: new Date(`${newPurchase.date}T12:00:00`),
                    purchase_id: purchaseId,
                    synced: 0
                });
            }

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
                    <strong className="purchase-summary-value">${purchasesSummary.total.toLocaleString()}</strong>
                    <span className="purchase-summary-meta">{filteredCompras?.length || 0} movimientos</span>
                </div>
                <div className="neo-card purchase-summary-card sale">
                    <span className="purchase-summary-label">Compras para vender</span>
                    <strong className="purchase-summary-value">${purchasesSummary.sale.toLocaleString()}</strong>
                    <span className="purchase-summary-meta">Impacta en stock de venta</span>
                </div>
                <div className="neo-card purchase-summary-card internal">
                    <span className="purchase-summary-label">Compras de uso interno</span>
                    <strong className="purchase-summary-value">${purchasesSummary.internal.toLocaleString()}</strong>
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
                            <span>${breakdown.total.toLocaleString()}</span>
                        </div>
                        <div className="purchase-breakdown">
                            <div className="purchase-breakdown-row">
                                <span>Para vender</span>
                                <strong>${breakdown.sale.toLocaleString()}</strong>
                            </div>
                            <div className="purchase-breakdown-row internal">
                                <span>Uso interno</span>
                                <strong>${breakdown.internal.toLocaleString()}</strong>
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
                                            <th style={{ padding: '0.75rem' }}>Subtotal</th>
                                            <th style={{ padding: '0.75rem', width: '40px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {newPurchase.selectedItems.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
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
                                                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>
                                                        ${item.subtotal.toLocaleString()}
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
                                                <td colSpan="5" style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>TOTAL CALCULADO:</td>
                                                <td colSpan="2" style={{ padding: '0.75rem', fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--color-primary)' }}>
                                                    ${newPurchase.total.toLocaleString()}
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
