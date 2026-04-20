import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Package, Search, Filter, TrendingUp, TrendingDown, Scale, Save, X, DownloadCloud, FileSpreadsheet, Pencil } from 'lucide-react';
import { scaleService, SCALE_PROTOCOLS } from '../utils/SerialScaleService';
import DirectionalReveal from '../components/DirectionalReveal';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { ensureUnifiedProduct, fetchProductsSafe, findProductByIdentity, getProductCurrentPrice, normalizeProductKey, reconcileLegacyProductConflicts, syncLegacyProductsToCatalog } from '../utils/productCatalog';
import { useUser } from '../context/UserContext';
import './Stock.css';

const TYPE_META = {
    vaca: { name: 'Vaca', icon: '🐄', color: '#dc2626' },
    cerdo: { name: 'Cerdo', icon: '🐷', color: '#ec4899' },
    pollo: { name: 'Pollo', icon: '🐔', color: '#f59e0b' },
    pescado: { name: 'Pescado', icon: '🐟', color: '#3b82f6' },
    'pre-elaborado': { name: 'Pre-elaborados', icon: '🍖', color: '#8b5cf6' },
    almacen: { name: 'Almacen', icon: '📦', color: '#f97316' },
    limpieza: { name: 'Limpieza', icon: '🧴', color: '#06b6d4' },
    bebidas: { name: 'Bebidas', icon: '🥤', color: '#22c55e' },
    insumo: { name: 'Insumos', icon: '🧰', color: '#14b8a6' },
    otros: { name: 'Otros', icon: '📁', color: '#64748b' },
};

const TYPE_PRIORITY = ['vaca', 'cerdo', 'pollo', 'pescado', 'pre-elaborado', 'almacen', 'limpieza', 'bebidas', 'insumo', 'otros'];

const normalizeStockType = (value) => {
    const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (normalized === 'pre-elaborados' || normalized === 'preelaborado') return 'pre-elaborado';
    return normalized || 'otros';
};

