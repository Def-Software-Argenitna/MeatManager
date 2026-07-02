import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, AlertTriangle, Percent, TrendingDown, Users, Receipt, Scale } from 'lucide-react';
import { fetchDescuentosReport } from '../utils/apiClient';

const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (v) => `$${(Number(v) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDiaLargo = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};
const pctOf = (descuento, bruto) => (bruto > 0 ? (descuento / bruto) * 100 : 0);

const InformesDescuentos = () => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);

    const [from, setFrom] = useState(toInput(weekAgo));
    const [to, setTo] = useState(toInput(now));
    const [data, setData] = useState({ porDia: [], porEmpleado: [], total: { tickets: 0, bruto: 0, descuento: 0, neto: 0 } });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchDescuentosReport({ from, to });
            setData({
                porDia: res?.porDia || [],
                porEmpleado: res?.porEmpleado || [],
                total: res?.total || { tickets: 0, bruto: 0, descuento: 0, neto: 0 },
            });
        } catch (e) {
            setError(e.message || 'No se pudo cargar el informe de descuentos.');
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { loadData(); }, [loadData]);

    const dias = useMemo(
        () => [...(data.porDia || [])].sort((a, b) => (a.dia < b.dia ? 1 : -1)),
        [data.porDia]
    );
    const empleados = useMemo(
        () => [...(data.porEmpleado || [])].sort((a, b) => b.descuento - a.descuento),
        [data.porEmpleado]
    );
    const { bruto, descuento, neto, tickets } = data.total;

    const exportCsv = () => {
        const lines = [];
        lines.push(['Detalle por día'].join(';'));
        lines.push(['Día', 'Tickets', 'Bruto (balanza)', 'Descuento', 'Neto (caja)'].join(';'));
        dias.forEach((r) => {
            lines.push([r.dia, r.tickets, r.bruto.toFixed(2), r.descuento.toFixed(2), r.neto.toFixed(2)].join(';'));
        });
        lines.push(['TOTAL', tickets, bruto.toFixed(2), descuento.toFixed(2), neto.toFixed(2)].join(';'));
        lines.push('');
        lines.push(['Detalle por empleado'].join(';'));
        lines.push(['Empleado', 'Tickets', 'Bruto (balanza)', 'Descuento', '% prom.', 'Neto (caja)'].join(';'));
        empleados.forEach((r) => {
            lines.push([r.empleado, r.tickets, r.bruto.toFixed(2), r.descuento.toFixed(2), pctOf(r.descuento, r.bruto).toFixed(1), r.neto.toFixed(2)].join(';'));
        });
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `descuentos_${from}_a_${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const cellStyle = { padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'right' };
    const headStyle = { ...cellStyle, fontWeight: 700, color: 'var(--color-text-muted)', borderBottom: '2px solid var(--color-border)' };
    const noData = !loading && dias.length === 0;

    const summaryCards = [
        { key: 'bruto', label: 'Bruto (como en la balanza)', value: fmt(bruto), Icon: Scale, color: 'var(--color-text-main)', hint: 'Suma de tickets sin descuento' },
        { key: 'descuento', label: 'Descuentos otorgados', value: fmt(descuento), Icon: TrendingDown, color: '#f59e0b', hint: 'La diferencia contra la balanza' },
        { key: 'neto', label: 'Neto cobrado (a caja)', value: fmt(neto), Icon: Receipt, color: '#22c55e', hint: 'Lo que realmente entró' },
        { key: 'tickets', label: 'Tickets con descuento', value: tickets.toLocaleString('es-AR'), Icon: Percent, color: 'var(--color-primary)', hint: 'Cantidad en el período' },
    ];

    return (
        <div className="animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Percent size={26} /> Informes de Descuentos
                    </h1>
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--color-text-muted)', maxWidth: 720 }}>
                        Descuentos de empleado aplicados en ventas. <strong>Bruto</strong> = lo que marcó la balanza
                        (sin descuento). <strong>Descuento</strong> = lo que se bonificó. <strong>Neto</strong> = lo
                        que realmente entró a la caja. La diferencia contra la balanza <strong>es</strong> el descuento.
                    </p>
                </div>
            </div>

            {/* Filtros */}
            <div className="neo-card" style={{ padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Desde</label>
                    <input type="date" className="neo-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Hasta</label>
                    <input type="date" className="neo-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                </div>
                <button className="neo-button" onClick={loadData} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} /> Actualizar
                </button>
                <button className="neo-button" onClick={exportCsv} disabled={noData} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                    <Download size={16} /> Exportar CSV
                </button>
            </div>

            {error && (
                <div style={{ padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <AlertTriangle size={18} /> {error}
                </div>
            )}

            {/* Tarjetas resumen */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {summaryCards.map(({ key, label, value, Icon, color, hint }) => (
                    <div key={key} className="neo-card" style={{ padding: '1rem 1.25rem', minWidth: 210, flex: '1 1 210px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>
                            <Icon size={16} style={{ color }} /> {label}
                        </div>
                        <div style={{ fontSize: '1.55rem', fontWeight: 800, marginTop: '0.35rem', color }}>{value}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>{hint}</div>
                    </div>
                ))}
            </div>

            {/* Identidad de conciliación: bruto = neto + descuento */}
            <div className="neo-card" style={{ padding: '0.9rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', borderLeft: '4px solid var(--color-primary)' }}>
                <Scale size={20} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                    Para cuadrar contra la balanza:&nbsp;
                    <strong style={{ color: 'var(--color-text-main)' }}>{fmt(bruto)}</strong>
                    <span style={{ color: 'var(--color-text-muted)' }}> (balanza) = </span>
                    <strong style={{ color: '#22c55e' }}>{fmt(neto)}</strong>
                    <span style={{ color: 'var(--color-text-muted)' }}> (caja) + </span>
                    <strong style={{ color: '#f59e0b' }}>{fmt(descuento)}</strong>
                    <span style={{ color: 'var(--color-text-muted)' }}> (descuentos)</span>
                </span>
            </div>

            {/* Tabla por día */}
            <div className="neo-card" style={{ padding: 0, overflowX: 'auto' }}>
                <div style={{ padding: '0.9rem 1.1rem', fontWeight: 700, borderBottom: '1px solid var(--color-border)' }}>Por día</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 560 }}>
                    <thead>
                        <tr>
                            <th style={{ ...headStyle, textAlign: 'left' }}>Día</th>
                            <th style={headStyle}>Tickets</th>
                            <th style={headStyle}>Bruto (balanza)</th>
                            <th style={headStyle}>Descuento</th>
                            <th style={headStyle}>Neto (caja)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dias.map((r) => (
                            <tr key={r.dia}>
                                <td style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>{fmtDiaLargo(r.dia)}</td>
                                <td style={cellStyle}>{r.tickets.toLocaleString('es-AR')}</td>
                                <td style={cellStyle}>{fmt(r.bruto)}</td>
                                <td style={{ ...cellStyle, color: '#f59e0b', fontWeight: 600 }}>{fmt(r.descuento)}</td>
                                <td style={{ ...cellStyle, color: '#22c55e', fontWeight: 600 }}>{fmt(r.neto)}</td>
                            </tr>
                        ))}
                        {!noData && dias.length > 0 && (
                            <tr>
                                <td style={{ ...cellStyle, textAlign: 'left', fontWeight: 800 }}>TOTAL</td>
                                <td style={{ ...cellStyle, fontWeight: 800 }}>{tickets.toLocaleString('es-AR')}</td>
                                <td style={{ ...cellStyle, fontWeight: 800 }}>{fmt(bruto)}</td>
                                <td style={{ ...cellStyle, fontWeight: 800, color: '#f59e0b' }}>{fmt(descuento)}</td>
                                <td style={{ ...cellStyle, fontWeight: 800, color: '#22c55e' }}>{fmt(neto)}</td>
                            </tr>
                        )}
                        {noData && (
                            <tr><td colSpan={5} style={{ ...cellStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>
                                No hay descuentos registrados en este período.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Tabla por empleado */}
            <div className="neo-card" style={{ padding: 0, overflowX: 'auto' }}>
                <div style={{ padding: '0.9rem 1.1rem', fontWeight: 700, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Users size={17} /> Por empleado
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 620 }}>
                    <thead>
                        <tr>
                            <th style={{ ...headStyle, textAlign: 'left' }}>Empleado</th>
                            <th style={headStyle}>Tickets</th>
                            <th style={headStyle}>Bruto (balanza)</th>
                            <th style={headStyle}>Descuento</th>
                            <th style={headStyle}>% prom.</th>
                            <th style={headStyle}>Neto (caja)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {empleados.map((r) => (
                            <tr key={r.empleado_id ?? r.empleado}>
                                <td style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>{r.empleado}</td>
                                <td style={cellStyle}>{r.tickets.toLocaleString('es-AR')}</td>
                                <td style={cellStyle}>{fmt(r.bruto)}</td>
                                <td style={{ ...cellStyle, color: '#f59e0b', fontWeight: 600 }}>{fmt(r.descuento)}</td>
                                <td style={cellStyle}>{pctOf(r.descuento, r.bruto).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%</td>
                                <td style={{ ...cellStyle, color: '#22c55e', fontWeight: 600 }}>{fmt(r.neto)}</td>
                            </tr>
                        ))}
                        {noData && (
                            <tr><td colSpan={6} style={{ ...cellStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>
                                Sin datos de empleados en este período.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>
                💡 Los descuentos solo se registran cuando la venta se cobra desde el punto de venta. Si un ticket con
                descuento se cobra desde <strong>Conciliación de balanza</strong>, se registra por el monto pleno (sin descuento).
            </p>
        </div>
    );
};

export default InformesDescuentos;
