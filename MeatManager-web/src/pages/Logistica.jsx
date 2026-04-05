import React, { useState, useEffect, useMemo } from 'react';
import {
    Map as MapIcon,
    Truck,
    CheckCircle2,
    Clock,
    MapPin,
    ChevronRight,
    Search,
    Printer,
    Navigation2,
    Share2,
    Users,
    X,
    AlertCircle,
    Mail,
    Wifi,
    WifiOff
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useLicense } from '../context/LicenseContext';
import { buildOrderAddress, geocodeAddress, getStoredCoordinates } from '../utils/geocoding';
import { assignLogisticsOrder, fetchLiveDrivers, fetchLogisticsDrivers, fetchTable, saveTableRecord } from '../utils/apiClient';
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

const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const formatOrderItems = (pedido) => {
    if (!pedido) return 'Sin items';

    if (Array.isArray(pedido.items) && pedido.items.length > 0) {
        return pedido.items.map((item) => {
            if (typeof item === 'string') return item;
            const productName = String(item?.product_name || item?.name || 'Item');
            const quantity = toNumber(item?.quantity);
            const unit = String(item?.unit || 'un');
            const quantityLabel = unit === 'kg'
                ? `${quantity.toFixed(3)} kg`
                : `${quantity.toFixed(0)} ${unit}`;
            return `${productName} · ${quantityLabel}`;
        }).join('\n');
    }

    if (typeof pedido.items_text === 'string' && pedido.items_text.trim()) {
        return pedido.items_text;
    }

    if (typeof pedido.items === 'string' && pedido.items.trim()) {
        return pedido.items;
    }

    return 'Sin items';
};

