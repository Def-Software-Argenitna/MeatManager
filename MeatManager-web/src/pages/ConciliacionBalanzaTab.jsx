import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ShoppingBag, AlertTriangle, CheckSquare, Square, ChevronRight } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import './ConciliacionBalanzaTab.css';

const today = () => new Date().toISOString().slice(0, 10);

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtKg = (n) => n ? `${(n / 1000).toFixed(3)} kg` : '-';

export default function ConciliacionBalanzaTab() {
    const navigate = useNavigate();
    const [dateFrom, setDateFrom] = useState(today());
    const [dateTo, setDateTo] = useState(today());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [tickets, setTickets] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [subTab, setSubTab] = useState('listado');
    const [detailTicket, setDetailTicket] = useState(null);
    const [sortField, setSortField] = useState('sale_at');
    const [sortDir, setSortDir] = useState('desc');
    const [filterText, setFilterText] = useState('');

    const buscar = useCallback(async () => {
        setLoading(true);
        setError(null);
        setTickets(null);
        setSelectedIds(new Set());
        setDetailTicket(null);
        try {
            const data = await apiFetch(`/api/conciliacion/balanza?dateFrom=${dateFrom}&dateTo=${dateTo}`);
            setTickets(data.tickets || []);
        } catch (e) {
            setError(e.message || 'Error al cargar datos');
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

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

            {tickets !== null && !loading && (
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

                        {selectedIds.size > 0 && (
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

                    {subTab === 'listado' && (
                        <>
                            {filtered.length === 0 ? (
                                <div className="concil-empty">
                                    <ShoppingBag size={40} style={{ opacity: 0.2 }} />
                                    <p>No hay tickets pendientes de conciliación en ese rango de fechas.</p>
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
                                    <div className="concil-table-wrap">
                                        <table className="concil-table">
                                            <thead>
                                                <tr>
                                                    <th>
                                                        <button className="concil-check-btn" onClick={toggleAll}>
                                                            {selectedIds.size === filtered.length && filtered.length > 0
                                                                ? <CheckSquare size={16} />
                                                                : <Square size={16} />}
                                                        </button>
                                                    </th>
                                                    <th onClick={() => handleSort('sale_at')} className="sortable">Fecha <SortIcon field="sale_at" /></th>
                                                    <th>Ticket</th>
                                                    <th onClick={() => handleSort('vendor_name')} className="sortable">Vendedor <SortIcon field="vendor_name" /></th>
                                                    <th onClick={() => handleSort('item_count')} className="sortable">Ítems <SortIcon field="item_count" /></th>
                                                    <th onClick={() => handleSort('total_amount')} className="sortable">Importe <SortIcon field="total_amount" /></th>
                                                    <th></th>
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
                                                <th>Línea</th>
                                                <th>PLU</th>
                                                <th>Vendedor</th>
                                                <th>Peso bruto</th>
                                                <th>Cantidad</th>
                                                <th>Importe</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailTicket.items.map((item, i) => (
                                                <tr key={i}>
                                                    <td className="concil-cell-center">{item.line_no}</td>
                                                    <td><code>{item.plu_code}</code></td>
                                                    <td>{item.vendor_name || '—'}</td>
                                                    <td>{fmtKg(item.grams)}</td>
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
                </>
            )}

            {tickets === null && !loading && (
                <div className="concil-empty">
                    <Search size={40} style={{ opacity: 0.15 }} />
                    <p>Seleccioná un rango de fechas y presioná Buscar.</p>
                </div>
            )}
        </div>
    );
}
