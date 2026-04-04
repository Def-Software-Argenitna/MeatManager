import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
    LayoutGrid,
    Plus,
    Trash2,
    Share2,
    Copy,
    Check,
    Smartphone,
    DollarSign,
    MessageCircle,
    Crown,
    Headset
} from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { BRAND_CONFIG } from '../brandConfig';
import './MenuDigital.css';

const MenuDigital = () => {
    const navigate = useNavigate();
    const [isAdding, setIsAdding] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedBot, setCopiedBot] = useState(false);
    const [copiedPortal, setCopiedPortal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const { hasModule, supportNumber, installationId } = useLicense();
    const hasMenuDigital = hasModule('menu-digital');

    const menuItems = useLiveQuery(() => db.menu_digital.toArray());
    const catalogItems = useLiveQuery(() => db.purchase_items.toArray());
    const stockItems = useLiveQuery(() => db.stock.toArray());
    const settingsArr = useLiveQuery(() => db.settings.toArray());

    const shopName = settingsArr?.find(s => s.key === 'shop_name')?.value || 'Nuestra Carnicería';
    const whatsappNumber = settingsArr?.find(s => s.key === 'whatsapp_number')?.value || '';

    const updateSetting = async (key, value) => {
        await db.settings.put({ key, value });
    };

    const getStockForItem = (name) => {
        return stockItems?.find(i => i.name.toLowerCase() === name.toLowerCase())?.quantity || 0;
    };

    const addToMenu = async (item) => {
        await db.menu_digital.add({
            product_name: item.name,
            price: item.last_price || 0,
            category: 'General',
            is_offer: false
        });
        setIsAdding(false);
    };

    const removeFromMenu = async (id) => {
        await db.menu_digital.delete(id);
    };

    const toggleOffer = async (item) => {
        await db.menu_digital.update(item.id, { is_offer: !item.is_offer });
    };

    const updatePrice = async (id, newPrice) => {
        await db.menu_digital.update(id, { price: parseFloat(newPrice) || 0 });
    };

    const generateCatalogLink = () => {
        const phone = whatsappNumber.replace(/\D/g, '');
        const availableItems = menuItems?.filter(i => getStockForItem(i.product_name) > 0) || [];

        let text = `*${shopName} - Menú Digital* 🥩\n\n`;
        text += `¡Hola! 👋 Para pedir, simplemente respondé con el *NÚMERO* y la *CANTIDAD* (kg o piezas).\n\n`;
        text += `*PRODUCTOS DISPONIBLES:*\n`;

        availableItems.forEach((item, index) => {
            text += `${index + 1}. ${item.product_name} -> *$${item.price.toLocaleString()}/kg* ${item.is_offer ? '🔥' : ''}\n`;
        });

        text += `\n--- \n`;
        text += `✍️ *TU PEDIDO:* \n`;
        text += `(Ejemplo: 1-2kg, 3-1.5kg, 5-1pieza)\n\n`;
        text += `*FORMA DE PAGO:* [Efectivo / Transferencia / Tarjeta]`;

        return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    };

    const copyLink = () => {
        navigator.clipboard.writeText(generateCatalogLink());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="menu-digital-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Configuración Menú Digital</h1>
                    <p className="page-description">Elegí qué cortes mostrar y gestioná tus precios de venta</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {!hasMenuDigital && (
                        <button className="neo-button" onClick={copyLink}>
                            {copied ? <Check size={20} color="#22c55e" /> : <Share2 size={20} />}
                            {copied ? 'Copiado!' : 'Copiar Lista (Manual)'}
                        </button>
                    )}
                    <button className="neo-button pro-btn" onClick={() => setIsAdding(true)}>
                        <Plus size={20} /> Agregar Producto
                    </button>
                </div>
            </header>

            <div className="menu-settings-bar neo-card animate-fade-in" style={{ marginBottom: '1.5rem', padding: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.2rem' }}>Nombre del Local</label>
                    <input
                        type="text"
                        className="blank-input"
                        placeholder="Ej: Carnicería El Toro"
                        value={shopName}
                        onChange={(e) => updateSetting('shop_name', e.target.value)}
                        style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
                    />
                </div>
                <div style={{ flex: 1.2, borderLeft: '1px solid var(--color-border)', paddingLeft: '1.5rem' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.2rem' }}>Dirección (Para el Ticket)</label>
                    <input
                        type="text"
                        className="blank-input"
                        placeholder="Ej: Av. Rivadavia 1234, CABA"
                        value={settingsArr?.find(s => s.key === 'shop_address')?.value || ''}
                        onChange={(e) => updateSetting('shop_address', e.target.value)}
                        style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
                    />
                </div>
                <div style={{ flex: 1, borderLeft: '1px solid var(--color-border)', paddingLeft: '1.5rem' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.2rem' }}>WhatsApp (54911...)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <MessageCircle size={18} color="#25D366" />
                        <input
                            type="text"
                            className="blank-input"
                            placeholder="5491100000000"
                            value={whatsappNumber}
                            onChange={(e) => updateSetting('whatsapp_number', e.target.value)}
                            style={{ fontSize: '1.1rem', fontWeight: 'bold', width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
                        />
                    </div>
                </div>
            </div>

            {hasMenuDigital ? (
                <div className="bot-config-area animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                    <div className="neo-card" style={{ padding: '1.25rem', borderLeft: '4px solid #25D366' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <MessageCircle size={20} color="#25D366" />
                            <h3 style={{ margin: 0 }}>Mensaje del "Bot" (Auto-respuesta) <span className="pro-badge-small">PRO</span></h3>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                            Copiá este mensaje y pegalo en tu aplicación de "Respuesta Automática" de WhatsApp:
                        </p>
                        <div className="code-box" style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', whiteSpace: 'pre-wrap', position: 'relative' }}>
                            {`¡Hola! 👋 Bienvenido a *${shopName}*.\n\n¿En qué podemos ayudarte?\n\n1️⃣ *Realizar un Pedido Online* (Ver precios y stock)\n2️⃣ *Hacer una consulta* (Hablar con un humano)\n\n_Respondé con el número de tu opción._`}
                            <button
                                className="icon-btn"
                                style={{ position: 'absolute', top: '5px', right: '5px', color: copiedBot ? '#22c55e' : 'inherit' }}
                                onClick={() => {
                                    navigator.clipboard.writeText(`¡Hola! 👋 Bienvenido a *${shopName}*.\n\n¿En qué podemos ayudarte?\n\n1️⃣ *Realizar un Pedido Online* (Ver precios y stock)\n2️⃣ *Hacer una consulta* (Hablar con un humano)\n\n_Respondé con el número de tu opción._`);
                                    setCopiedBot(true);
                                    setTimeout(() => setCopiedBot(false), 2000);
                                }}
                            >
                                {copiedBot ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>

                    <div className="neo-card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--color-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <LayoutGrid size={20} color="var(--color-primary)" />
                            <h3 style={{ margin: 0 }}>Link de tu Portal de Clientes <span className="pro-badge-small">PRO</span></h3>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                            El "Bot" enviará este link cuando el cliente elija la **Opción 1**:
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <input
                                type="text"
                                readOnly
                                className="neo-input"
                                value={`${window.location.origin}/#/catalogo`}
                                style={{ flex: 1 }}
                            />
                            <button
                                className="neo-button"
                                style={{ minWidth: '120px', justifyContent: 'center', color: copiedPortal ? '#22c55e' : 'inherit' }}
                                onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/#/catalogo`);
                                    setCopiedPortal(true);
                                    setTimeout(() => setCopiedPortal(false), 2000);
                                }}
                            >
                                {copiedPortal ? <Check size={20} /> : <Copy size={20} />}
                                {copiedPortal ? 'Copiado!' : 'Copiar'}
                            </button>
                        </div>

                        <div style={{ background: 'var(--color-bg-secondary)', padding: '1rem', borderRadius: '12px', border: '1px dashed var(--color-border)' }}>
                            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.75rem 0' }}>
                                💡 <strong>Importante:</strong> Para que tus clientes vean el portal desde sus celulares, necesitás "subirlo" a internet.
                            </p>
                            <button
                                className="neo-button full-width"
                                style={{ gap: '0.5rem', background: '#1e293b', color: 'white' }}
                                onClick={() => {
                                    const msg = `Hola! Soy de *${shopName}* y tengo el módulo Menú Digital activo en MeatManager. Me gustaría pedir un turno para configurar mi Portal de Clientes en Vercel. Mi ID de Instalación es: ${installationId || 'N/A'}`;
                                    window.open(`https://wa.me/${supportNumber}?text=${encodeURIComponent(msg)}`, '_blank');
                                }}
                            >
                                <Headset size={18} /> Solicitar Configuración Online
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="neo-card pro-locked-banner" style={{ marginBottom: '1.5rem', padding: '1.5rem', background: 'linear-gradient(135deg, #1e293b, #0f172a)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ background: 'gold', padding: '0.75rem', borderRadius: '50%' }}>
                            <Crown color="#000" size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Pasate a PRO para automatizar tus ventas</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>Bot de auto-respuesta, Portal con carrito de compras y más.</p>
                        </div>
                    </div>
                    <button
                        className="neo-button"
                        style={{ background: 'gold', color: 'black', fontWeight: 'bold' }}
                        onClick={() => navigate('/config/licencia')}
                    >
                        Conocer Planes PRO
                    </button>
                </div>
            )}

            <div className="pro-grid-layout">
                {/* PREVIEW PANEL */}
                <div className="menu-preview-panel neo-card">
                    <div className="phone-mockup">
                        <div className="phone-screen">
                            <div className="whatsapp-header">
                                <Smartphone size={16} />
                                <span>Vista previa en Celular</span>
                            </div>
                            <div className="menu-content">
                                <h2 className="shop-name">🥩 {shopName}</h2>
                                <p className="menu-tagline">Precios del día {new Date().toLocaleDateString()}</p>

                                <div className="preview-items">
                                    {menuItems?.map((item, index) => {
                                        const stock = getStockForItem(item.product_name);
                                        const hasStock = stock > 0;

                                        return (
                                            <div key={item.id} className={`preview-item ${item.is_offer ? 'is-offer' : ''} ${!hasStock ? 'no-stock' : ''}`} style={{ opacity: hasStock ? 1 : 0.6 }}>
                                                <div className="item-info">
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span className="item-number" style={{ fontWeight: 'bold', color: 'var(--color-primary)', fontSize: '0.8rem' }}>{index + 1}.</span>
                                                        <span className="item-name">{item.product_name}</span>
                                                    </div>
                                                    {item.is_offer && hasStock && <span className="offer-badge">OFERTA</span>}
                                                    {!hasStock && <span style={{ fontSize: '0.6rem', color: '#ef4444', fontWeight: 'bold' }}>SIN STOCK</span>}
                                                </div>
                                                <span className="item-price">
                                                    {hasStock ? `$${(item.price / 1000).toFixed(1)}k /kg` : '---'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {menuItems?.length === 0 && (
                                        <p style={{ textAlign: 'center', color: '#999', marginTop: '2rem' }}>No hay productos en el menú.</p>
                                    )}
                                </div>
                                <div className="whatsapp-footer">
                                    Haz clic en el botón para pedir por WhatsApp
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* MANAGEMENT PANEL */}
                <div className="menu-mgmt-panel">
                    <div className="neo-card" style={{ padding: '1.5rem' }}>
                        <h3>Productos en el Menú</h3>
                        <div className="items-table-scroll">
                            <table className="menu-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Producto</th>
                                        <th>Precio /kg</th>
                                        <th>Stock</th>
                                        <th>Oferta</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {menuItems?.map((item, index) => {
                                        const stock = getStockForItem(item.product_name);
                                        return (
                                            <tr key={item.id}>
                                                <td><span className="menu-index">{index + 1}</span></td>
                                                <td style={{ fontWeight: 'bold' }}>{item.product_name}</td>
                                                <td>
                                                    <div className="price-input-wrapper">
                                                        <DollarSign size={14} />
                                                        <input
                                                            type="number"
                                                            value={item.price}
                                                            onChange={(e) => updatePrice(item.id, e.target.value)}
                                                        />
                                                    </div>
                                                </td>
                                                <td>
                                                    <span style={{
                                                        color: stock > 5 ? 'var(--color-primary)' : (stock > 0 ? '#f59e0b' : '#ef4444'),
                                                        fontWeight: 'bold',
                                                        fontSize: '0.9rem'
                                                    }}>
                                                        {stock.toFixed(1)} kg
                                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        className={`offer-toggle ${item.is_offer ? 'active' : ''}`}
                                                        onClick={() => toggleOffer(item)}
                                                        disabled={stock <= 0}
                                                        style={{ opacity: stock <= 0 ? 0.5 : 1 }}
                                                    >
                                                        {item.is_offer ? '🔥 Sí' : 'No'}
                                                    </button>
                                                </td>
                                                <td>
                                                    <button className="delete-btn" onClick={() => removeFromMenu(item.id)}>
                                                        <Trash2 size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* ADD MODAL */}
            {isAdding && (
                <div className="modal-overlay" onClick={() => setIsAdding(false)}>
                    <div className="modal-content neo-card" style={{ maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
                        <h2>Agregar al Menú Digital</h2>
                        <div className="search-box">
                            <input
                                type="text"
                                className="neo-input"
                                placeholder="Buscar en catálogo..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="catalog-selection-list">
                            {catalogItems?.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase())).map(item => (
                                <div key={item.id} className="catalog-selection-item" onClick={() => addToMenu(item)}>
                                    <span>{item.name}</span>
                                    <Plus size={18} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MenuDigital;
