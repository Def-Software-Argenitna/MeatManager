import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
    Truck,
    Clock,
    MapPin,
    ChevronRight,
    Search,
    Navigation2,
    Share2,
    Users,
    Tag,
    X,
    AlertCircle,
    Mail,
    Wifi,
    WifiOff,
    Maximize2,
    Minimize2
} from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import DirectionalReveal from '../components/DirectionalReveal';
import GoogleLogisticsMap from '../components/GoogleLogisticsMap';
import { buildOrderAddress, geocodeAddress, getStoredCoordinates } from '../utils/geocoding';
import { assignLogisticsOrder, fetchLiveDrivers, fetchLogisticsDrivers, fetchTable, saveTableRecord, updateLogisticsOrderStatus } from '../utils/apiClient';
import './Logistica.css';

const LIVE_DRIVERS_REFRESH_INTERVAL_MS = 5000;

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

const formatDriverLastSeen = (value) => {
    if (!value) return 'Sin dato';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Sin dato';
    return parsed.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const normalizeOrderForLogistics = (pedido) => ({
    ...pedido,
    customer_name: typeof pedido?.customer_name === 'string' ? pedido.customer_name : String(pedido?.customer_name || ''),
    address: typeof pedido?.address === 'string' ? pedido.address : String(pedido?.address || ''),
    repartidor: typeof pedido?.repartidor === 'string' ? pedido.repartidor : String(pedido?.repartidor || ''),
    items_preview: formatOrderItems(pedido),
});

const normalizeLiveDriver = (driver) => {
    const lastSeenRaw = driver?.time
        ?? driver?.updatedAt
        ?? driver?.updated_at
        ?? driver?.timestamp
        ?? driver?.lastSeenAt
        ?? driver?.lastSeen
        ?? driver?.last_seen
        ?? null;

    return {
        ...driver,
        repartidor: String(driver?.repartidor || driver?.name || driver?.email || 'Repartidor'),
        lat: toNumber(driver?.lat),
        lng: toNumber(driver?.lng),
        activeOrders: toNumber(driver?.activeOrders),
        lastSeenRaw,
    };
};

const getDriverDisplayName = (driver) => {
    const fullName = [driver?.firstName, driver?.lastName]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');

    if (fullName) return fullName;

    const directName = String(driver?.name || '').trim();
    if (directName && !directName.includes('@')) return directName;

    return String(driver?.email || driver?.name || 'Repartidor').trim();
};

const getDriverBranchLabel = (driver) => {
    const branchName = String(driver?.branchName || driver?.branch_name || '').trim();
    if (branchName) return branchName;

    const branchId = String(driver?.branchId || driver?.branch_id || '').trim();
    if (branchId) return `Sucursal #${branchId}`;

    return 'Sucursal general';
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
    const [liveDriversError, setLiveDriversError] = useState('');
    const [pedidos, setPedidos] = useState([]);
    const [clients, setClients] = useState([]);
    const [selectedDriverIdentity, setSelectedDriverIdentity] = useState('');
    const [paymentDraft, setPaymentDraft] = useState({ status: 'pending_driver_collection', amountDue: '', method: '' });
    const hasLogisticsModule = hasModule('logistica');
    const [isMapExpanded, setIsMapExpanded] = useState(false);
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
                    setPedidos(
                        (Array.isArray(orderRows) ? orderRows : [])
                            .filter((pedido) => pedido.delivery_type === 'delivery')
                            .map(normalizeOrderForLogistics)
                    );
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
        setPedidos(
            (Array.isArray(orderRows) ? orderRows : [])
                .filter((pedido) => pedido.delivery_type === 'delivery')
                .map(normalizeOrderForLogistics)
        );
        setClients(Array.isArray(clientRows) ? clientRows : []);
    };

    useEffect(() => {
        if (!hasLogisticsModule) return;

        let cancelled = false;

        const loadLiveDrivers = async () => {
            try {
                const payload = await fetchLiveDrivers();
                if (!cancelled) {
                    setDriversLocations(
                        (Array.isArray(payload?.drivers) ? payload.drivers : []).map(normalizeLiveDriver)
                    );
                    setLiveDriversError('');
                }
            } catch (error) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : 'No se pudo leer tracking vivo';
                    console.warn('[LOGISTICA] No se pudo leer tracking vivo', message);
                    setLiveDriversError(message);
                }
            }
        };

        loadLiveDrivers();
        const interval = window.setInterval(loadLiveDrivers, LIVE_DRIVERS_REFRESH_INTERVAL_MS);

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

    const selectedLiveDriver = useMemo(() => {
        if (!selectedDriverIdentity) return null;
        return driversLocations.find((loc) => (
            String(loc.firebaseUid || '').trim() === selectedDriverIdentity
            || String(loc.email || '').trim().toLowerCase() === selectedDriverIdentity
        )) || null;
    }, [driversLocations, selectedDriverIdentity]);

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

    const handleFocusPedido = (pedido) => {
        setSelectedPedido(normalizeOrderForLogistics(pedido));
        setSelectedDriverIdentity('');
        const coords = getOrderCoordinates(pedido);
        if (coords) {
            setMapCenter(coords);
            setMapZoom(16);
        }
    };

    const handleFocusDriver = (driver) => {
        setSelectedPedido(null);
        setSelectedDriverIdentity(String(driver.firebaseUid || '').trim() || String(driver.email || '').trim().toLowerCase());
        if (Number.isFinite(Number(driver.lat)) && Number.isFinite(Number(driver.lng))) {
            setMapCenter([Number(driver.lat), Number(driver.lng)]);
            setMapZoom(16);
        }
    };

    const syncSelectedOrder = async (pedido, patch) => {
        const payload = {
            status: pedido.status || 'pending',
            paymentStatus: patch.payment_status ?? pedido.payment_status ?? null,
            paymentMethod: patch.payment_method ?? pedido.payment_method ?? null,
            paid: patch.paid ?? pedido.paid ?? false,
            amountDue: patch.amount_due ?? pedido.amount_due ?? null,
        };

        const response = await updateLogisticsOrderStatus(pedido.id, payload);
        const order = response?.order;
        const nextPatch = {
            payment_status: order?.paymentStatus || payload.paymentStatus,
            payment_method: order?.paymentMethod || payload.paymentMethod,
            paid: order?.paid ?? payload.paid,
            amount_due: order?.amountDue ?? payload.amountDue,
            status: order?.status || pedido.status,
        };
        setSelectedPedido((current) => (current && Number(current.id) === Number(pedido.id) ? { ...current, ...nextPatch } : current));
    };

    useEffect(() => {
        if (!selectedPedido) {
            setPaymentDraft({ status: 'pending_driver_collection', amountDue: '', method: '' });
            return;
        }

        setPaymentDraft({
            status: selectedPedido.paid ? 'paid' : (selectedPedido.payment_status || 'pending_driver_collection'),
            amountDue: String(
                selectedPedido.paid
                    ? 0
                    : (Number(selectedPedido.amount_due) || Number(selectedPedido.total) || 0)
            ),
            method: selectedPedido.payment_method || '',
        });
    }, [selectedPedido]);

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
                        items_preview: formatOrderItems(current),
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
            <DirectionalReveal className="logistica-toolbar neo-card" from="up" delay={0.04}>
                <button className="neo-button" style={{ background: '#1e293b', color: 'white' }} onClick={() => setIsDriverModalOpen(true)}>
                    <Users size={18} /> Staff Repartidores
                </button>
                <div className="stats-mini-grid">
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
            </DirectionalReveal>

            <div className="logistica-content">
                <DirectionalReveal className={`map-view neo-card${isMapExpanded ? ' map-view--hidden' : ''}`} from="left" delay={0.1}>
                    <GoogleLogisticsMap
                        center={mapCenter}
                        zoom={mapZoom}
                        drivers={driversLocations}
                        orders={deliveryOrders}
                        getOrderCoordinates={getOrderCoordinates}
                        formatDriverLastSeen={formatDriverLastSeen}
                        onDriverSelect={handleFocusDriver}
                        onOrderSelect={handleFocusPedido}
                        onExpand={() => setIsMapExpanded(true)}
                    />

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
                                    <label><Tag size={14} /> Cobro del pedido:</label>
                                    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
                                        <select
                                            className="neo-input"
                                            style={{ color: '#1e293b' }}
                                            value={paymentDraft.status}
                                            onChange={(e) => setPaymentDraft((current) => ({
                                                ...current,
                                                status: e.target.value,
                                                amountDue: e.target.value === 'paid' ? '0' : (current.amountDue || String(Number(selectedPedido.total) || 0)),
                                                method: e.target.value === 'paid' ? (current.method || 'Cobrado previamente') : current.method,
                                            }))}
                                        >
                                            <option value="pending_driver_collection">Lo cobra el repartidor</option>
                                            <option value="paid">Ya está cobrado</option>
                                        </select>
                                        <input
                                            className="neo-input"
                                            type="number"
                                            min="0"
                                            disabled={paymentDraft.status === 'paid'}
                                            value={paymentDraft.status === 'paid' ? '0' : paymentDraft.amountDue}
                                            onChange={(e) => setPaymentDraft((current) => ({ ...current, amountDue: e.target.value }))}
                                            placeholder="Monto a cobrar"
                                        />
                                        <button
                                            className="neo-button"
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await syncSelectedOrder(selectedPedido, {
                                                        payment_status: paymentDraft.status,
                                                        payment_method: paymentDraft.status === 'paid' ? (paymentDraft.method || 'Cobrado previamente') : null,
                                                        paid: paymentDraft.status === 'paid',
                                                        amount_due: paymentDraft.status === 'paid' ? 0 : (Number(paymentDraft.amountDue) || Number(selectedPedido.total) || 0),
                                                    });
                                                } catch (error) {
                                                    alert(error instanceof Error ? error.message : 'No se pudo guardar la condición de cobro.');
                                                }
                                            }}
                                        >
                                            Guardar condición de cobro
                                        </button>
                                    </div>
                                </div>

                                <div className="assignment-box">
                                    <label><Users size={14} /> Asignar Repartidor:</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        <select
                                            className="neo-input"
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
                                    {selectedPedido.items_preview || formatOrderItems(selectedPedido)}
                                </div>
                            </div>
                            <div className="overlay-actions">
                                <button className="btn-delivered" onClick={async () => {
                                    await saveTableRecord('pedidos', 'update', { ...selectedPedido, status: 'delivered' }, selectedPedido.id);
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
                </DirectionalReveal>

                <div className="logistica-panels">
                    <DirectionalReveal className="logistica-panel neo-card drivers-panel" from="up" delay={0.16}>
                        <div className="panel-header-row">
                            <h3>Repartidores</h3>
                            <span>{driversLocations.length} con tracking</span>
                        </div>
                        {liveDriversError && (
                            <div className="risk-warning-banner" style={{ marginBottom: '0.85rem' }}>
                                <AlertCircle size={18} />
                                <span>{liveDriversError}</span>
                            </div>
                        )}
                        {driversLocations.length === 0 ? (
                            <div className="empty-delivery compact">
                                <Truck size={28} />
                                <p>No hay repartidores reportando ubicación.</p>
                            </div>
                        ) : (
                            <div className="drivers-live-list">
                                {driversLocations.map((driver) => {
                                    const identity = String(driver.firebaseUid || '').trim() || String(driver.email || '').trim().toLowerCase();
                                    const isSelected = selectedLiveDriver && (
                                        (selectedLiveDriver.firebaseUid && selectedLiveDriver.firebaseUid === driver.firebaseUid)
                                        || (selectedLiveDriver.email && selectedLiveDriver.email === driver.email)
                                    );
                                    return (
                                        <button
                                            type="button"
                                            key={identity || driver.repartidor}
                                            className={`driver-live-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => handleFocusDriver(driver)}
                                        >
                                            <div>
                                                <strong>{driver.repartidor || 'Repartidor'}</strong>
                                                <span>{formatDriverLastSeen(driver.lastSeenRaw)}</span>
                                            </div>
                                            <div className={`comp-pill ${driver.activeOrders ? 'ok' : 'missing'}`}>
                                                {driver.activeOrders ? `${driver.activeOrders} pedidos` : 'Sin pedidos'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </DirectionalReveal>

                    <DirectionalReveal className="logistica-panel logistica-sidebar neo-card" from="right" delay={0.22}>
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
                            <div className="empty-delivery compact">
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
                    </DirectionalReveal>
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
                            <button className="logistica-modal-close" onClick={() => setIsDriverModalOpen(false)} aria-label="Cerrar modal">
                                <X size={18} />
                            </button>
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
                                                    <div className="driver-staff-name">{getDriverDisplayName(driver)}</div>
                                                    <div className="driver-staff-meta">
                                                        <Mail size={12} /> {driver.email}
                                                    </div>
                                                    <div className="driver-staff-branch">{getDriverBranchLabel(driver)}</div>
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

            {/* EXPANDED MAP PORTAL */}
            {isMapExpanded && ReactDOM.createPortal(
                <div className="map-fullscreen-overlay">
                    <GoogleLogisticsMap
                        center={mapCenter}
                        zoom={mapZoom}
                        drivers={driversLocations}
                        orders={deliveryOrders}
                        getOrderCoordinates={getOrderCoordinates}
                        formatDriverLastSeen={formatDriverLastSeen}
                        onDriverSelect={handleFocusDriver}
                        onOrderSelect={handleFocusPedido}
                        className="gm-map-shell--expanded"
                    />
                    {/* Close button - inline SVG to avoid Google Maps CSS interference */}
                    <button className="map-expand-btn map-expand-btn--close" onClick={() => setIsMapExpanded(false)} title="Cerrar mapa">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4 14 10 14 10 20" />
                            <polyline points="20 10 14 10 14 4" />
                            <line x1="10" y1="14" x2="3" y2="21" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                        </svg>
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Logistica;
