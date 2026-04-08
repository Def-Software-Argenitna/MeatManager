import React, { useState, useMemo } from 'react';
import { Truck, Plus, Search, Edit2, Trash2, X, MapPin, Phone, FileText, Globe } from 'lucide-react';
import { createPortal } from 'react-dom';
import { PROVINCES, MAJOR_CITIES } from '../utils/argentina_locations';
import { fetchTable, saveTableRecord } from '../utils/apiClient';

const Proveedores = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [suppliers, setSuppliers] = useState([]);
    const [compras, setCompras] = useState([]);
    const [pagos, setPagos] = useState([]);

    const [formData, setFormData] = useState({
        name: '',
        cuit: '',
        iva_condition: 'Responsable Inscripto',
        phone: '',
        street: '',
        number: '',
        floor_dept: '',
        neighborhood: '',
        city: '',
        province: 'Buenos Aires',
        zip_code: '',
        email: ''
    });

    const ivaConditions = [
        'Responsable Inscripto',
        'Monotributista',
        'Exento',
        'Consumidor Final',
        'No Responsable'
    ];

    const loadSuppliersData = React.useCallback(async () => {
        const [suppliersRows, comprasRows, pagosRows] = await Promise.all([
            fetchTable('suppliers'),
            fetchTable('compras'),
            fetchTable('caja_movimientos'),
        ]);
        setSuppliers(Array.isArray(suppliersRows) ? suppliersRows : []);
        setCompras(Array.isArray(comprasRows) ? comprasRows : []);
        setPagos((Array.isArray(pagosRows) ? pagosRows : []).filter((item) => item.category === 'Pago Proveedor'));
    }, []);

    React.useEffect(() => {
        loadSuppliersData().catch((error) => console.error('Error cargando proveedores:', error));
    }, [loadSuppliersData]);

    const resetForm = () => {
        setFormData({
            name: '', cuit: '', iva_condition: 'Responsable Inscripto',
            phone: '', street: '', number: '', floor_dept: '',
            neighborhood: '', city: '', province: 'Buenos Aires',
            zip_code: '', email: ''
        });
        setEditingId(null);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.name) return;

        try {
            if (editingId) {
                await saveTableRecord('suppliers', 'update', formData, editingId);
            } else {
                await saveTableRecord('suppliers', 'insert', formData);
            }
            await loadSuppliersData();
            setIsModalOpen(false);
            resetForm();
        } catch (error) {
            console.error("Error saving supplier:", error);
            alert("Error al guardar proveedor. Verifique los datos.");
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Seguro que desea eliminar este proveedor?')) {
            await saveTableRecord('suppliers', 'delete', null, id);
            await loadSuppliersData();
        }
    };

    const openEdit = (supplier) => {
        // Handle migration of old single 'address' field if needed
        const updatedSupplier = { ...supplier };
        if (supplier.address && !supplier.street) {
            updatedSupplier.street = supplier.address;
        }
        setFormData(updatedSupplier);
        setEditingId(supplier.id);
        setIsModalOpen(true);
    };

    const filteredSuppliers = suppliers?.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.cuit.includes(searchTerm) ||
        (s.city && s.city.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const availableCities = useMemo(() => {
        return MAJOR_CITIES[formData.province] || [];
    }, [formData.province]);

    return (
        <div className="animate-fade-in">
            <header className="page-header">
                
                <div className="page-header-actions">
                    <button className="neo-button" onClick={() => { resetForm(); setIsModalOpen(true); }}>
                        <Plus size={20} />
                        Nuevo Proveedor
                    </button>
                </div>
            </header>

            <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div style={{ position: 'relative' }}>
                    <Search className="text-muted" size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Buscar por Razón Social, CUIT o Localidad..."
                        className="neo-input"
                        style={{ paddingLeft: '3rem', marginBottom: 0 }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '1.5rem' }}>
                {filteredSuppliers?.map(s => {
                    // Calcular saldo de cuenta corriente
                    const comprasProveedor = compras?.filter(c => c.supplier === s.name && (c.is_account || c.payment_method === 'cta_cte')) || [];
                    const totalDebe = comprasProveedor.reduce((sum, c) => sum + (parseFloat(c.total) || 0), 0);
                    const pagosProveedor = pagos?.filter(p => p.supplier === s.name) || [];
                    const totalHaber = pagosProveedor.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
                    const saldo = totalDebe - totalHaber;
                    return (
                    <div key={s.id} className="neo-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <div>
                                <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{s.name}</h3>
                                <div style={{ fontSize: '0.85rem', color: 'var(--color-primary)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <FileText size={14} /> {s.iva_condition}
                                </div>
                            </div>
                            <div style={{ background: 'var(--color-bg-main)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid var(--color-border)' }}>
                                {s.cuit || 'S/D'}
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                            <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem' }}>
                                <MapPin size={16} style={{ marginTop: '0.2rem' }} />
                                <div>
                                    {s.street} {s.number} {s.floor_dept && `(${s.floor_dept})`}<br />
                                    {s.neighborhood && `${s.neighborhood}, `}{s.city}, {s.province} {s.zip_code && `(CP: ${s.zip_code})`}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                {s.phone && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Phone size={16} /> {s.phone}
                                    </div>
                                )}
                                {s.email && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Globe size={16} /> {s.email}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 'bold', color: saldo > 0 ? '#ef4444' : '#22c55e' }}>
                                    Cuenta Corriente: ${Number(saldo || 0).toLocaleString()}
                                </span>
                                <button className="neo-button" style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem' }} onClick={() => alert('Movimientos no implementado aún')}>Ver Movimientos</button>
                                <button className="neo-button" style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem', background: '#22c55e', color: 'white' }} onClick={() => alert('Registrar pago no implementado aún')}>Registrar Pago</button>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                <button onClick={() => openEdit(s)} className="neo-button" style={{ background: 'transparent', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                                    <Edit2 size={16} /> Editar
                                </button>
                                <button onClick={() => handleDelete(s.id)} className="neo-button" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                                    <Trash2 size={16} /> Eliminar
                                </button>
                            </div>
                        </div>
                    </div>
                    );
                })}
            </div>

            {isModalOpen && createPortal(
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px', width: '90%', padding: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)' }}><X size={24} /></button>
                        </div>

                        <form onSubmit={handleSave}>
                            <h4 style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Datos Fiscales</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ gridColumn: 'span 1' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Razón Social *</label>
                                    <input
                                        type="text" autoFocus required className="neo-input" placeholder="Nombre de la empresa"
                                        value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>CUIT</label>
                                    <input
                                        type="text" className="neo-input" placeholder="20-XXXXXXXX-X"
                                        value={formData.cuit} onChange={e => setFormData({ ...formData, cuit: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Condición IVA</label>
                                    <select
                                        className="neo-input"
                                        value={formData.iva_condition} onChange={e => setFormData({ ...formData, iva_condition: e.target.value })}
                                    >
                                        {ivaConditions.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            <h4 style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ubicación y Logística</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Calle</label>
                                    <input type="text" className="neo-input" placeholder="Ej: Av. Rivadavia" value={formData.street} onChange={e => setFormData({ ...formData, street: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Número</label>
                                    <input type="text" className="neo-input" placeholder="1234" value={formData.number} onChange={e => setFormData({ ...formData, number: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Piso / Depto</label>
                                    <input type="text" className="neo-input" placeholder="2do B" value={formData.floor_dept} onChange={e => setFormData({ ...formData, floor_dept: e.target.value })} />
                                </div>

                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Provincia</label>
                                    <select className="neo-input" value={formData.province} onChange={e => setFormData({ ...formData, province: e.target.value, city: '' })}>
                                        {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Localidad / Ciudad</label>
                                    <input
                                        type="text" list="city-options" className="neo-input" placeholder="Escriba o seleccione..."
                                        value={formData.city} onChange={e => setFormData({ ...formData, city: e.target.value })}
                                    />
                                    <datalist id="city-options">
                                        {availableCities.map(c => <option key={c} value={c} />)}
                                    </datalist>
                                </div>

                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Barrio / Zona</label>
                                    <input type="text" className="neo-input" placeholder="Ej: Palermo" value={formData.neighborhood} onChange={e => setFormData({ ...formData, neighborhood: e.target.value })} />
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>Código Postal</label>
                                    <input type="text" className="neo-input" placeholder="Ej: B1640" value={formData.zip_code} onChange={e => setFormData({ ...formData, zip_code: e.target.value })} />
                                </div>
                            </div>

                            <h4 style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contacto</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Teléfono de Pedidos</label>
                                    <input
                                        type="text" className="neo-input" placeholder="Cod.Area + Numero"
                                        value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Email / Web</label>
                                    <input
                                        type="text" className="neo-input" placeholder="ventas@proveedor.com"
                                        value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1.5rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>Cancelar</button>
                                <button type="submit" className="neo-button" style={{ padding: '0.75rem 2rem' }}>{editingId ? 'Actualizar' : 'Guardar'} Proveedor</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Proveedores;
