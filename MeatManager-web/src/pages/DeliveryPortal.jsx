import React, { useState, useEffect } from 'react';
import {
    Truck,
    MapPin,
    Navigation2,
    CheckCircle2,
    Phone,
    LogOut,
    Clock,
    User
} from 'lucide-react';
import { fdb } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import './DeliveryPortal.css';

const DeliveryPortal = () => {
    const [repartidorName, setRepartidorName] = useState(localStorage.getItem('delivery_name') || '');
    const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('delivery_name'));
    const [lastLocation, setLastLocation] = useState(null);
    const [cloudOrders, setCloudOrders] = useState([]);

    // CLOUD SYNC: Listen for orders assigned in Firestore
    useEffect(() => {
        if (!isLoggedIn || !repartidorName) return;

        const q = query(
            collection(fdb, "orders_delivery"),
            where("repartidor", "==", repartidorName),
            where("status", "!=", "delivered")
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const orders = [];
            snapshot.forEach((doc) => {
                orders.push({ cloudId: doc.id, ...doc.data() });
            });
            setCloudOrders(orders);
        });

        return () => unsub();
    }, [isLoggedIn, repartidorName]);

    // Track location & Push to Cloud
    useEffect(() => {
        if (!isLoggedIn) return;

        const watchId = navigator.geolocation.watchPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                setLastLocation({ lat: latitude, lng: longitude });

                // PUSH TO FIREBASE: Real-time tracking for the carnicería
                try {
                    await setDoc(doc(fdb, "drivers_locations", repartidorName), {
                        lat: latitude,
                        lng: longitude,
                        time: new Date().toISOString(),
                        repartidor: repartidorName
                    });
                } catch (err) {
                    console.error("Firebase Location Error:", err);
                }
            },
            (err) => console.error("Error tracking location:", err),
            { enableHighAccuracy: true }
        );

        return () => navigator.geolocation.clearWatch(watchId);
    }, [isLoggedIn, repartidorName]);

    const handleLogin = (e) => {
        e.preventDefault();
        const name = e.target.name.value;
        if (!name) return;
        localStorage.setItem('delivery_name', name);
        setRepartidorName(name);
        setIsLoggedIn(true);
    };

    const handleLogout = () => {
        localStorage.removeItem('delivery_name');
        setIsLoggedIn(false);
        setRepartidorName('');
    };

    const markAsDelivered = async (cloudId) => {
        try {
            // Update in Firestore: Logistics dashboard will react to this change
            await updateDoc(doc(fdb, "orders_delivery", cloudId), {
                status: 'delivered',
                delivered_at: new Date().toISOString()
            });
        } catch (err) {
            console.error("Error marking as delivered:", err);
            alert("Error al sincronizar entrega. Verificá tu conexión.");
        }
    };

    if (!isLoggedIn) {
        return (
            <div className="delivery-auth-container">
                <div className="auth-card animate-fade-in">
                    <div className="icon-circle">
                        <Truck size={40} color="white" />
                    </div>
                    <h1>Portal de Reparto</h1>
                    <p>Ingresá tu nombre para ver tus pedidos asignados.</p>
                    <form onSubmit={handleLogin}>
                        <div className="input-group">
                            <User size={20} />
                            <input name="name" type="text" placeholder="Tu Nombre (Ej: Juan)" required />
                        </div>
                        <button type="submit" className="login-btn">Comenzar Turno</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="delivery-portal-container animate-fade-in">
            <header className="delivery-header">
                <div className="user-info">
                    <div className="avatar">{repartidorName.charAt(0).toUpperCase()}</div>
                    <div>
                        <h3>Hola, {repartidorName}</h3>
                        <p className="status-online">● En línea y rastreando</p>
                    </div>
                </div>
                <button className="logout-btn" onClick={handleLogout}>
                    <LogOut size={20} />
                </button>
            </header>

            <main className="delivery-main">
                <div className="section-title">
                    <Clock size={16} />
                    <span>Tus Repartos Pendientes ({cloudOrders.length})</span>
                </div>

                <div className="orders-cards-list">
                    {cloudOrders.length === 0 ? (
                        <div className="empty-delivery-state">
                            <CheckCircle2 size={48} color="#22c55e" />
                            <p>¡Todo entregado! Esperando nuevas asignaciones...</p>
                        </div>
                    ) : (
                        cloudOrders.map(pedido => (
                            <div key={pedido.cloudId} className="delivery-order-card">
                                <div className="card-top">
                                    <span className="order-tag">#{pedido.id || pedido.cloudId}</span>
                                    <span className={`status-pill ${pedido.status}`}>
                                        {pedido.status === 'ready' ? 'Listo para salir' : 'Pendiente'}
                                    </span>
                                </div>

                                <div className="card-body">
                                    <h2 className="customer-name">{pedido.customer_name}</h2>
                                    <div className="address-box">
                                        <MapPin size={18} color="#ef4444" />
                                        <span>{pedido.address}</span>
                                    </div>
                                    <div className="items-box">
                                        <strong>Detalle:</strong>
                                        <p>{pedido.items}</p>
                                    </div>
                                </div>

                                <div className="card-actions">
                                    <button className="action-btn gps" onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(pedido.address)}`, '_blank')}>
                                        <Navigation2 size={18} /> GPS
                                    </button>
                                    <button className="action-btn call" onClick={() => window.open(`tel:${pedido.customer_phone || ''}`)}>
                                        <Phone size={18} /> Llamar
                                    </button>
                                </div>

                                <button className="deliver-confirm-btn" onClick={() => markAsDelivered(pedido.cloudId.toString())}>
                                    <CheckCircle2 size={20} /> Marcar como Entregado
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </main>

            <footer className="delivery-footer">
                <p>Ubicación actual: {lastLocation ? `${lastLocation.lat.toFixed(4)}, ${lastLocation.lng.toFixed(4)}` : 'Buscando señal...'}</p>
            </footer>
        </div>
    );
};

export default DeliveryPortal;
