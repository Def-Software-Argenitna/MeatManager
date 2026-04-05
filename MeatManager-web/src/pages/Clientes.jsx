import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Search, Phone, X, UserPlus, History, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { fetchTable, getNextRemoteReceiptData, saveTableRecord } from '../utils/apiClient';
import { buildClientAddress, geocodeAddress, searchAddressSuggestions } from '../utils/geocoding';
import './Clientes.css';

const currentMonth = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
};

const emptyClientForm = {
    client_type: 'person',
    first_name: '',
    last_name: '',
    company_name: '',
    contact_first_name: '',
    contact_last_name: '',
    dni_cuit: '',
    street: '',
    street_number: '',
    zip_code: '',
    city: '',
    phone1: '',
    phone2: '',
    email1: '',
    email2: '',
    hasCurrentAccount: true,
    hasInitialBalance: false,
    balance: ''
};

const cleanValue = (value) => String(value || '').trim();

const getClientPhones = (client) => {
    const phones = [
        cleanValue(client.phone1),
        cleanValue(client.phone2),
        ...String(client.phones || '')
            .split('\n')
            .map(cleanValue)
            .filter(Boolean),
        cleanValue(client.phone)
    ];
    return [...new Set(phones.filter(Boolean))];
};

const getPrimaryPhone = (client) => getClientPhones(client)[0] || '';

const getClientEmails = (client) => {
    const emails = [
        cleanValue(client.email1),
        cleanValue(client.email2),
        ...String(client.emails || '')
            .split('\n')
            .map(cleanValue)
            .filter(Boolean)
    ];
    return [...new Set(emails.filter(Boolean))];
};

const formatAddress = (client) => {
    const streetLine = [cleanValue(client.street), cleanValue(client.street_number)].filter(Boolean).join(' ');
    const cityLine = [cleanValue(client.zip_code), cleanValue(client.city)].filter(Boolean).join(' ');
    const structured = [streetLine, cityLine].filter(Boolean).join(', ');
    return structured || cleanValue(client.address);
};

const hasCurrentAccount = (client) => client?.has_current_account !== false;
const getBalanceValue = (client) => Number(client?.balance) || 0;
const isCompanyClient = (client) => cleanValue(client.client_type) === 'company';
const getClientFullName = (client) =>
    isCompanyClient(client)
        ? (cleanValue(client.company_name) || cleanValue(client.name))
        : ([cleanValue(client.first_name), cleanValue(client.last_name)].filter(Boolean).join(' ') || cleanValue(client.name));
const getClientContactName = (client) =>
    [cleanValue(client.contact_first_name), cleanValue(client.contact_last_name)].filter(Boolean).join(' ');
const formatReceiptCode = (branchNumber = 1, receiptNumber = 0) =>
    `${String(branchNumber || 1).padStart(4, '0')}-${String(receiptNumber || 0).padStart(6, '0')}`;
const getMovementPaymentMethod = (movement) => {
    if (cleanValue(movement.payment_method)) return cleanValue(movement.payment_method);
    const match = String(movement.description || '').match(/\(([^()]+)\)\s*$/);
    return cleanValue(match?.[1]);
};
const toNumber = (value) => Number(value) || 0;

