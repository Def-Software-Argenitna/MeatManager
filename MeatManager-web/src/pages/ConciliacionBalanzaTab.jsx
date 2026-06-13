import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ShoppingBag, AlertTriangle, CheckSquare, Square, ChevronRight, PlusCircle, Hash, CreditCard, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import './ConciliacionBalanzaTab.css';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtKg = (n) => n ? `${(n / 1000).toFixed(3)} kg` : '-';

const todayStr = () => new Date().toISOString().slice(0, 10);

const apiFetchJson = async (path, options) => {
    const res = await apiFetch(path, options);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
};

export default function ConciliacionBalanzaTab() {
    const navigate = useNavigate();

    // ── Listado ──────────────────────────────────────────────────────────────
    const [dateFrom, setDateFrom] = useState(todayStr);
    const [dateTo, setDateTo] = useState(todayStr);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [subTab, setSubTab] = useState('listado');
    const [detailTicket, setDetailTicket] = useState(null);
    const [sortField, setSortField] = useState('sale_at');
    const [sortDir, setSortDir] = useState('desc');
    const [filterText, setFilterText] = useState('');

    // ── Carga manual ─────────────────────────────────────────────────────────
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [manualBarcode, setManualBarcode] = useState('');
    const [manualSearching, setManualSearching] = useState(false);
    const [manualTicket, setManualTicket] = useState(null);
    const [manualError, setManualError] = useState(null);
    const [manualPaymentId, setManualPaymentId] = useState('');
    const [manualNotes, setManualNotes] = useState('');
    const [manualSaving, setManualSaving] = useState(false);
    const [manualSuccess, setManualSuccess] = useState(null);

    // ── Cargar métodos de pago ────────────────────────────────────────────────
    useEffect(() => {
        apiFetchJson('/api/table/payment_methods')
            .then(data => {
                const rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
                const active = rows.filter(m => !m.inactive && String(m.type || '').toLowerCase() !== 'mixed');
                setPaymentMethods(active);
                if (active.length > 0) setManualPaymentId(String(active[0].id));
            })
            .catch(() => {});
    }, []);

    // ── Buscar tickets open ───────────────────────────────────────────────────
    const buscar = useCallback(async () => {
        setLoading(true);
        setError(null);
        setTickets([]);
        setSelectedIds(new Set());
        setDetailTicket(null);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            const qs = params.toString() ? `?${params.toString()}` : '';
            const data = await apiFetchJson(`/api/conciliacion/balanza${qs}`);
            setTickets(data.tickets || []);
        } catch (e) {
            setError(e.message || 'Error al cargar datos');
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => { buscar(); }, []);

    // ── Carga manual: buscar ticket por barcode ───────────────────────────────
    const buscarManual = async () => {
        const code = manualBarcode.trim();
        if (!code) return;
        setManualSearching(true);
        setManualTicket(null);
        setManualError(null);
        setManualSuccess(null);
        try {
            const data = await apiFetchJson(`/api/scale/tickets/by-barcode/${encodeURIComponent(code)}`);
            setManualTicket(data);
        } catch (e) {
            setManualError(e.message || 'Ticket no encontrado');
        } finally {
            setManualSearching(false);
        }
    };

    // ── Carga manual: registrar cobro ─────────────────────────────────────────
    const registrarCobro = async () => {
        if (!manualTicket?.ticket) return;
        const pm = paymentMethods.find(m => String(m.id) === String(manualPaymentId));
        setManualSaving(true);
        setManualError(null);
        try {
            const data = await apiFetchJson('/api/conciliacion/balanza/cobro-manual', {
                method: 'POST',
                body: JSON.stringify({
                    ticket_barcode: manualTicket.ticket.ticket_barcode,
                    payment_method_id: pm?.id ?? null,
                    payment_method_name: pm?.name ?? '',
                    notes: manualNotes.trim() || null,
                }),
            });
            setManualSuccess({ saleId: data.sale_id, total: data.total });
            setManualTicket(null);
            setManualBarcode('');
            setManualNotes('');
            buscar();
        } catch (e) {
            setManualError(e.message || 'Error al registrar cobro');
        } finally {
            setManualSaving(false);
        }
    };

    // ── Listado: lógica ───────────────────────────────────────────────────────
    const handleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const filtered = React.useMemo(() => {
        if (!tickets) return [];
        const term = filterText.toLowerCase();
        let rows = term
            ? tickets.filter(t =>
                (t.printed_ticket_barcode || t.ticket_barcode || '').toLowerCase().includes(term) ||
                (t.vendor_name || '').toLowerCase().includes(term)
            )
            : tickets;
        return [...rows].sort((a, b) => {
            let av = a[sortField] ?? '', bv = b[sortField] ?? '';
            if (sortField === 'total_amount' || sortField === 'item_count') { av = Number(av); bv = Number(bv); }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [tickets, filterText, sortField, sortDir]);

    const toggleSelect = (id) => setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const toggleAll = () => {
        if (selectedIds.size === filtered.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(filtered.map(t => t.id)));
    };

    const cargarAlPOS = (barcodes) => {
        if (barcodes.length === 1) {
            navigate('/ventas', { state: { conciliacionTicket: barcodes[0] } });
        } else {
            navigate('/ventas', { state: { conciliacionMultiTickets: barcodes } });
        }
    };

    const selectedTickets = filtered.filter(t => selectedIds.has(t.id));
    const totalPendiente = filtered.reduce((s, t) => s + Number(t.total_amount || 0), 0);
    const totalSeleccionado = selectedTickets.reduce((s, t) => s + Number(t.total_amount || 0), 0);

    const SortIcon = ({ field }) => {
        if (sortField !== field) return <ArrowUpDown size={13} style={{ opacity: 0.4 }} />;
        return sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
    };

    const ticketStatus = manualTicket?.ticket?.ticket_status;
    const ticketAlreadyCharged = ticketStatus && String(ticketStatus).toLowerCase() !== 'open';

    return (
        <div className="concil-wrap">
            {/* Filtros */}
            <div className="concil-filters">
                <div className="concil-filter-group">
                    <label>Desde</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div className="concil-filter-group">
                    <label>Hasta</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                <button className="concil-buscar-btn" onClick={buscar} disabled={loading}>
                    {loading ? 'Buscando…' : <><Search size={15} /> Buscar</>}
                </button>
            </div>

            {error && (
                <div className="concil-error">
                    <AlertTriangle size={16} /> {error}
                </div>
            )}

            {!loading && (
                <>
                    {/* Summary chips */}
                    <div className="concil-summary">
                        <div className="concil-chip">
                            <span className="concil-chip-label">Tickets pendientes</span>
                            <span className="concil-chip-value">{filtered.length}</span>
                        </div>
                        <div className="concil-chip">
                            <span className="concil-chip-label">Total sin cobrar</span>
                            <span className="concil-chip-value">{fmt(totalPendiente)}</span>
                        </div>
                        {selectedIds.size > 0 && (
                            <div className="concil-chip selected">
                                <span className="concil-chip-label">Seleccionados</span>
                                <span className="concil-chip-value">{selectedIds.size} · {fmt(totalSeleccionado)}</span>
                            </div>
                        )}
                    </div>

                    {/* Sub-tabs */}
                    <div className="concil-subtabs">
                        <button className={`concil-subtab ${subTab === 'listado' ? 'active' : ''}`} onClick={() => setSubTab('listado')}>
                            Listado Open
                        </button>
                        <button
                            className={`concil-subtab ${subTab === 'detalle' ? 'active' : ''}`}
                            onClick={() => setSubTab('detalle')}
                            disabled={!detailTicket}
                        >
                            Detalle{detailTicket ? ` — ${detailTicket.printed_ticket_barcode || detailTicket.ticket_barcode?.slice(-8)}` : ''}
                        </button>
                        <button
                            className={`concil-subtab ${subTab === 'manual' ? 'active' : ''}`}
                            onClick={() => setSubTab('manual')}
                        >
                            <PlusCircle size={14} style={{ marginRight: '0.3rem' }} />
                            Carga Manual
                        </button>

                        {selectedIds.size > 0 && subTab !== 'manual' && (
                            <div className="concil-actions">
                                {selectedIds.size === 1 ? (
                                    <button
                                        className="concil-action-btn primary"
                                        onClick={() => cargarAlPOS([selectedTickets[0].ticket_barcode])}
                                    >
                                        <ShoppingBag size={15} /> Cargar al POS
                                    </button>
                                ) : (
                                    <button
                                        className="concil-action-btn primary"
                                        onClick={() => cargarAlPOS(selectedTickets.map(t => t.ticket_barcode))}
                                    >
                                        <ShoppingBag size={15} /> Combinar y cargar ({selectedIds.size})
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── LISTADO ────────────────────────────────────────────── */}
                    {subTab === 'listado' && (
                        <>
                            {filtered.length === 0 ? (
                                <div className="concil-empty">
                                    <ShoppingBag size={40} style={{ opacity: 0.2 }} />
                                    <p>No hay tickets pendientes de conciliación.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="concil-search-row">
                                        <Search size={15} />
                                        <input
                                            placeholder="Filtrar por ticket o vendedor…"
                                            value={filterText}
                                            onChange={e => setFilterText(e.target.value)}
                                        />
                                    </div>
                                    <div className="concil-result-count">{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</div>
                                    <div className="concil-table-wrap">
                                        <table className="concil-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '40px' }}>
                                                        <button className="concil-check-btn" onClick={toggleAll}>
                                                            {selectedIds.size === filtered.length && filtered.length > 0
                                                                ? <CheckSquare size={16} />
                                                                : <Square size={16} />}
                                                        </button>
                                                    </th>
                                                    <th style={{ width: '130px' }} onClick={() => handleSort('sale_at')}><span className="concil-th-sort">Fecha <SortIcon field="sale_at" /></span></th>
                                                    <th style={{ width: '140px' }}>Ticket</th>
                                                    <th onClick={() => handleSort('vendor_name')}><span className="concil-th-sort">Vendedor <SortIcon field="vendor_name" /></span></th>
                                                    <th style={{ width: '70px', textAlign: 'center' }} onClick={() => handleSort('item_count')}><span className="concil-th-sort" style={{ justifyContent: 'center' }}>Ítems <SortIcon field="item_count" /></span></th>
                                                    <th style={{ width: '120px', textAlign: 'right' }} onClick={() => handleSort('total_amount')}><span className="concil-th-sort" style={{ justifyContent: 'flex-end' }}>Importe <SortIcon field="total_amount" /></span></th>
                                                    <th style={{ width: '36px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filtered.map(t => (
                                                    <tr
                                                        key={t.id}
                                                        className={selectedIds.has(t.id) ? 'selected' : ''}
                                                        onClick={() => toggleSelect(t.id)}
                                                    >
                                                        <td onClick={e => e.stopPropagation()}>
                                                            <button className="concil-check-btn" onClick={() => toggleSelect(t.id)}>
                                                                {selectedIds.has(t.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                                            </button>
                                                        </td>
                                                        <td className="concil-cell-date">{fmtDate(t.sale_at)}</td>
                                                        <td className="concil-cell-ticket">{t.printed_ticket_barcode || t.ticket_barcode?.slice(-10)}</td>
                                                        <td>{t.vendor_name || '—'}</td>
                                                        <td className="concil-cell-center">{t.item_count}</td>
                                                        <td className="concil-cell-amount">{fmt(t.total_amount)}</td>
                                                        <td onClick={e => e.stopPropagation()}>
                                                            <button
                                                                className="concil-detail-btn"
                                                                onClick={() => { setDetailTicket(t); setSubTab('detalle'); }}
                                                                title="Ver detalle"
                                                            >
                                                                <ChevronRight size={16} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ── DETALLE ────────────────────────────────────────────── */}
                    {subTab === 'detalle' && detailTicket && (
                        <div className="concil-detail">
                            <div className="concil-detail-header">
                                <div>
                                    <div className="concil-detail-title">Ticket {detailTicket.printed_ticket_barcode || detailTicket.ticket_barcode?.slice(-10)}</div>
                                    <div className="concil-detail-meta">
                                        {fmtDate(detailTicket.sale_at)} · {detailTicket.vendor_name || 'Sin vendedor'} · {detailTicket.item_count} ítem{detailTicket.item_count !== 1 ? 's' : ''}
                                    </div>
                                </div>
                                <button
                                    className="concil-action-btn primary"
                                    onClick={() => cargarAlPOS([detailTicket.ticket_barcode])}
                                >
                                    <ShoppingBag size={15} /> Cargar al POS
                                </button>
                            </div>

                            <div className="concil-detail-info">
                                <div className="concil-info-row"><span>Barcode interno</span><code>{detailTicket.ticket_barcode}</code></div>
                                <div className="concil-info-row"><span>Barcode impreso</span><code>{detailTicket.printed_ticket_barcode || '—'}</code></div>
                                <div className="concil-info-row"><span>Dirección balanza</span><span>{detailTicket.scale_address ?? '—'}</span></div>
                                <div className="concil-info-row"><span>Sincronizado</span><span>{fmtDate(detailTicket.synced_at)}</span></div>
                                <div className="concil-info-row"><span>Estado</span><span className="concil-badge open">SIN COBRAR</span></div>
                                <div className="concil-info-row total"><span>Total</span><span>{fmt(detailTicket.total_amount)}</span></div>
                            </div>

                            {detailTicket.items?.length > 0 && (
                                <div className="concil-items-table-wrap">
                                    <table className="concil-table concil-items-table">
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px' }}>Línea</th>
                                                <th style={{ width: '90px' }}>PLU</th>
                                                <th>Descripción</th>
                                                <th>Vendedor</th>
                                                <th style={{ width: '90px' }}>Cantidad</th>
                                                <th style={{ width: '110px', textAlign: 'right' }}>Importe</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailTicket.items.map((item, i) => (
                                                <tr key={i}>
                                                    <td className="concil-cell-center">{item.line_no}</td>
                                                    <td><code>{item.plu_code}</code></td>
                                                    <td>{item.product_name || '—'}</td>
                                                    <td>{item.vendor_name || '—'}</td>
                                                    <td>{Number(item.item_quantity || 0).toFixed(3)} {item.item_quantity_unit || 'kg'}</td>
                                                    <td className="concil-cell-amount">{fmt(item.amount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── CARGA MANUAL ──────────────────────────────────────── */}
                    {subTab === 'manual' && (
                        <div className="concil-manual">
                            <div className="concil-manual-title">
                                <Hash size={16} /> Cargar ticket manualmente
                            </div>

                            {/* Buscar barcode */}
                            <div className="concil-manual-search">
                                <div className="concil-filter-group" style={{ flex: 1 }}>
                                    <label>Número / código de barras del ticket</label>
                                    <div className="concil-barcode-row">
                                        <input
                                            type="text"
                                            placeholder="Ej: 0000012345678"
                                            value={manualBarcode}
                                            onChange={e => { setManualBarcode(e.target.value); setManualTicket(null); setManualError(null); setManualSuccess(null); }}
                                            onKeyDown={e => e.key === 'Enter' && buscarManual()}
                                        />
                                        <button
                                            className="concil-buscar-btn"
                                            onClick={buscarManual}
                                            disabled={manualSearching || !manualBarcode.trim()}
                                        >
                                            {manualSearching ? 'Buscando…' : <><Search size={15} /> Buscar</>}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {manualError && (
                                <div className="concil-error">
                                    <AlertTriangle size={16} /> {manualError}
                                </div>
                            )}

                            {manualSuccess && (
                                <div className="concil-success">
                                    <CheckCircle2 size={16} />
                                    Cobro registrado correctamente — Venta #{manualSuccess.saleId} · {fmt(manualSuccess.total)}
                                </div>
                            )}

                            {/* Ticket encontrado */}
                            {manualTicket?.ticket && (
                                <div className="concil-manual-card">
                                    <div className="concil-manual-card-header">
                                        <div>
                                            <div className="concil-detail-title">
                                                Ticket {manualTicket.ticket.printed_ticket_barcode || manualTicket.ticket.ticket_barcode?.slice(-10)}
                                            </div>
                                            <div className="concil-detail-meta">
                                                {fmtDate(manualTicket.ticket.sale_at)} · {manualTicket.ticket.vendor_name || 'Sin vendedor'}
                                            </div>
                                        </div>
                                        <span className={`concil-badge ${ticketAlreadyCharged ? 'charged' : 'open'}`}>
                                            {ticketAlreadyCharged ? 'YA COBRADO' : 'SIN COBRAR'}
                                        </span>
                                    </div>

                                    {ticketAlreadyCharged && (
                                        <div className="concil-error" style={{ marginTop: '0.5rem' }}>
                                            <AlertTriangle size={16} /> Este ticket ya fue cobrado (venta #{manualTicket.ticket.charged_sale_id}).
                                        </div>
                                    )}

                                    {/* Items */}
                                    {manualTicket.items?.length > 0 && (
                                        <div className="concil-items-table-wrap" style={{ marginTop: '0.75rem' }}>
                                            <table className="concil-table concil-items-table">
                                                <thead>
                                                    <tr>
                                                        <th>PLU</th>
                                                        <th>Producto</th>
                                                        <th>Cantidad</th>
                                                        <th>Importe</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {manualTicket.items.map((item, i) => (
                                                        <tr key={i}>
                                                            <td><code>{item.plu_code || item.plu}</code></td>
                                                            <td>{item.product?.name || item.name || '—'}</td>
                                                            <td>{Number(item.item_quantity || item.quantity || 0).toFixed(3)} {item.item_quantity_unit || item.unit || 'kg'}</td>
                                                            <td className="concil-cell-amount">{fmt(item.amount)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    <div className="concil-info-row total" style={{ marginTop: '0.5rem', borderRadius: '8px' }}>
                                        <span>Total del ticket</span>
                                        <span>{fmt(manualTicket.ticket.total_amount)}</span>
                                    </div>

                                    {/* Form de cobro */}
                                    {!ticketAlreadyCharged && (
                                        <div className="concil-manual-form">
                                            <div className="concil-filter-group">
                                                <label><CreditCard size={13} style={{ marginRight: '0.3rem' }} />Método de pago</label>
                                                <select
                                                    value={manualPaymentId}
                                                    onChange={e => setManualPaymentId(e.target.value)}
                                                    className="concil-manual-select"
                                                >
                                                    {paymentMethods.map(m => (
                                                        <option key={m.id} value={m.id}>{m.name}</option>
                                                    ))}
                                                    {paymentMethods.length === 0 && (
                                                        <option value="">Sin métodos configurados</option>
                                                    )}
                                                </select>
                                            </div>
                                            <div className="concil-filter-group">
                                                <label>Observaciones (opcional)</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: cliente pagó en efectivo en mostrador"
                                                    value={manualNotes}
                                                    onChange={e => setManualNotes(e.target.value)}
                                                    className="concil-manual-notes"
                                                />
                                            </div>
                                            <div className="concil-manual-actions">
                                                <button
                                                    className="concil-action-btn secondary"
                                                    onClick={() => cargarAlPOS([manualTicket.ticket.ticket_barcode])}
                                                >
                                                    <ShoppingBag size={15} /> Abrir en POS
                                                </button>
                                                <button
                                                    className="concil-action-btn primary"
                                                    onClick={registrarCobro}
                                                    disabled={manualSaving || !manualPaymentId}
                                                >
                                                    <CheckCircle2 size={15} />
                                                    {manualSaving ? 'Registrando…' : 'Registrar cobro'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!manualTicket && !manualError && !manualSuccess && (
                                <div className="concil-empty" style={{ paddingTop: '2rem' }}>
                                    <Hash size={36} style={{ opacity: 0.15 }} />
                                    <p>Ingresá el número de ticket de la balanza para buscarlo.</p>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
