import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
    ShoppingBag,
    Plus,
    Search,
    MessageCircle,
    Clock,
    CheckCircle2,
    XCircle,
    ExternalLink,
    ClipboardPaste,
    User,
    Calendar,
    ChevronRight,
    Printer,
    Truck,
    MapPin,
    Tag
} from 'lucide-react';
import { BRAND_CONFIG } from '../brandConfig';
import { buildOrderAddress, geocodeAddress } from '../utils/geocoding';
import './Pedidos.css';

const Pedidos = () => {
    const getLocalDateStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; };
    const [filter, setFilter] = useState('pending');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [newPedido, setNewPedido] = useState({
        name: '',
        items: '',
        total: '',
        date: getLocalDateStr(),
        address: '',
        delivery_type: 'pickup'
    });

    const pedidos = useLiveQuery(
        () => db.pedidos?.orderBy('created_at').reverse().toArray()
    );

    const filteredPedidos = pedidos?.filter(p => {
        const term = searchTerm.trim().toLowerCase();
        const matchesSearch = !term ||
            p.customer_name.toLowerCase().includes(term) ||
            String(p.id).includes(term);
        const matchesFilter = filter === 'all' || p.status === filter;
        return matchesSearch && matchesFilter;
    });

    const updateStatus = async (id, newStatus) => {
        await db.pedidos.update(id, { status: newStatus });
    };

    const handleSaveOrder = async () => {
        if (!newPedido.name || !newPedido.items) return;
        let geocoded = null;
        if (newPedido.delivery_type === 'delivery' && newPedido.address) {
            try {
                geocoded = await geocodeAddress(buildOrderAddress(newPedido));
            } catch (error) {
                console.warn('[PEDIDOS] No se pudo geocodificar el pedido manual', error?.message || error);
            }
        }
        await db.pedidos.add({
            customer_name: newPedido.name,
            items: newPedido.items,
            total: parseInt(newPedido.total) || 0,
            status: 'pending',
            delivery_date: newPedido.date,
            address: newPedido.address,
            delivery_type: newPedido.delivery_type,
            latitude: geocoded?.latitude ?? null,
            longitude: geocoded?.longitude ?? null,
            geocoded_at: geocoded?.geocoded_at ?? null,
            created_at: new Date(),
            source: 'manual'
        });
        setIsModalOpen(false);
        setNewPedido({
            name: '',
            items: '',
            total: '',
            date: getLocalDateStr(),
            address: '',
            delivery_type: 'pickup'
        });
    };

    const importFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            let parsed = { name: 'WhatsApp', items: '', total: 0 };

            if (text.includes('NUEVO PEDIDO')) {
                const lines = text.split('\n');
                const clientLine = lines.find(l => l.includes('👤 CLIENTE:'));
                const addressLine = lines.find(l => l.includes('📍 DIRECCIÓN:'));
                const deliveryLine = lines.find(l => l.includes('🚚 ENTREGA:'));
                const totalLine = lines.find(l => l.includes('*TOTAL:'));

                if (clientLine) parsed.name = clientLine.split(':')[1].trim();
                if (addressLine) parsed.address = addressLine.split(':')[1].trim();
                if (deliveryLine) parsed.delivery_type = deliveryLine.toLowerCase().includes('envío') ? 'delivery' : 'pickup';

                if (totalLine) {
                    const match = totalLine.match(/\$([\d.]+)/);
                    if (match) parsed.total = parseInt(match[1].replace(/\./g, ''));
                }

                const itemsList = lines.filter(l => l.trim().startsWith('-'));
                parsed.items = itemsList.map(l => l.replace('-', '').trim()).join('\n');
            }
            else if (text.includes('ORDEN:')) {
                const namePart = text.match(/ORDEN:\s*([^|]*)/);
                const itemsPart = text.match(/ITEMS:\s*([^|]*)/);
                const totalPart = text.match(/TOTAL:\s*(\d+)/);

                if (namePart) parsed.name = namePart[1].trim();
                if (itemsPart) parsed.items = itemsPart[1].trim();
                if (totalPart) parsed.total = parseInt(totalPart[1]);
            }

            if (parsed.items) {
                let geocoded = null;
                if (parsed.delivery_type === 'delivery' && parsed.address) {
                    try {
                        geocoded = await geocodeAddress(buildOrderAddress(parsed));
                    } catch (error) {
                        console.warn('[PEDIDOS] No se pudo geocodificar el pedido importado', error?.message || error);
                    }
                }
                await db.pedidos.add({
                    customer_name: parsed.name,
                    items: parsed.items,
                    total: parsed.total,
                    address: parsed.address || '',
                    delivery_type: parsed.delivery_type || 'pickup',
                    latitude: geocoded?.latitude ?? null,
                    longitude: geocoded?.longitude ?? null,
                    geocoded_at: geocoded?.geocoded_at ?? null,
                    status: 'pending',
                    delivery_date: getLocalDateStr(),
                    created_at: new Date(),
                    source: 'whatsapp'
                });
                alert('Pedido importado con éxito!');
            } else {
                alert('No se detectó un formato de pedido válido en el portapapeles.');
            }
        } catch (err) {
            console.error('Error al importar:', err);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending': return '#f59e0b';
            case 'ready': return '#3b82f6';
            case 'delivered': return '#22c55e';
            case 'cancelled': return '#ef4444';
            default: return 'var(--color-text-muted)';
        }
    };

    const printTicket = (pedido) => {
        const printWindow = window.open('', '_blank', 'width=300,height=600');
        const dateStr = new Date(pedido.created_at).toLocaleString();

        printWindow.document.write(`
            <html>
                <head>
                    <title>Ticket #${pedido.id}</title>
                    <style>
                        body { font-family: 'Courier New', Courier, monospace; width: 80mm; padding: 10px; font-size: 14px; }
                        .text-center { text-align: center; }
                        .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
                        .bold { font-weight: bold; }
                        .items { width: 100%; border-collapse: collapse; }
                        .total { font-size: 18px; margin-top: 10px; }
                        @media print { body { margin: 0; padding: 5px; } }
                    </style>
                </head>
                <body>
                    <div class="text-center">
                        <h2 style="margin:0">${BRAND_CONFIG.brand_name?.toUpperCase() || 'MEATMANAGER'}</h2>
                        <p style="margin:5px 0">Comanda de Pedido</p>
                    </div>
                    <div class="divider"></div>
                    <p><strong>FECHA:</strong> ${dateStr}</p>
                    <p><strong>ORDEN:</strong> #${pedido.id}</p>
                    <p><strong>CLIENTE:</strong> ${pedido.customer_name}</p>
                    ${pedido.address ? `<p><strong>ENTREGA:</strong> ${pedido.address}</p>` : ''}
                    <p><strong>MODALIDAD:</strong> ${pedido.delivery_type === 'delivery' ? '🚚 ENVÍO DOMICILIO' : '🏪 RETIRO LOCAL'}</p>
                    <div class="divider"></div>
                    <div class="bold">PRODUCTOS:</div>
                    <pre style="white-space: pre-wrap; font-family: inherit;">${pedido.items}</pre>
                    <div class="divider"></div>
                    <div class="text-center bold total">
                        TOTAL: $${pedido.total.toLocaleString()}
                    </div>
                    ${pedido.address ? `
                        <div class="divider"></div>
                        <div class="text-center" style="font-size: 10px;">
                            <p>Escaneá para GPS:</p>
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent('https://www.google.com/maps/search/' + pedido.address)}" />
                        </div>
                    ` : ''}
                    <div class="divider"></div>
                    <p class="text-center" style="font-size: 10px;">Gracias por confiar en nosotros!</p>
                </body>
            </html>
        `);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    };

    const printLabel = (pedido) => {
        const printWindow = window.open('', '_blank', 'width=300,height=400');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Etiqueta #${pedido.id}</title>
                    <style>
                        body { font-family: 'Arial', sans-serif; width: 80mm; padding: 5px; text-align: center; }
                        .client-name { font-size: 24px; font-weight: bold; margin: 10px 0; border-bottom: 2px solid #000; padding-bottom: 5px; }
                        .order-id { font-size: 14px; color: #666; }
                        .items { font-size: 18px; text-align: left; margin: 15px 0; padding-left: 10px; }
                        .total-label { font-size: 28px; font-weight: 800; background: #000; color: #fff; padding: 5px; display: block; border-radius: 5px; }
                        @media print { body { margin: 0; } }
                    </style>
                </head>
                <body>
                    <div class="order-id">ORDEN #${pedido.id}</div>
                    <div class="client-name">${pedido.customer_name.toUpperCase()}</div>
                    <div class="items">
                        ${pedido.items.split('\n').map(item => `• ${item}`).join('<br/>')}
                    </div>
                    <div class="total-label">
                        TOTAL: $${pedido.total.toLocaleString()}
                    </div>
                    <p style="font-size: 12px; margin-top: 15px;">MeatManager PRO</p>
                </body>
            </html>
        `);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    };

    return (
        <div className="pedidos-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Pedidos y Reservas</h1>
                    <p className="page-description">Gestioná tus pedidos de mostrador y WhatsApp</p>
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
                    <input
                        type="text"
                        placeholder="Buscar por cliente o N° de pedido..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="filter-tabs">
                    <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pendientes</button>
                    <button className={filter === 'ready' ? 'active' : ''} onClick={() => setFilter('ready')}>Listos</button>
                    <button className={filter === 'delivered' ? 'active' : ''} onClick={() => setFilter('delivered')}>Entregados</button>
                    <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
                </div>
            </div>

            <div className="pedidos-grid">
                {filteredPedidos?.length === 0 && (
                    <div className="empty-state">
                        <ShoppingBag size={48} />
                        <p>No se encontraron pedidos.</p>
                    </div>
                )}
                {filteredPedidos?.map(pedido => (
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
                            <p className="items-list">{pedido.items}</p>

                            <div style={{ marginTop: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
                                <div className="delivery-info">
                                    <Calendar size={14} />
                                    <span>Entrega: {pedido.delivery_date}</span>
                                </div>
                                {pedido.address && (
                                    <div className="delivery-info" style={{ color: 'var(--color-primary)', marginTop: '0.4rem' }}>
                                        <MapPin size={14} />
                                        <span style={{ fontSize: '0.85rem' }}>{pedido.address}</span>
                                    </div>
                                )}
                                <div className="delivery-info" style={{ marginTop: '0.4rem', opacity: 0.8 }}>
                                    {pedido.delivery_type === 'delivery' ? <Truck size={14} /> : <ShoppingBag size={14} />}
                                    <span style={{ fontSize: '0.8rem', fontWeight: '500' }}>
                                        {pedido.delivery_type === 'delivery' ? 'ENVÍO A DOMICILIO' : 'RETIRO LOCAL'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="pedido-footer">
                            <div className="total-amount">${pedido.total.toLocaleString()}</div>
                            <div className="action-buttons">
                                {pedido.status === 'pending' && (
                                    <button className="icon-btn ready" title="Marcar como Listo" onClick={() => updateStatus(pedido.id, 'ready')}>
                                        <Clock size={18} />
                                    </button>
                                )}
                                {pedido.status === 'ready' && (
                                    <button className="icon-btn deliver" title="Entregar" onClick={() => updateStatus(pedido.id, 'delivered')}>
                                        <CheckCircle2 size={18} />
                                    </button>
                                )}
                                {pedido.status !== 'cancelled' && pedido.status !== 'delivered' && (
                                    <button className="icon-btn cancel" title="Cancelar" onClick={() => updateStatus(pedido.id, 'cancelled')}>
                                        <XCircle size={18} />
                                    </button>
                                )}
                                <button className="icon-btn" style={{ background: '#f1f5f9', color: '#64748b' }} title="Imprimir Comanda" onClick={() => printTicket(pedido)}>
                                    <Printer size={18} />
                                </button>
                                <button className="icon-btn" style={{ background: '#fdf2f8', color: '#db2777' }} title="Imprimir Etiqueta" onClick={() => printLabel(pedido)}>
                                    <Tag size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
                        <h2>Nuevo Pedido Manual</h2>
                        <div className="modal-form">
                            <input
                                type="text"
                                className="neo-input"
                                placeholder="Nombre del Cliente"
                                value={newPedido.name}
                                onChange={e => setNewPedido({ ...newPedido, name: e.target.value })}
                            />
                            <textarea
                                className="neo-input"
                                placeholder="Detalle (Ej: 2kg de asado, 1kg de chorizo)"
                                style={{ height: '100px' }}
                                value={newPedido.items}
                                onChange={e => setNewPedido({ ...newPedido, items: e.target.value })}
                            ></textarea>
                            <input
                                type="number"
                                className="neo-input"
                                placeholder="Monto estimado $"
                                value={newPedido.total}
                                onChange={e => setNewPedido({ ...newPedido, total: e.target.value })}
                            />
                            <input
                                type="date"
                                className="neo-input"
                                value={newPedido.date}
                                onChange={e => setNewPedido({ ...newPedido, date: e.target.value })}
                            />

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                <select
                                    className="neo-input"
                                    style={{ flex: 1 }}
                                    value={newPedido.delivery_type}
                                    onChange={e => setNewPedido({ ...newPedido, delivery_type: e.target.value })}
                                >
                                    <option value="pickup">Retiro en Local</option>
                                    <option value="delivery">Envío a Domicilio</option>
                                </select>
                            </div>

                            {newPedido.delivery_type === 'delivery' && (
                                <input
                                    type="text"
                                    className="neo-input animate-fade-in"
                                    placeholder="Dirección de Envío"
                                    value={newPedido.address}
                                    onChange={e => setNewPedido({ ...newPedido, address: e.target.value })}
                                />
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
