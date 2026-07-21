import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, AlertTriangle, ShoppingBag, ChevronRight, Printer, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useUser } from '../context/UserContext';
import './ConciliacionBalanzaTab.css';

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const fmtDateTime = (s) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtTime = (s) => s ? new Date(s).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

const todayStr = () => new Date().toISOString().slice(0, 10);

const apiFetchJson = async (path, options) => {
    const res = await apiFetch(path, options);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
};

const STATUS_STYLE = {
    cobrado: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'COBRADO' },
    pendiente: { bg: 'rgba(234,179,8,0.15)', color: '#eab308', label: 'PENDIENTE' },
    anulado: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', label: 'ANULADO' },
};

const StatusBadge = ({ status }) => {
    const s = STATUS_STYLE[status] || STATUS_STYLE.pendiente;
    return (
        <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '6px',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.03em',
            background: s.bg, color: s.color,
        }}>{s.label}</span>
    );
};

const OriginBadge = ({ origin }) => {
    const isManual = origin === 'manual';
    return (
        <span style={{
            display: 'inline-block', marginLeft: '6px', padding: '1px 6px', borderRadius: '5px',
            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.03em', verticalAlign: 'middle',
            background: isManual ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.15)',
            color: isManual ? '#3b82f6' : '#94a3b8',
        }}>{isManual ? 'MANUAL' : 'BALANZA'}</span>
    );
};

const cantidadLinea = (item) => {
    const qty = Number(item.itemQuantity || 0);
    const unit = item.itemQuantityUnit || (Number(item.grams) > 0 ? 'kg' : 'un');
    if (qty > 0) return `${qty.toFixed(3)} ${unit}`;
    if (Number(item.grams) > 0) return `${(Number(item.grams) / 1000).toFixed(3)} kg`;
    if (Number(item.units) > 0) return `${item.units} un`;
    return '—';
};

// Imprime el ticket tal cual salió de la balanza, en una ventana con formato de
// comprobante angosto (58/80mm). Los datos vienen del archivo permanente, así que
// se puede reimprimir aunque la balanza ya se haya vaciado.
const imprimirTicket = (t) => {
    const win = window.open('', '_blank', 'width=380,height=640');
    if (!win) {
        alert('El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes para este sitio y volvé a intentar.');
        return;
    }
    const lineas = (t.items || []).map((it) => `
        <tr>
            <td class="d">${(it.productName || it.pluCode || '—')}</td>
            <td class="q">${cantidadLinea(it)}</td>
            <td class="a">${fmt(it.amount)}</td>
        </tr>`).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${t.printed_ticket_barcode || t.ticket_id || ''}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; margin: 0; padding: 10px 12px; }
        h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
        .meta { text-align: center; font-size: 11px; margin-bottom: 8px; }
        hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
        td.d { width: 55%; }
        td.q { width: 22%; text-align: right; padding-right: 6px; white-space: nowrap; }
        td.a { width: 23%; text-align: right; white-space: nowrap; }
        .total { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-top: 6px; }
        .foot { text-align: center; font-size: 10px; margin-top: 10px; }
    </style></head><body>
        <h1>DETALLE DE VENTA</h1>
        <div class="meta">
            Ticket ${t.printed_ticket_barcode || t.ticket_id || ''}<br/>
            ${fmtDateTime(t.sale_at)} · ${fmtTime(t.sale_at)}<br/>
            Vendedor: ${t.vendor_name || '—'}
        </div>
        <hr/>
        <table><tbody>${lineas || '<tr><td>Sin renglones</td></tr>'}</tbody></table>
        <hr/>
        <div class="total"><span>TOTAL</span><span>${fmt(t.total_amount)}</span></div>
        <div class="foot">${t.item_count} ítem(s) · ${(t.status || '').toUpperCase()}</div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 250);
};

