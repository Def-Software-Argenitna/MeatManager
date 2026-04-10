import React, { useState, useMemo } from 'react';
import { Truck, Plus, Search, Edit2, Trash2, X, MapPin, Phone, FileText, Globe, Printer } from 'lucide-react';
import { createPortal } from 'react-dom';
import { PROVINCES, MAJOR_CITIES } from '../utils/argentina_locations';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { printCurrentAccountA4 } from '../utils/printCurrentAccountA4';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const Proveedores = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [suppliers, setSuppliers] = useState([]);
    const [compras, setCompras] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [showLedgerModal, setShowLedgerModal] = useState(false);
    const [ledgerSupplier, setLedgerSupplier] = useState(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentSupplier, setPaymentSupplier] = useState(null);
    const [paymentForm, setPaymentForm] = useState({
        amount: '',
        payment_method: '',
        description: '',
        date: new Date().toISOString().slice(0, 10),
    });

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
        const [suppliersRows, comprasRows, pagosRows, paymentMethodsRows] = await Promise.all([
            fetchTable('suppliers'),
            fetchTable('compras'),
            fetchTable('caja_movimientos'),
            fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' }),
        ]);
        setSuppliers(Array.isArray(suppliersRows) ? suppliersRows : []);
        setCompras(Array.isArray(comprasRows) ? comprasRows : []);
        setPagos((Array.isArray(pagosRows) ? pagosRows : []).filter((item) => item.category === 'Pago Proveedor'));
        setPaymentMethods(Array.isArray(paymentMethodsRows) ? paymentMethodsRows : []);
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

    const activePaymentMethods = useMemo(() => {
        const methods = (paymentMethods || []).filter((m) => Number(m.enabled || 0) === 1 || m.enabled === true);
        if (methods.length > 0) return methods;
        return [
            { name: 'Efectivo', type: 'cash' },
            { name: 'Transferencia', type: 'transfer' },
            { name: 'Mercado Pago', type: 'wallet' },
            { name: 'Posnet', type: 'card' },
            { name: 'Cuenta Corriente', type: 'cuenta_corriente' },
        ];
    }, [paymentMethods]);

    const getSupplierLedger = React.useCallback((supplierName) => {
        const supplierKey = normalizeText(supplierName);
        const comprasProveedor = (compras || []).filter((c) => {
            const isSupplier = normalizeText(c.supplier) === supplierKey;
            const isAccount = Boolean(c.is_account) || ['cta_cte', 'cuenta corriente'].includes(normalizeText(c.payment_method));
            return isSupplier && isAccount;
        });

        const pagosProveedor = (pagos || []).filter((p) => {
            const bySupplierColumn = normalizeText(p.supplier) === supplierKey;
            const byDescription = normalizeText(p.description).includes(supplierKey);
            return bySupplierColumn || byDescription;
        });

        const ledgerRows = [
            ...comprasProveedor.map((c) => ({
                id: `compra-${c.id}`,
                date: c.date,
                kind: 'haber',
                concept: `Compra ${c.invoice_num ? `#${c.invoice_num}` : ''}`.trim(),
                amount: Number(c.total || 0),
                payment_method: c.payment_method || 'Cuenta Corriente',
            })),
            ...pagosProveedor.map((p) => ({
                id: `pago-${p.id}`,
                date: p.date,
                kind: 'debe',
                concept: p.description || 'Pago a proveedor',
                amount: Number(p.amount || 0),
                payment_method: p.payment_method || 'Sin definir',
            })),
        ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

        let running = 0;
        return ledgerRows.map((row) => {
            running += row.kind === 'haber' ? row.amount : -row.amount;
            return { ...row, balance: running };
        });
    }, [compras, pagos]);

    const openLedger = (supplier) => {
        setLedgerSupplier(supplier);
        setShowLedgerModal(true);
    };

    const openPayment = (supplier) => {
        setPaymentSupplier(supplier);
        setPaymentForm({
            amount: '',
            payment_method: activePaymentMethods[0]?.name || '',
            description: '',
            date: new Date().toISOString().slice(0, 10),
        });
        setShowPaymentModal(true);
    };

    const handlePrintSupplierLedger = React.useCallback((supplier) => {
        if (!supplier) return;
        const rows = getSupplierLedger(supplier.name);
        const totalDebe = rows
            .filter((row) => row.kind === 'debe')
            .reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const totalHaber = rows
            .filter((row) => row.kind === 'haber')
            .reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const saldoFinal = rows.length > 0 ? Number(rows[rows.length - 1].balance || 0) : 0;
        printCurrentAccountA4({
            entityLabel: 'Proveedor',
            entityName: supplier.name || '-',
            entityDocument: supplier.cuit || '',
            title: 'Detalle de Cuenta Corriente',
            subtitle: 'Proveedor',
            rows: rows.map((row) => ({
                date: row.date,
                concept: row.concept,
                paymentMethod: row.payment_method || '-',
                debe: row.kind === 'debe' ? Number(row.amount || 0) : 0,
                haber: row.kind === 'haber' ? Number(row.amount || 0) : 0,
                balance: Number(row.balance || 0)
            })),
            summary: {
                totalDebe,
                totalHaber,
                saldoFinal
            }
        });
    }, [getSupplierLedger]);

    const handleRegisterPayment = async (e) => {
        e.preventDefault();
        const amount = Number(paymentForm.amount || 0);
        if (!paymentSupplier || !Number.isFinite(amount) || amount <= 0) {
            alert('Ingrese un monto valido para registrar el pago.');
            return;
        }
        const selectedMethod = activePaymentMethods.find((m) => m.name === paymentForm.payment_method) || activePaymentMethods[0];
        const supplierName = String(paymentSupplier.name || '').trim();
        const userDescription = String(paymentForm.description || '').trim();
        const description = userDescription
            ? `[PROVEEDOR:${supplierName}] ${userDescription}`
            : `Pago a proveedor ${supplierName}`;
        await saveTableRecord('caja_movimientos', 'insert', {
            type: 'egreso',
            amount,
            category: 'Pago Proveedor',
            description,
            supplier: supplierName,
            payment_method: selectedMethod?.name || 'Efectivo',
            payment_method_type: selectedMethod?.type || 'cash',
            date: new Date(`${paymentForm.date}T12:00:00`).toISOString(),
        });
        await loadSuppliersData();
        setShowPaymentModal(false);
        setPaymentSupplier(null);
    };

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
                    const supplierKey = normalizeText(s.name);
                    const comprasProveedor = compras?.filter(c => normalizeText(c.supplier) === supplierKey && (c.is_account || ['cta_cte', 'cuenta corriente'].includes(normalizeText(c.payment_method)))) || [];
                    const totalHaber = comprasProveedor.reduce((sum, c) => sum + (parseFloat(c.total) || 0), 0);
                    const pagosProveedor = pagos?.filter(p => {
                        const bySupplier = normalizeText(p.supplier) === supplierKey;
                        const byDescription = normalizeText(p.description).includes(supplierKey);
                        return bySupplier || byDescription;
                    }) || [];
                    const totalDebe = pagosProveedor.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
                    const saldo = totalHaber - totalDebe;
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
                                <button className="neo-button" style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem' }} onClick={() => openLedger(s)}>Ver Cuenta Corriente</button>
                                <button className="neo-button" style={{ fontSize: '0.85rem', padding: '0.3rem 0.8rem', background: '#22c55e', color: 'white' }} onClick={() => openPayment(s)}>Registrar Pago</button>
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

            {showLedgerModal && ledgerSupplier && createPortal(
                <div className="modal-overlay" onClick={() => setShowLedgerModal(false)}>
                    <div className="modal-content neo-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', width: '92%', padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Cuenta Corriente · {ledgerSupplier.name}</h2>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <button
                                    type="button"
                                    className="neo-button"
                                    onClick={() => handlePrintSupplierLedger(ledgerSupplier)}
                                    style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                                >
                                    <Printer size={15} /> Imprimir
                                </button>
                                <button onClick={() => setShowLedgerModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)' }}><X size={24} /></button>
                            </div>
                        </div>
                        <div style={{ maxHeight: '60vh', overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-main)' }}>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Fecha</th>
                                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Concepto</th>
                                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Medio</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Debe</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Haber</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Saldo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {getSupplierLedger(ledgerSupplier.name).map((row) => (
                                        <tr key={row.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '0.6rem' }}>{row.date ? new Date(row.date).toLocaleDateString() : '-'}</td>
                                            <td style={{ padding: '0.6rem' }}>{row.concept}</td>
                                            <td style={{ padding: '0.6rem' }}>{row.payment_method || '-'}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right', color: '#ef4444' }}>{row.kind === 'debe' ? `$${row.amount.toLocaleString()}` : '-'}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right', color: '#22c55e' }}>{row.kind === 'haber' ? `$${row.amount.toLocaleString()}` : '-'}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: 700 }}>{`$${Number(row.balance || 0).toLocaleString()}`}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showPaymentModal && paymentSupplier && createPortal(
                <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
                    <div className="modal-content neo-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px', width: '92%', padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Registrar Pago · {paymentSupplier.name}</h2>
                            <button onClick={() => setShowPaymentModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)' }}><X size={24} /></button>
                        </div>
                        <form onSubmit={handleRegisterPayment}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem' }}>Monto</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="neo-input"
                                        value={paymentForm.amount}
                                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem' }}>Fecha</label>
                                    <input
                                        type="date"
                                        className="neo-input"
                                        value={paymentForm.date}
                                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, date: e.target.value }))}
                                        required
                                    />
                                </div>
                            </div>
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.4rem' }}>Medio de pago</label>
                                <select
                                    className="neo-input"
                                    value={paymentForm.payment_method}
                                    onChange={(e) => setPaymentForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                                    required
                                >
                                    {activePaymentMethods.map((method) => (
                                        <option key={method.name} value={method.name}>{method.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.4rem' }}>Descripcion (opcional)</label>
                                <input
                                    type="text"
                                    className="neo-input"
                                    placeholder={`Pago a proveedor ${paymentSupplier.name}`}
                                    value={paymentForm.description}
                                    onChange={(e) => setPaymentForm((prev) => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.2rem' }}>
                                <button type="button" onClick={() => setShowPaymentModal(false)} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.6rem 1rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>Cancelar</button>
                                <button type="submit" className="neo-button" style={{ background: '#22c55e', color: '#fff' }}>Guardar Pago</button>
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
