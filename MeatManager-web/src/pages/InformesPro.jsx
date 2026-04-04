import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TrendingUp, Users, Target, Calendar, ArrowRight, ShieldCheck, Crown, Filter, Download } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import './InformesPro.css';

const InformesPro = () => {
    const { isPro } = useLicense();
    const [filterDays, setFilterDays] = useState('30');

    const logs = useLiveQuery(
        () => db.despostada_logs.orderBy('date').reverse().toArray()
    );

    if (!isPro) {
        return (
            <div className="pro-locked-container animate-fade-in">
                <Crown size={64} color="gold" />
                <h2>Módulo de Informes Avanzados</h2>
                <p>El análisis de rendimiento y costos es exclusivo para usuarios **PRO**.</p>
                <button className="neo-button pro-btn" onClick={() => window.location.hash = '#/config/licencia'}>
                    Ver Planes de Activación
                </button>
            </div>
        );
    }

    // Calculations for Supplier Ranking
    const supplierStats = {};
    logs?.forEach(log => {
        if (!log.supplier) return;
        if (!supplierStats[log.supplier]) {
            supplierStats[log.supplier] = { name: log.supplier, totalYield: 0, count: 0, bestYield: 0, worstYield: 100, avgWeight: 0 };
        }
        const stats = supplierStats[log.supplier];
        stats.totalYield += log.yield_percentage;
        stats.count += 1;
        stats.bestYield = Math.max(stats.bestYield, log.yield_percentage);
        stats.worstYield = Math.min(stats.worstYield, log.yield_percentage);
        stats.avgWeight += log.total_weight;
    });

    const ranking = Object.values(supplierStats).map(s => ({
        ...s,
        avgYield: (s.totalYield / s.count).toFixed(1),
        avgWeight: (s.avgWeight / s.count).toFixed(1)
    })).sort((a, b) => b.avgYield - a.avgYield);

    const worstSupplier = ranking.length > 0 ? ranking[ranking.length - 1] : null;
    const avgCowYield = ranking.length > 0 ? (ranking.reduce((acc, r) => acc + parseFloat(r.avgYield), 0) / ranking.length).toFixed(1) : 0;

    return (
        <div className="informes-pro-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title"><Crown size={24} color="gold" style={{ marginRight: '0.5rem' }} /> Informes de Rendimiento PRO</h1>
                    <p className="page-description">Análisis profundo de rendes por proveedor y costos de despostada</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <select className="neo-input" style={{ width: 'auto' }} value={filterDays} onChange={e => setFilterDays(e.target.value)}>
                        <option value="7">Últimos 7 días</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="90">Últimos 90 días</option>
                    </select>
                    <button className="neo-button" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}>
                        <Download size={18} /> Exportar
                    </button>
                </div>
            </header>

            <div className="pro-grid">
                {/* SUPPLIER RANKING CARD */}
                <div className="neo-card ranking-card">
                    <div className="card-header">
                        <Users size={20} color="var(--color-primary)" />
                        <h3>Ranking de Proveedores (Mejor Rinde)</h3>
                    </div>
                    <div className="ranking-table-container">
                        <table className="pro-table">
                            <thead>
                                <tr>
                                    <th>Proveedor</th>
                                    <th>Cant.</th>
                                    <th>Peso Prom.</th>
                                    <th>Rinde Avg.</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranking.map((s) => (
                                    <tr key={s.name}>
                                        <td style={{ fontWeight: 'bold' }}>{s.name}</td>
                                        <td>{s.count}</td>
                                        <td>{s.avgWeight} kg</td>
                                        <td style={{ color: parseFloat(s.avgYield) > 70 ? '#22c55e' : '#ef4444' }}>
                                            {s.avgYield}%
                                        </td>
                                        <td>
                                            <span className={`badge ${parseFloat(s.avgYield) > 72 ? 'success' : (parseFloat(s.avgYield) > 68 ? 'warning' : 'danger')}`}>
                                                {parseFloat(s.avgYield) > 72 ? 'Excelente' : (parseFloat(s.avgYield) > 68 ? 'Aceptable' : 'Pobre')}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {ranking.length === 0 && (
                                    <tr>
                                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>No hay datos de despostada aún.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* YIELD PERFORMANCE TREND */}
                <div className="neo-card trend-card">
                    <div className="card-header">
                        <Target size={20} color="var(--color-primary)" />
                        <h3>Objetivos de Rendimiento</h3>
                    </div>
                    <div className="target-progress-area">
                        <div className="target-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span>Media Res Vaca (Optimum: 74%)</span>
                                <span>Promedio: {avgCowYield}%</span>
                            </div>
                            <div className="progress-bar-bg">
                                <div className="progress-bar-fill" style={{ width: `${Math.min((avgCowYield / 74) * 100, 100)}%` }}></div>
                            </div>
                        </div>
                    </div>
                    {worstSupplier && worstSupplier.avgYield < 70 && (
                        <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '10px', border: '1px solid #ef4444' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#b91c1c', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                <TrendingUp size={18} /> Alerta PRO:
                            </div>
                            <p style={{ fontSize: '0.85rem', color: '#b91c1c', margin: 0 }}>
                                El rinde promedio del proveedor **"{worstSupplier.name}"** ({worstSupplier.avgYield}%) está por debajo del estándar aceptable. Considerá renegociar precios por merma excesiva.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* RECENT DETAILED LOGS */}
            <h2 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.2rem' }}>Últimas Despostadas Detalladas</h2>
            <div className="logs-grid">
                {logs?.slice(0, 10).map(log => (
                    <div key={log.id} className="neo-card log-report-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <span className="log-type-tag">{log.type.toUpperCase()}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{new Date(log.date).toLocaleDateString()}</span>
                        </div>
                        <h4 style={{ marginBottom: '0.5rem' }}>{log.supplier || 'Proveedor Desconocido'}</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="log-stat">
                                <span>Peso Inicial</span>
                                <strong>{log.total_weight} kg</strong>
                            </div>
                            <div className="log-stat">
                                <span>Rendimiento</span>
                                <strong style={{ color: log.yield_percentage > 70 ? '#22c55e' : '#ef4444' }}>{log.yield_percentage}%</strong>
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Análisis de Costo Real</span>
                            <ArrowRight size={16} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default InformesPro;
