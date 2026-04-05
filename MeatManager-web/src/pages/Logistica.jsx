import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
    Map as MapIcon,
    Truck,
    CheckCircle2,
    Clock,
    MapPin,
    ChevronRight,
    Search,
    Filter,
    Printer,
    Navigation2,
    Share2,
    UserPlus,
    Users,
    Trash2,
    X,
    AlertTriangle,
    ShieldAlert,
    CalendarDays,
    AlertCircle
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fdb } from '../firebase';
import { collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { useLicense } from '../context/LicenseContext';
import { buildOrderAddress, geocodeAddress, getStoredCoordinates } from '../utils/geocoding';
import 'leaflet/dist/leaflet.css';
import './Logistica.css';

// Fix for default marker icons in Leaflet with React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons for Status
const yellowIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const blueIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const truckIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1048/1048329.png', // A truck icon
    iconSize: [35, 35],
    iconAnchor: [17, 17],
    popupAnchor: [0, -15],
});

// Component to recenter map
function ChangeView({ center, zoom }) {
    const map = useMap();
    map.setView(center, zoom);
    return null;
}

const Logistica = () => {
    const { hasModule } = useLicense();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPedido, setSelectedPedido] = useState(null);
    const [mapCenter, setMapCenter] = useState([-34.6037, -58.3816]); // Buenos Aires default
    const [mapZoom, setMapZoom] = useState(13);
    const [driversLocations, setDriversLocations] = useState({});
    const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
    const [newDriver, setNewDriver] = useState({
        name: '',
        vehicle: '',
        plate: '',
        phone: '',
        vtv_expiry: '',
        license_expiry: '',
        insurance_expiry: ''
    });

    const pedidos = useLiveQuery(async () => {
        const rows = await db.pedidos?.toArray();
        return (rows || []).filter((pedido) => pedido.delivery_type === 'delivery');
    });

    const registeredDrivers = useLiveQuery(() => db.repartidores?.toArray());
    const clients = useLiveQuery(() => db.clients?.toArray());
    const settings = useLiveQuery(() => db.settings.toArray());
    const hasLogisticsModule = hasModule('logistica');


    useEffect(() => {
        if (settings) {
            const locations = {};
            settings.forEach(s => {
                if (s.key.startsWith('location_')) {
                    locations[s.key.replace('location_', '')] = s.value;
                }
            });
            setDriversLocations(locations);
        }
    }, [settings]);

    // Filtered orders
    const deliveryOrders = pedidos?.filter(p => {
        const matchesSearch = p.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.address && p.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (p.repartidor && p.repartidor.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesFilter = filter === 'all' || p.status === filter;
        return matchesSearch && matchesFilter;
    }) || [];

    const getOrderCoordinates = (pedido) => {
        const stored = getStoredCoordinates(pedido);
        if (stored) return [stored.latitude, stored.longitude];

        const clientMatch = clients?.find((client) => Number(client.id) === Number(pedido.customer_id));
        const clientCoords = getStoredCoordinates(clientMatch);
        if (clientCoords) return [clientCoords.latitude, clientCoords.longitude];

        return null;
    };

    const getIconForStatus = (status) => {
        switch (status) {
            case 'pending': return yellowIcon;
            case 'ready': return blueIcon;
            case 'delivered': return greenIcon;
            default: return blueIcon;
        }
    };

    const handleFocusPedido = (pedido) => {
        setSelectedPedido(pedido);
        const coords = getOrderCoordinates(pedido);
        if (coords) {
            setMapCenter(coords);
            setMapZoom(16);
        }
    };

    const assignDriver = async (id, driverName) => {
        await db.pedidos.update(id, { repartidor: driverName, status: 'ready' });

        // CLOUD SYNC: Push assigned order to Firestore
        if (hasLogisticsModule) {
            try {
                const pedido = pedidos.find(p => p.id === id);
                if (pedido) {
                    await setDoc(doc(fdb, "orders_delivery", id.toString()), {
                        ...pedido,
                        repartidor: driverName,
                        status: 'ready',
                        updated_at: new Date().toISOString()
                    });
                }
            } catch (err) {
                console.error("Cloud Sync Error:", err);
            }
        }
    };

    // REAL-TIME CLOUD LISTENERS
    useEffect(() => {
        if (!hasLogisticsModule) return;

        // 1. Listen for Driver Locations
        const unsubLocations = onSnapshot(collection(fdb, "drivers_locations"), (snapshot) => {
            const locations = {};
            snapshot.forEach(doc => {
                locations[doc.id] = doc.data(); // doc.id is driver name
            });
            setDriversLocations(locations);
        });

        // 2. Listen for Status Updates from Drivers (Delivered)
        const unsubStatus = onSnapshot(collection(fdb, "orders_delivery"), (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === "modified") {
                    const cloudOrder = change.doc.data();
                    if (cloudOrder.status === 'delivered') {
                        // Sync back to Local DB
                        await db.pedidos.update(parseInt(change.doc.id), { status: 'delivered' });
                        // Clean up cloud
                        await deleteDoc(doc(fdb, "orders_delivery", change.doc.id));
                    }
                }
            });
        });

        return () => {
            unsubLocations();
            unsubStatus();
        };
    }, [hasLogisticsModule]);

    useEffect(() => {
        if (!pedidos?.length) return;

        let cancelled = false;

        const geocodeMissingOrders = async () => {
            const missingOrders = pedidos.filter((pedido) =>
                pedido.delivery_type === 'delivery' &&
                pedido.address &&
                !getStoredCoordinates(pedido)
            );

            for (const pedido of missingOrders) {
                if (cancelled) return;
                try {
                    const geocoded = await geocodeAddress(buildOrderAddress(pedido));
                    if (!geocoded || cancelled) continue;
                    await db.pedidos.update(pedido.id, {
                        latitude: geocoded.latitude,
                        longitude: geocoded.longitude,
                        geocoded_at: geocoded.geocoded_at,
                    });
                } catch (error) {
                    console.warn('[LOGISTICA] No se pudo geocodificar pedido', pedido.id, error?.message || error);
                }
            }
        };

        geocodeMissingOrders();

        return () => {
            cancelled = true;
        };
    }, [pedidos]);

    const checkExpiry = (date) => {
        if (!date) return 'missing';
        const today = new Date();
        const expiry = new Date(date);
        const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'expired';
        if (diffDays < 15) return 'soon';
        return 'ok';
    };

    const hasAnyWarning = (driver) => {
        return checkExpiry(driver.vtv_expiry) !== 'ok' ||
            checkExpiry(driver.license_expiry) !== 'ok' ||
            checkExpiry(driver.insurance_expiry) !== 'ok';
    };

    const handleAddDriver = async () => {
        if (!newDriver.name) return;
        await db.repartidores.add({ ...newDriver, status: 'idle' });
        setNewDriver({
            name: '', vehicle: '', plate: '', phone: '',
            vtv_expiry: '', license_expiry: '', insurance_expiry: ''
        });
    };

    const deleteDriver = async (id) => {
        if (confirm('¿Eliminar a este repartidor?')) {
            await db.repartidores.delete(id);
        }
    };

    const copyPortalLink = () => {
        const link = `${window.location.origin}/#/reparto`;
        navigator.clipboard.writeText(link);
        alert('Link del Portal de Repartidores copiado! Envialo por WhatsApp.');
    };

    return (
        <div className="logistica-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Control de Logística y Reparto</h1>
                    <p className="page-description">Seguimiento de envíos y control de rutas en tiempo real.</p>
                </div>
                <div className="stats-mini-grid">
                    <button className="neo-button" style={{ background: '#1e293b', color: 'white' }} onClick={() => setIsDriverModalOpen(true)}>
                        <Users size={18} /> Staff Repartidores
                    </button>
                    <div className="stat-mini-card">
                        <span className="label">Flota</span>
                        <span className="value" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {registeredDrivers?.length || 0}
                            {registeredDrivers?.some(d => hasAnyWarning(d)) && <AlertTriangle size={18} color="#ef4444" />}
                        </span>
                    </div>
                    <div className="stat-mini-card">
                        <span className="label">En Camino</span>
                        <span className="value" style={{ color: '#3b82f6' }}>
                            {pedidos?.filter(p => p.status === 'ready').length || 0}
                        </span>
                    </div>
                    <div className="stat-mini-card">
                        <span className="label">Entregados</span>
                        <span className="value" style={{ color: '#22c55e' }}>
                            {pedidos?.filter(p => p.status === 'delivered').length || 0}
                        </span>
                    </div>
                </div>
            </header>

            <div className="logistica-content">
                {/* LIST PANEL */}
                <div className="logistica-sidebar neo-card">
                    <div className="sidebar-search">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Buscar dirección o cliente..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="filter-pills">
                        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
                        <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Sin Asignar</button>
                        <button className={filter === 'ready' ? 'active' : ''} onClick={() => setFilter('ready')}>En Reparto</button>
                        <button className={filter === 'delivered' ? 'active' : ''} onClick={() => setFilter('delivered')}>Entregados</button>
                    </div>

                    <div style={{ padding: '0 1rem 1rem' }}>
                        <button className="neo-button full-width" onClick={copyPortalLink} style={{ fontSize: '0.8rem', gap: '0.5rem' }}>
                            <Share2 size={14} /> Link del Repartidor
                        </button>
                    </div>

                    <div className="orders-list">
                        {deliveryOrders.length === 0 ? (
                            <div className="empty-delivery">
                                <Truck size={32} />
                                <p>No hay envíos pendientes.</p>
                            </div>
                        ) : (
                            deliveryOrders.map(p => (
                                <div
                                    key={p.id}
                                    className={`delivery-item ${selectedPedido?.id === p.id ? 'selected' : ''}`}
                                    onClick={() => handleFocusPedido(p)}
                                >
                                    <div className="status-indicator" style={{ background: p.status === 'delivered' ? '#22c55e' : (p.status === 'ready' ? '#3b82f6' : '#f59e0b') }}></div>
                                    <div className="item-main">
                                        <div className="item-info">
                                            <h4>{p.customer_name}</h4>
                                            <p className="address"><MapPin size={12} /> {p.address}</p>
                                            {p.repartidor && <p className="driver-label"><Truck size={12} /> {p.repartidor}</p>}
                                        </div>
                                        <ChevronRight size={18} className="arrow" />
                                    </div>
                                    <div className="item-footer">
                                        <span>#{p.id}</span>
                                        <span className={`badge-status ${p.status}`}>{p.status === 'ready' ? 'En Camino' : p.status}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* MAP PANEL */}
                <div className="map-view neo-card">
                    <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: '100%', width: '100%', borderRadius: '12px' }}>
                        <ChangeView center={mapCenter} zoom={mapZoom} />
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        {/* Driver Markers */}
                        {Object.entries(driversLocations).map(([name, loc]) => (
                            <Marker key={name} position={[loc.lat, loc.lng]} icon={truckIcon}>
                                <Popup>
                                    <strong>Repartidor: {name}</strong><br />
                                    Última vez: {new Date(loc.time).toLocaleTimeString()}
                                </Popup>
                            </Marker>
                        ))}

                        {deliveryOrders.map(p => {
                            const coords = getOrderCoordinates(p);
                            if (!coords) return null;
                            return (
                                <Marker
                                    key={p.id}
                                    position={coords}
                                    icon={getIconForStatus(p.status)}
                                    eventHandlers={{
                                        click: () => setSelectedPedido(p),
                                    }}
                                >
                                    <Popup>
                                        <div className="popup-content">
                                            <h4 style={{ margin: '0 0 5px 0' }}>{p.customer_name}</h4>
                                            <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem' }}>{p.address}</p>
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <button className="popup-btn" onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(`https://www.google.com/maps/search/${encodeURIComponent(p.address)}`, '_blank');
                                                }}>
                                                    <Navigation2 size={14} /> GPS
                                                </button>
                                                <button className="popup-btn" style={{ background: '#f1f5f9', color: '#334155' }}>
                                                    <Printer size={14} /> Ticket
                                                </button>
                                            </div>
                                        </div>
                                    </Popup>
                                </Marker>
                            );
                        })}
                    </MapContainer>

                    {/* OVERLAY PANEL FOR SELECTED ORDER */}
                    {selectedPedido && (
                        <div className="order-map-overlay animate-slide-up">
                            <div className="overlay-header">
                                <div>
                                    <h3>Pedido #{selectedPedido.id}</h3>
                                    <p>{selectedPedido.customer_name}</p>
                                </div>
                                <button className="close-overlay" onClick={() => setSelectedPedido(null)}>×</button>
                            </div>
                            <div className="overlay-body">
                                <div className="info-row">
                                    <MapPin size={16} />
                                    <span>{selectedPedido.address || 'Direccion pendiente'}</span>
                                </div>
                                {!getOrderCoordinates(selectedPedido) && (
                                    <div className="risk-warning-banner">
                                        <AlertCircle size={18} />
                                        <span>NO SE PUDO UBICAR ESTE DESTINO EN EL MAPA</span>
                                    </div>
                                )}
                                <div className="info-row">
                                    <Clock size={16} />
                                    <span>{selectedPedido.status === 'ready' ? 'En viaje' : 'Esperando asignación'}</span>
                                </div>

                                {selectedPedido.repartidor && registeredDrivers?.find(d => d.name === selectedPedido.repartidor) && hasAnyWarning(registeredDrivers.find(d => d.name === selectedPedido.repartidor)) && (
                                    <div className="risk-warning-banner">
                                        <AlertCircle size={18} />
                                        <span>DOCUMENTACIÓN VENCIDA O INCOMPLETA</span>
                                    </div>
                                )}

                                <div className="assignment-box">
                                    <label><UserPlus size={14} /> Asignar Repartidor:</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        <select
                                            className="neo-input"
                                            style={{ color: '#1e293b' }}
                                            value={selectedPedido.repartidor || ''}
                                            onChange={(e) => assignDriver(selectedPedido.id, e.target.value)}
                                        >
                                            <option value="">-- Seleccionar Repartidor --</option>
                                            {registeredDrivers?.map(d => {
                                                const warning = hasAnyWarning(d);
                                                return (
                                                    <option key={d.id} value={d.name} style={{ color: warning ? '#ef4444' : 'inherit' }}>
                                                        {warning ? '⚠️ ' : ''}{d.name} ({d.vehicle} - {d.plate})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                </div>

                                <div className="items-preview">
                                    {selectedPedido.items}
                                </div>
                            </div>
                            <div className="overlay-actions">
                                <button className="btn-delivered" onClick={async () => {
                                    await db.pedidos.update(selectedPedido.id, { status: 'delivered' });
                                    setSelectedPedido(null);
                                }}>
                                    Confirmar Entrega
                                </button>
                                <button className="btn-call" onClick={() => {
                                    const driver = registeredDrivers?.find(d => d.name === selectedPedido.repartidor);
                                    if (driver?.phone) window.open(`tel:${driver.phone}`);
                                }}>Llamar Repartidor</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* DRIVER MANAGEMENT MODAL */}
            {isDriverModalOpen && (
                <div className="modal-overlay" onClick={() => setIsDriverModalOpen(false)}>
                    <div className="modal-content neo-card" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                            <h1 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <ShieldAlert color="var(--color-primary)" /> Control de Flota y Documentación
                            </h1>
                            <button className="icon-btn" onClick={() => setIsDriverModalOpen(false)}><X /></button>
                        </div>

                        <div className="add-driver-form-pro">
                            <div className="input-field">
                                <label>Repartidor</label>
                                <input className="neo-input" placeholder="Nombre" value={newDriver.name} onChange={e => setNewDriver({ ...newDriver, name: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label>Vehículo / Modelo</label>
                                <input className="neo-input" placeholder="Ej: VW Saveiro" value={newDriver.vehicle} onChange={e => setNewDriver({ ...newDriver, vehicle: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label>Patente</label>
                                <input className="neo-input" placeholder="AAA 000" value={newDriver.plate} onChange={e => setNewDriver({ ...newDriver, plate: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label>Teléfono</label>
                                <input className="neo-input" placeholder="549..." value={newDriver.phone} onChange={e => setNewDriver({ ...newDriver, phone: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label><CalendarDays size={12} /> VTV Vence</label>
                                <input type="date" className="neo-input" value={newDriver.vtv_expiry} onChange={e => setNewDriver({ ...newDriver, vtv_expiry: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label><CalendarDays size={12} /> Carnet Vence</label>
                                <input type="date" className="neo-input" value={newDriver.license_expiry} onChange={e => setNewDriver({ ...newDriver, license_expiry: e.target.value })} />
                            </div>
                            <div className="input-field">
                                <label><CalendarDays size={12} /> Seguro Vence</label>
                                <input type="date" className="neo-input" value={newDriver.insurance_expiry} onChange={e => setNewDriver({ ...newDriver, insurance_expiry: e.target.value })} />
                            </div>
                            <div className="input-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <button className="neo-button pro-btn full-width" style={{ height: '42px' }} onClick={handleAddDriver}>Registrar en Flota</button>
                            </div>
                        </div>

                        <div className="drivers-table-container">
                            <table className="menu-table pro-table">
                                <thead>
                                    <tr>
                                        <th>Personal / Vehículo</th>
                                        <th>Documentación (Vencimientos)</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {registeredDrivers?.map(d => {
                                        const vtvStatus = checkExpiry(d.vtv_expiry);
                                        const licStatus = checkExpiry(d.license_expiry);
                                        const insStatus = checkExpiry(d.insurance_expiry);

                                        return (
                                            <tr key={d.id}>
                                                <td style={{ verticalAlign: 'top' }}>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{d.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{d.vehicle} • <span style={{ fontWeight: 'bold' }}>{d.plate}</span></div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>📞 {d.phone}</div>
                                                </td>
                                                <td>
                                                    <div className="compliance-grid">
                                                        <div className={`comp-pill ${vtvStatus}`}>
                                                            VTV: {d.vtv_expiry || 'N/A'}
                                                        </div>
                                                        <div className={`comp-pill ${licStatus}`}>
                                                            CARNET: {d.license_expiry || 'N/A'}
                                                        </div>
                                                        <div className={`comp-pill ${insStatus}`}>
                                                            SEGURO: {d.insurance_expiry || 'N/A'}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <button className="delete-btn" onClick={() => deleteDriver(d.id)}>
                                                        <Trash2 size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {registeredDrivers?.length === 0 && (
                                        <tr><td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No hay repartidores cargados</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Logistica;
