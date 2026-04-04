import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { PackageSearch, Plus, Search, Edit2, Trash2, X, FolderOpen, Save, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '../context/LicenseContext';
import { desktopApi } from '../utils/desktopApi';

const ProductosCompra = () => {
    const navigate = useNavigate();
    const { isPro } = useLicense();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingItem, setEditingItem] = useState(null);
    const [qendraAvailable, setQendraAvailable] = useState(false);
    const [qendraSendStatus, setQendraSendStatus] = useState(null);

    useEffect(() => {
        desktopApi.qendraDbExists().then((exists) => setQendraAvailable(exists)).catch(() => setQendraAvailable(false));
    }, []);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        unit: 'kg', // default unit
        type: 'directo', // directo or despostada
        species: 'vaca', // default species for traceability
        sale_category: 'vaca',
        sale_price: '',
        sale_plu: ''
    });

    const items = useLiveQuery(() => db.purchase_items.toArray());
    const prices = useLiveQuery(() => db.prices.toArray());
    const categories = useLiveQuery(() => db.categories.toArray());

    // Build category map for display
    const categoryMap = React.useMemo(() => {
        if (!categories) return {};
        return categories.reduce((acc, cat) => {
            acc[cat.id] = cat.name;
            return acc;
        }, {});
    }, [categories]);

    // Flat list of categories for dropdown (could be improved with indentation for tree)
    const categoryOptions = React.useMemo(() => {
        if (!categories) return [];
        return categories.sort((a, b) => a.name.localeCompare(b.name));
    }, [categories]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.name) return;

        const nameTrimmed = formData.name.trim();
        if (!formData.sale_price || !formData.sale_plu) {
            alert('⚠️ Completa el precio y el PLU para ventas.');
            return;
        }

        const salePrice = parseFloat(formData.sale_price);
        if (Number.isNaN(salePrice) || salePrice <= 0) {
            alert('⚠️ El precio de venta debe ser un numero valido.');
            return;
        }

        if (editingItem) {
            await db.purchase_items.update(editingItem.id, {
                name: nameTrimmed,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                species: formData.type === 'despostada' ? formData.species : null
            });
            setEditingItem(null);
        } else {
            await db.purchase_items.add({
                name: nameTrimmed,
                category_id: formData.category_id ? parseInt(formData.category_id) : null,
                unit: formData.unit,
                type: formData.type,
                species: formData.type === 'despostada' ? formData.species : 'vaca',
                last_price: 0
            });
        }

        const productId = `${nameTrimmed}-${formData.sale_category}`;
        const existingStock = await db.stock
            .where('name')
            .equals(nameTrimmed)
            .and(item => item.type === formData.sale_category)
            .first();

        if (!existingStock) {
            await db.stock.add({
                name: nameTrimmed,
                type: formData.sale_category,
                quantity: 0,
                unit: formData.unit,
                updated_at: new Date(),
                synced: 0,
                reference: 'catalogo_compra'
            });
        }

        const existingPrice = await db.prices.where('product_id').equals(productId).first();
        if (existingPrice) {
            await db.prices.update(existingPrice.id, {
                price: salePrice,
                plu: formData.sale_plu.trim(),
                updated_at: new Date()
            });
        } else {
            await db.prices.add({
                product_id: productId,
                price: salePrice,
                plu: formData.sale_plu.trim(),
                updated_at: new Date()
            });
        }

        setIsModalOpen(false);
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', species: 'vaca', sale_category: 'vaca', sale_price: '', sale_plu: '' });
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Eliminar este producto del catálogo de compras?')) {
            await db.purchase_items.delete(id);
        }
    };

    const openEdit = (item) => {
        const priceRecord = prices?.find(p => p.product_id?.startsWith(`${item.name}-`));
        const existingCategory = priceRecord?.product_id?.substring(item.name.length + 1) || 'vaca';
        setEditingItem(item);
        setFormData({
            name: item.name,
            category_id: item.category_id || '',
            unit: item.unit || 'kg',
            type: item.type || 'directo',
            species: item.species || 'vaca',
            sale_category: existingCategory,
            sale_price: priceRecord?.price?.toString() || '',
            sale_plu: priceRecord?.plu || ''
        });
        setIsModalOpen(true);
    };

    const openNew = () => {
        setEditingItem(null);
        setFormData({ name: '', category_id: '', unit: 'kg', type: 'directo', species: 'vaca', sale_category: 'vaca', sale_price: '', sale_plu: '' });
        setIsModalOpen(true);
    };

    const handleSendToQendra = async (item) => {
        const priceRecord = prices?.find(p => p.product_id?.startsWith(`${item.name}-`));
        if (!priceRecord?.plu || !priceRecord?.price) {
            setQendraSendStatus({ ok: false, msg: `Sin PLU/precio definido para "${item.name}"` });
            setTimeout(() => setQendraSendStatus(null), 4000);
            return;
        }
        setQendraSendStatus({ ok: null, msg: 'Actualizando en QENDRA...' });
        const res = await desktopApi.qendraUpdatePrecio(priceRecord.plu, priceRecord.price);
        setQendraSendStatus({
            ok: res.ok,
            msg: res.ok
                ? `PLU ${priceRecord.plu} → $${priceRecord.price} actualizado en QENDRA ✓`
                : `Error QENDRA: ${res.error}`
        });
        setTimeout(() => setQendraSendStatus(null), 5000);
    };

    const filteredItems = items?.filter(i =>
        i.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="animate-fade-in" style={{ padding: '1rem' }}>
            {qendraSendStatus && (
                <div style={{
                    position: 'fixed', top: '1.2rem', right: '1.2rem', zIndex: 9999,
                    maxWidth: '420px', padding: '0.8rem 1.2rem',
                    borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '0.8rem',
                    backgroundColor: qendraSendStatus.ok === null ? '#1e3a5f' : qendraSendStatus.ok ? '#14532d' : '#7f1d1d',
                    border: `1px solid ${qendraSendStatus.ok === null ? '#3b82f6' : qendraSendStatus.ok ? '#22c55e' : '#ef4444'}`,
                    color: '#f1f5f9', fontSize: '0.9rem', boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
                }}>
                    <span>{qendraSendStatus.ok === null ? '⏳' : qendraSendStatus.ok ? '✅' : '❌'}</span>
                    <span>{qendraSendStatus.msg}</span>
                </div>
            )}
            <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 className="page-title">Catálogo de Compras</h1>
                    <p className="page-description">Define los productos que compras a proveedores</p>
                </div>
                <button className="neo-button" onClick={openNew}>
                    <Plus size={20} />
                    Nuevo Producto
                </button>
            </header>

            <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div style={{ position: 'relative' }}>
                    <Search className="text-muted" size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        className="neo-input"
                        style={{ paddingLeft: '3rem', marginBottom: 0 }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                {filteredItems?.map(item => (
                    <div key={item.id} className="neo-card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.name}</div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.85rem', alignItems: 'center' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>
                                    {item.category_id ? categoryMap[item.category_id] : 'Sin Categoría'}
                                </span>
                                <span style={{ background: 'var(--color-bg-main)', padding: '0 0.3rem', borderRadius: '4px' }}>
                                    {item.unit}
                                </span>
                                {item.type === 'despostada' && (
                                    <span style={{ background: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-primary)', padding: '0 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', border: '1px solid var(--color-primary)' }}>
                                        PARA DESPOSTAR
                                    </span>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {qendraAvailable && (
                                <button
                                    onClick={() => handleSendToQendra(item)}
                                    style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
                                    title="Enviar precio a QENDRA (balanza)"
                                >⬆️</button>
                            )}
                            <button onClick={() => openEdit(item)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}><Edit2 size={18} /></button>
                            <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={18} /></button>
                        </div>
                    </div>
                ))}
            </div>

            {isModalOpen && createPortal(
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                {editingItem ? 'Editar Producto' : 'Nuevo Producto de Compra'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>

                        <form onSubmit={handleSave}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Nombre del Producto</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="neo-input"
                                    placeholder="Ej: Media Res, Pollo Cajón..."
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>

                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Categoría</label>
                                <select
                                    className="neo-input"
                                    value={formData.category_id}
                                    onChange={e => setFormData({ ...formData, category_id: e.target.value })}
                                >
                                    <option value="">Seleccionar Categoría...</option>
                                    {categoryOptions.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                    <a href="#" onClick={(e) => { e.preventDefault(); navigate('/config/categorias'); }} style={{ color: 'var(--color-primary)' }}>Generar nueva categoría</a>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Unidad de Medida</label>
                                    <select
                                        className="neo-input"
                                        value={formData.unit}
                                        onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                    >
                                        <option value="kg">Kilogramos (kg)</option>
                                        <option value="un">Unidad (un)</option>
                                        <option value="l">Litros (l)</option>
                                        <option value="caja">Caja</option>
                                        <option value="bulto">Bulto</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Destino / Uso</label>
                                    <select
                                        className="neo-input"
                                        value={formData.type}
                                        onChange={e => setFormData({ ...formData, type: e.target.value })}
                                        disabled={!isPro}
                                    >
                                        <option value="directo">Venta Directa / Insumo</option>
                                        {isPro ? (
                                            <option value="despostada">Animal para Despostada</option>
                                        ) : (
                                            <option value="disabled" disabled>Animal para Despostada (Solo PRO)</option>
                                        )}
                                    </select>
                                    {!isPro && (
                                        <div
                                            onClick={() => navigate('/config/licencia')}
                                            style={{ fontSize: '0.7rem', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: '0.2rem' }}
                                        >
                                            <ShieldCheck size={12} /> Activar modo PRO para despostada
                                        </div>
                                    )}
                                </div>
                            </div>

                            {formData.type === 'despostada' && isPro && (
                                <div style={{ marginBottom: '1.5rem', animate: 'fade-in' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Especie de Animal</label>
                                    <select
                                        className="neo-input"
                                        style={{ border: '1px solid var(--color-primary)' }}
                                        value={formData.species}
                                        onChange={e => setFormData({ ...formData, species: e.target.value })}
                                    >
                                        <option value="vaca">Vaca / Ternera</option>
                                        <option value="cerdo">Cerdo</option>
                                        <option value="pollo">Pollo / Ave</option>
                                        <option value="pescado">Pescado</option>
                                    </select>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                                        Esto determina en qué pantalla de despostada aparecerá el stock.
                                    </p>
                                </div>
                            )}

                            <div style={{ marginBottom: '1.5rem', padding: '0.75rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                <div style={{ fontWeight: '600', marginBottom: '0.75rem' }}>Datos para Ventas</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Categoria de Venta</label>
                                        <select
                                            className="neo-input"
                                            value={formData.sale_category}
                                            onChange={e => setFormData({ ...formData, sale_category: e.target.value })}
                                        >
                                            <option value="vaca">Vaca</option>
                                            <option value="cerdo">Cerdo</option>
                                            <option value="pollo">Pollo</option>
                                            <option value="pescado">Pescado</option>
                                            <option value="pre-elaborados">Pre-elaborados</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>PLU</label>
                                        <input
                                            type="text"
                                            className="neo-input"
                                            placeholder="Ej: 111"
                                            required
                                            value={formData.sale_plu}
                                            onChange={e => setFormData({ ...formData, sale_plu: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Precio de Venta</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="neo-input"
                                        placeholder="0"
                                        required
                                        value={formData.sale_price}
                                        onChange={e => setFormData({ ...formData, sale_price: e.target.value })}
                                    />
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                                    Se crea el producto base en Stock con 0 cantidad y el precio/PLU para Ventas.
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" className="neo-button">Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default ProductosCompra;

