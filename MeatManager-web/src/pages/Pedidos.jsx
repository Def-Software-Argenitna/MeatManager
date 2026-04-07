import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Plus, Search, MessageCircle, Clock, CheckCircle2, XCircle, ClipboardPaste, Printer, Truck, MapPin, Tag } from 'lucide-react';
import { BRAND_CONFIG } from '../brandConfig';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { buildOrderAddress, geocodeAddress, searchAddressSuggestions } from '../utils/geocoding';
import './Pedidos.css';

const getLocalDateStr = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const emptyPedido = () => ({
    customer_id: '',
    total: '',
    date: getLocalDateStr(),
    delivery_type: 'pickup',
    street: '',
    city: '',
    zip_code: '',
    address: '',
    phone: '',
    payment_status: 'pending_driver_collection',
    payment_method: '',
    paid: false,
    amount_due: '',
    items: [],
});

const emptyDraft = () => ({ stockKey: '', quantity: '' });
const slugify = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const qtyStep = (unit) => (unit === 'kg' ? '0.001' : '1');
const qtySuffix = (unit) => (unit === 'kg' ? 'kg' : 'un');
const qtyLabel = (unit) => (unit === 'kg' ? 'Kilos' : 'Cantidad');
const cleanValue = (value) => String(value || '').trim();
const normalizeProductKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const isCompanyClient = (client) => cleanValue(client?.client_type) === 'company';
const getClientContactName = (client) => [cleanValue(client?.contact_first_name), cleanValue(client?.contact_last_name)].filter(Boolean).join(' ');
const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const parseOrderItems = (pedido) => {
    if (Array.isArray(pedido?.items)) return pedido.items;
    if (typeof pedido?.items === 'string') {
        try {
            const parsed = JSON.parse(pedido.items);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            return String(pedido.items || '')
                .split('\n')
                .map((line, index) => ({ id: `legacy-${pedido?.id || 'order'}-${index}`, label: line.trim() }))
                .filter((item) => item.label);
        }
    }
    return [];
};

const formatOrderItems = (pedido) => parseOrderItems(pedido).map((item) => item.label || '').filter(Boolean).join('\n');