export default function DetalleVentasBalanzaTab() {
    const { activeBranch } = useUser();
    const branchId = Number(activeBranch?.id ?? 0);
    const [dateFrom, setDateFrom] = useState(todayStr);
    const [dateTo, setDateTo] = useState(todayStr);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [detail, setDetail] = useState(null);

    const buscar = useCallback(async () => {
        setLoading(true);
        setError(null);
        setDetail(null);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            const qs = params.toString() ? `?${params.toString()}` : '';
            const data = await apiFetchJson(`/api/scale/detalle-ventas${qs}`);
            setTickets(data.tickets || []);
        } catch (e) {
            setError(e.message || 'Error al cargar el detalle de ventas');
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    // Refetch al montar Y al cambiar de sucursal: garantiza que nunca se muestren
    // tickets de la otra sucursal (el endpoint ya filtra por branch, esto ademas
    // refresca la vista al cambiar el selector Pilar/Fatima sin quedar datos viejos).
    useEffect(() => { buscar(); }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        const q = filterText.trim().toLowerCase();
        if (!q) return tickets;
        return tickets.filter((t) => (
            String(t.printed_ticket_barcode || '').toLowerCase().includes(q)
            || String(t.ticket_id || '').toLowerCase().includes(q)
            || String(t.vendor_name || '').toLowerCase().includes(q)
        ));
    }, [tickets, filterText]);

    const totalDia = useMemo(() => filtered.reduce((acc, t) => acc + Number(t.total_amount || 0), 0), [filtered]);

    return (
        <div className="concil-wrap">
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

            {!loading && !detail && (
                <>
                    <div className="concil-summary">
                        <div className="concil-chip">
                            <span className="concil-chip-label">Tickets</span>
                            <span className="concil-chip-value">{filtered.length}</span>
                        </div>
                        <div className="concil-chip">
                            <span className="concil-chip-label">Total del período</span>
                            <span className="concil-chip-value">{fmt(totalDia)}</span>
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="concil-empty">
                            <ShoppingBag size={40} style={{ opacity: 0.2 }} />
                            <p>No hay ventas registradas en ese período.</p>
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
                                            <th style={{ width: '150px' }}>Fecha / Hora</th>
                                            <th style={{ width: '140px' }}>Ticket</th>
                                            <th>Vendedor</th>
                                            <th style={{ width: '70px', textAlign: 'center' }}>Ítems</th>
                                            <th style={{ width: '120px', textAlign: 'right' }}>Importe</th>
                                            <th style={{ width: '110px', textAlign: 'center' }}>Estado</th>
                                            <th style={{ width: '44px' }}></th>
                                            <th style={{ width: '36px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map(t => (
                                            <tr key={t.id} onClick={() => setDetail(t)} style={{ cursor: 'pointer' }}>
                                                <td className="concil-cell-date">{fmtDateTime(t.sale_at)}</td>
                                                <td className="concil-cell-ticket">{t.printed_ticket_barcode || t.ticket_id}<OriginBadge origin={t.origin} /></td>
                                                <td>{t.vendor_name || '—'}</td>
                                                <td className="concil-cell-center">{t.item_count}</td>
                                                <td className="concil-cell-amount">{fmt(t.total_amount)}</td>
                                                <td className="concil-cell-center"><StatusBadge status={t.status} /></td>
                                                <td onClick={e => e.stopPropagation()}>
                                                    <button className="concil-detail-btn" onClick={() => imprimirTicket(t)} title="Imprimir ticket">
                                                        <Printer size={15} />
                                                    </button>
                                                </td>
                                                <td onClick={e => e.stopPropagation()}>
                                                    <button className="concil-detail-btn" onClick={() => setDetail(t)} title="Ver detalle">
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

            {!loading && detail && (
                <div className="concil-detail">
                    <div className="concil-detail-header">
                        <div>
                            <button className="concil-action-btn" onClick={() => setDetail(null)} style={{ marginBottom: '0.5rem' }}>
                                <ArrowLeft size={15} /> Volver
                            </button>
                            <div className="concil-detail-title">Ticket {detail.printed_ticket_barcode || detail.ticket_id}</div>
                            <div className="concil-detail-meta">
                                {fmtDateTime(detail.sale_at)} · {fmtTime(detail.sale_at)} · {detail.vendor_name || 'Sin vendedor'} · {detail.item_count} ítem{detail.item_count !== 1 ? 's' : ''}
                            </div>
                        </div>
                        <div className="concil-actions">
                            <button className="concil-action-btn primary" onClick={() => imprimirTicket(detail)}>
                                <Printer size={15} /> Imprimir
                            </button>
                        </div>
                    </div>

                    <div className="concil-detail-info">
                        <div className="concil-info-row"><span>Barcode impreso</span><code>{detail.printed_ticket_barcode || '—'}</code></div>
                        <div className="concil-info-row"><span>Barcode interno</span><code>{detail.ticket_barcode}</code></div>
                        <div className="concil-info-row"><span>Registrado</span><span>{fmtDateTime(detail.captured_at)}</span></div>
                        <div className="concil-info-row"><span>Estado</span><StatusBadge status={detail.status} /></div>
                        <div className="concil-info-row total"><span>Total</span><span>{fmt(detail.total_amount)}</span></div>
                    </div>

                    {detail.items?.length > 0 && (
                        <div className="concil-items-table-wrap">
                            <table className="concil-table concil-items-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '50px' }}>Línea</th>
                                        <th style={{ width: '90px' }}>PLU</th>
                                        <th>Descripción</th>
                                        <th>Vendedor</th>
                                        <th style={{ width: '100px' }}>Cantidad</th>
                                        <th style={{ width: '110px', textAlign: 'right' }}>Importe</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.items.map((item, i) => (
                                        <tr key={i}>
                                            <td className="concil-cell-center">{item.lineNo}</td>
                                            <td><code>{item.pluCode}</code></td>
                                            <td>{item.productName || '—'}</td>
                                            <td>{item.vendorName || '—'}</td>
                                            <td>{cantidadLinea(item)}</td>
                                            <td className="concil-cell-amount">{fmt(item.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
