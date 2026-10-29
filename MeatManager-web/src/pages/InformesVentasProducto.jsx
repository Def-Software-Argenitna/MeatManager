import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCcw, Download, Search } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import './InformesCortes.css';

const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ventas por producto en un rango de fechas, de cualquier categoria, con
// buscador. Pensado para productos que se venden a cuenta de terceros (ej. el
// pan de la fiambreria): filtrar "pan" y ver cuanto se cobro para rendirlo.
// Reusa el estilo de los rankings (InformesCortes.css).
export default function InformesVentasProducto() {
    const today = toInput(new Date());
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Espera a que se deje de tipear para no pegarle a la API por cada letra.
    useEffect(() => {
        const t = setTimeout(() => setQuery(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    // Si se tipea rapido pueden volver respuestas fuera de orden: solo se
    // aplica la del ultimo pedido.
    const requestSeq = useRef(0);

    const datesValid = DATE_RE.test(from) && DATE_RE.test(to) && from <= to;

    const fetchData = useCallback(async () => {
        if (!datesValid) return;
        const seq = ++requestSeq.current;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ from, to });
            if (query) params.set('q', query);
            const res = await apiFetch(`/api/informes/ventas-por-producto?${params}`);
            if (!res.ok) throw new Error('Error al obtener datos');
            const json = await res.json();
            if (seq === requestSeq.current) setData(json);
        } catch (err) {
            if (seq !== requestSeq.current) return;
            console.error(err);
            setError('No se pudo cargar el informe de ventas por producto.');
            setData(null);
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [from, to, query, datesValid]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const formatKg = (n) => `${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg`;
    const formatUn = (n) => `${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} un`;
    const formatMoney = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const productos = Array.isArray(data?.productos) ? data.productos : [];
    const totales = data?.totales || { total_kg: 0, total_unidades: 0, total_vendido: 0 };

    const exportCsv = () => {
        const lines = ['Producto;Categoria;Kilos;Unidades;Vendido;Veces'];
        productos.forEach((r) => {
            lines.push([
                `"${String(r.producto || '').replace(/"/g, '""')}"`,
                r.categoria || '',
                r.total_kg.toFixed(3).replace('.', ','),
                r.total_unidades.toFixed(0),
                r.total_vendido.toFixed(2).replace('.', ','),
                r.veces_vendido,
            ].join(';'));
        });
        const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ventas_por_producto_${from}_a_${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="informes-cortes-container">
            <div className="informes-cortes-header">
                <div>
                    <h1>Ventas por Producto</h1>
                    <p>Todo lo vendido por producto en el período, de cualquier categoría. Buscá un producto para ver solo ese.</p>
                </div>
                <button className="ic-refresh-btn" onClick={fetchData} title="Actualizar">
                    <RotateCcw size={16} />
                </button>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 220px' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Producto</label>
                    <div style={{ position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                        <input
                            type="text"
                            className="neo-input"
                            placeholder="Ej: pan"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: '100%', paddingLeft: '2rem' }}
                        />
                    </div>
                </div>
                <button className="neo-button" onClick={exportCsv} disabled={productos.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Download size={16} /> Exportar CSV
                </button>
            </div>

            {!datesValid && <p className="ic-loading">Elegí un rango de fechas válido (desde no puede ser posterior a hasta).</p>}

            {datesValid && loading && !data && <p className="ic-loading">Cargando...</p>}

            {datesValid && error && !loading && <p className="ic-loading">{error}</p>}

            {/* Mientras se busca se deja la tabla anterior (atenuada) en vez de
                vaciar la pantalla con cada letra. */}
            {datesValid && data && !error && (
                <section className="ic-panel" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
                    <div className="ic-panel-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                        <h3>{query ? `Productos que contienen "${query}"` : 'Todos los productos'}</h3>
                        <span className="ic-total-label">
                            Total: <strong>{formatMoney(totales.total_vendido)}</strong>
                            {Number(totales.total_kg) > 0 && <> · <strong>{formatKg(totales.total_kg)}</strong></>}
                            {Number(totales.total_unidades) > 0 && <> · <strong>{formatUn(totales.total_unidades)}</strong></>}
                        </span>
                    </div>

                    <div style={{ overflowX: 'auto', position: 'relative', zIndex: 1 }}>
                    <table className="ic-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Categoría</th>
                                <th>Cantidad</th>
                                <th>Vendido</th>
                                <th>Veces</th>
                            </tr>
                        </thead>
                        <tbody>
                            {productos.map((r, i) => (
                                <tr key={r.producto || i}>
                                    <td>{r.producto || '(sin nombre)'}</td>
                                    <td>{r.categoria || '—'}</td>
                                    <td>
                                        {[
                                            Number(r.total_kg) > 0 ? formatKg(r.total_kg) : null,
                                            Number(r.total_unidades) > 0 ? formatUn(r.total_unidades) : null,
                                        ].filter(Boolean).join(' · ') || '—'}
                                    </td>
                                    <td>{formatMoney(r.total_vendido)}</td>
                                    <td>{r.veces_vendido}</td>
                                </tr>
                            ))}
                            {productos.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="ic-empty">Sin ventas en este período</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    </div>
                </section>
            )}
        </div>
    );
}