const Pedidos = () => {
    const navigate = useNavigate();
    const [filter, setFilter] = useState('pending');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [newPedido, setNewPedido] = useState(emptyPedido);
    const [itemDraft, setItemDraft] = useState(emptyDraft);
    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [selectedSuggestion, setSelectedSuggestion] = useState(null);
    const [clients, setClients] = useState([]);
    const [prices, setPrices] = useState([]);
    const [pedidos, setPedidos] = useState([]);
    const [stockRows, setStockRows] = useState([]);

    const sortOrders = (rows) => [...(rows || [])].sort((a, b) => {
        const left = new Date(b?.created_at || b?.date || 0).getTime();
        const right = new Date(a?.created_at || a?.date || 0).getTime();
        if (left !== right) return left - right;
        return Number(b?.id || 0) - Number(a?.id || 0);
    });
    useEffect(() => {
        let cancelled = false;

        const loadRemoteData = async () => {
            try {
                const [clientRows, priceRows, orderRows, stockTableRows] = await Promise.all([
                    fetchTable('clients', { limit: 1000, orderBy: 'id', direction: 'ASC' }),
                    fetchTable('prices', { limit: 5000, orderBy: 'id', direction: 'ASC' }),
                    fetchTable('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
                    fetchTable('stock', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
                ]);
                if (!cancelled) {
                    setClients(Array.isArray(clientRows) ? clientRows : []);
                    setPrices(Array.isArray(priceRows) ? priceRows : []);
                    setPedidos(sortOrders(Array.isArray(orderRows) ? orderRows : []));
                    setStockRows(Array.isArray(stockTableRows) ? stockTableRows : []);
                }
            } catch (error) {
                console.error('[PEDIDOS] No se pudieron cargar datos desde la API', error);
                if (!cancelled) {
                    setClients([]);
                    setPrices([]);
                    setPedidos([]);
                    setStockRows([]);
                }
            }
        };

        loadRemoteData();
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshPedidosData = async () => {
        const [orderRows, stockTableRows, priceRows] = await Promise.all([
            fetchTable('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
            fetchTable('stock', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
            fetchTable('prices', { limit: 5000, orderBy: 'id', direction: 'ASC' }),
        ]);
        setPedidos(sortOrders(Array.isArray(orderRows) ? orderRows : []));
        setStockRows(Array.isArray(stockTableRows) ? stockTableRows : []);
        setPrices(Array.isArray(priceRows) ? priceRows : []);
    };

    const clientOptions = useMemo(() => (
        (clients || []).map((client) => ({
            id: client.id,
            label: isCompanyClient(client)
                ? (client.company_name || client.name || '')
                : ([client.first_name, client.last_name].filter(Boolean).join(' ').trim() || client.name || ''),
            client_type: client.client_type || 'person',
            company_name: client.company_name || '',
            contact_name: getClientContactName(client),
            street: client.street || '',
            city: client.city || '',
            zip_code: client.zip_code || '',
            address: client.address || '',
            phone: client.phone || client.mobile || client.whatsapp || '',
        })).filter((client) => client.label).sort((a, b) => a.label.localeCompare(b.label))
    ), [clients]);

    const stockOptions = useMemo(() => {
        if (!stockRows?.length) return [];
        const grouped = new Map();
        for (const row of stockRows) {
            const unit = row.unit || 'kg';
            const key = `${row.name}__${row.type}__${unit}`;
            const current = grouped.get(key) || { key, name: row.name, type: row.type || 'otros', unit, quantity: 0 };
            current.quantity += Number(row.quantity) || 0;
            grouped.set(key, current);
        }
        return Array.from(grouped.values())
            .filter((item) => item.quantity > 0.0001)
            .map((item) => {
                const normalizedName = normalizeProductKey(item.name);
                const normalizedType = slugify(item.type);
                const productId = `${normalizedName}-${normalizedType}`;
                const priceMatch = (prices || []).find((price) => {
                    const rawProductId = normalizeProductKey(price.product_id);
                    return (
                        rawProductId === productId ||
                        rawProductId === normalizedName ||
                        rawProductId.startsWith(`${normalizedName}-`)
                    );
                });
                return { ...item, productId, price: Number(priceMatch?.price) || 0 };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [stockRows, prices]);

    const selectedStockItem = useMemo(() => stockOptions.find((item) => item.key === itemDraft.stockKey) || null, [stockOptions, itemDraft.stockKey]);
    const selectedClient = useMemo(() => clientOptions.find((client) => String(client.id) === String(newPedido.customer_id)) || null, [clientOptions, newPedido.customer_id]);
    const computedTotal = useMemo(() => newPedido.items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0), [newPedido.items]);
    const deliveryAddress = useMemo(() => [newPedido.street, newPedido.city, newPedido.zip_code].map((value) => String(value || '').trim()).filter(Boolean).join(', '), [newPedido.street, newPedido.city, newPedido.zip_code]);

    useEffect(() => {
        if (newPedido.delivery_type !== 'delivery') {
            setAddressSuggestions([]);
            return;
        }
        const streetQuery = [newPedido.street].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
        const localityReady = Boolean(String(newPedido.city || '').trim() || String(newPedido.zip_code || '').trim());
        const query = [newPedido.street, newPedido.city, newPedido.zip_code].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
        if (streetQuery.length < 5 || !localityReady || query.length < 5) {
            setAddressSuggestions([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            setLoadingSuggestions(true);
            try {
                const suggestions = await searchAddressSuggestions(query);
                if (!cancelled) setAddressSuggestions(suggestions);
            } catch {
                if (!cancelled) setAddressSuggestions([]);
            } finally {
                if (!cancelled) setLoadingSuggestions(false);
            }
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [newPedido.delivery_type, newPedido.street, newPedido.city, newPedido.zip_code]);

    const filteredPedidos = pedidos?.filter((pedido) => {
        const term = searchTerm.trim().toLowerCase();
        const matchesSearch = !term || String(pedido.customer_name || '').toLowerCase().includes(term) || String(pedido.id).includes(term);
        const matchesFilter = filter === 'all' || pedido.status === filter;
        return matchesSearch && matchesFilter;
    });

    const updateStatus = async (id, newStatus) => {
        const pedido = pedidos.find((item) => Number(item.id) === Number(id));
        if (!pedido) return;
        await saveTableRecord('pedidos', 'update', {
            ...pedido,
            status: newStatus,
            status_updated_at: new Date().toISOString(),
        }, id);
        await refreshPedidosData();
    };

    const resetModal = () => {
        setIsModalOpen(false);
        setNewPedido(emptyPedido());
        setItemDraft(emptyDraft());
        setAddressSuggestions([]);
        setSelectedSuggestion(null);
    };

    const goToClients = () => {
        resetModal();
        navigate('/clientes');
    };

    const handleSelectClient = (clientId) => {
        const client = clientOptions.find((entry) => String(entry.id) === String(clientId));
        if (!client) {
            setNewPedido((prev) => ({ ...prev, customer_id: '' }));
            return;
        }
        setNewPedido((prev) => ({
            ...prev,
            customer_id: client.id,
            street: client.street || prev.street,
            city: client.city || prev.city,
            zip_code: client.zip_code || prev.zip_code,
            address: client.address || prev.address,
            phone: client.phone || prev.phone,
        }));
    };

    const addLineItem = () => {
        if (!selectedStockItem) return;
        const quantity = Number(itemDraft.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        if (quantity > Number(selectedStockItem.quantity)) {
            alert('La cantidad supera el stock disponible');
            return;
        }
        const subtotal = selectedStockItem.price > 0 ? quantity * selectedStockItem.price : 0;
        const nextItem = {
            id: `${selectedStockItem.key}-${Date.now()}`,
            product_name: selectedStockItem.name,
            category: selectedStockItem.type,
            unit: selectedStockItem.unit,
            quantity,
            price: selectedStockItem.price,
            subtotal,
            label: `${selectedStockItem.name} · ${toNumber(quantity).toFixed(selectedStockItem.unit === 'kg' ? 3 : 0)} ${qtySuffix(selectedStockItem.unit)}`,
        };
        setNewPedido((prev) => ({ ...prev, items: [...prev.items, nextItem], total: prev.total || String(Math.round((prev.items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0)) + subtotal)) }));
        setItemDraft(emptyDraft());
    };

    const removeLineItem = (itemId) => {
        setNewPedido((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== itemId) }));
    };

    const selectAddressSuggestion = (suggestion) => {
        setSelectedSuggestion(suggestion);
        setNewPedido((prev) => ({
            ...prev,
            street: suggestion.street || prev.street,
            city: suggestion.city || prev.city,
            zip_code: suggestion.zip_code || prev.zip_code,
            address: suggestion.label,
        }));
        setAddressSuggestions([]);
    };

    const handleSaveOrder = async () => {
        if (!selectedClient || !newPedido.items.length) return;
        const address = newPedido.delivery_type === 'delivery' ? (newPedido.address || deliveryAddress) : '';
        const total = Number(newPedido.total) || Math.round(computedTotal) || 0;
        const paymentStatus = newPedido.payment_status || 'pending_driver_collection';
        const paid = paymentStatus === 'paid';
        const amountDue = paid ? 0 : (Number(newPedido.amount_due) || total);
        let geocoded = null;
        if (newPedido.delivery_type === 'delivery' && address) {
            geocoded = selectedSuggestion ? {
                latitude: selectedSuggestion.latitude,
                longitude: selectedSuggestion.longitude,
                geocoded_at: new Date().toISOString(),
            } : null;
            if (!geocoded) {
                try {
                    geocoded = await geocodeAddress(buildOrderAddress({ address, city: newPedido.city, zip_code: newPedido.zip_code }));
                } catch {
                    geocoded = null;
                }
            }
        }

        await saveTableRecord('pedidos', 'insert', {
            customer_id: newPedido.customer_id ? Number(newPedido.customer_id) : null,
            customer_name: selectedClient.label,
            items: newPedido.items,
            items_text: newPedido.items.map((item) => item.label).join('\n'),
            total,
            status: 'pending',
            delivery_date: newPedido.date,
            address,
            city: newPedido.city || '',
            zip_code: newPedido.zip_code || '',
            delivery_type: newPedido.delivery_type,
            payment_status: paymentStatus,
            payment_method: paid ? (newPedido.payment_method || 'Cobrado previamente') : null,
            paid,
            amount_due: amountDue,
            latitude: geocoded?.latitude ?? null,
            longitude: geocoded?.longitude ?? null,
            geocoded_at: geocoded?.geocoded_at ?? null,
            created_at: new Date().toISOString(),
            source: 'manual',
        });
        await refreshPedidosData();
        resetModal();
    };

    const importFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            let parsed = { name: 'WhatsApp', items: '', total: 0 };
            if (text.includes('NUEVO PEDIDO')) {
                const lines = text.split('\n');
                const clientLine = lines.find((line) => line.includes('👤 CLIENTE:'));
                const addressLine = lines.find((line) => line.includes('📍 DIRECCIÓN:'));
                const deliveryLine = lines.find((line) => line.includes('🚚 ENTREGA:'));
                const totalLine = lines.find((line) => line.includes('*TOTAL:'));
                if (clientLine) parsed.name = clientLine.split(':')[1].trim();
                if (addressLine) parsed.address = addressLine.split(':')[1].trim();
                if (deliveryLine) parsed.delivery_type = deliveryLine.toLowerCase().includes('envío') ? 'delivery' : 'pickup';
                if (totalLine) {
                    const match = totalLine.match(/\$([\d.]+)/);
                    if (match) parsed.total = parseInt(match[1].replace(/\./g, ''), 10);
                }
                parsed.items = lines.filter((line) => line.trim().startsWith('-')).map((line) => line.replace('-', '').trim()).join('\n');
            }
            if (parsed.items) {
                let geocoded = null;
                if (parsed.delivery_type === 'delivery' && parsed.address) {
                    try {
                        geocoded = await geocodeAddress(buildOrderAddress(parsed));
                    } catch {
                        geocoded = null;
                    }
                }
                await saveTableRecord('pedidos', 'insert', {
                    customer_name: parsed.name,
                    items: parsed.items,
                    items_text: parsed.items,
                    total: parsed.total,
                    address: parsed.address || '',
                    delivery_type: parsed.delivery_type || 'pickup',
                    latitude: geocoded?.latitude ?? null,
                    longitude: geocoded?.longitude ?? null,
                    geocoded_at: geocoded?.geocoded_at ?? null,
                    status: 'pending',
                    delivery_date: getLocalDateStr(),
                    created_at: new Date().toISOString(),
                    source: 'whatsapp',
                });
                await refreshPedidosData();
                alert('Pedido importado con éxito!');
            } else {
                alert('No se detectó un formato de pedido válido en el portapapeles.');
            }
        } catch (error) {
            console.error('Error al importar:', error);
        }
    };

    const getStatusColor = (status) => ({ pending: '#f59e0b', ready: '#3b82f6', delivered: '#22c55e', cancelled: '#ef4444' }[status] || 'var(--color-text-muted)');

    const printTicket = (pedido) => {
        const printWindow = window.open('', '_blank', 'width=300,height=600');
        const dateStr = new Date(pedido.created_at).toLocaleString();
        printWindow.document.write(`<html><head><title>Ticket #${pedido.id}</title></head><body style="font-family:Courier New;padding:10px"><h2>${BRAND_CONFIG.brand_name?.toUpperCase() || 'MEATMANAGER'}</h2><p>FECHA: ${dateStr}</p><p>ORDEN: #${pedido.id}</p><p>CLIENTE: ${pedido.customer_name}</p>${pedido.address ? `<p>ENTREGA: ${pedido.address}</p>` : ''}<pre>${formatOrderItems(pedido)}</pre><h3>TOTAL: $${Number(pedido.total || 0).toLocaleString()}</h3></body></html>`);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    };

    const printLabel = (pedido) => {
        const printWindow = window.open('', '_blank', 'width=300,height=400');
        printWindow.document.write(`<html><head><title>Etiqueta #${pedido.id}</title></head><body style="font-family:Arial;padding:5px;text-align:center"><div>ORDEN #${pedido.id}</div><h2>${pedido.customer_name.toUpperCase()}</h2><div style="text-align:left">${formatOrderItems(pedido).split('\n').map((item) => `• ${item}`).join('<br/>')}</div><h1>TOTAL: $${Number(pedido.total || 0).toLocaleString()}</h1></body></html>`);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
    };

    return (
        <div className="pedidos-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Pedidos y Reservas</h1>
                    <p className="page-description">Gestioná pedidos manuales y de WhatsApp con stock real y dirección asistida</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="neo-button" style={{ background: '#25D366', color: 'white', border: 'none' }} onClick={importFromClipboard}>
                        <ClipboardPaste size={20} /> Importar de WhatsApp
                    </button>
                    <button className="neo-button" onClick={() => setIsModalOpen(true)}>
                        <Plus size={20} /> Nuevo Pedido
                    </button>
                </div>
            </header>

            <div className="pedidos-filters neo-card">
                <div className="search-bar">
                    <Search size={18} />
                    <input type="text" placeholder="Buscar por cliente o N° de pedido..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="filter-tabs">
                    <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pendientes</button>
                    <button className={filter === 'ready' ? 'active' : ''} onClick={() => setFilter('ready')}>Listos</button>
                    <button className={filter === 'delivered' ? 'active' : ''} onClick={() => setFilter('delivered')}>Entregados</button>
                    <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
                </div>
            </div>

            <div className="pedidos-grid">
                {filteredPedidos?.length === 0 && <div className="empty-state"><ShoppingBag size={48} /><p>No se encontraron pedidos.</p></div>}
                {filteredPedidos?.map((pedido) => (
                    <div key={pedido.id} className="pedido-card neo-card" style={{ borderLeftColor: getStatusColor(pedido.status) }}>
                        <div className="pedido-header">
                            <div className="customer-info">
                                <span className="status-dot" style={{ backgroundColor: getStatusColor(pedido.status) }}></span>
                                <h3>{pedido.customer_name}</h3>
                                {pedido.source === 'whatsapp' && <MessageCircle size={16} color="#25D366" />}
                            </div>
                            <span className="order-id">#{pedido.id}</span>
                        </div>
                        <div className="pedido-body">
                            <p className="items-list">{formatOrderItems(pedido)}</p>
                            <div style={{ marginTop: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
                                <div className="delivery-info"><Clock size={14} /><span>Entrega: {pedido.delivery_date}</span></div>
                                {pedido.address && <div className="delivery-info" style={{ color: 'var(--color-primary)', marginTop: '0.4rem' }}><MapPin size={14} /><span style={{ fontSize: '0.85rem' }}>{pedido.address}</span></div>}
                                <div className="delivery-info" style={{ marginTop: '0.4rem', opacity: 0.8 }}>{pedido.delivery_type === 'delivery' ? <Truck size={14} /> : <ShoppingBag size={14} />}<span style={{ fontSize: '0.8rem', fontWeight: '500' }}>{pedido.delivery_type === 'delivery' ? 'ENVÍO A DOMICILIO' : 'RETIRO LOCAL'}</span></div>
                                {pedido.delivery_type === 'delivery' && (
                                    <div className="delivery-info" style={{ marginTop: '0.4rem', opacity: 0.85 }}>
                                        <Tag size={14} />
                                        <span style={{ fontSize: '0.8rem', fontWeight: '500' }}>
                                            {pedido.paid
                                                ? `COBRADO${pedido.payment_method ? ` · ${pedido.payment_method}` : ''}`
                                                : `COBRA REPARTIDOR${pedido.amount_due ? ` · $${Number(pedido.amount_due).toLocaleString()}` : ''}`}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="pedido-footer">
                            <div className="total-amount">${toNumber(pedido.total).toLocaleString()}</div>
                            <div className="action-buttons">
                                {pedido.status === 'pending' && <button className="icon-btn ready" title="Marcar como Listo" onClick={() => updateStatus(pedido.id, 'ready')}><Clock size={18} /></button>}
                                {pedido.status === 'ready' && <button className="icon-btn deliver" title="Entregar" onClick={() => updateStatus(pedido.id, 'delivered')}><CheckCircle2 size={18} /></button>}
                                {pedido.status !== 'cancelled' && pedido.status !== 'delivered' && <button className="icon-btn cancel" title="Cancelar" onClick={() => updateStatus(pedido.id, 'cancelled')}><XCircle size={18} /></button>}
                                <button className="icon-btn" style={{ background: '#f1f5f9', color: '#64748b' }} title="Imprimir Comanda" onClick={() => printTicket(pedido)}><Printer size={18} /></button>
                                <button className="icon-btn" style={{ background: '#fdf2f8', color: '#db2777' }} title="Imprimir Etiqueta" onClick={() => printLabel(pedido)}><Tag size={18} /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && (
                <div className="modal-overlay" onClick={resetModal}>
                    <div className="modal-content neo-card pedidos-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Nuevo Pedido Manual</h2>
                        <div className="modal-form">
                            <div className="pedido-form-grid">
                                <div className="field-group">
                                    <label>Cliente existente</label>
                                    <select className="neo-input" value={newPedido.customer_id} onChange={(e) => handleSelectClient(e.target.value)}>
                                        <option value="">Seleccionar cliente</option>
                                        {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
                                    </select>
                                    <button type="button" className="pedido-inline-link" onClick={goToClients}>
                                        Si no esta cargado, crear cliente
                                    </button>
                                </div>
                                <div className="field-group">
                                    <label>Cliente seleccionado</label>
                                    <div className="neo-input pedido-selected-client-display">
                                        {selectedClient ? (
                                            <div className="pedido-selected-client-meta">
                                                <strong>{selectedClient.label}</strong>
                                                <span>{selectedClient.client_type === 'company' ? 'Empresa' : 'Persona'}</span>
                                                {selectedClient.client_type === 'company' && selectedClient.contact_name && (
                                                    <span>Contacto: {selectedClient.contact_name}</span>
                                                )}
                                            </div>
                                        ) : 'Primero seleccioná un cliente cargado'}
                                    </div>
                                </div>
                                <div className="field-group">
                                    <label>Teléfono</label>
                                    <input type="text" className="neo-input" placeholder="Teléfono de contacto" value={newPedido.phone} onChange={(e) => setNewPedido((prev) => ({ ...prev, phone: e.target.value }))} />
                                </div>
                            </div>

                            <div className="pedido-line-builder neo-card">
                                <div className="pedido-line-builder__header"><span>Agregar items desde stock</span></div>
                                <div className="pedido-line-builder__grid">
                                    <div className="field-group">
                                        <label>Producto en stock</label>
                                        <select className="neo-input" value={itemDraft.stockKey} onChange={(e) => setItemDraft((prev) => ({ ...prev, stockKey: e.target.value }))}>
                                            <option value="">Seleccionar producto</option>
                                            {stockOptions.map((item) => <option key={item.key} value={item.key}>{item.name} · {toNumber(item.quantity).toFixed(item.unit === 'kg' ? 3 : 0)} {qtySuffix(item.unit)} disponibles</option>)}
                                        </select>
                                    </div>
                                    <div className="field-group">
                                        <label>{qtyLabel(selectedStockItem?.unit || 'kg')}</label>
                                        <input type="number" className="neo-input" min="0" step={qtyStep(selectedStockItem?.unit || 'kg')} placeholder={selectedStockItem?.unit === 'kg' ? '0.000' : '0'} value={itemDraft.quantity} onChange={(e) => setItemDraft((prev) => ({ ...prev, quantity: e.target.value }))} />
                                    </div>
                                    <button className="neo-button pedido-line-builder__add" type="button" onClick={addLineItem}><Plus size={18} /> Agregar</button>
                                </div>
                                {selectedStockItem && <div className="pedido-line-builder__meta"><span>{selectedStockItem.type.toUpperCase()}</span><span>Disponible: {toNumber(selectedStockItem.quantity).toFixed(selectedStockItem.unit === 'kg' ? 3 : 0)} {qtySuffix(selectedStockItem.unit)}</span>{toNumber(selectedStockItem.price) > 0 && <span>Precio sugerido: ${toNumber(selectedStockItem.price).toLocaleString()}</span>}</div>}
                            </div>

                            <div className="pedido-selected-items neo-card">
                                <div className="pedido-selected-items__header"><span>Items del pedido</span><strong>{newPedido.items.length}</strong></div>
                                {newPedido.items.length === 0 ? <p className="pedido-selected-items__empty">Todavía no agregaste productos del stock.</p> : (
                                    <div className="pedido-selected-items__list">
                                        {newPedido.items.map((item) => (
                                            <div key={item.id} className="pedido-selected-item">
                                                <div><strong>{item.product_name}</strong><p>{toNumber(item.quantity).toFixed(item.unit === 'kg' ? 3 : 0)} {qtySuffix(item.unit)} · {item.category}</p></div>
                                                <div className="pedido-selected-item__actions"><span>{toNumber(item.subtotal) > 0 ? `$${Math.round(toNumber(item.subtotal)).toLocaleString()}` : 'Sin precio'}</span><button type="button" className="icon-btn cancel" onClick={() => removeLineItem(item.id)}><XCircle size={16} /></button></div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="pedido-form-grid">
                                <div className="field-group">
                                    <label>Monto estimado</label>
                                    <input type="number" className="neo-input" placeholder="Monto estimado" value={newPedido.total} onChange={(e) => setNewPedido((prev) => ({ ...prev, total: e.target.value }))} />
                                </div>
                                <div className="field-group">
                                    <label>Fecha de entrega</label>
                                    <input type="date" className="neo-input" value={newPedido.date} onChange={(e) => setNewPedido((prev) => ({ ...prev, date: e.target.value }))} />
                                </div>
                            </div>

                            <div className="field-group">
                                <label>Modalidad</label>
                                <select className="neo-input" value={newPedido.delivery_type} onChange={(e) => setNewPedido((prev) => ({ ...prev, delivery_type: e.target.value }))}>
                                    <option value="pickup">Retiro en local</option>
                                    <option value="delivery">Envío a domicilio</option>
                                </select>
                            </div>

                            {newPedido.delivery_type === 'delivery' && (
                                <div className="delivery-address-card neo-card animate-fade-in">
                                    <div className="pedido-form-grid pedido-form-grid--address">
                                        <div className="field-group field-group--full">
                                            <label>Calle y altura</label>
                                            <input type="text" className="neo-input" placeholder="Ej: Av. San Martín 1234" value={newPedido.street} onChange={(e) => { setSelectedSuggestion(null); setNewPedido((prev) => ({ ...prev, street: e.target.value })); }} />
                                            {(loadingSuggestions || addressSuggestions.length > 0) && (
                                                <div className="address-suggestions">
                                                    {loadingSuggestions && <div className="address-suggestion muted">Buscando direcciones...</div>}
                                                    {!loadingSuggestions && addressSuggestions.map((suggestion) => (
                                                        <button key={`${suggestion.label}-${suggestion.latitude}`} type="button" className="address-suggestion" onClick={() => selectAddressSuggestion(suggestion)}>
                                                            <strong>{suggestion.street || suggestion.label}</strong>
                                                            <span>{suggestion.city} {suggestion.zip_code}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="field-group">
                                            <label>Localidad</label>
                                            <input type="text" className="neo-input" placeholder="Localidad" value={newPedido.city} onChange={(e) => { setSelectedSuggestion(null); setNewPedido((prev) => ({ ...prev, city: e.target.value })); }} />
                                        </div>
                                        <div className="field-group">
                                            <label>Código postal</label>
                                            <input type="text" className="neo-input" placeholder="CP" value={newPedido.zip_code} onChange={(e) => { setSelectedSuggestion(null); setNewPedido((prev) => ({ ...prev, zip_code: e.target.value })); }} />
                                        </div>
                                    </div>
                                    {deliveryAddress && <div className="delivery-address-card__preview"><span>Dirección compuesta:</span><strong>{newPedido.address || deliveryAddress}</strong></div>}
                                    <div className="pedido-form-grid" style={{ marginTop: '1rem' }}>
                                        <div className="field-group">
                                            <label>Condición de cobro</label>
                                            <select
                                                className="neo-input"
                                                value={newPedido.payment_status}
                                                onChange={(e) => setNewPedido((prev) => ({
                                                    ...prev,
                                                    payment_status: e.target.value,
                                                    paid: e.target.value === 'paid',
                                                    payment_method: e.target.value === 'paid' ? (prev.payment_method || 'Cobrado previamente') : '',
                                                    amount_due: e.target.value === 'paid' ? '0' : (prev.amount_due || String(Number(prev.total) || Math.round(computedTotal) || 0)),
                                                }))}
                                            >
                                                <option value="pending_driver_collection">Lo cobra el repartidor</option>
                                                <option value="paid">Ya está cobrado</option>
                                            </select>
                                        </div>
                                        <div className="field-group">
                                            <label>Monto a cobrar</label>
                                            <input
                                                type="number"
                                                className="neo-input"
                                                min="0"
                                                disabled={newPedido.payment_status === 'paid'}
                                                value={newPedido.payment_status === 'paid' ? '0' : newPedido.amount_due}
                                                onChange={(e) => setNewPedido((prev) => ({ ...prev, amount_due: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <button className="neo-button full-width" style={{ marginTop: '1rem' }} onClick={handleSaveOrder}>Guardar Pedido</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Pedidos;