const Stock = () => {
    const { accessProfile } = useUser();
    const currentBranchId = accessProfile?.branch?.id ? Number(accessProfile.branch.id) : null;
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [isImporting, setIsImporting] = useState(false);
    const [importStatus, setImportStatus] = useState(null);
    const [diagLogs, setDiagLogs] = useState([]);
    const [showDiag, setShowDiag] = useState(false);
    const [products, setProducts] = useState([]);
    const [editingPriceId, setEditingPriceId] = useState('');
    const [editingPriceValue, setEditingPriceValue] = useState('');
    const [allStock, setAllStock] = useState([]);

    const loadStockAndPrices = async () => {
        const [stockRows, productRows] = await Promise.all([
            fetchTable('stock', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
            fetchProductsSafe(),
        ]);
        setAllStock(Array.isArray(stockRows) ? stockRows : []);
        setProducts(Array.isArray(productRows) ? productRows : []);
    };

    useEffect(() => {
        let cancelled = false;

        const loadPrices = async () => {
            try {
                const [stockRows, productRows] = await Promise.all([
                    fetchTable('stock', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
                    fetchProductsSafe(),
                ]);
                await syncLegacyProductsToCatalog({
                    products: productRows,
                    stockRows,
                    prices: [],
                });
                const syncedProducts = await fetchProductsSafe();
                await reconcileLegacyProductConflicts({
                    products: syncedProducts,
                    prices: [],
                });
                const refreshedProducts = await fetchProductsSafe();
                if (!cancelled) {
                    setAllStock(Array.isArray(stockRows) ? stockRows : []);
                    setProducts(Array.isArray(refreshedProducts) ? refreshedProducts : []);
                }
            } catch (error) {
                console.error('[STOCK] No se pudieron cargar stock/precios desde la API', error);
                if (!cancelled) {
                    setAllStock([]);
                    setProducts([]);
                }
            }
        };

        loadPrices();
        return () => {
            cancelled = true;
        };
    }, []);

    const addDiagLog = (type, msg) => {
        const ts = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2 });
        setDiagLogs(prev => [...prev, { type, msg, ts }]);
    };

    const showStatus = (type, message, autoDismiss = true) => {
        setImportStatus({ type, message });
        if (autoDismiss && type !== 'loading') {
            setTimeout(() => setImportStatus(null), 6000);
        }
    };

    const branchStockRows = React.useMemo(() => {
        if (!Array.isArray(allStock)) return [];
        if (!currentBranchId) return allStock;
        return allStock.filter((row) => (
            row.branch_id == null || Number(row.branch_id) === currentBranchId
        ));
    }, [allStock, currentBranchId]);

    const consolidatedStock = React.useMemo(() => {
        if (!branchStockRows) return [];

        const grouped = {};
        branchStockRows.forEach((item) => {
            const matchedProduct = findProductByIdentity(products, {
                id: item.product_id,
                name: item.name,
            });
            const key = matchedProduct?.id
                ? `product:${matchedProduct.id}`
                : `${normalizeProductKey(item.name)}__${item.unit || 'kg'}`;
            if (!grouped[key]) {
                grouped[key] = {
                    id: key,
                    product_ref_id: matchedProduct?.id || null,
                    name: matchedProduct?.name || item.name,
                    type: normalizeStockType(matchedProduct?.category || item.type),
                    unit: matchedProduct?.unit || item.unit || 'kg',
                    quantity: 0,
                    updated_at: item.updated_at
                };
            }

            grouped[key].quantity += Number(item.quantity) || 0;

            if (item.updated_at && (!grouped[key].updated_at || new Date(item.updated_at) > new Date(grouped[key].updated_at))) {
                grouped[key].updated_at = item.updated_at;
            }
        });

        return Object.values(grouped)
            .filter((item) => Math.abs(item.quantity) > 0.0001)
            .filter((item) => !/_p\d+$/i.test(String(item.name || '').trim()))
            .map((item) => {
                const matchedProduct = findProductByIdentity(products, {
                    id: item.product_ref_id,
                    name: item.name,
                });
                return {
                    ...item,
                    product_id: matchedProduct?.id || item.product_ref_id || null,
                    price_record_id: matchedProduct?.id || null,
                    price: getProductCurrentPrice(matchedProduct),
                    plu: matchedProduct?.plu || '',
                };
            })
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }, [branchStockRows, products]);

    // Filtrar stock consolidado
    const filteredStock = consolidatedStock.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === 'all' || normalizeStockType(item.type) === filterType;
        return matchesSearch && matchesType;
    });

    // Agrupar por tipo
    const stockByType = filteredStock.reduce((acc, item) => {
        const type = item.type;
        if (!acc[type]) {
            acc[type] = [];
        }
        acc[type].push(item);
        return acc;
    }, {});

    // Calcular totales
    const totalItems = filteredStock.length;
    const totalWeight = filteredStock.reduce((sum, item) => {
        if (item.unit === 'kg') {
            return sum + item.quantity;
        }
        return sum;
    }, 0);
    const totalUnits = filteredStock.reduce((sum, item) => {
        if (item.unit === 'unidades') {
            return sum + item.quantity;
        }
        return sum;
    }, 0);

    // Tipos disponibles
    const types = React.useMemo(() => {
        const dynamicTypes = [...new Set((consolidatedStock || []).map((item) => normalizeStockType(item.type)))];
        dynamicTypes.sort((a, b) => {
            const ia = TYPE_PRIORITY.indexOf(a);
            const ib = TYPE_PRIORITY.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b, 'es');
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
        return [
            { id: 'all', name: 'Todos', icon: '📦', color: '#64748b' },
            ...dynamicTypes.map((id) => ({
                id,
                name: TYPE_META[id]?.name || id,
                icon: TYPE_META[id]?.icon || '📦',
                color: TYPE_META[id]?.color || '#64748b',
            })),
        ];
    }, [consolidatedStock]);

    const getTypeInfo = (type) => {
        const normalized = normalizeStockType(type);
        return types.find(t => t.id === normalized) || { name: normalized, icon: '📦', color: '#6b7280' };
    };

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [adjustment, setAdjustment] = useState({
        productId: '',
        quantity: '',
        type: 'add' // 'add' or 'subtract'
    });

    const handleAdjustment = async (e) => {
        e.preventDefault();
        if (!adjustment.productId || !adjustment.quantity) return;

        const product = productsForAdjustment.find(p => p.id === adjustment.productId);
        if (!product) return;

        const qty = parseFloat(adjustment.quantity);
        const finalQty = adjustment.type === 'add' ? qty : -qty;

        await saveTableRecord('stock', 'insert', {
            branch_id: currentBranchId || null,
            product_id: product.productId || null,
            name: product.name,
            type: product.category,
            quantity: finalQty,
            unit: product.unit,
            updated_at: new Date().toISOString(),
            reference: 'ajuste_manual'
        });

        await loadStockAndPrices();
        setIsModalOpen(false);
        setAdjustment({ productId: '', quantity: '', type: 'add' });
    };

    const handleExportExcel = () => {{
        const rows = filteredStock.map(item => ({
            'Código': item.id,
            'Nombre': item.name,
            'PLU': item.plu || '',
            'Categoría': item.type,
            'Cantidad': item.quantity,
            'Unidad': item.unit,
            'Precio ($)': item.price ?? '',
            'Última actualización': item.updated_at ? new Date(item.updated_at).toLocaleString('es-AR') : '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stock');
        const fecha = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `Stock_${fecha}.xlsx`);
    }};

    const handleImportFromScale = async () => {
        try {
            setIsImporting(true);
            setDiagLogs([]);
            setShowDiag(true);
            addDiagLog('info', 'Iniciando importación de balanza...');

            // 1. Connect if not connected
            if (!scaleService.port) {
                addDiagLog('info', 'Solicitando puerto serial USB...');
                const hasPort = await scaleService.requestPort();
                if (!hasPort) {
                    addDiagLog('error', 'No se seleccionó puerto USB.');
                    showStatus('error', 'No se seleccionó puerto USB.');
                    setIsImporting(false);
                    return;
                }
            }

            if (scaleService.isConnected()) {
                addDiagLog('ok', 'Puerto ya abierto (reutilizando conexión existente).');
            } else {
                addDiagLog('info', 'Conectando al puerto (115200 baud)...');
                const connected = await scaleService.connect(115200);
                if (!connected) {
                    addDiagLog('error', 'No se pudo abrir el puerto. Cable desconectado o puerto ocupado.');
                    showStatus('error', 'No se pudo conectar a la balanza. Verificá el cable USB.');
                    setIsImporting(false);
                    return;
                }
                addDiagLog('ok', 'Puerto abierto correctamente.');
            }

            scaleService.setProtocol(SCALE_PROTOCOLS.SYSTEL_CUORA);
            addDiagLog('info', 'Protocolo: Systel Cuora (STX + CMD + ETX + LRC)');

            // 2. Download with live diagnostic
            showStatus('loading', 'Descargando artículos de la balanza... Por favor, esperá...', false);
            const articles = await scaleService.downloadArticles(addDiagLog);

            if (!articles || articles.length === 0) {
                showStatus('warn', 'No se recibieron artículos. Mirá el panel de diagnóstico para más detalles.');
                setIsImporting(false);
                return;
            }

            // 3. Process & Save
            let updatedCount = 0;
            let createdCount = 0;

            for (const art of articles) {
                const validPrice = typeof art.price === 'number' && !isNaN(art.price) && art.price > 0;
                const unifiedProduct = await ensureUnifiedProduct({
                    products,
                    prices: [],
                    name: art.name,
                    category: 'vaca',
                    unit: art.unit || 'kg',
                    price: validPrice ? art.price : null,
                    plu: art.plu,
                    source: 'importacion_balanza',
                });
                if (validPrice) updatedCount++;

                // Ensure product exists in stock tracker
                const inStock = allStock.find((item) => (
                    Number(item.product_id || 0) === Number(unifiedProduct?.id || 0)
                    || String(item.name || '').trim().toLowerCase() === String(art.name || '').trim().toLowerCase()
                ));
                if (!inStock) {
                    await saveTableRecord('stock', 'insert', {
                        branch_id: currentBranchId || null,
                        product_id: unifiedProduct?.id || null,
                        name: art.name,
                        type: 'vaca',
                        quantity: 0,
                        unit: art.unit || 'kg',
                        updated_at: new Date().toISOString(),
                        reference: 'importacion_balanza'
                    });
                    createdCount++;
                }
            }

            await loadStockAndPrices();
            showStatus('success', `Sincronización exitosa — Nuevos: ${createdCount} | Actualizados: ${updatedCount} | Total: ${articles.length}`);
            addDiagLog('ok', `✅ Sincronización exitosa — Nuevos: ${createdCount} | Actualizados: ${updatedCount}`);
        } catch (error) {
            console.error("❌ Scale Import Error:", error);
            addDiagLog('error', `Excepción: ${error.message}`);
            showStatus('error', 'Error al importar: ' + error.message + '. Intentá nuevamente.');
        } finally {
            setIsImporting(false);
            try {
                await scaleService.disconnect();
            } catch {
                // Ignore disconnect errors
            }
        }
    };

    const productsForAdjustment = React.useMemo(() => {
        return consolidatedStock.map((item) => ({
            id: item.id,
            productId: item.product_id,
            name: item.name,
            category: item.type,
            unit: item.unit
        }));
    }, [consolidatedStock]);

    const startPriceEdit = (item) => {
        setEditingPriceId(item.id);
        setEditingPriceValue(item.price ? String(item.price) : '');
    };

    const cancelPriceEdit = () => {
        setEditingPriceId('');
        setEditingPriceValue('');
    };

    const savePriceEdit = async (item) => {
        const numericPrice = Number(editingPriceValue);
        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            showStatus('error', 'Ingresá un precio válido');
            return;
        }

        try {
            await ensureUnifiedProduct({
                products,
                prices: [],
                preferredProductId: item.product_id,
                name: item.name,
                category: item.type,
                unit: item.unit,
                price: numericPrice,
                plu: item.plu,
                source: 'stock_manual',
            });

            await loadStockAndPrices();
            cancelPriceEdit();
            showStatus('success', `Precio actualizado para ${item.name}`);
        } catch (error) {
            console.error('[STOCK] No se pudo guardar el precio', error);
            showStatus('error', error.message || 'No se pudo guardar el precio');
        }
    };

    return (
        <div className="stock-container animate-fade-in">

            {/* Import Status Toast */}
            {importStatus && (
                <div style={{
                    position: 'fixed',
                    top: '1.2rem',
                    right: '1.2rem',
                    zIndex: 9999,
                    maxWidth: '420px',
                    padding: '1rem 1.4rem',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.8rem',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    backgroundColor:
                        importStatus.type === 'success' ? '#14532d' :
                        importStatus.type === 'error'   ? '#7f1d1d' :
                        importStatus.type === 'warn'    ? '#713f12' :
                        '#1e3a5f',
                    border: `1px solid ${
                        importStatus.type === 'success' ? '#22c55e' :
                        importStatus.type === 'error'   ? '#ef4444' :
                        importStatus.type === 'warn'    ? '#f59e0b' :
                        '#3b82f6'
                    }`,
                    color: '#f1f5f9',
                    fontSize: '0.9rem',
                    lineHeight: 1.4,
                }}>
                    {importStatus.type === 'loading' && (
                        <div style={{
                            width: '18px', height: '18px', border: '2px solid #3b82f6',
                            borderTopColor: 'transparent', borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite', flexShrink: 0
                        }} />
                    )}
                    {importStatus.type === 'success' && <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>✅</span>}
                    {importStatus.type === 'error'   && <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>❌</span>}
                    {importStatus.type === 'warn'    && <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⚠️</span>}
                    <span>{importStatus.message}</span>
                    {importStatus.type !== 'loading' && (
                        <button onClick={() => setImportStatus(null)} style={{
                            marginLeft: 'auto', background: 'none', border: 'none',
                            color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', flexShrink: 0
                        }}>✕</button>
                    )}
                </div>
            )}

            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                
                <div style={{ display: 'flex', gap: '0.8rem' }}>
                    <button
                        className="neo-button"
                        style={{ border: '1px solid #22c55e', color: '#22c55e', background: 'transparent' }}
                        onClick={handleExportExcel}
                        title="Exportar stock visible a Excel"
                    >
                        <FileSpreadsheet size={20} />
                        Exportar Excel
                    </button>
                    <button
                        className="neo-button"
                        style={{ border: '1px solid #3b82f6', color: '#3b82f6', background: 'transparent' }}
                        onClick={handleImportFromScale}
                        disabled={isImporting}
                    >
                        <DownloadCloud size={20} />
                        {isImporting ? 'Importando...' : 'Importar de Balanza'}
                    </button>
                    <button className="neo-button" onClick={() => setIsModalOpen(true)}>
                        <Scale size={20} />
                        Ajuste Manual
                    </button>
                </div>
            </header>
            </DirectionalReveal>

            {/* Stats Cards */}
            <DirectionalReveal className="stats-grid" from="left" delay={0.1}>
                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                        <Package size={24} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-label">Total Items</div>
                        <div className="stat-value">{totalItems}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                        <TrendingUp size={24} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-label">Peso Total</div>
                        <div className="stat-value">{Number(totalWeight || 0).toFixed(2)} <span className="stat-unit">kg</span></div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                        <TrendingDown size={24} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-label">Unidades</div>
                        <div className="stat-value">{Number(totalUnits || 0).toFixed(0)} <span className="stat-unit">un</span></div>
                    </div>
                </div>
            </DirectionalReveal>

            {/* Filters */}
            <DirectionalReveal className="filters-bar" from="right" delay={0.16}>
                <div className="search-box">
                    <Search size={20} />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="type-filters">
                    {types.map(type => (
                        <button
                            key={type.id}
                            className={`type-filter-btn ${filterType === type.id ? 'active' : ''}`}
                            onClick={() => setFilterType(type.id)}
                            style={{
                                borderColor: filterType === type.id ? type.color : 'var(--color-border)',
                                backgroundColor: filterType === type.id ? `${type.color}15` : 'transparent',
                                color: filterType === type.id ? type.color : 'var(--color-text-main)'
                            }}
                        >
                            <span>{type.icon}</span>
                            <span>{type.name}</span>
                        </button>
                    ))}
                </div>
            </DirectionalReveal>

            {/* Stock List */}
            <DirectionalReveal className="stock-content" from="down" delay={0.22}>
                {filteredStock.length === 0 ? (
                    <div className="empty-state">
                        <Package size={64} style={{ opacity: 0.3 }} />
                        <h3>No hay productos en stock</h3>
                        <p>Comienza despostando animales o cargando productos pre-elaborados</p>
                    </div>
                ) : (
                    <div className="stock-groups">
                        {Object.entries(stockByType).map(([type, items]) => {
                            const typeInfo = getTypeInfo(type);
                            return (
                                <DirectionalReveal key={type} className="stock-group" from={Object.keys(stockByType).indexOf(type) % 2 === 0 ? 'left' : 'right'} delay={0.28 + (Object.keys(stockByType).indexOf(type) * 0.04)}>
                                    <div className="group-header">
                                        <span className="group-icon">{typeInfo.icon}</span>
                                        <span className="group-name">{typeInfo.name}</span>
                                        <span className="group-count">{items.length} items</span>
                                    </div>
                                    <div className="stock-items">
                                        {items.map(item => (
                                            <div key={item.id} className="stock-item">
                                                <div className="item-info">
                                                    <div className="item-name">{item.name}</div>
                                                    <div className="item-meta">
                                                        <span className="item-plu">
                                                            PLU: <strong>{String(item.plu || '').trim() || 'Sin PLU'}</strong>
                                                        </span>
                                                        <span className="item-price">
                                                            Precio: {editingPriceId === item.id ? (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        step="0.01"
                                                                        className="neo-input"
                                                                        style={{ width: '120px', marginBottom: 0, padding: '0.35rem 0.55rem' }}
                                                                        value={editingPriceValue}
                                                                        onChange={(e) => setEditingPriceValue(e.target.value)}
                                                                    />
                                                                    <button type="button" className="icon-btn save" onClick={() => savePriceEdit(item)}>
                                                                        <Save size={14} />
                                                                    </button>
                                                                    <button type="button" className="icon-btn cancel" onClick={cancelPriceEdit}>
                                                                        <X size={14} />
                                                                    </button>
                                                                </span>
                                                            ) : (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <strong>{Number(item.price || 0) > 0 ? `$${Number(item.price || 0).toLocaleString('es-AR')}` : 'Sin precio'}</strong>
                                                                    <button type="button" className="icon-btn" onClick={() => startPriceEdit(item)}>
                                                                        <Pencil size={14} />
                                                                    </button>
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="item-date">
                                                            {new Date(item.updated_at).toLocaleDateString('es-AR', {
                                                                day: '2-digit',
                                                                month: '2-digit',
                                                                year: 'numeric',
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="item-quantity">
                                                    {Number(item.quantity || 0) < 0 && (
                                                        <span style={{
                                                            fontSize: '0.7rem',
                                                            fontWeight: '700',
                                                            color: '#ef4444',
                                                            background: 'rgba(239,68,68,0.12)',
                                                            border: '1px solid rgba(239,68,68,0.35)',
                                                            borderRadius: '4px',
                                                            padding: '1px 5px',
                                                            marginBottom: '2px',
                                                            display: 'block',
                                                        }}>
                                                            ⚠️ Stock negativo
                                                        </span>
                                                    )}
                                                    <span className="quantity-value" style={Number(item.quantity || 0) < 0 ? { color: '#ef4444' } : {}}>
                                                        {Number(item.quantity || 0).toFixed(item.unit === 'kg' ? 3 : 0)}
                                                    </span>
                                                    <span className="quantity-unit">{item.unit === 'kg' ? 'kg' : 'un'}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </DirectionalReveal>
                            );
                        })}
                    </div>
                )}
            </DirectionalReveal>

            {/* MODAL ADJUSTMENT */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" style={{ maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Ajuste de Inventario</h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleAdjustment}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Producto</label>
                                <select
                                    className="neo-input"
                                    required
                                    value={adjustment.productId}
                                    onChange={e => setAdjustment({ ...adjustment, productId: e.target.value })}
                                >
                                    <option value="">Seleccionar producto...</option>
                                    {productsForAdjustment.map(p => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Cantidad / Kg</label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        required
                                        className="neo-input"
                                        placeholder="0.00"
                                        value={adjustment.quantity}
                                        onChange={e => setAdjustment({ ...adjustment, quantity: e.target.value })}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem' }}>Acción</label>
                                    <select
                                        className="neo-input"
                                        value={adjustment.type}
                                        onChange={e => setAdjustment({ ...adjustment, type: e.target.value })}
                                    >
                                        <option value="add">➕ Sumar Stock</option>
                                        <option value="subtract">➖ Restar Stock</option>
                                    </select>
                                </div>
                            </div>

                            <button type="submit" className="neo-button full-width">
                                <Save size={18} /> Guardar Ajuste
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal Diagnóstico Balanza ─────────────────────────────────── */}
            {showDiag && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                    zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                }}>
                    <div style={{
                        background: '#0f172a', border: '1px solid #334155', borderRadius: '12px',
                        width: '100%', maxWidth: '750px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
                    }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.2rem', borderBottom: '1px solid #1e293b' }}>
                            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
                                ⚡ Diagnóstico Serial — Balanza Systel Cuora
                            </span>
                            <button
                                onClick={() => setShowDiag(false)}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
                            >✕</button>
                        </div>

                        {/* Log body */}
                        <div style={{
                            flex: 1, overflowY: 'auto', padding: '0.8rem 1rem',
                            fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.6,
                        }}>
                            {diagLogs.length === 0 && (
                                <div style={{ color: '#64748b', textAlign: 'center', marginTop: '2rem' }}>Sin datos aún...</div>
                            )}
                            {diagLogs.map((log, i) => (
                                <div key={i} style={{
                                    display: 'flex', gap: '0.6rem', padding: '0.15rem 0',
                                    color: log.type === 'raw'   ? '#94a3b8' :
                                           log.type === 'ok'    ? '#4ade80' :
                                           log.type === 'warn'  ? '#fbbf24' :
                                           log.type === 'error' ? '#f87171' : '#7dd3fc'
                                }}>
                                    <span style={{ color: '#475569', flexShrink: 0 }}>{log.ts}</span>
                                    <span style={{ color: '#475569', flexShrink: 0 }}>
                                        {log.type === 'raw' ? '📡' : log.type === 'ok' ? '✔' : log.type === 'warn' ? '⚠' : log.type === 'error' ? '✘' : 'ℹ'}
                                    </span>
                                    <span style={{ wordBreak: 'break-all' }}>{log.msg}</span>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '0.8rem 1.2rem', borderTop: '1px solid #1e293b', display: 'flex', gap: '0.8rem' }}>
                            <button
                                onClick={() => setDiagLogs([])}
                                style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem' }}
                            >Limpiar</button>
                            <button
                                onClick={() => setShowDiag(false)}
                                style={{ marginLeft: 'auto', background: '#1e40af', border: 'none', color: '#fff', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.8rem' }}
                            >Cerrar</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default Stock;
