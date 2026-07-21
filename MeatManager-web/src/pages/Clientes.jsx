import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Search, Phone, X, UserPlus, History, ChevronLeft, ChevronRight, Check, Printer, Pencil, FileText } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { fetchTable, getNextRemoteReceiptData, saveTableRecord, fetchClientBranches, fetchClientCurrentAccount } from '../utils/apiClient';
import { useUser, isEffectiveAdminUser } from '../context/UserContext';
import { printCurrentAccountA4 } from '../utils/printCurrentAccountA4';
import { Button, EmptyState, Skeleton, SkeletonLine, SkeletonCard, useToast } from '../components/ui';
import './Clientes.css';

const currentMonth = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
};

const emptyClientForm = {
    first_name: '',
    last_name: '',
    street: '',
    street_number: '',
    zip_code: '',
    city: '',
    phone1: '',
    phone2: '',
    email1: '',
    email2: '',
    hasCurrentAccount: true,
    employeeDiscountEnabled: false,
    employeeDiscountPct: '0',
    hasInitialBalance: false,
    balance: '',
    branchId: ''
};

const cleanValue = (value) => String(value || '').trim();
const normalizeDiscountPctInput = (value) => {
    const normalized = String(value || '').replace(',', '.').trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return '';
    return String(Math.max(0, Math.min(100, parsed)));
};
const splitStoredList = (value) => String(value || '')
    .split('\n')
    .map(cleanValue)
    .filter(Boolean);
const toClientForm = (client) => {
    const nameParts = cleanValue(client?.name).split(/\s+/).filter(Boolean);
    const fallbackFirstName = nameParts[0] || '';
    const fallbackLastName = nameParts.slice(1).join(' ');
    const phoneCandidates = [
        cleanValue(client?.phone1),
        cleanValue(client?.phone),
        ...splitStoredList(client?.phones),
    ].filter(Boolean);
    const emailCandidates = [
        cleanValue(client?.email1),
        ...splitStoredList(client?.emails),
    ].filter(Boolean);
    const employeeDiscountEnabled = Number(client?.employee_discount_enabled) === 1 || client?.employee_discount_enabled === true;
    const employeeDiscountPct = Math.max(0, Math.min(100, Number(client?.employee_discount_pct) || 0));
    return {
        first_name: (cleanValue(client?.first_name) || fallbackFirstName).toUpperCase(),
        last_name: (cleanValue(client?.last_name) || fallbackLastName).toUpperCase(),
        street: cleanValue(client?.street),
        street_number: cleanValue(client?.street_number),
        zip_code: cleanValue(client?.zip_code),
        city: cleanValue(client?.city),
        phone1: phoneCandidates[0] || '',
        phone2: cleanValue(client?.phone2) || phoneCandidates[1] || '',
        email1: emailCandidates[0] || '',
        email2: cleanValue(client?.email2) || emailCandidates[1] || '',
        hasCurrentAccount: hasCurrentAccount(client),
        employeeDiscountEnabled,
        employeeDiscountPct: employeeDiscountEnabled ? String(employeeDiscountPct) : '0',
        hasInitialBalance: Boolean(client?.has_initial_balance),
        balance: String(getBalanceValue(client) || ''),
        branchId: String(client?.branch_id || ''),
    };
};

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
const getClientFullName = (client) =>
    [cleanValue(client.first_name), cleanValue(client.last_name)].filter(Boolean).join(' ').toUpperCase() || cleanValue(client.name).toUpperCase();
const formatReceiptCode = (branchNumber = 1, receiptNumber = 0) =>
    `${String(branchNumber || 1).padStart(4, '0')}-${String(receiptNumber || 0).padStart(6, '0')}`;
const getMovementPaymentMethod = (movement) => {
    if (cleanValue(movement.payment_method)) return cleanValue(movement.payment_method);
    const match = String(movement.description || '').match(/\(([^()]+)\)\s*$/);
    return cleanValue(match?.[1]);
};

const isCurrentAccountPart = (part) => {
    const methodType = cleanValue(part?.method_type || part?.type).toLowerCase();
    const methodName = cleanValue(part?.method_name || part?.name).toLowerCase();
    return methodType === 'cuenta_corriente' || methodName === 'cuenta corriente';
};