const Clientes = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [historyClient, setHistoryClient] = useState(null);
    const [historyMonth, setHistoryMonth] = useState(currentMonth);
    const [payInput, setPayInput] = useState('');
    const [payLoading, setPayLoading] = useState(false);
    const [paymentMethodId, setPaymentMethodId] = useState('');
    const [newClient, setNewClient] = useState(emptyClientForm);
    const [expandedLedgerRowId, setExpandedLedgerRowId] = useState(null);
    const [clients, setClients] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [clientLedger, setClientLedger] = useState({ rows: [], openingBalance: 0, salesTotal: 0, paymentTotal: 0, currentBalance: 0 });
    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [selectedSuggestion, setSelectedSuggestion] = useState(null);

    const clientAddressPreview = useMemo(() => formatAddress(newClient), [newClient]);

    const loadCoreData = async () => {
        const [clientsRows, paymentMethodRows] = await Promise.all([
            fetchTable('clients', { limit: 1000, orderBy: 'id', direction: 'ASC' }),
            fetchTable('payment_methods', { limit: 100, orderBy: 'id', direction: 'ASC' })
        ]);
        const allowedNames = ['Posnet', 'Mercado Pago', 'Cuenta DNI', 'Efectivo', 'Transferencia'];
        setClients(clientsRows);
        setPaymentMethods(paymentMethodRows.filter((method) => method.enabled && allowedNames.includes(method.name)));
        return clientsRows;
    };

    const loadLedger = useCallback(async (clientRef = historyClient, monthRef = historyMonth) => {
        if (!clientRef) {
            setClientLedger({ rows: [], openingBalance: 0, salesTotal: 0, paymentTotal: 0, currentBalance: 0 });
            return;
        }
        const [year, month] = monthRef.split('-').map(Number);
        const start = new Date(year, month - 1, 1).getTime();
        const end = new Date(year, month, 1).getTime();
        const clientId = Number(clientRef.id);
        const clientName = getClientFullName(clientRef);
        const [ventas, movimientos, ventasItems] = await Promise.all([
            fetchTable('ventas', { limit: 5000, orderBy: 'date', direction: 'ASC' }),
            fetchTable('caja_movimientos', { limit: 5000, orderBy: 'date', direction: 'ASC' }),
            fetchTable('ventas_items', { limit: 10000, orderBy: 'id', direction: 'ASC' })
        ]);

        const saleRows = ventas
            .filter((venta) => {
                if (Number(venta.clientId) !== clientId) return false;

                const hasCurrentAccountInBreakdown = Array.isArray(venta.payment_breakdown)
                    && venta.payment_breakdown.some((part) => part.method_type === 'cuenta_corriente' || part.method_name === 'Cuenta Corriente');

                return venta.payment_method === 'Cuenta Corriente' || hasCurrentAccountInBreakdown;
            })
            .map((venta) => ({
                id: `sale-${venta.id}`,
                timestamp: new Date(venta.date).getTime(),
                fecha: new Date(venta.date),
                comprobante: `Venta ${venta.receipt_code || formatReceiptCode(1, venta.receipt_number || venta.id)}`,
                debe: Number(venta.total) || 0,
                haber: 0,
                delta: -(Number(venta.total) || 0),
                items: ventasItems.filter((item) => Number(item.venta_id) === Number(venta.id))
            }));

        const paymentRows = movimientos
            .filter((mov) =>
                (Number(mov.client_id) === clientId) ||
                (
                    mov.category === 'Cobro Pendientes' &&
                    String(mov.description || '').includes(`cliente: ${clientName}`)
                )
            )
            .map((mov) => ({
                id: `payment-${mov.id}`,
                timestamp: new Date(mov.date).getTime(),
                fecha: new Date(mov.date),
                comprobante: `Cobro ${mov.receipt_code || formatReceiptCode(1, mov.receipt_number || mov.id)}${getMovementPaymentMethod(mov) ? ` - ${getMovementPaymentMethod(mov)}` : ''}`,
                debe: 0,
                haber: Number(mov.amount) || 0,
                delta: Number(mov.amount) || 0
            }));

        const allRows = [...saleRows, ...paymentRows].sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.id.localeCompare(b.id);
        });

        let runningBalance = 0;
        let openingBalance = 0;
        let salesTotal = 0;
        let paymentTotal = 0;
        const rows = [];

        allRows.forEach((row) => {
            if (row.timestamp < start) {
                runningBalance += row.delta;
                openingBalance = runningBalance;
                return;
            }
            if (row.timestamp >= end) return;

            runningBalance += row.delta;
            salesTotal += row.debe;
            paymentTotal += row.haber;
            rows.push({
                ...row,
                saldo: runningBalance
            });
        });

        setClientLedger({
            rows,
            openingBalance,
            salesTotal,
            paymentTotal,
            currentBalance: runningBalance
        });
    }, [historyClient, historyMonth]);

    const refreshHistoryClient = async () => {
        if (!historyClient) return;
        const latestClients = await loadCoreData();
        const updated = latestClients.find((client) => Number(client.id) === Number(historyClient.id));
        if (updated) setHistoryClient(updated);
    };

    const historyClientData = historyClient;
    const effectiveHistoryBalance = clientLedger ? (Number(clientLedger.currentBalance) || 0) : getBalanceValue(historyClientData);

    useEffect(() => {
        loadCoreData();
    }, []);

    useEffect(() => {
        loadLedger();
    }, [loadLedger]);

    useEffect(() => {
        if (!historyClientData || !clientLedger) return;
        if (historyClientData.has_initial_balance) return;

        const storedBalance = getBalanceValue(historyClientData);
        const derivedBalance = Number(clientLedger.currentBalance) || 0;

        if (Math.abs(storedBalance - derivedBalance) < 0.01) return;

        saveTableRecord('clients', 'update', {
            ...historyClientData,
            balance: derivedBalance,
            last_updated: new Date().toISOString()
        }, historyClientData.id).catch(() => {});
    }, [historyClientData, clientLedger]);

    useEffect(() => {
        if (!clients?.length) return;

        const syncMislabeledSales = async () => {
            const ventas = await fetchTable('ventas', { limit: 5000, orderBy: 'date', direction: 'ASC' });
            const fixes = ventas.filter((venta) => {
                if (!venta.clientId) return false;
                const hasCurrentAccountInBreakdown = Array.isArray(venta.payment_breakdown)
                    && venta.payment_breakdown.some((part) => part.method_type === 'cuenta_corriente' || part.method_name === 'Cuenta Corriente');

                return venta.payment_method !== 'Cuenta Corriente' && !hasCurrentAccountInBreakdown;
            });

            if (fixes.length === 0) return;

            await Promise.all(
                fixes.map((venta) =>
                    saveTableRecord('ventas', 'update', { ...venta, clientId: null }, venta.id)
                )
            );
        };

        syncMislabeledSales();
    }, [clients]);

    useEffect(() => {
        setExpandedLedgerRowId(null);
    }, [historyMonth]);

    useEffect(() => {
        const streetQuery = [newClient.street, newClient.street_number].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
        const localityReady = Boolean(String(newClient.city || '').trim() || String(newClient.zip_code || '').trim());
        const query = buildClientAddress(newClient);
        if (streetQuery.length < 5 || !localityReady || query.length < 8) {
            setAddressSuggestions([]);
            setLoadingSuggestions(false);
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            setLoadingSuggestions(true);
            try {
                const suggestions = await searchAddressSuggestions(query);
                if (!cancelled) setAddressSuggestions(suggestions);
            } catch {
                if (!cancelled) setAddressSuggestions([]);
            } finally {
                if (!cancelled) setLoadingSuggestions(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [newClient.street, newClient.street_number, newClient.city, newClient.zip_code]);

    const openHistory = (client) => {
        if (!hasCurrentAccount(client)) return;
        setHistoryClient(client);
        setHistoryMonth(currentMonth());
        setPayInput('');
        setPaymentMethodId('');
        setExpandedLedgerRowId(null);
    };

    const updateNewClient = (field, value) => {
        if (['street', 'street_number', 'city', 'zip_code'].includes(field)) {
            setSelectedSuggestion(null);
        }
        setNewClient((prev) => {
            if (field === 'client_type') {
                return {
                    ...prev,
                    client_type: value,
                    first_name: value === 'company' ? '' : prev.first_name,
                    last_name: value === 'company' ? '' : prev.last_name,
                    company_name: value === 'company' ? prev.company_name : '',
                    contact_first_name: value === 'company' ? prev.contact_first_name : '',
                    contact_last_name: value === 'company' ? prev.contact_last_name : '',
                };
            }
            if (field === 'hasCurrentAccount') {
                return {
                    ...prev,
                    hasCurrentAccount: value,
                    hasInitialBalance: value ? prev.hasInitialBalance : false,
                    balance: value ? prev.balance : ''
                };
            }
            if (field === 'hasInitialBalance') {
                return {
                    ...prev,
                    hasInitialBalance: value,
                    balance: value ? prev.balance : ''
                };
            }
            return { ...prev, [field]: value };
        });
    };

    const selectAddressSuggestion = (suggestion) => {
        setSelectedSuggestion(suggestion);
        setNewClient((prev) => ({
            ...prev,
            street: suggestion.street || prev.street,
            city: suggestion.city || prev.city,
            zip_code: suggestion.zip_code || prev.zip_code,
        }));
        setAddressSuggestions([]);
    };

    const handleAddClient = async (e) => {
        e.preventDefault();
        const clientType = cleanValue(newClient.client_type) || 'person';
        const firstName = clientType === 'company' ? cleanValue(newClient.contact_first_name) : cleanValue(newClient.first_name);
        const lastName = clientType === 'company' ? cleanValue(newClient.contact_last_name) : cleanValue(newClient.last_name);
        const companyName = cleanValue(newClient.company_name);
        const fullName = clientType === 'company'
            ? companyName
            : [firstName, lastName].filter(Boolean).join(' ');
        if (!fullName) return;

        const phone1 = cleanValue(newClient.phone1);
        const phone2 = cleanValue(newClient.phone2);
        const email1 = cleanValue(newClient.email1);
        const email2 = cleanValue(newClient.email2);
        const address = formatAddress(newClient);
        const phones = [phone1, phone2].filter(Boolean).join('\n');
        const emails = [email1, email2].filter(Boolean).join('\n');
        const balance = newClient.hasCurrentAccount && newClient.hasInitialBalance
            ? (parseFloat(newClient.balance) || 0)
            : 0;
        let geocoded = null;
        if (address) {
            try {
                geocoded = await geocodeAddress(buildClientAddress(newClient));
            } catch (error) {
                console.warn('[CLIENTES] No se pudo geocodificar la direccion del cliente', error?.message || error);
            }
        }

        await saveTableRecord('clients', 'insert', {
            name: fullName,
            client_type: clientType,
            first_name: clientType === 'company' ? '' : firstName,
            last_name: clientType === 'company' ? '' : lastName,
            company_name: clientType === 'company' ? companyName : '',
            contact_first_name: clientType === 'company' ? firstName : '',
            contact_last_name: clientType === 'company' ? lastName : '',
            dni_cuit: cleanValue(newClient.dni_cuit),
            phone: phone1,
            phones,
            phone1,
            phone2,
            emails,
            email1,
            email2,
            address,
            street: cleanValue(newClient.street),
            street_number: cleanValue(newClient.street_number),
            zip_code: cleanValue(newClient.zip_code),
            city: cleanValue(newClient.city),
            latitude: geocoded?.latitude ?? null,
            longitude: geocoded?.longitude ?? null,
            geocoded_at: geocoded?.geocoded_at ?? null,
            has_current_account: newClient.hasCurrentAccount,
            has_initial_balance: newClient.hasCurrentAccount && newClient.hasInitialBalance,
            balance,
            last_updated: new Date().toISOString(),
            synced: 0
        });

        setIsModalOpen(false);
        setNewClient(emptyClientForm);
        setAddressSuggestions([]);
        setSelectedSuggestion(null);
        await loadCoreData();
    };

    const handlePayment = async () => {
        const payAmount = parseFloat(payInput);
        const selectedPaymentMethod = paymentMethods?.find((method) => String(method.id) === String(paymentMethodId));
        if (isNaN(payAmount) || payAmount <= 0 || !historyClient || !selectedPaymentMethod) return;
        setPayLoading(true);
        try {
            const client = clients.find((item) => Number(item.id) === Number(historyClient.id));
            if (!client || !hasCurrentAccount(client)) return;
            const { receiptNumber: paymentReceiptNumber, receiptCode: paymentReceiptCode } = await getNextRemoteReceiptData('payments_receipt_counter');
            await saveTableRecord('clients', 'update', {
                ...client,
                balance: getBalanceValue(client) + payAmount,
                last_updated: new Date().toISOString()
            }, historyClient.id);
            await saveTableRecord('caja_movimientos', 'insert', {
                type: 'ingreso',
                category: 'Cobro Pendientes',
                amount: payAmount,
                receipt_number: paymentReceiptNumber,
                receipt_code: paymentReceiptCode,
                client_id: historyClient.id,
                payment_method: selectedPaymentMethod.name,
                payment_method_id: selectedPaymentMethod.id,
                description: `Cobro ${paymentReceiptCode} de cliente: ${client.name} (${selectedPaymentMethod.name})`,
                date: new Date().toISOString(),
                synced: 0
            });
            setPayInput('');
            setPaymentMethodId('');
            await refreshHistoryClient();
            await loadLedger(historyClient, historyMonth);
        } finally {
            setPayLoading(false);
        }
    };

    const filteredClients = clients?.filter((c) => {
        const term = searchTerm.toLowerCase();
        return (
            getClientFullName(c).toLowerCase().includes(term) ||
            getClientPhones(c).join(' ').toLowerCase().includes(term) ||
            getClientEmails(c).join(' ').toLowerCase().includes(term) ||
            formatAddress(c).toLowerCase().includes(term)
        );
    });

    return (
        <div className="clients-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Clientes y Cuentas</h1>
                    <p className="page-description">Gestion de clientes y cuentas corrientes</p>
                </div>
                <button className="neo-button" onClick={() => setIsModalOpen(true)}>
                    <UserPlus size={20} />
                    Nuevo Cliente
                </button>
            </header>

            <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
                <div style={{ position: 'relative' }}>
                    <Search className="text-muted" size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Buscar cliente por nombre, telefono, mail o direccion..."
                        className="neo-input"
                        style={{ paddingLeft: '3rem', marginBottom: 0 }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="clients-grid">
                {filteredClients?.map((client) => {
                    const accountEnabled = hasCurrentAccount(client);
                    const clientAddress = formatAddress(client);
                    const clientBalance = getBalanceValue(client);
                    return (
                        <div key={client.id} className={`client-card ${clientBalance < 0 ? 'debt' : (clientBalance > 0 ? 'credit' : '')}`}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                <div>
                                    <h3 className="client-name">{getClientFullName(client)}</h3>
                                    <div className="client-phone">
                                        <Phone size={14} />
                                        {getPrimaryPhone(client) || 'Sin telefono'}
                                    </div>
                                    {clientAddress && (
                                        <div className="client-extra-data">{clientAddress}</div>
                                    )}
                                    {isCompanyClient(client) && getClientContactName(client) && (
                                        <div className="client-extra-data">Contacto: {getClientContactName(client)}</div>
                                    )}
                                    {cleanValue(client.dni_cuit) && (
                                        <div className="client-extra-data">DNI / CUIT: {cleanValue(client.dni_cuit)}</div>
                                    )}
                                    <div className={`client-account-badge ${accountEnabled ? 'enabled' : 'disabled'}`}>
                                        {accountEnabled ? 'Cuenta corriente habilitada' : 'Sin cuenta corriente'}
                                    </div>
                                </div>
                                <div className="client-avatar" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Users size={20} />
                                </div>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <div className="balance-label">Estado de Cuenta</div>
                                <div className={`client-balance ${clientBalance < 0 ? 'negative' : (clientBalance > 0 ? 'positive' : '')}`}>
                                    {clientBalance < 0 ? '-' : ''}${Math.abs(toNumber(clientBalance)).toLocaleString()}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: clientBalance < 0 ? '#ef4444' : 'var(--color-text-muted)' }}>
                                    {!accountEnabled ? 'Cuenta corriente desactivada' : (clientBalance < 0 ? 'Debe al local' : (clientBalance > 0 ? 'Saldo a favor' : 'Al dia'))}
                                </div>
                            </div>

                            {accountEnabled ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
                                    <button onClick={() => openHistory(client)} className="action-btn pay">
                                        <History size={16} /> Cuenta corriente
                                    </button>
                                </div>
                            ) : (
                                <div className="client-disabled-note">Este cliente queda guardado sin cuenta corriente.</div>
                            )}
                        </div>
                    );
                })}
            </div>

            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card clients-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="clients-modal-header">
                            <h2 className="clients-modal-title">Nuevo Cliente</h2>
                            <button onClick={() => setIsModalOpen(false)} className="clients-modal-close"><X size={24} /></button>
                        </div>

                        <form onSubmit={handleAddClient}>
                            <div className="clients-type-switch">
                                <button
                                    type="button"
                                    className={`clients-type-option ${newClient.client_type === 'person' ? 'active' : ''}`}
                                    onClick={() => updateNewClient('client_type', 'person')}
                                >
                                    Persona
                                </button>
                                <button
                                    type="button"
                                    className={`clients-type-option ${newClient.client_type === 'company' ? 'active' : ''}`}
                                    onClick={() => updateNewClient('client_type', 'company')}
                                >
                                    Empresa
                                </button>
                            </div>

                            {newClient.client_type === 'company' ? (
                                <>
                                    <div className="clients-form-grid">
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">Nombre de la empresa</label>
                                            <input
                                                type="text"
                                                required
                                                className="neo-input"
                                                value={newClient.company_name}
                                                onChange={(e) => updateNewClient('company_name', e.target.value)}
                                            />
                                        </div>
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">CUIT</label>
                                            <input
                                                type="text"
                                                className="neo-input"
                                                placeholder="Ej: 30712345678"
                                                value={newClient.dni_cuit}
                                                onChange={(e) => updateNewClient('dni_cuit', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="clients-form-grid">
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">Nombre del contacto</label>
                                            <input
                                                type="text"
                                                className="neo-input"
                                                value={newClient.contact_first_name}
                                                onChange={(e) => updateNewClient('contact_first_name', e.target.value)}
                                            />
                                        </div>
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">Apellido del contacto</label>
                                            <input
                                                type="text"
                                                className="neo-input"
                                                value={newClient.contact_last_name}
                                                onChange={(e) => updateNewClient('contact_last_name', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="clients-form-grid">
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">Nombre</label>
                                            <input
                                                type="text"
                                                required
                                                className="neo-input"
                                                value={newClient.first_name}
                                                onChange={(e) => updateNewClient('first_name', e.target.value)}
                                            />
                                        </div>
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">Apellido</label>
                                            <input
                                                type="text"
                                                required
                                                className="neo-input"
                                                value={newClient.last_name}
                                                onChange={(e) => updateNewClient('last_name', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="clients-form-grid">
                                        <div className="clients-form-group">
                                            <label className="clients-form-label">DNI / CUIT</label>
                                            <input
                                                type="text"
                                                className="neo-input"
                                                placeholder="Ej: 30111222333"
                                                value={newClient.dni_cuit}
                                                onChange={(e) => updateNewClient('dni_cuit', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="clients-form-grid">
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Calle</label>
                                    <input type="text" className="neo-input" value={newClient.street} onChange={(e) => updateNewClient('street', e.target.value)} />
                                    {(loadingSuggestions || addressSuggestions.length > 0) && (
                                        <div className="clients-address-suggestions">
                                            {loadingSuggestions && <div className="clients-address-suggestion muted">Buscando direcciones...</div>}
                                            {!loadingSuggestions && addressSuggestions.map((suggestion) => (
                                                <button
                                                    key={`${suggestion.label}-${suggestion.latitude}`}
                                                    type="button"
                                                    className="clients-address-suggestion"
                                                    onClick={() => selectAddressSuggestion(suggestion)}
                                                >
                                                    <strong>{suggestion.street || suggestion.label}</strong>
                                                    <span>{[suggestion.city, suggestion.zip_code].filter(Boolean).join(' ')}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Altura</label>
                                    <input type="text" className="neo-input" value={newClient.street_number} onChange={(e) => updateNewClient('street_number', e.target.value)} />
                                </div>
                                <div className="clients-form-group">
                                    <label className="clients-form-label">CP</label>
                                    <input type="text" className="neo-input" value={newClient.zip_code} onChange={(e) => updateNewClient('zip_code', e.target.value)} />
                                </div>
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Localidad</label>
                                    <input type="text" className="neo-input" value={newClient.city} onChange={(e) => updateNewClient('city', e.target.value)} />
                                </div>
                            </div>

                            {clientAddressPreview && (
                                <div className="clients-address-preview">
                                    <span>Direccion compuesta:</span>
                                    <strong>{selectedSuggestion?.label || clientAddressPreview}</strong>
                                </div>
                            )}

                            <div className="clients-form-grid">
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Telefono 1</label>
                                    <input type="text" className="neo-input" value={newClient.phone1} onChange={(e) => updateNewClient('phone1', e.target.value)} />
                                </div>
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Telefono 2</label>
                                    <input type="text" className="neo-input" value={newClient.phone2} onChange={(e) => updateNewClient('phone2', e.target.value)} />
                                </div>
                            </div>

                            <div className="clients-form-grid">
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Mail 1</label>
                                    <input type="email" className="neo-input" value={newClient.email1} onChange={(e) => updateNewClient('email1', e.target.value)} />
                                </div>
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Mail 2</label>
                                    <input type="email" className="neo-input" value={newClient.email2} onChange={(e) => updateNewClient('email2', e.target.value)} />
                                </div>
                            </div>

                            <div className="clients-form-toggles">
                                <label className="clients-checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={newClient.hasCurrentAccount}
                                        onChange={(e) => updateNewClient('hasCurrentAccount', e.target.checked)}
                                    />
                                    <span>Tiene cuenta corriente</span>
                                </label>

                                <label className={`clients-checkbox-row ${!newClient.hasCurrentAccount ? 'disabled' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={newClient.hasInitialBalance}
                                        disabled={!newClient.hasCurrentAccount}
                                        onChange={(e) => updateNewClient('hasInitialBalance', e.target.checked)}
                                    />
                                    <span>Tiene saldo inicial</span>
                                </label>
                            </div>

                            {newClient.hasCurrentAccount && newClient.hasInitialBalance && (
                                <div className="clients-form-group clients-form-group-last">
                                    <label className="clients-form-label">Saldo Inicial ($)</label>
                                    <input
                                        type="number"
                                        className="neo-input"
                                        placeholder="0 o -1000"
                                        value={newClient.balance}
                                        onChange={(e) => updateNewClient('balance', e.target.value)}
                                    />
                                    <small className="clients-form-hint">Use numeros negativos para indicar deuda inicial.</small>
                                </div>
                            )}

                            <div className="clients-form-actions">
                                <button
                                    type="button"
                                    className="clients-action-button clients-secondary-button"
                                    onClick={() => setIsModalOpen(false)}
                                >
                                    Cerrar
                                </button>
                                <button type="submit" className="clients-action-button clients-submit-button">Crear Cliente</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {historyClient && (
                <div className="modal-overlay" onClick={() => setHistoryClient(null)}>
                    <div className="modal-content neo-card clients-history-modal" style={{ maxWidth: '520px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                            <div>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>Historial Cta. Cte.</h2>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>{getClientFullName(historyClientData)}</p>
                                {(formatAddress(historyClientData) || getClientPhones(historyClientData).length > 0 || getClientEmails(historyClientData).length > 0 || cleanValue(historyClientData?.dni_cuit) || (isCompanyClient(historyClientData) && getClientContactName(historyClientData))) && (
                                    <div style={{ marginTop: '0.45rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                        {formatAddress(historyClientData) && <div>{formatAddress(historyClientData)}</div>}
                                        {isCompanyClient(historyClientData) && getClientContactName(historyClientData) && <div>Contacto: {getClientContactName(historyClientData)}</div>}
                                        {cleanValue(historyClientData?.dni_cuit) && <div>DNI / CUIT: {cleanValue(historyClientData.dni_cuit)}</div>}
                                        {getClientPhones(historyClientData).length > 0 && <div>{getClientPhones(historyClientData).join(' | ')}</div>}
                                        {getClientEmails(historyClientData).length > 0 && <div>{getClientEmails(historyClientData).join(' | ')}</div>}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => setHistoryClient(null)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{
                            background: effectiveHistoryBalance < 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                            border: `1px solid ${effectiveHistoryBalance < 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                            borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Saldo actual</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: '800', color: effectiveHistoryBalance < 0 ? '#ef4444' : '#22c55e' }}>
                                {effectiveHistoryBalance < 0 ? '-' : ''}${Math.abs(toNumber(effectiveHistoryBalance)).toLocaleString()}
                            </span>
                        </div>

                        <div style={{
                            background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)',
                            borderRadius: '8px', padding: '0.85rem', marginBottom: '1.25rem'
                        }}>
                            <div style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: '700', marginBottom: '0.5rem' }}>REGISTRAR PAGO / COBRO</div>
                            <div style={{ marginBottom: '0.75rem' }}>
                                <select
                                    className="neo-input"
                                    style={{ marginBottom: 0 }}
                                    value={paymentMethodId}
                                    onChange={(e) => setPaymentMethodId(e.target.value)}
                                >
                                    <option value="">Elegir metodo de pago...</option>
                                    {paymentMethods?.map((method) => (
                                        <option key={method.id} value={method.id}>{method.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold', color: '#22c55e' }}>$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        value={payInput}
                                        onChange={(e) => setPayInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handlePayment(); }}
                                        style={{
                                            width: '100%', padding: '0.6rem 0.6rem 0.6rem 1.8rem',
                                            fontSize: '1.1rem', fontWeight: 'bold',
                                            background: 'var(--color-bg-main)',
                                            border: '1px solid rgba(34,197,94,0.4)',
                                            borderRadius: '6px', color: 'var(--color-text-main)',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                                <button
                                    onClick={handlePayment}
                                    disabled={payLoading || !payInput || parseFloat(payInput) <= 0 || !paymentMethodId}
                                    style={{
                                        padding: '0.6rem 1.1rem', background: '#22c55e', border: 'none',
                                        borderRadius: '6px', color: '#fff', fontWeight: '700',
                                        cursor: payLoading || !payInput ? 'not-allowed' : 'pointer',
                                        opacity: payLoading || !payInput ? 0.6 : 1,
                                        display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap'
                                    }}
                                >
                                    <Check size={16} /> Cobrar
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'center' }}>
                            <button
                                onClick={() => {
                                    const [y, m] = historyMonth.split('-').map(Number);
                                    const d = new Date(y, m - 2, 1);
                                    setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                                }}
                                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '0.4rem 0.75rem', color: 'var(--color-text-main)', cursor: 'pointer' }}
                            ><ChevronLeft size={16} /></button>
                            <span style={{ fontWeight: '700', fontSize: '1rem', minWidth: '150px', textAlign: 'center' }}>
                                {new Date(historyMonth + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase())}
                            </span>
                            <button
                                onClick={() => {
                                    const [y, m] = historyMonth.split('-').map(Number);
                                    const d = new Date(y, m, 1);
                                    setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                                }}
                                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '0.4rem 0.75rem', color: 'var(--color-text-main)', cursor: 'pointer' }}
                            ><ChevronRight size={16} /></button>
                        </div>

                        {clientLedger && clientLedger.rows.length > 0 && (
                            <div style={{
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                    Debe del mes ({clientLedger.rows.length} movimiento{clientLedger.rows.length !== 1 ? 's' : ''})
                                </span>
                                <span style={{ fontWeight: '800', color: '#ef4444', fontSize: '1.1rem' }}>
                                    ${toNumber(clientLedger.salesTotal).toLocaleString()}
                                </span>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {clientLedger && (
                                <div className="clients-history-summary">
                                    <div className="clients-history-summary-item">
                                        <span>Saldo anterior</span>
                                        <strong>{toNumber(clientLedger.openingBalance).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                    <div className="clients-history-summary-item">
                                        <span>Debe</span>
                                        <strong>{toNumber(clientLedger.salesTotal).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                    <div className="clients-history-summary-item positive">
                                        <span>Haber</span>
                                        <strong>{toNumber(clientLedger.paymentTotal).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                </div>
                            )}

                            {!clientLedger || clientLedger.rows.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
                                    Sin movimientos registrados para este mes
                                </div>
                            ) : (
                                <div className="clients-history-table-wrap">
                                    <table className="clients-history-table">
                                        <thead>
                                            <tr>
                                                <th>Fecha</th>
                                                <th>Comprobante</th>
                                                <th>Debe</th>
                                                <th>Haber</th>
                                                <th>Saldo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {clientLedger.rows.map((row) => (
                                                <React.Fragment key={row.id}>
                                                    <tr
                                                        className={row.items?.length ? 'clients-history-row-expandable' : ''}
                                                        onClick={() => {
                                                            if (!row.items?.length) return;
                                                            setExpandedLedgerRowId((prev) => prev === row.id ? null : row.id);
                                                        }}
                                                    >
                                                        <td>{row.fecha.toLocaleDateString('es-AR')}</td>
                                                        <td>{row.comprobante}</td>
                                                        <td>{row.debe ? toNumber(row.debe).toLocaleString('es-AR') : ''}</td>
                                                        <td>{row.haber ? toNumber(row.haber).toLocaleString('es-AR') : ''}</td>
                                                        <td>{toNumber(row.saldo).toLocaleString('es-AR')}</td>
                                                    </tr>
                                                    {expandedLedgerRowId === row.id && row.items?.length > 0 && (
                                                        <tr className="clients-history-row-detail">
                                                            <td colSpan="5">
                                                                <div className="clients-history-items">
                                                                    {row.items.map((item) => (
                                                                        <div key={item.id} className="clients-history-item-line">
                                                                            <span>{item.product_name}</span>
                                                                            <span>
                                                                                {toNumber(item.quantity)} x ${toNumber(item.price).toLocaleString('es-AR')} = ${toNumber(item.subtotal).toLocaleString('es-AR')}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Clientes;
