import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Scale, Download, AlertTriangle, BarChart3 } from 'lucide-react';
import { fetchKilosReport, fetchClientBranches } from '../utils/apiClient';
import InformesCortes from './InformesCortes';

const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtKg = (v) => `${(Number(v) || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
const fmtDiaLargo = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const InformesKilos = () => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);

    const [tab, setTab] = useState('kilos'); // 'kilos' | 'cortes'
    const [from, setFrom] = useState(toInput(weekAgo));
    const [to, setTo] = useState(toInput(now));
    const [data, setData] = useState({ pesado: [], cobrado: [] });
    const [branchNames, setBranchNames] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadBranches = useCallback(async () => {
        try {
            const res = await fetchClientBranches();
            const map = {};
            (res?.branches || []).forEach((b) => { map[Number(b.id)] = b.name || `Sucursal ${b.id}`; });
            setBranchNames(map);
        } catch (_) { /* nombres opcionales */ }
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchKilosReport({ from, to });
            setData({ pesado: res?.pesado || [], cobrado: res?.cobrado || [] });
        } catch (e) {
            setError(e.message || 'No se pudo cargar el informe de kilos.');
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { loadBranches(); }, [loadBranches]);
    useEffect(() => { loadData(); }, [loadData]);

    // Estructura: { [dia]: { [branchId]: { pesado, cobrado } } }
    const { dias, branchIds, grid, totals } = useMemo(() => {
        const g = {};
        const branchSet = new Set();
        const add = (rows, key) => {
            (rows || []).forEach((r) => {
                const dia = r.dia;
                const bid = r.branch_id == null ? 0 : Number(r.branch_id);
                branchSet.add(bid);
                g[dia] = g[dia] || {};
                g[dia][bid] = g[dia][bid] || { pesado: 0, cobrado: 0 };
                g[dia][bid][key] += Number(r.kg || 0);
            });
        };
        add(data.pesado, 'pesado');
        add(data.cobrado, 'cobrado');

        const diasOrden = Object.keys(g).sort((a, b) => (a < b ? 1 : -1)); // desc
        const branchOrden = Array.from(branchSet).sort((a, b) => a - b);

        const tot = {};
        branchOrden.forEach((bid) => { tot[bid] = { pesado: 0, cobrado: 0 }; });
        const totGeneral = { pesado: 0, cobrado: 0 };
        diasOrden.forEach((dia) => {
            branchOrden.forEach((bid) => {
                const cell = g[dia][bid] || { pesado: 0, cobrado: 0 };
                tot[bid].pesado += cell.pesado;
                tot[bid].cobrado += cell.cobrado;
                totGeneral.pesado += cell.pesado;
                totGeneral.cobrado += cell.cobrado;
            });
        });

        return { dias: diasOrden, branchIds: branchOrden, grid: g, totals: { porSucursal: tot, general: totGeneral } };
    }, [data]);

    const branchLabel = (bid) => (bid === 0 ? 'Sin sucursal' : (branchNames[bid] || `Sucursal ${bid}`));

    const exportCsv = () => {
        const head = ['Dia'];
        branchIds.forEach((bid) => {
            head.push(`${branchLabel(bid)} - Pesado (kg)`, `${branchLabel(bid)} - Cobrado (kg)`, `${branchLabel(bid)} - Dif (kg)`);
        });
        head.push('Total Pesado (kg)', 'Total Cobrado (kg)', 'Total Dif (kg)');

        const lines = [head.join(';')];
        dias.forEach((dia) => {
            const row = [dia];
            let tp = 0, tc = 0;
            branchIds.forEach((bid) => {
                const c = grid[dia][bid] || { pesado: 0, cobrado: 0 };
                tp += c.pesado; tc += c.cobrado;
                row.push(c.pesado.toFixed(1), c.cobrado.toFixed(1), (c.pesado - c.cobrado).toFixed(1));
            });
            row.push(tp.toFixed(1), tc.toFixed(1), (tp - tc).toFixed(1));
            lines.push(row.join(';'));
        });
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kilos_${from}_a_${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const cellStyle = { padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'right' };
    const headStyle = { ...cellStyle, textAlign: 'right', fontWeight: 700, color: 'var(--color-text-muted)', borderBottom: '2px solid var(--color-border)' };

    return (
        <div className="animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Solapas: Kilos Vendidos · Ranking de Cortes */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                {[
                    { key: 'kilos', label: 'Kilos Vendidos', Icon: Scale },
                    { key: 'cortes', label: 'Ranking de Cortes', Icon: BarChart3 },
                ].map(({ key, label, Icon }) => {
                    const active = tab === key;
                    return (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: '0.6rem 0.9rem', marginBottom: '-1px',
                                fontSize: '0.92rem', fontWeight: 700,
                                color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                            }}
                        >
                            <Icon size={17} /> {label}
                        </button>
                    );
                })}
            </div>

            {tab === 'cortes' && <InformesCortes />}

            {tab === 'kilos' && (<>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Scale size={26} /> Kilos Vendidos
                    </h1>
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--color-text-muted)', maxWidth: 680 }}>
                        Kilos por día y sucursal. <strong>Pesado</strong> = todo lo que pasó por la balanza
                        (salga o no el ticket). <strong>Cobrado</strong> = kilos de ventas registradas.
                        La <strong>diferencia</strong> es lo que se pesó pero no se cobró.
                    </p>
                </div>
            </div>

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
                <button className="neo-button" onClick={exportCsv} disabled={dias.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                    <Download size={16} /> Exportar CSV
                </button>
            </div>

            {error && (
                <div style={{ padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <AlertTriangle size={18} /> {error}
                </div>
            )}

            {/* Totales del período */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {branchIds.map((bid) => {
                    const t = totals.porSucursal[bid] || { pesado: 0, cobrado: 0 };
                    return (
                        <div key={bid} className="neo-card" style={{ padding: '1rem 1.25rem', minWidth: 200, flex: '1 1 200px' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>{branchLabel(bid)}</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.2rem' }}>{fmtKg(t.pesado)}</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                                pesado · cobrado {fmtKg(t.cobrado)}
                            </div>
                            <div style={{ fontSize: '0.82rem', color: (t.pesado - t.cobrado) > 0.05 ? '#f59e0b' : 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                                diferencia {fmtKg(t.pesado - t.cobrado)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Tabla por día */}
            <div className="neo-card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 520 }}>
                    <thead>
                        <tr>
                            <th style={{ ...headStyle, textAlign: 'left' }}>Día</th>
                            {branchIds.map((bid) => (
                                <th key={bid} style={{ ...headStyle, textAlign: 'center' }} colSpan={3}>{branchLabel(bid)}</th>
                            ))}
                            <th style={{ ...headStyle, textAlign: 'center' }} colSpan={3}>Total</th>
                        </tr>
                        <tr>
                            <th style={{ ...headStyle, textAlign: 'left' }}></th>
                            {[...branchIds, 'total'].map((bid) => (
                                <React.Fragment key={`sub-${bid}`}>
                                    <th style={headStyle}>Pesado</th>
                                    <th style={headStyle}>Cobrado</th>
                                    <th style={headStyle}>Dif.</th>
                                </React.Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {dias.map((dia) => {
                            let tp = 0, tc = 0;
                            return (
                                <tr key={dia}>
                                    <td style={{ ...cellStyle, textAlign: 'left', fontWeight: 600 }}>{fmtDiaLargo(dia)}</td>
                                    {branchIds.map((bid) => {
                                        const c = grid[dia][bid] || { pesado: 0, cobrado: 0 };
                                        tp += c.pesado; tc += c.cobrado;
                                        const dif = c.pesado - c.cobrado;
                                        return (
                                            <React.Fragment key={`${dia}-${bid}`}>
                                                <td style={cellStyle}>{c.pesado.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                                <td style={cellStyle}>{c.cobrado.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                                <td style={{ ...cellStyle, color: dif > 0.05 ? '#f59e0b' : 'var(--color-text-muted)' }}>{dif.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                            </React.Fragment>
                                        );
                                    })}
                                    <td style={{ ...cellStyle, fontWeight: 700 }}>{tp.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                    <td style={{ ...cellStyle, fontWeight: 700 }}>{tc.toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                    <td style={{ ...cellStyle, fontWeight: 700, color: (tp - tc) > 0.05 ? '#f59e0b' : 'var(--color-text-muted)' }}>{(tp - tc).toLocaleString('es-AR', { maximumFractionDigits: 1 })}</td>
                                </tr>
                            );
                        })}
                        {!loading && dias.length === 0 && (
                            <tr><td colSpan={2 + branchIds.length * 3 + 3} style={{ ...cellStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>
                                No hay datos de kilos en este período.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>
                ⚠️ Si un día aparece en cero o casi, es porque la balanza no registró ese día (no es un error del informe): ese dato no quedó guardado en ningún lado.
            </p>
            </>)}
        </div>
    );
};

export default InformesKilos;