const getCurrentAccountAmountFromVenta = (venta) => {
    const breakdown = Array.isArray(venta?.payment_breakdown) ? venta.payment_breakdown : null;
    if (breakdown?.length) {
        return breakdown.reduce((sum, part) => (
            isCurrentAccountPart(part)
                ? sum + (Number(part?.amount_charged ?? part?.amount ?? part?.total) || 0)
                : sum
        ), 0);
    }

    return cleanValue(venta?.payment_method).toLowerCase() === 'cuenta corriente'
        ? (Number(venta?.total) || 0)
        : 0;
};

const getClientLedgerPaymentMethod = (row) => {
    if (!row) return '-';
    if (Number(row.debe || 0) > 0) return 'Cuenta Corriente';
    const parts = String(row.comprobante || '').split(' - ');
    return cleanValue(parts[parts.length - 1]) || '-';
};

const Clientes = () => {
    const { currentUser, accessProfile, activeBranch, adminGlobalMode } = useUser();
    const currentBranchId = Number(activeBranch?.id ?? accessProfile?.branch?.id ?? 0) || null;
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClientId, setEditingClientId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [historyClient, setHistoryClient] = useState(null);
    const [historyMonth, setHistoryMonth] = useState(currentMonth);
    const [payInput, setPayInput] = useState('');
    const [payLoading, setPayLoading] = useState(false);
    const [paymentMethodId, setPaymentMethodId] = useState('');
    const [paymentQuickMode, setPaymentQuickMode] = useState(false);
    const [expandedLedgerRowId, setExpandedLedgerRowId] = useState(null);
    const [newClient, setNewClient] = useState(emptyClientForm);
    const [clients, setClients] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [branches, setBranches] = useState([]);
    const [clientLedger, setClientLedger] = useState({ rows: [], openingBalance: 0, salesTotal: 0, paymentTotal: 0, currentBalance: 0 });
    const paymentInputRef = useRef(null);
    const isEditingClient = Boolean(editingClientId);
    const toast = useToast();

    const clientBelongsToCurrentBranch = useCallback((client) => {
        if (adminGlobalMode) return true;
        if (!currentBranchId) return false;
        return Number(client?.branch_id) === Number(currentBranchId);
    }, [currentBranchId, adminGlobalMode]);

    const loadCoreData = useCallback(async () => {
        const [clientsRows, paymentMethodRows, branchPayload] = await Promise.all([
            fetchTable('clients', { limit: 1000, orderBy: 'id', direction: 'ASC' }),
            fetchTable('payment_methods', { limit: 100, orderBy: 'id', direction: 'ASC' }),
            fetchClientBranches(),
        ]);
        const allowedNames = ['Posnet', 'Postnet', 'Mercado Pago', 'Cuenta DNI', 'Efectivo', 'Transferencia'];
        const branchClients = (Array.isArray(clientsRows) ? clientsRows : []).filter(clientBelongsToCurrentBranch);
        setClients(branchClients);
        setPaymentMethods(paymentMethodRows.filter((method) => method.enabled && allowedNames.includes(method.name)));
        setBranches(Array.isArray(branchPayload?.branches) ? branchPayload.branches : []);
        return branchClients;
    }, [clientBelongsToCurrentBranch]);

    const loadLedger = useCallback(async (clientRef = historyClient, monthRef = historyMonth) => {
        if (!clientRef || !clientBelongsToCurrentBranch(clientRef)) {
            setClientLedger({ rows: [], openingBalance: 0, salesTotal: 0, paymentTotal: 0, currentBalance: 0 });
            return;
        }
        const [year, month] = monthRef.split('-').map(Number);
        const start = new Date(year, month - 1, 1).getTime();
        const end = new Date(year, month, 1).getTime();
        const clientId = Number(clientRef.id);
        // Endpoint dedicado: trae SOLO la cuenta corriente de este cliente (todas
        // sus ventas + cobros + items), sin el tope de 1000 filas que dejaba afuera
        // ventas recientes y sus detalles.
        const ledgerData = await fetchClientCurrentAccount(clientId);
        const ventas = Array.isArray(ledgerData?.ventas) ? ledgerData.ventas : [];
        const movimientos = Array.isArray(ledgerData?.movimientos) ? ledgerData.movimientos : [];
        const ventasItems = Array.isArray(ledgerData?.ventas_items) ? ledgerData.ventas_items : [];

        const saleRows = ventas
            .filter((venta) => {
                if (Number(venta.clientId) !== clientId) return false;
                return getCurrentAccountAmountFromVenta(venta) > 0;
            })
            .map((venta) => {
                const currentAccountAmount = getCurrentAccountAmountFromVenta(venta);
                return ({
                id: `sale-${venta.id}`,
                timestamp: new Date(venta.date).getTime(),
                fecha: new Date(venta.date),
                comprobante: `Venta ${venta.receipt_code || formatReceiptCode(1, venta.receipt_number || venta.id)}`,
                debe: currentAccountAmount,
                haber: 0,
                delta: -currentAccountAmount,
                items: ventasItems.filter((item) => Number(item.venta_id) === Number(venta.id))
            });
            });

        // El backend ya acota los movimientos a los cobros de este cliente
        // (customer_payment / 'Cobro Pendientes' por client_id), así que se mapean
        // directo: re-filtrar por descripción descartaba cobros válidos.
        const paymentRows = movimientos
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

        const storedCurrentBalance = getBalanceValue(clientRef);
        const monthDelta = allRows
            .filter((row) => row.timestamp >= start && row.timestamp < end)
            .reduce((sum, row) => sum + row.delta, 0);
        const futureDelta = allRows
            .filter((row) => row.timestamp >= end)
            .reduce((sum, row) => sum + row.delta, 0);
        const monthEndBalance = storedCurrentBalance - futureDelta;
        let runningBalance = monthEndBalance - monthDelta;
        const openingBalance = runningBalance;
        let salesTotal = 0;
        let paymentTotal = 0;
        const rows = [];

        allRows.forEach((row) => {
            if (row.timestamp < start) return;
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
            currentBalance: monthEndBalance
        });
    }, [historyClient, historyMonth, clientBelongsToCurrentBranch]);

    const refreshHistoryClient = async () => {
        if (!historyClient) return;
        const latestClients = await loadCoreData();
        const updated = latestClients.find((client) => Number(client.id) === Number(historyClient.id));
        if (updated) setHistoryClient(updated);
        return updated || null;
    };

    const historyClientData = historyClient;
    const effectiveHistoryBalance = clientLedger ? (Number(clientLedger.currentBalance) || 0) : getBalanceValue(historyClientData);

    useEffect(() => {
        setHistoryClient(null);
        setClientLedger({ rows: [], openingBalance: 0, salesTotal: 0, paymentTotal: 0, currentBalance: 0 });
        setSearchTerm('');
        setExpandedLedgerRowId(null);
        loadCoreData().finally(() => setIsLoading(false));
    }, [loadCoreData]);

    useEffect(() => {
        loadLedger();
    }, [loadLedger]);

    useEffect(() => {
        setExpandedLedgerRowId(null);
    }, [historyMonth]);

    const openHistory = (client, options = {}) => {
        if (!clientBelongsToCurrentBranch(client)) return;
        if (!hasCurrentAccount(client)) return;
        setHistoryClient(client);
        setHistoryMonth(currentMonth());
        setPayInput('');
        setPaymentMethodId('');
        setExpandedLedgerRowId(null);
        setPaymentQuickMode(Boolean(options.openPayment));
    };

    useEffect(() => {
        if (!historyClient || !paymentQuickMode) return;
        const timer = setTimeout(() => {
            paymentInputRef.current?.focus();
        }, 120);
        return () => clearTimeout(timer);
    }, [historyClient, paymentQuickMode]);

    const closeClientModal = () => {
        setIsModalOpen(false);
        setEditingClientId(null);
        setNewClient(emptyClientForm);
    };

    const openCreateClientModal = () => {
        setEditingClientId(null);
        setNewClient({
            ...emptyClientForm,
            branchId: currentBranchId ? String(currentBranchId) : '',
        });
        setIsModalOpen(true);
    };

    const openEditClientModal = (client) => {
        setEditingClientId(Number(client.id));
        setNewClient(toClientForm(client));
        setIsModalOpen(true);
    };

    const updateNewClient = (field, value) => {
        setNewClient((prev) => {
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
            if (field === 'employeeDiscountEnabled') {
                return {
                    ...prev,
                    employeeDiscountEnabled: value,
                    employeeDiscountPct: value ? (prev.employeeDiscountPct || '10') : '0',
                };
            }
            if (field === 'employeeDiscountPct') {
                return {
                    ...prev,
                    employeeDiscountPct: normalizeDiscountPctInput(value),
                };
            }
            return { ...prev, [field]: value };
        });
    };

    const handleSaveClient = async (e) => {
        e.preventDefault();
        const selectedBranchId = Number(newClient.branchId || currentBranchId || 0);
        if (!Number.isFinite(selectedBranchId) || selectedBranchId <= 0) {
            toast.error('No se pudo determinar la sucursal activa para guardar el cliente.');
            return;
        }
        const firstName = cleanValue(newClient.first_name).toUpperCase();
        const lastName = cleanValue(newClient.last_name).toUpperCase();
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
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
        const employeeDiscountEnabled = Boolean(newClient.employeeDiscountEnabled);
        const employeeDiscountPct = employeeDiscountEnabled
            ? Math.max(0, Math.min(100, parseFloat(newClient.employeeDiscountPct) || 0))
            : 0;
        const basePayload = {
            name: fullName,
            first_name: firstName,
            last_name: lastName,
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
            has_current_account: newClient.hasCurrentAccount,
            employee_discount_enabled: employeeDiscountEnabled,
            employee_discount_pct: employeeDiscountPct,
            branch_id: selectedBranchId,
            last_updated: new Date().toISOString(),
            synced: 0,
        };

        if (isEditingClient) {
            await saveTableRecord('clients', 'update', basePayload, editingClientId);
        } else {
            await saveTableRecord('clients', 'insert', {
                ...basePayload,
                has_initial_balance: newClient.hasCurrentAccount && newClient.hasInitialBalance,
                balance,
            });
        }

        closeClientModal();
        if (historyClient) {
            await refreshHistoryClient();
        } else {
            await loadCoreData();
        }
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
                money_flow_kind: 'customer_payment',
                origin_table: 'clients',
                origin_id: historyClient.id,
                origin_group_id: `client_payment_${paymentReceiptCode || paymentReceiptNumber || Date.now()}`,
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
            const updatedClient = await refreshHistoryClient();
            await loadLedger(updatedClient || historyClient, historyMonth);
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

    const handlePrintClientLedger = useCallback(() => {
        if (!historyClientData || !clientLedger) return;
        printCurrentAccountA4({
            entityLabel: 'Cliente',
            entityName: getClientFullName(historyClientData) || '-',
            entityDocument: getPrimaryPhone(historyClientData) || '',
            title: 'Detalle de Cuenta Corriente',
            subtitle: `Cliente · ${new Date(historyMonth + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
            rows: (clientLedger.rows || []).map((row) => ({
                date: row.fecha,
                concept: row.comprobante,
                paymentMethod: getClientLedgerPaymentMethod(row),
                debe: Number(row.debe || 0),
                haber: Number(row.haber || 0),
                balance: Number(row.saldo || 0)
            })),
            summary: {
                openingBalance: Number(clientLedger.openingBalance || 0),
                totalDebe: Number(clientLedger.salesTotal || 0),
                totalHaber: Number(clientLedger.paymentTotal || 0),
                saldoFinal: Number(clientLedger.currentBalance || 0)
            }
        });
    }, [clientLedger, historyClientData, historyMonth]);

    if (isLoading) return (
        <div className="clients-container animate-fade-in">
            <div className="neo-card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <Skeleton width="220px" height="38px" borderRadius="10px" />
                <Skeleton width="160px" height="38px" borderRadius="10px" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="neo-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
                                <SkeletonLine width="65%" />
                                <SkeletonLine width="45%" />
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <Skeleton width="30px" height="30px" borderRadius="8px" />
                                <Skeleton width="30px" height="30px" borderRadius="8px" />
                            </div>
                        </div>
                        <SkeletonLine width="55%" />
                        <SkeletonLine width="40%" />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <Skeleton width="90px" height="32px" borderRadius="8px" />
                            <Skeleton width="90px" height="32px" borderRadius="8px" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="clients-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                
                <Button variant="primary" icon={<UserPlus size={20} />} onClick={openCreateClientModal}>
                    Nuevo Cliente
                </Button>
            </header>
            </DirectionalReveal>

            <DirectionalReveal className="neo-card" style={{ marginBottom: '1.5rem', padding: '1rem' }} from="left" delay={0.1}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
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
            </DirectionalReveal>

            <div className="clients-table-wrap neo-card">
                <table className="clients-table">
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th>Teléfono</th>
                            <th>Cuenta</th>
                            <th style={{ textAlign: 'right' }}>Saldo</th>
                            <th style={{ textAlign: 'right' }}>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredClients?.map((client) => {
                            const accountEnabled = hasCurrentAccount(client);
                            const clientBalance = getBalanceValue(client);
                            const employeeDiscountEnabled = Number(client?.employee_discount_enabled) === 1 || client?.employee_discount_enabled === true;
                            const employeeDiscountPct = Math.max(0, Math.min(100, Number(client?.employee_discount_pct) || 0));
                            const balanceClass = clientBalance < 0 ? 'negative' : (clientBalance > 0 ? 'positive' : '');
                            return (
                                <tr key={client.id} className={`clients-row ${clientBalance < 0 ? 'debt' : (clientBalance > 0 ? 'credit' : '')}`}>
                                    <td className="clients-col-name">
                                        <span className="clients-name">{getClientFullName(client)}</span>
                                        <div className="clients-tags">
                                            {accountEnabled && employeeDiscountEnabled && employeeDiscountPct > 0 && (
                                                <span className="client-tag discount">Dto. {employeeDiscountPct.toLocaleString('es-AR', { maximumFractionDigits: 0 })}%</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="clients-col-phone">
                                        <div className="client-phone">
                                            <Phone size={13} />
                                            {getPrimaryPhone(client) || <span style={{ opacity: 0.4 }}>—</span>}
                                        </div>
                                    </td>
                                    <td className="clients-col-account">
                                        <span className={`client-account-badge ${accountEnabled ? 'enabled' : 'disabled'}`}>
                                            {accountEnabled ? 'Habilitada' : 'Sin CC'}
                                        </span>
                                    </td>
                                    <td className={`clients-col-balance ${balanceClass}`}>
                                        {!accountEnabled ? <span style={{ opacity: 0.3 }}>—</span> : (
                                            <>
                                                <span className="clients-balance-amount">
                                                    {clientBalance < 0 ? '-' : clientBalance > 0 ? '+' : ''}${Math.abs(clientBalance).toLocaleString()}
                                                </span>
                                                <span className="clients-balance-label">
                                                    {clientBalance < 0 ? 'Debe' : clientBalance > 0 ? 'A favor' : 'Al día'}
                                                </span>
                                            </>
                                        )}
                                    </td>
                                    <td className="clients-col-actions">
                                        <button type="button" onClick={() => openEditClientModal(client)} className="clients-action-btn">
                                            <Pencil size={14} />
                                        </button>
                                        {accountEnabled && (
                                            <>
                                                <button type="button" onClick={() => openHistory(client)} className="clients-action-btn">
                                                    <History size={14} />
                                                </button>
                                                <button type="button" onClick={() => openHistory(client, { openPayment: true })} className="clients-action-btn pay">
                                                    <Check size={14} /> Pago
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {filteredClients?.length === 0 && (
                    <div className="clients-empty">
                        <Users size={36} style={{ opacity: 0.15 }} />
                        <p>No se encontraron clientes.</p>
                    </div>
                )}
            </div>

            {isModalOpen && createPortal((
                <div className="modal-overlay clients-modal-overlay" onClick={closeClientModal}>
                    <div className="modal-content neo-card clients-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="clients-modal-header">
                            <h2 className="clients-modal-title">{isEditingClient ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
                            <button onClick={closeClientModal} className="clients-modal-close"><X size={24} /></button>
                        </div>

                        <form className="clients-modal-form" onSubmit={handleSaveClient}>
                            <p className="clients-form-section">Datos personales</p>
                            <div className="clients-form-group">
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
                            </div>

                            <p className="clients-form-section">Domicilio</p>
                            <div className="clients-form-grid">
                                <div className="clients-form-group">
                                    <label className="clients-form-label">Calle</label>
                                    <input type="text" className="neo-input" value={newClient.street} onChange={(e) => updateNewClient('street', e.target.value)} />
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

                            <p className="clients-form-section">Contacto</p>
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

                            <p className="clients-form-section">Configuración</p>
                            <div className="clients-form-toggles">
                                <label className="clients-checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={newClient.hasCurrentAccount}
                                        onChange={(e) => updateNewClient('hasCurrentAccount', e.target.checked)}
                                    />
                                    <span>Tiene cuenta corriente</span>
                                </label>

                                <label className="clients-checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={newClient.employeeDiscountEnabled}
                                        onChange={(e) => updateNewClient('employeeDiscountEnabled', e.target.checked)}
                                    />
                                    <span>Aplicar descuento de empleado</span>
                                </label>

                                {!isEditingClient && (
                                    <label className={`clients-checkbox-row ${!newClient.hasCurrentAccount ? 'disabled' : ''}`}>
                                        <input
                                            type="checkbox"
                                            checked={newClient.hasInitialBalance}
                                            disabled={!newClient.hasCurrentAccount}
                                            onChange={(e) => updateNewClient('hasInitialBalance', e.target.checked)}
                                        />
                                        <span>Tiene saldo inicial</span>
                                    </label>
                                )}
                            </div>

                            {isAdmin && (
                                <div className="clients-form-group clients-form-group-last">
                                    <label className="clients-form-label">Sucursal</label>
                                    <select
                                        className="neo-input"
                                        value={newClient.branchId}
                                        onChange={(e) => updateNewClient('branchId', e.target.value)}
                                    >
                                        {branches.map((b) => (
                                            <option key={b.id} value={String(b.id)}>{b.name || `Sucursal ${b.id}`}</option>
                                        ))}
                                    </select>
                                    <small className="clients-form-hint">Por defecto se asigna a la sucursal activa.</small>
                                </div>
                            )}

                            {newClient.employeeDiscountEnabled && (
                                <div className="clients-form-group clients-form-group-last">
                                    <label className="clients-form-label">Descuento empleado (%)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        className="neo-input"
                                        placeholder="Ej: 10"
                                        value={newClient.employeeDiscountPct}
                                        onChange={(e) => updateNewClient('employeeDiscountPct', e.target.value)}
                                    />
                                    <small className="clients-form-hint">Se aplicará automáticamente en Ventas al seleccionar este cliente.</small>
                                </div>
                            )}

                            {!isEditingClient && newClient.hasCurrentAccount && newClient.hasInitialBalance && (
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

                            {isEditingClient && (
                                <div className="clients-form-group clients-form-group-last">
                                    <small className="clients-form-hint">El saldo de cuenta corriente se gestiona desde Historial Cta. Cte.</small>
                                </div>
                            )}

                            <div className="clients-form-actions">
                                <button
                                    type="button"
                                    className="clients-action-button clients-secondary-button"
                                    onClick={closeClientModal}
                                >
                                    Cerrar
                                </button>
                                <button type="submit" className="clients-action-button clients-submit-button">
                                    {isEditingClient ? 'Guardar Cambios' : 'Crear Cliente'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ), document.body)}

            {historyClient && (
                <div className="modal-overlay" onClick={() => setHistoryClient(null)}>
                    <div className="modal-content neo-card clients-history-modal" style={{ maxWidth: '520px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <div className="clients-ledger-header">
                            <div className="clients-ledger-header__info">
                                <h2>Historial Cta. Cte.</h2>
                                <p>{getClientFullName(historyClientData)}</p>
                                {(formatAddress(historyClientData) || getClientPhones(historyClientData).length > 0 || getClientEmails(historyClientData).length > 0) && (
                                    <div className="clients-ledger-header__meta">
                                        {formatAddress(historyClientData) && <span>{formatAddress(historyClientData)}</span>}
                                        {getClientPhones(historyClientData).length > 0 && <span>{getClientPhones(historyClientData).join(' | ')}</span>}
                                        {getClientEmails(historyClientData).length > 0 && <span>{getClientEmails(historyClientData).join(' | ')}</span>}
                                    </div>
                                )}
                            </div>
                            <div className="clients-ledger-header__actions">
                                <Button
                                    variant="secondary"
                                    icon={<Printer size={15} />}
                                    onClick={handlePrintClientLedger}
                                    style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                                >
                                    Imprimir A4
                                </Button>
                                <button onClick={() => setHistoryClient(null)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        <div className={`clients-balance-card ${effectiveHistoryBalance < 0 ? 'clients-balance-card--debt' : 'clients-balance-card--credit'}`}>
                            <span className="clients-balance-card__label">Saldo actual</span>
                            <span className={`clients-balance-card__amount ${effectiveHistoryBalance < 0 ? 'clients-balance-card__amount--debt' : 'clients-balance-card__amount--credit'}`}>
                                {effectiveHistoryBalance < 0 ? '-' : ''}${Math.abs(effectiveHistoryBalance).toLocaleString()}
                            </span>
                        </div>

                        <div className="clients-pay-box">
                            <div className="clients-pay-box__title">Registrar pago / cobro</div>
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
                            <div className="clients-pay-box__row">
                                <div className="clients-pay-box__input-wrap">
                                    <span className="clients-pay-box__currency">$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        ref={paymentInputRef}
                                        value={payInput}
                                        onChange={(e) => setPayInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handlePayment(); }}
                                        className="neo-input clients-pay-box__input"
                                    />
                                </div>
                                <button
                                    onClick={handlePayment}
                                    disabled={payLoading || !payInput || parseFloat(payInput) <= 0 || !paymentMethodId}
                                    className="clients-pay-box__btn"
                                >
                                    <Check size={16} /> Cobrar
                                </button>
                            </div>
                        </div>

                        <div className="clients-month-nav">
                            <button
                                className="clients-month-nav__btn"
                                onClick={() => {
                                    const [y, m] = historyMonth.split('-').map(Number);
                                    const d = new Date(y, m - 2, 1);
                                    setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                                }}
                            ><ChevronLeft size={16} /></button>
                            <span className="clients-month-nav__label">
                                {new Date(historyMonth + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase())}
                            </span>
                            <button
                                className="clients-month-nav__btn"
                                onClick={() => {
                                    const [y, m] = historyMonth.split('-').map(Number);
                                    const d = new Date(y, m, 1);
                                    setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                                }}
                            ><ChevronRight size={16} /></button>
                        </div>

                        {clientLedger && clientLedger.rows.length > 0 && (
                            <div className="clients-debt-summary">
                                <span className="clients-debt-summary__label">
                                    Compras a cuenta del mes ({clientLedger.rows.length} movimiento{clientLedger.rows.length !== 1 ? 's' : ''})
                                </span>
                                <span className="clients-debt-summary__amount">
                                    ${clientLedger.salesTotal.toLocaleString()}
                                </span>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {clientLedger && (
                                <div className="clients-history-summary">
                                    <div className="clients-history-summary-item">
                                        <span>Saldo anterior</span>
                                        <strong>{clientLedger.openingBalance.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                    <div className="clients-history-summary-item">
                                        <span>Debe mes</span>
                                        <strong>{clientLedger.salesTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                    <div className="clients-history-summary-item positive">
                                        <span>Pagos mes</span>
                                        <strong>{clientLedger.paymentTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</strong>
                                    </div>
                                </div>
                            )}

                            {!clientLedger || clientLedger.rows.length === 0 ? (
                                <EmptyState
                                    compact
                                    icon={FileText}
                                    title="Sin movimientos"
                                    description="No hay movimientos registrados para este mes."
                                />
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
                                                        <td>{row.debe ? row.debe.toLocaleString('es-AR') : ''}</td>
                                                        <td>{row.haber ? row.haber.toLocaleString('es-AR') : ''}</td>
                                                        <td>{row.saldo.toLocaleString('es-AR')}</td>
                                                    </tr>
                                                    {expandedLedgerRowId === row.id && row.items?.length > 0 && (
                                                        <tr className="clients-history-row-detail">
                                                            <td colSpan="5">
                                                                <div className="clients-history-items">
                                                                    {row.items.map((item) => (
                                                                        <div key={item.id} className="clients-history-item-line">
                                                                            <span>{item.product_name}</span>
                                                                            <span>
                                                                                {item.quantity} x ${Number(item.price || 0).toLocaleString('es-AR')} = ${Number(item.subtotal || 0).toLocaleString('es-AR')}
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
