import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, X, MapPin, Phone, FileText, Globe, Printer, Building2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { PROVINCES, MAJOR_CITIES } from '../utils/argentina_locations';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { printCurrentAccountA4 } from '../utils/printCurrentAccountA4';
import { Button, EmptyState, Modal, Skeleton, SkeletonLine, SkeletonCard, useToast } from '../components/ui';

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const CASH_ACCOUNTS = [
    { value: 'principal', label: 'Caja Principal' },
    { value: 'secondary', label: 'Caja Secundaria' },
];
const isMixedPaymentMethod = (method) => (
    normalizeText(method?.type) === 'mixed'
    || normalizeText(method?.type) === 'mixto'
    || normalizeText(method?.name).includes('mixto')
    || normalizeText(method?.name).includes('mixed')
);
const isCurrentAccountMethod = (method) => (
    normalizeText(method?.type) === 'cuenta_corriente'
    || normalizeText(method?.name).includes('cuenta corriente')
);
const isCurrentAccountPurchase = (purchase) => (
    Boolean(purchase?.is_account)
    || ['cta_cte', 'cuenta corriente'].includes(normalizeText(purchase?.payment_method))
);
const isCashPaymentMethod = (method) => (
    normalizeText(method?.type) === 'cash'
    || normalizeText(method?.name) === 'efectivo'
);
const formatCurrency = (value) => `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})}`;

