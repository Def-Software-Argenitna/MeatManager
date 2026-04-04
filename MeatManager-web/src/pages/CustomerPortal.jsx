import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
    ShoppingBasket,
    ArrowLeft,
    MessageCircle,
    CreditCard,
    Truck,
    Store,
    CheckCircle2,
    Minus,
    Plus,
    X
} from 'lucide-react';
import './CustomerPortal.css';

const CustomerPortal = () => {
    const [cart, setCart] = useState([]);
    const [step, setStep] = useState('browse'); // browse, checkout, success
    const [deliveryMode, setDeliveryMode] = useState('pickup');
    const [paymentMethod, setPaymentMethod] = useState('cash');

    const menuItems = useLiveQuery(() => db.menu_digital.toArray());
    const stockItems = useLiveQuery(() => db.stock.toArray());
    const settings = useLiveQuery(() => db.settings.toArray());

    const shopName = settings?.find(s => s.key === 'shop_name')?.value || 'Nuestra Carnicería';
    const whatsapp = settings?.find(s => s.key === 'whatsapp_number')?.value || '';

    const getStock = (name) => stockItems?.find(s => s.name.toLowerCase() === name.toLowerCase())?.quantity || 0;

    const addToCart = (item) => {
        const existing = cart.find(c => c.id === item.id);
        if (existing) {
            setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 0.5 } : c));
        } else {
            setCart([...cart, { ...item, qty: 1 }]);
        }
    };

    const removeFromCart = (id) => {
        const item = cart.find(c => c.id === id);
        if (item.qty > 0.5) {
            setCart(cart.map(c => c.id === id ? { ...c, qty: c.qty - 0.5 } : c));
        } else {
            setCart(cart.filter(c => c.id !== id));
        }
    };

    const total = cart.reduce((acc, i) => acc + (i.price * i.qty), 0);

    const finishOrder = () => {
        // Generate WhatsApp message with the order details
        let text = `*NUEVO PEDIDO - ${shopName}*\n\n`;
        text += `👤 *CLIENTE:* [Completar Nombre]\n`;
        text += `📍 *ENTREGA:* ${deliveryMode === 'pickup' ? 'Retiro en Local' : 'Envio a Domicilio'}\n`;
        text += `💳 *PAGO:* ${paymentMethod === 'cash' ? 'Efectivo/Transferencia' : 'Mercado Pago'}\n\n`;
        text += `🛒 *DETALLE:*\n`;
        cart.forEach(i => {
            text += `- ${i.qty}kg x ${i.product_name} ($${(i.price * i.qty).toLocaleString()})\n`;
        });
        text += `\n*TOTAL: $${total.toLocaleString()}*`;

        const waUrl = `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank');
        setStep('success');
    };

    if (step === 'success') {
        return (
            <div className="portal-container success-screen">
                <CheckCircle2 size={64} color="#22c55e" />
                <h2>¡Pedido Enviado!</h2>
                <p>Tu pedido fue enviado por WhatsApp. Te avisaremos cuando esté listo.</p>
                <button className="portal-btn-primary" onClick={() => setStep('browse')}>Volver al catálogo</button>
            </div>
        );
    }

    return (
        <div className="portal-container">
            <header className="portal-header">
                {step === 'checkout' && (
                    <button className="back-btn" onClick={() => setStep('browse')}>
                        <ArrowLeft size={20} />
                    </button>
                )}
                <h1>{shopName}</h1>
                <ShoppingBasket size={24} />
            </header>

            {step === 'browse' ? (
                <main className="portal-main">
                    <div className="portal-banner">
                        <h2>¡Hace tu pedido online! 🥩</h2>
                        <p>Frescura y calidad garantizada</p>
                    </div>

                    <div className="portal-category-list">
                        {menuItems?.map(item => {
                            const stock = getStock(item.product_name);
                            const inCart = cart.find(c => c.id === item.id);

                            return (
                                <div key={item.id} className={`portal-item-card ${stock <= 0 ? 'out-of-stock' : ''}`}>
                                    <div className="item-details">
                                        <span className="item-name">{item.product_name}</span>
                                        <span className="item-price">${item.price.toLocaleString()} /kg</span>
                                        {item.is_offer && <span className="offer-tag">OFERTA</span>}
                                    </div>
                                    <div className="item-actions">
                                        {stock <= 0 ? (
                                            <span className="no-stock-label">Sin Stock</span>
                                        ) : inCart ? (
                                            <div className="qty-controls">
                                                <button onClick={() => removeFromCart(item.id)}><Minus size={16} /></button>
                                                <span>{inCart.qty}kg</span>
                                                <button onClick={() => addToCart(item)}><Plus size={16} /></button>
                                            </div>
                                        ) : (
                                            <button className="add-btn" onClick={() => addToCart(item)}>
                                                Agregar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {cart.length > 0 && (
                        <div className="floating-cart" onClick={() => setStep('checkout')}>
                            <div className="cart-summary">
                                <span>{cart.length} productos</span>
                                <strong>$ {total.toLocaleString()}</strong>
                            </div>
                            <button className="checkout-btn">Ver Pedido</button>
                        </div>
                    )}
                </main>
            ) : (
                <main className="portal-checkout">
                    <h2>Confirmar Pedido</h2>

                    <div className="checkout-card">
                        <h3>Detalle</h3>
                        {cart.map(i => (
                            <div key={i.id} className="checkout-item">
                                <span>{i.qty}kg x {i.product_name}</span>
                                <span>$ {(i.price * i.qty).toLocaleString()}</span>
                            </div>
                        ))}
                        <div className="checkout-total">
                            <span>TOTAL</span>
                            <span>$ {total.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="checkout-card">
                        <h3>Método de Entrega</h3>
                        <div className="toggle-group">
                            <button className={deliveryMode === 'pickup' ? 'active' : ''} onClick={() => setDeliveryMode('pickup')}>
                                <Store size={18} /> Retiro
                            </button>
                            <button className={deliveryMode === 'delivery' ? 'active' : ''} onClick={() => setDeliveryMode('delivery')}>
                                <Truck size={18} /> Envío
                            </button>
                        </div>
                    </div>

                    <div className="checkout-card">
                        <h3>Forma de Pago</h3>
                        <div className="toggle-group">
                            <button className={paymentMethod === 'cash' ? 'active' : ''} onClick={() => setPaymentMethod('cash')}>
                                <DollarSign size={18} /> Efectivo / Transf.
                            </button>
                            <button className={paymentMethod === 'digital' ? 'active' : ''} onClick={() => setPaymentMethod('digital')}>
                                <CreditCard size={18} /> Mercado Pago
                            </button>
                        </div>
                    </div>

                    <button className="portal-btn-primary finalize" onClick={finishOrder}>
                        <MessageCircle size={20} /> Enviar Pedido por WhatsApp
                    </button>
                </main>
            )}
        </div>
    );
};

export default CustomerPortal;