const Logistica = () => {
    const { hasModule } = useLicense();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPedido, setSelectedPedido] = useState(null);
    const [mapCenter, setMapCenter] = useState([-34.6037, -58.3816]); // Buenos Aires default
    const [mapZoom, setMapZoom] = useState(13);
    const [driversLocations, setDriversLocations] = useState([]);
    const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
    const [registeredDrivers, setRegisteredDrivers] = useState([]);
    const [driversError, setDriversError] = useState('');
    const [pedidos, setPedidos] = useState([]);
    const [clients, setClients] = useState([]);

    const hasLogisticsModule = hasModule('logistica');
    const driversById = useMemo(() => {
        const map = new Map();
        registeredDrivers.forEach((driver) => map.set(String(driver.id), driver));
        return map;
    }, [registeredDrivers]);
    const driversByIdentity = useMemo(() => {
        const map = new Map();
        registeredDrivers.forEach((driver) => {
            const keys = [
                String(driver.firebaseUid || '').trim(),
                String(driver.email || '').trim().toLowerCase(),
                String(driver.name || '').trim().toLowerCase(),
            ].filter(Boolean);
            keys.forEach((key) => map.set(key, driver));
        });
        return map;
    }, [registeredDrivers]);

    useEffect(() => {
        if (!hasLogisticsModule) return;

        let cancelled = false;

        const loadOrders = async () => {
            try {
                const [orderRows, clientRows] = await Promise.all([
                    fetchTable('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
                    fetchTable('clients', { limit: 1000, orderBy: 'id', direction: 'ASC' }),
                ]);
                if (!cancelled) {
                    setPedidos((Array.isArray(orderRows) ? orderRows : []).filter((pedido) => pedido.delivery_type === 'delivery'));
                    setClients(Array.isArray(clientRows) ? clientRows : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.warn('[LOGISTICA] No se pudieron cargar pedidos/clientes', error?.message || error);
                    setPedidos([]);
                    setClients([]);
                }
            }
        };

        const loadDrivers = async () => {
            try {
                const payload = await fetchLogisticsDrivers();
                if (!cancelled) {
                    setRegisteredDrivers(Array.isArray(payload?.drivers) ? payload.drivers : []);
                    setDriversError('');
                }
            } catch (error) {
                if (!cancelled) {
                    setDriversError(error instanceof Error ? error.message : 'No se pudo leer el staff de reparto.');
                    setRegisteredDrivers([]);
                }
            }
        };

        loadOrders();
        loadDrivers();
        return () => {
            cancelled = true;
        };
    }, [hasLogisticsModule]);

    const refreshOrders = async () => {
        const [orderRows, clientRows] = await Promise.all([
            fetchTable('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
            fetchTable('clients', { limit: 1000, orderBy: 'id', direction: 'ASC' }),
        ]);
        setPedidos((Array.isArray(orderRows) ? orderRows : []).filter((pedido) => pedido.delivery_type === 'delivery'));
        setClients(Array.isArray(clientRows) ? clientRows : []);
    };

    useEffect(() => {
        if (!hasLogisticsModule) return;

        let cancelled = false;

        const loadLiveDrivers = async () => {
            try {
                const payload = await fetchLiveDrivers();
                if (!cancelled) {
                    setDriversLocations(Array.isArray(payload?.drivers) ? payload.drivers : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.warn('[LOGISTICA] No se pudo leer tracking vivo', error?.message || error);
                }
            }
        };

        loadLiveDrivers();
        const interval = window.setInterval(loadLiveDrivers, 15000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [hasLogisticsModule]);

    // Filtered orders
    const deliveryOrders = pedidos?.filter(p => {
        const matchesSearch = p.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.address && p.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (p.repartidor && p.repartidor.toLowerCase().includes(searchTerm.toLowerCase()));
        const normalizedStatus = p.status === 'ready' ? 'assigned' : p.status;
        const matchesFilter = filter === 'all' || normalizedStatus === filter;
        return matchesSearch && matchesFilter;
    }) || [];

    const findDriverForOrder = (pedido) => {
        const keys = [
            String(pedido?.assigned_driver_uid || '').trim(),
            String(pedido?.assigned_driver_email || '').trim().toLowerCase(),
            String(pedido?.repartidor || '').trim().toLowerCase(),
        ].filter(Boolean);

        for (const key of keys) {
            const driver = driversByIdentity.get(key);
            if (driver) return driver;
        }

        return null;
    };

    const getDriverSelectValue = (pedido) => {
        const driver = findDriverForOrder(pedido);
        return driver ? String(driver.id) : '';
    };

    const getStatusLabel = (status) => {
        if (status === 'ready' || status === 'assigned') return 'En Reparto';
        if (status === 'on_route') return 'En Ruta';
        if (status === 'arrived') return 'En Puerta';
        if (status === 'delivered') return 'Entregado';
        return 'Sin Asignar';
    };

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

    const assignDriver = async (id, driverId) => {
        const driver = driversById.get(String(driverId));
        if (!driver) {
            const pedido = pedidos.find((item) => Number(item.id) === Number(id));
            if (!pedido) return;
            await saveTableRecord('pedidos', 'update', {
                ...pedido,
                repartidor: null,
                assigned_driver_uid: null,
                assigned_driver_email: null,
                status: 'pending',
                assigned_at: null,
                status_updated_at: new Date().toISOString(),
            }, id);
            await refreshOrders();
            return;
        }

        try {
            const payload = await assignLogisticsOrder(id, {
                driverUserId: driver.id,
                driverFirebaseUid: driver.firebaseUid || null,
                driverEmail: driver.email || null,
                driverName: driver.name,
                status: 'assigned',
            });

            const order = payload?.order;
            await refreshOrders();

            setSelectedPedido((current) => (
                current && Number(current.id) === Number(id)
                    ? {
                        ...current,
                        repartidor: order?.driver?.name || driver.name,
                        assigned_driver_uid: order?.driver?.firebaseUid || driver.firebaseUid || null,
                        assigned_driver_email: order?.driver?.email || driver.email || null,
                        status: order?.status || 'assigned',
                    }
                    : current
            ));
        } catch (error) {
            alert(error instanceof Error ? error.message : 'No se pudo asignar el pedido.');
        }
    };

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
                    await saveTableRecord('pedidos', 'update', {
                        ...pedido,
                        latitude: geocoded.latitude,
                        longitude: geocoded.longitude,
                        geocoded_at: geocoded.geocoded_at,
                    }, pedido.id);
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
                        <span className="value">{registeredDrivers?.length || 0}</span>
                    </div>
                    <div className="stat-mini-card">
                        <span className="label">En Camino</span>
                        <span className="value" style={{ color: '#3b82f6' }}>
                            {pedidos?.filter(p => ['ready', 'assigned', 'on_route', 'arrived'].includes(p.status)).length || 0}
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
                        <button className={filter === 'assigned' ? 'active' : ''} onClick={() => setFilter('assigned')}>En Reparto</button>
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
                                        <span className={`badge-status ${p.status}`}>{getStatusLabel(p.status)}</span>
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
                        {driversLocations.map((loc) => (
                            <Marker key={loc.firebaseUid || loc.email || loc.repartidor} position={[loc.lat, loc.lng]} icon={truckIcon}>
                                <Popup>
                                    <strong>Repartidor: {loc.repartidor}</strong><br />
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
                                    <span>{getStatusLabel(selectedPedido.status)}</span>
                                </div>

                                <div className="assignment-box">
                                    <label><Users size={14} /> Asignar Repartidor:</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        <select
                                            className="neo-input"
                                            style={{ color: '#1e293b' }}
                                            value={getDriverSelectValue(selectedPedido)}
                                            onChange={(e) => assignDriver(selectedPedido.id, e.target.value)}
                                        >
                                            <option value="">-- Seleccionar Repartidor --</option>
                                            {registeredDrivers?.map((driver) => (
                                                <option key={driver.id} value={driver.id}>
                                                    {driver.name} · {driver.email}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="items-preview" style={{ whiteSpace: 'pre-line' }}>
                                    {formatOrderItems(selectedPedido)}
                                </div>
                            </div>
                            <div className="overlay-actions">
                                <button className="btn-delivered" onClick={async () => {
                                    await saveTableRecord('pedidos', 'update', {
                                        ...selectedPedido,
                                        status: 'delivered',
                                        status_updated_at: new Date().toISOString(),
                                    }, selectedPedido.id);
                                    await refreshOrders();
                                    setSelectedPedido(null);
                                }}>
                                    Confirmar Entrega
                                </button>
                                <button className="btn-call" onClick={() => {
                                    const driver = findDriverForOrder(selectedPedido);
                                    if (driver?.email) window.open(`mailto:${driver.email}`);
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
                                <Users color="var(--color-primary)" /> Repartidores habilitados del tenant
                            </h1>
                            <button className="icon-btn" onClick={() => setIsDriverModalOpen(false)}><X /></button>
                        </div>

                        <div style={{ marginBottom: '1rem', color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.5 }}>
                            Acá aparecen los usuarios reales del cliente que están activos y tienen una licencia de reparto asignada.
                        </div>
                        {driversError && (
                            <div className="risk-warning-banner" style={{ marginBottom: '1rem' }}>
                                <AlertCircle size={18} />
                                <span>{driversError}</span>
                            </div>
                        )}

                        <div className="drivers-table-container">
                            <table className="menu-table pro-table">
                                <thead>
                                    <tr>
                                        <th>Repartidor</th>
                                        <th>Licencias</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {registeredDrivers?.map((driver) => {
                                        const liveDriver = driversLocations.find((entry) => (
                                            (entry.firebaseUid && entry.firebaseUid === driver.firebaseUid)
                                            || (entry.email && entry.email.toLowerCase() === String(driver.email || '').toLowerCase())
                                        ));

                                        return (
                                            <tr key={driver.id}>
                                                <td style={{ verticalAlign: 'top' }}>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{driver.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <Mail size={12} /> {driver.email}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Sucursal #{driver.branchId || 'General'}</div>
                                                </td>
                                                <td>
                                                    <div className="compliance-grid">
                                                        {(driver.licenses || []).map((license) => (
                                                            <div key={license.clientLicenseId} className="comp-pill ok">
                                                                {license.commercialName || license.internalCode}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                        <div className={`comp-pill ${liveDriver ? 'ok' : 'missing'}`}>
                                                            {liveDriver ? <Wifi size={12} /> : <WifiOff size={12} />}
                                                            {liveDriver ? 'Online' : 'Sin tracking'}
                                                        </div>
                                                        {liveDriver?.activeOrders ? (
                                                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                                {liveDriver.activeOrders} pedido(s) activos
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {registeredDrivers?.length === 0 && (
                                        <tr><td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No hay usuarios habilitados para reparto</td></tr>
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