const Proveedores = () => {
    const toast = useToast();
    const [isLoading, setIsLoading] = useState(true);
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
    const [selectedPurchaseDetail, setSelectedPurchaseDetail] = useState(null);
    const [paymentForm, setPaymentForm] = useState({
        amount: '',
        payment_method: '',
        description: '',
        date: new Date().toISOString().slice(0, 10),
        cash_account: 'principal',
        payment_mode: 'full',
    });
    const [supplierPaymentSplits, setSupplierPaymentSplits] = useState([]);

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
        const [suppliersRows, comprasRows, comprasItemsRows, pagosRows, paymentMethodsRows] = await Promise.all([
            fetchTable('suppliers'),
            fetchTable('compras'),
            fetchTable('compras_items', { limit: 5000, orderBy: 'id', direction: 'ASC' }),
            fetchTable('caja_movimientos'),
            fetchTable('payment_methods', { limit: 200, orderBy: 'id', direction: 'ASC' }),
        ]);
        const itemsByPurchaseId = new Map();
        (Array.isArray(comprasItemsRows) ? comprasItemsRows : []).forEach((item) => {
            const key = Number(item.purchase_id);
            const list = itemsByPurchaseId.get(key) || [];
            list.push({ ...item, name: item.product_name || item.name || '' });
            itemsByPurchaseId.set(key, list);
        });
        setSuppliers(Array.isArray(suppliersRows) ? suppliersRows : []);
        setCompras((Array.isArray(comprasRows) ? comprasRows : []).map((compra) => ({
            ...compra,
            items_detail: compra.items_detail || itemsByPurchaseId.get(Number(compra.id)) || [],
        })));
        setPagos((Array.isArray(pagosRows) ? pagosRows : []).filter((item) => item.category === 'Pago Proveedor'));
        setPaymentMethods(Array.isArray(paymentMethodsRows) ? paymentMethodsRows : []);
    }, []);

    React.useEffect(() => {
        loadSuppliersData().catch((error) => console.error('Error cargando proveedores:', error)).finally(() => setIsLoading(false));
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
            toast.error("Error al guardar proveedor. Verifique los datos.");
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
            { name: 'Mixto', type: 'mixed' },
            { name: 'Cuenta Corriente', type: 'cuenta_corriente' },
        ];
    }, [paymentMethods]);

    const supplierPaymentMethods = useMemo(
        () => activePaymentMethods.filter((method) => !isCurrentAccountMethod(method)),
        [activePaymentMethods]
    );

    const splitPaymentMethods = useMemo(
        () => supplierPaymentMethods.filter((method) => !isMixedPaymentMethod(method)),
        [supplierPaymentMethods]
    );

    const selectedPaymentMethod = useMemo(
        () => supplierPaymentMethods.find((method) => method.name === paymentForm.payment_method) || null,
        [supplierPaymentMethods, paymentForm.payment_method]
    );
    const isMixedSupplierPayment = isMixedPaymentMethod(selectedPaymentMethod);
    const supplierSplitTotal = supplierPaymentSplits.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const supplierSplitPending = Math.max(0, Number(paymentForm.amount || 0) - supplierSplitTotal);

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
                purchaseId: c.id,
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
        const defaultMethod = supplierPaymentMethods.find((method) => !isMixedPaymentMethod(method)) || supplierPaymentMethods[0];
        const rows = getSupplierLedger(supplier.name);
        const currentDebt = Math.max(0, Number(rows[rows.length - 1]?.balance || 0));
        setPaymentSupplier(supplier);
        setPaymentForm({
            amount: currentDebt > 0 ? String(currentDebt) : '',
            payment_method: defaultMethod?.name || '',
            description: '',
            date: new Date().toISOString().slice(0, 10),
            cash_account: 'principal',
            payment_mode: 'full',
        });
        setSupplierPaymentSplits([]);
        setShowPaymentModal(true);
    };

    const seedSupplierSplitPayments = React.useCallback((amountValue = paymentForm.amount) => {
        const defaultMethod = splitPaymentMethods.find((method) => method.type === 'cash') || splitPaymentMethods[0];
        const secondMethod = splitPaymentMethods.find((method) => method.name !== defaultMethod?.name) || defaultMethod;
        const rows = [];
        if (defaultMethod) {
            rows.push({
                methodName: defaultMethod.name,
                amount: '',
                cash_account: 'principal',
            });
        }
        if (secondMethod) {
            rows.push({
                methodName: secondMethod.name,
                amount: rows.length === 0 && amountValue ? String(amountValue) : '',
                cash_account: 'principal',
            });
        }
        setSupplierPaymentSplits(rows);
    }, [paymentForm.amount, splitPaymentMethods]);

    const updateSupplierSplit = (index, field, value) => {
        setSupplierPaymentSplits((prev) => prev.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [field]: value } : row
        )));
    };

    const addSupplierSplit = () => {
        const defaultMethod = splitPaymentMethods.find((method) => method.type === 'cash') || splitPaymentMethods[0];
        if (!defaultMethod) return;
        setSupplierPaymentSplits((prev) => [...prev, { methodName: defaultMethod.name, amount: '', cash_account: 'principal' }]);
    };

    const removeSupplierSplit = (index) => {
        setSupplierPaymentSplits((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    };

    const openPurchaseDetailFromLedger = React.useCallback((row) => {
        if (row?.kind !== 'haber' || !row?.purchaseId) return;
        const purchase = (compras || []).find((item) => Number(item.id) === Number(row.purchaseId));
        if (!purchase) return;
        setSelectedPurchaseDetail(purchase);
    }, [compras]);

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

    const paymentSupplierDebt = useMemo(() => {
        if (!paymentSupplier) return 0;
        const rows = getSupplierLedger(paymentSupplier.name);
        return Math.max(0, Number(rows[rows.length - 1]?.balance || 0));
    }, [getSupplierLedger, paymentSupplier]);

    const handleRegisterPayment = async (e) => {
        e.preventDefault();
        const amount = Number(paymentForm.amount || 0);
        if (!paymentSupplier || !Number.isFinite(amount) || amount <= 0) {
            toast.warning('Ingrese un monto valido para registrar el pago.');
            return;
        }
        const selectedMethod = supplierPaymentMethods.find((m) => m.name === paymentForm.payment_method) || supplierPaymentMethods[0];
        if (!selectedMethod) {
            toast.error('No hay medios de pago reales configurados para registrar el pago.');
            return;
        }
        const supplierName = String(paymentSupplier.name || '').trim();
        const userDescription = String(paymentForm.description || '').trim();
        const description = userDescription
            ? `[PROVEEDOR:${supplierName}] ${userDescription}`
            : `Pago a proveedor ${supplierName}`;
        const cashAccount = paymentForm.cash_account || 'principal';
        const paymentDate = new Date(`${paymentForm.date}T12:00:00`).toISOString();
        const rowsToSave = isMixedPaymentMethod(selectedMethod)
            ? supplierPaymentSplits.map((row) => {
                const method = splitPaymentMethods.find((item) => item.name === row.methodName) || splitPaymentMethods[0];
                return {
                    method,
                    amount: Number(row.amount || 0),
                    cashAccount: row.cash_account || 'principal',
                };
            }).filter((row) => row.method && Number.isFinite(row.amount) && row.amount > 0)
            : [{ method: selectedMethod, amount, cashAccount }];

        if (isMixedPaymentMethod(selectedMethod)) {
            const total = rowsToSave.reduce((sum, row) => sum + row.amount, 0);
            if (rowsToSave.length === 0) {
                toast.warning('Agregue al menos un medio de pago para el pago mixto.');
                return;
            }
            if (Math.abs(total - amount) > 0.009) {
                toast.warning(`El detalle del pago mixto debe sumar exactamente $${amount.toLocaleString('es-AR')}. Falta o sobra $${Math.abs(amount - total).toLocaleString('es-AR')}.`);
                return;
            }
        }

        const groupId = isMixedPaymentMethod(selectedMethod)
            ? `prov_mix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            : null;

        for (const row of rowsToSave) {
            await saveTableRecord('caja_movimientos', 'insert', {
                type: 'egreso',
                amount: row.amount,
                category: 'Pago Proveedor',
                money_flow_kind: 'supplier_payment',
                origin_table: 'suppliers',
                origin_id: paymentSupplier?.id || null,
                origin_group_id: groupId || `supplier_payment_${Date.now()}`,
                description: groupId
                    ? `${description} · Pago mixto (${row.method?.name})`
                    : description,
                supplier: supplierName,
                payment_method: row.method?.name || 'Efectivo',
                payment_method_type: row.method?.type || 'cash',
                cash_account: isCashPaymentMethod(row.method) ? (row.cashAccount || cashAccount) : cashAccount,
                date: paymentDate,
            });
        }
        await loadSuppliersData();
        setShowPaymentModal(false);
        setPaymentSupplier(null);
        setSupplierPaymentSplits([]);
    };

    if (isLoading) return (
        <div className="animate-fade-in">
            <div className="neo-card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
                <SkeletonCard height="40px" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '1.5rem' }}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="neo-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                                <SkeletonLine width="55%" />
                                <SkeletonLine width="35%" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <Skeleton width="32px" height="32px" borderRadius="8px" />
                                <Skeleton width="32px" height="32px" borderRadius="8px" />
                            </div>
                        </div>
                        <SkeletonLine width="45%" />
                        <SkeletonLine width="60%" />
                        <Skeleton width="100%" height="44px" borderRadius="10px" />
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="animate-fade-in">
            <header className="page-header">
                
                <div className="page-header-actions">
                    <Button variant="primary" icon={<Plus size={20} />} onClick={() => { resetForm(); setIsModalOpen(true); }}>
                        Nuevo Proveedor
                    </Button>
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

            {filteredSuppliers?.length === 0 && (
                <EmptyState
                    icon={Building2}
                    title="No hay proveedores"
                    description={suppliers?.length === 0 ? 'Agregá tu primer proveedor con el botón de arriba.' : 'No coincide ningún proveedor con esa búsqueda.'}
                />
            )}
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
                                <Button variant="secondary" size="sm" onClick={() => openLedger(s)}>Ver Cuenta Corriente</Button>
                                <Button variant="success" size="sm" onClick={() => openPayment(s)}>Registrar Pago</Button>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                <Button variant="secondary" size="sm" icon={<Edit2 size={16} />} onClick={() => openEdit(s)}>
                                    Editar
                                </Button>
                                <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => handleDelete(s.id)}>
                                    Eliminar
                                </Button>
                            </div>
                        </div>
                    </div>
                    );
                })}
            </div>

            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                size="lg"
                title={editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            >
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
                                <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                                <Button variant="primary" type="submit">{editingId ? 'Actualizar' : 'Guardar'} Proveedor</Button>
                            </div>
                </form>
            </Modal>

            {showLedgerModal && ledgerSupplier && createPortal(
                <div className="modal-overlay" onClick={() => setShowLedgerModal(false)}>
                    <div className="modal-content neo-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', width: '92%', padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Cuenta Corriente · {ledgerSupplier.name}</h2>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<Printer size={15} />}
                                    onClick={() => handlePrintSupplierLedger(ledgerSupplier)}
                                >
                                    Imprimir
                                </Button>
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
                                        <tr
                                            key={row.id}
                                            style={{
                                                borderTop: '1px solid var(--color-border)',
                                                cursor: row.kind === 'haber' && row.purchaseId ? 'pointer' : 'default',
                                                background: row.kind === 'haber' && row.purchaseId ? 'rgba(255,255,255,0.02)' : 'transparent',
                                            }}
                                            onClick={() => openPurchaseDetailFromLedger(row)}
                                            title={row.kind === 'haber' && row.purchaseId ? 'Ver detalle de la compra' : ''}
                                        >
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

            {selectedPurchaseDetail && createPortal(
                <div className="modal-overlay" onClick={() => setSelectedPurchaseDetail(null)}>
                    <div className="modal-content neo-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', width: '92%', padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <div>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>Detalle de compra</h2>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.92rem' }}>
                                    {selectedPurchaseDetail.supplier || '-'}{selectedPurchaseDetail.invoice_num ? ` · Comprobante ${selectedPurchaseDetail.invoice_num}` : ''}
                                </div>
                            </div>
                            <button onClick={() => setSelectedPurchaseDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)' }}><X size={24} /></button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                            <div className="neo-card" style={{ padding: '0.75rem' }}>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Fecha</div>
                                <div style={{ fontWeight: 700 }}>{selectedPurchaseDetail.date ? new Date(selectedPurchaseDetail.date).toLocaleDateString() : '-'}</div>
                            </div>
                            <div className="neo-card" style={{ padding: '0.75rem' }}>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Pago</div>
                                <div style={{ fontWeight: 700 }}>{selectedPurchaseDetail.payment_method || '-'}</div>
                            </div>
                            <div className="neo-card" style={{ padding: '0.75rem' }}>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Total</div>
                                <div style={{ fontWeight: 700 }}>${Number(selectedPurchaseDetail.total || 0).toLocaleString()}</div>
                            </div>
                            <div className="neo-card" style={{ padding: '0.75rem' }}>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Cuenta corriente</div>
                                <div style={{ fontWeight: 700 }}>{isCurrentAccountPurchase(selectedPurchaseDetail) ? 'Si' : 'No'}</div>
                            </div>
                        </div>

                        <div style={{ maxHeight: '52vh', overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-main)' }}>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Articulo</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Cant.</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Peso</th>
                                        <th style={{ textAlign: 'left', padding: '0.65rem' }}>Unidad</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>P. unitario</th>
                                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(Array.isArray(selectedPurchaseDetail.items_detail) ? selectedPurchaseDetail.items_detail : []).map((item, index) => (
                                        <tr key={`${selectedPurchaseDetail.id}-${index}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '0.6rem' }}>{item.product_name || item.name || '-'}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right' }}>{Number(item.quantity || 0).toLocaleString()}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right' }}>{Number(item.weight || 0).toLocaleString()}</td>
                                            <td style={{ padding: '0.6rem' }}>{item.unit || '-'}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right' }}>${Number(item.unit_price || 0).toLocaleString()}</td>
                                            <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: 700 }}>${Number(item.subtotal || 0).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    {(!Array.isArray(selectedPurchaseDetail.items_detail) || selectedPurchaseDetail.items_detail.length === 0) && (
                                        <tr>
                                            <td colSpan="6" style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                                Esta compra no tiene items detallados guardados.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showPaymentModal && paymentSupplier && (
            <Modal
                open
                onClose={() => setShowPaymentModal(false)}
                size="lg"
                title={`Registrar Pago · ${paymentSupplier.name}`}
            >
                <form onSubmit={handleRegisterPayment}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div style={{ padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.03)' }}>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginBottom: '0.35rem' }}>Deuda total actual</div>
                                    <div style={{ fontSize: '1.45rem', fontWeight: 800, color: paymentSupplierDebt > 0 ? '#ef4444' : '#22c55e' }}>
                                        {formatCurrency(paymentSupplierDebt)}
                                    </div>
                                </div>
                                <div style={{ padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.03)' }}>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>Tipo de pago</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                        <Button
                                            type="button"
                                            variant={paymentForm.payment_mode === 'full' ? 'primary' : 'secondary'}
                                            onClick={() => {
                                                const nextAmount = paymentSupplierDebt > 0 ? String(paymentSupplierDebt) : '';
                                                setPaymentForm((prev) => ({ ...prev, payment_mode: 'full', amount: nextAmount }));
                                                if (isMixedSupplierPayment) seedSupplierSplitPayments(nextAmount);
                                            }}
                                        >
                                            Total
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={paymentForm.payment_mode === 'partial' ? 'primary' : 'secondary'}
                                            onClick={() => {
                                                setPaymentForm((prev) => ({ ...prev, payment_mode: 'partial', amount: '' }));
                                                if (isMixedSupplierPayment) seedSupplierSplitPayments('');
                                            }}
                                        >
                                            Parcial
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem' }}>Monto a pagar</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="neo-input"
                                        value={paymentForm.amount}
                                        disabled={paymentForm.payment_mode === 'full'}
                                        onChange={(e) => {
                                            const nextAmount = e.target.value;
                                            setPaymentForm((prev) => ({ ...prev, amount: nextAmount }));
                                            if (isMixedSupplierPayment && supplierPaymentSplits.length === 1 && !supplierPaymentSplits[0].amount) {
                                                setSupplierPaymentSplits((prev) => prev.map((row, index) => (
                                                    index === 0 ? { ...row, amount: nextAmount } : row
                                                )));
                                            }
                                        }}
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
                                    onChange={(e) => {
                                        const nextMethodName = e.target.value;
                                        const nextMethod = supplierPaymentMethods.find((method) => method.name === nextMethodName);
                                        setPaymentForm((prev) => ({ ...prev, payment_method: nextMethodName }));
                                        if (isMixedPaymentMethod(nextMethod)) seedSupplierSplitPayments();
                                        else setSupplierPaymentSplits([]);
                                    }}
                                    required
                                >
                                    {supplierPaymentMethods.map((method) => (
                                        <option key={method.name} value={method.name}>{method.name}</option>
                                    ))}
                                </select>
                            </div>
                            {!isMixedSupplierPayment && isCashPaymentMethod(selectedPaymentMethod) && (
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.4rem' }}>Caja origen</label>
                                <select
                                    className="neo-input"
                                    value={paymentForm.cash_account}
                                    onChange={(e) => setPaymentForm((prev) => ({ ...prev, cash_account: e.target.value }))}
                                    required
                                >
                                    {CASH_ACCOUNTS.map((cashbox) => (
                                        <option key={cashbox.value} value={cashbox.value}>{cashbox.label}</option>
                                    ))}
                                </select>
                            </div>
                            )}
                            {isMixedSupplierPayment && (
                                <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.03)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                                        <div>
                                            <strong>Detalle del pago mixto</strong>
                                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
                                                Total cargado: ${supplierSplitTotal.toLocaleString('es-AR')} · Pendiente: ${supplierSplitPending.toLocaleString('es-AR')}
                                            </div>
                                        </div>
                                        <Button variant="secondary" size="sm" onClick={addSupplierSplit}>
                                            Agregar medio
                                        </Button>
                                    </div>
                                    {supplierPaymentSplits.map((row, index) => (
                                        <div key={`${row.methodName}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 150px auto', gap: '0.6rem', alignItems: 'center', marginTop: '0.55rem' }}>
                                            <select
                                                className="neo-input"
                                                value={row.methodName}
                                                onChange={(e) => updateSupplierSplit(index, 'methodName', e.target.value)}
                                                required
                                            >
                                                {splitPaymentMethods.map((method) => (
                                                    <option key={method.name} value={method.name}>{method.name}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="neo-input"
                                                value={row.amount}
                                                onChange={(e) => updateSupplierSplit(index, 'amount', e.target.value)}
                                                placeholder="0.00"
                                                required
                                            />
                                            {isCashPaymentMethod(splitPaymentMethods.find((method) => method.name === row.methodName)) ? (
                                                <select
                                                    className="neo-input"
                                                    value={row.cash_account || 'principal'}
                                                    onChange={(e) => updateSupplierSplit(index, 'cash_account', e.target.value)}
                                                    required
                                                >
                                                    {CASH_ACCOUNTS.map((cashbox) => (
                                                        <option key={cashbox.value} value={cashbox.value}>{cashbox.label}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>Sin caja</div>
                                            )}
                                            <Button
                                                variant="secondary"
                                                onClick={() => removeSupplierSplit(index)}
                                                disabled={supplierPaymentSplits.length <= 2}
                                            >
                                                Quitar
                                            </Button>
                                        </div>
                                    ))}
                                    {splitPaymentMethods.length === 0 && (
                                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.6rem' }}>
                                            No hay medios de pago disponibles para detallar el pago mixto.
                                        </div>
                                    )}
                                </div>
                            )}
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
                                <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>Cancelar</Button>
                                <Button variant="success" type="submit">Guardar Pago</Button>
                            </div>
                </form>
            </Modal>
            )}
        </div>
    );
};

export default Proveedores;
