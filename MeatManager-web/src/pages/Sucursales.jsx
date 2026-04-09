import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Building2, MapPin, Phone, ShieldCheck, User } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { useTenant } from '../context/TenantContext';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { createBranchTransfer, fetchBranchTransfers, fetchClientBranches, fetchTable, receiveBranchTransfer } from '../utils/apiClient';
import './Sucursales.css';

const Sucursales = () => {
    const { tenant } = useTenant();
    const { accessProfile, currentUser } = useUser();
    const branch = accessProfile?.branch || null;
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const [branches, setBranches] = useState([]);
    const [stockRows, setStockRows] = useState([]);
    const [stockSearch, setStockSearch] = useState('');
    const [destinationBranchId, setDestinationBranchId] = useState('');
    const [transferItems, setTransferItems] = useState([]);
    const [transferNote, setTransferNote] = useState('');
    const [pendingTransfers, setPendingTransfers] = useState([]);
    const [outgoingTransfers, setOutgoingTransfers] = useState([]);
    const [transferStatus, setTransferStatus] = useState(null);
    const [transferError, setTransferError] = useState(null);
    const [transferLoading, setTransferLoading] = useState(false);
    const [receiveLoadingId, setReceiveLoadingId] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const loadBranches = async () => {
            try {
                const data = await fetchClientBranches();
                if (!cancelled) {
                    setBranches(Array.isArray(data?.branches) ? data.branches : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('[SUCURSALES] No se pudieron leer las sucursales del tenant', error);
                    setBranches([]);
                }
            }
        };

        loadBranches();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadStock = async () => {
            try {
                const rows = await fetchTable('stock');
                if (!cancelled) {
                    setStockRows(Array.isArray(rows) ? rows : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('[SUCURSALES] No se pudo leer el stock', error);
                    setStockRows([]);
                }
            }
        };

        loadStock();
        return () => { cancelled = true; };
    }, []);

    const refreshTransfers = async () => {
        try {
            const incoming = await fetchBranchTransfers({ direction: 'incoming', status: 'pending' });
            const outgoing = await fetchBranchTransfers({ direction: 'outgoing' });
            setPendingTransfers(Array.isArray(incoming?.transfers) ? incoming.transfers : []);
            setOutgoingTransfers(Array.isArray(outgoing?.transfers) ? outgoing.transfers : []);
        } catch (error) {
            console.error('[SUCURSALES] No se pudieron leer las transferencias', error);
        }
    };

    useEffect(() => {
        refreshTransfers();
    }, []);

    const currentBranch = useMemo(() => {
        if (branch?.id) {
            const matchedBranch = branches.find((item) => String(item.id) === String(branch.id));
            if (matchedBranch) return matchedBranch;
        }
        return branch || null;
    }, [branch, branches]);

    const currentBranchId = currentBranch?.id ? Number(currentBranch.id) : null;
    const branchStockRows = useMemo(() => {
        if (!Array.isArray(stockRows)) return [];
        if (!currentBranchId) return stockRows;
        return stockRows.filter((row) => row.branch_id == null || Number(row.branch_id) === currentBranchId);
    }, [stockRows, currentBranchId]);

    const availableStock = useMemo(() => {
        const grouped = new Map();
        branchStockRows.forEach((row) => {
            const key = row.product_id ? `product:${row.product_id}` : `name:${String(row.name || '').trim().toLowerCase()}::${String(row.unit || 'kg').trim()}`;
            const existing = grouped.get(key) || {
                key,
                product_id: row.product_id || null,
                name: String(row.name || '').trim(),
                type: row.type || null,
                unit: row.unit || 'kg',
                quantity: 0,
            };
            existing.quantity += Number(row.quantity) || 0;
            grouped.set(key, existing);
        });

        return Array.from(grouped.values())
            .filter((item) => item.quantity > 0.0001)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }, [branchStockRows]);

    const filteredStock = useMemo(() => {
        const term = stockSearch.trim().toLowerCase();
        if (!term) return availableStock;
        return availableStock.filter((item) => item.name.toLowerCase().includes(term));
    }, [availableStock, stockSearch]);

    const addToTransfer = (item) => {
        setTransferItems((prev) => {
            const existing = prev.find((entry) => entry.key === item.key);
            if (existing) {
                const nextQty = Math.min(existing.quantity + 1, existing.available || item.quantity);
                return prev.map((entry) => entry.key === item.key ? { ...entry, quantity: nextQty } : entry);
            }
            return [...prev, { ...item, available: item.quantity, quantity: Math.min(1, item.quantity) }];
        });
    };

    const updateTransferQty = (key, value) => {
        const parsed = Number(value);
        setTransferItems((prev) => {
            return prev
                .map((entry) => {
                    if (entry.key !== key) return entry;
                    const safeQty = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, entry.available || entry.quantity)) : entry.quantity;
                    return { ...entry, quantity: safeQty };
                })
                .filter((entry) => entry.quantity > 0);
        });
    };

    const removeTransferItem = (key) => {
        setTransferItems((prev) => prev.filter((entry) => entry.key !== key));
    };

    const handleCreateTransfer = async () => {
        if (!destinationBranchId) {
            setTransferError('Seleccioná la sucursal destino');
            return;
        }
        if (!transferItems.length) {
            setTransferError('Agregá al menos un producto al remito');
            return;
        }

        try {
            setTransferLoading(true);
            setTransferError(null);
            const payload = {
                from_branch_id: currentBranchId,
                to_branch_id: Number(destinationBranchId),
                note: transferNote,
                items: transferItems.map((item) => ({
                    product_id: item.product_id || null,
                    product_name: item.name,
                    quantity: item.quantity,
                    unit: item.unit,
                })),
            };
            const result = await createBranchTransfer(payload);
            setTransferStatus(`Remito ${result.remito_code || result.remito_number} creado`);
            setTransferItems([]);
            setTransferNote('');
            await refreshTransfers();
        } catch (error) {
            setTransferError(error.message || 'No se pudo crear el remito');
        } finally {
            setTransferLoading(false);
        }
    };

    const handleReceiveTransfer = async (transferId) => {
        try {
            setReceiveLoadingId(transferId);
            await receiveBranchTransfer(transferId);
            await refreshTransfers();
        } catch (error) {
            setTransferError(error.message || 'No se pudo confirmar la recepcion');
        } finally {
            setReceiveLoadingId(null);
        }
    };

    return (
        <div className="sucursales-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header sucursales-readonly-header">
                
            </header>
            </DirectionalReveal>

            <div className="sucursal-readonly-grid">
                <DirectionalReveal className="neo-card sucursal-readonly-card" from="left" delay={0.12}>
                    <div className="sucursal-readonly-card-head">
                        <div className="sucursal-readonly-icon">
                            <ArrowLeftRight size={22} />
                        </div>
                        <div>
                            <h2>{currentBranch?.name || 'Sin sucursal asignada'}</h2>
                            <p>
                                {branches.length > 0
                                    ? `El tenant tiene ${branches.length} sucursal${branches.length === 1 ? '' : 'es'} activa${branches.length === 1 ? '' : 's'} en GdC.`
                                    : 'Este tenant todavía no tiene sucursales activas sincronizadas desde GdC.'}
                            </p>
                        </div>
                    </div>

                    <div className="sucursal-readonly-body">
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Empresa</span>
                            <span className="sucursal-readonly-value">{tenant?.empresa || accessProfile?.username || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Sucursal</span>
                            <span className="sucursal-readonly-value">{currentBranch?.name || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Código interno</span>
                            <span className="sucursal-readonly-value">{currentBranch?.internalCode || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Dirección</span>
                            <span className="sucursal-readonly-value">{currentBranch?.address || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Estado</span>
                            <span className={`sucursal-status-pill ${currentBranch?.status ? 'active' : 'muted'}`}>
                                {currentBranch?.status || 'Sin asignar'}
                            </span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Sucursales del tenant</span>
                            <span className="sucursal-readonly-value">
                                {branches.length > 0
                                    ? branches.map((item) => item.internalCode ? `${item.name} (${item.internalCode})` : item.name).join(' • ')
                                    : '-'}
                            </span>
                        </div>
                    </div>
                </DirectionalReveal>

                <DirectionalReveal className="neo-card sucursal-readonly-card sucursal-readonly-info" from="right" delay={0.18}>
                    <h3>Contexto actual</h3>
                    <div className="sucursal-info-list">
                        <div className="sucursal-info-item">
                            <Building2 size={18} />
                            <div>
                                <strong>Tenant</strong>
                                <span>{tenant?.empresa || tenant?.email || '-'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <User size={18} />
                            <div>
                                <strong>Usuario</strong>
                                <span>{currentUser?.username || currentUser?.email || '-'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <ShieldCheck size={18} />
                            <div>
                                <strong>Rol</strong>
                                <span>{isAdmin ? 'Administrador' : 'Operador'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <MapPin size={18} />
                            <div>
                                <strong>Origen de datos</strong>
                                <span>Gestión de Clientes (GdC)</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <Phone size={18} />
                            <div>
                                <strong>Edición</strong>
                                <span>Alta, cambios y asignación de sucursal se hacen en GdC.</span>
                            </div>
                        </div>
                    </div>
                </DirectionalReveal>
            </div>

            <div className="sucursales-grid" style={{ marginTop: '2rem' }}>
                <DirectionalReveal className="neo-card transfer-card" from="left" delay={0.22}>
                    <div className="panel-header">
                        <div className="sucursal-readonly-icon icon-send">
                            <ArrowLeftRight size={20} />
                        </div>
                        <div>
                            <h2>Enviar mercaderÃ­a</h2>
                            <p>GenerÃ¡ un remito y notificÃ¡ a la sucursal destino.</p>
                        </div>
                    </div>

                    <div className="destination-config">
                        <label>Sucursal destino</label>
                        <select
                            value={destinationBranchId}
                            onChange={(e) => setDestinationBranchId(e.target.value)}
                            className="neo-input-mini"
                            style={{ width: '100%' }}
                        >
                            <option value="">Seleccionar sucursal</option>
                            {branches
                                .filter((item) => String(item.id) !== String(currentBranchId))
                                .map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} {item.internalCode ? `(${item.internalCode})` : ''}
                                    </option>
                                ))}
                        </select>
                    </div>

                    <div className="stock-selector">
                        <div className="search-box">
                            <input
                                placeholder="Buscar en stock..."
                                value={stockSearch}
                                onChange={(e) => setStockSearch(e.target.value)}
                            />
                        </div>
                        <div className="stock-list-mini">
                            {filteredStock.length === 0 ? (
                                <div style={{ color: 'var(--color-text-muted)', padding: '0.5rem 0.2rem' }}>
                                    No hay items con stock para enviar.
                                </div>
                            ) : (
                                filteredStock.map((item) => (
                                    <div key={item.key} className="stock-item-pick" onClick={() => addToTransfer(item)}>
                                        <div className="item-details">
                                            <span className="name">{item.name}</span>
                                            <span className="qty">Disponible: {item.quantity.toFixed(item.unit === 'kg' ? 3 : 0)} {item.unit}</span>
                                        </div>
                                        <button className="add-btn">+</button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="transfer-bucket">
                        <div className="bucket-list">
                            {transferItems.length === 0 ? (
                                <div style={{ color: 'var(--color-text-muted)' }}>
                                    ArrastrÃ¡ o clickeÃ¡ productos para armar el remito.
                                </div>
                            ) : (
                                transferItems.map((item) => (
                                    <div key={item.key} className="bucket-item">
                                        <div>
                                            <strong>{item.name}</strong>
                                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                                                MÃ¡x: {item.available?.toFixed(item.unit === 'kg' ? 3 : 0)} {item.unit}
                                            </div>
                                        </div>
                                        <div className="qty-edit">
                                            <input
                                                type="number"
                                                min="0"
                                                step={item.unit === 'kg' ? '0.001' : '1'}
                                                value={item.quantity}
                                                onChange={(e) => updateTransferQty(item.key, e.target.value)}
                                            />
                                            <span>{item.unit}</span>
                                            <button onClick={() => removeTransferItem(item.key)}>Ã—</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <label style={{ marginBottom: '0.35rem', color: 'var(--color-text-muted)' }}>Notas</label>
                        <textarea
                            value={transferNote}
                            onChange={(e) => setTransferNote(e.target.value)}
                            style={{ minHeight: '70px', marginBottom: '1rem', background: 'var(--color-bg-main)', border: '1px solid var(--color-border)', color: '#fff', borderRadius: '8px', padding: '0.6rem' }}
                            placeholder="Observaciones del remito..."
                        />

                        {transferError ? (
                            <div style={{ color: '#fca5a5', marginBottom: '0.75rem' }}>{transferError}</div>
                        ) : null}
                        {transferStatus ? (
                            <div style={{ color: '#86efac', marginBottom: '0.75rem' }}>{transferStatus}</div>
                        ) : null}

                        <button
                            className="action-btn-main"
                            disabled={transferLoading || !destinationBranchId || transferItems.length === 0}
                            onClick={handleCreateTransfer}
                        >
                            {transferLoading ? 'Generando...' : 'Generar remito y enviar'}
                        </button>
                    </div>
                </DirectionalReveal>

                <DirectionalReveal className="neo-card transfer-card" from="right" delay={0.26}>
                    <div className="panel-header">
                        <div className="sucursal-readonly-icon icon-receive">
                            <ArrowLeftRight size={20} />
                        </div>
                        <div>
                            <h2>Recibir mercaderÃ­a</h2>
                            <p>ConfirmÃ¡ los remitos pendientes para actualizar tu stock.</p>
                        </div>
                    </div>

                    {pendingTransfers.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>
                            No hay remitos pendientes para tu sucursal.
                        </div>
                    ) : (
                        pendingTransfers.map((transfer) => (
                            <div key={transfer.id} className="branch-file-row" style={{ alignItems: 'flex-start' }}>
                                <div>
                                    <strong>Remito {transfer.remito_code || transfer.remito_number}</strong>
                                    <span>Desde: {transfer.from_branch?.name || transfer.from_branch_id}</span>
                                    <span>Creado: {transfer.created_at ? new Date(transfer.created_at).toLocaleString('es-AR') : '-'}</span>
                                    {transfer.note ? <span>Nota: {transfer.note}</span> : null}
                                    <div style={{ marginTop: '0.5rem' }}>
                                        {(transfer.items || []).map((item) => (
                                            <div key={`${transfer.id}-${item.id}`} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                                {item.product_name} â€” {Number(item.quantity).toFixed(item.unit === 'kg' ? 3 : 0)} {item.unit}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="branch-file-actions">
                                    <button
                                        className="action-btn-main"
                                        style={{ padding: '0.6rem 1rem' }}
                                        disabled={receiveLoadingId === transfer.id}
                                        onClick={() => handleReceiveTransfer(transfer.id)}
                                    >
                                        {receiveLoadingId === transfer.id ? 'Confirmando...' : 'Confirmar recepciÃ³n'}
                                    </button>
                                </div>
                            </div>
                        ))
                    )}

                    {outgoingTransfers.length > 0 ? (
                        <div style={{ marginTop: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 0.6rem', color: 'var(--color-text-main)' }}>Enviados recientes</h3>
                            {outgoingTransfers.slice(0, 5).map((transfer) => (
                                <div key={`out-${transfer.id}`} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                                    {transfer.remito_code || transfer.remito_number} â€” {transfer.to_branch?.name || transfer.to_branch_id} ({transfer.status})
                                </div>
                            ))}
                        </div>
                    ) : null}
                </DirectionalReveal>
            </div>
        </div>
    );
};

export default Sucursales;
