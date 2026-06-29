import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import BarChart from '../components/ui/BarChart';
import './InformesCortes.css';

const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const SPECIES_COLORS = {
    vaca: { bg: '#dc2626', light: '#fef2f2' },
    cerdo: { bg: '#eab308', light: '#fefce8' },
    pollo: { bg: '#f97316', light: '#fff7ed' },
};

const SPECIES_LABELS = { vaca: 'Vaca', cerdo: 'Cerdo', pollo: 'Pollo' };

export default function InformesCortes() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [useMonthFilter, setUseMonthFilter] = useState(true);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ year: String(year) });
            if (useMonthFilter) params.set('month', String(month));
            const res = await apiFetch(`/api/informes/cortes-ranking?${params}`);
            if (!res.ok) throw new Error('Error al obtener datos');
            setData(await res.json());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [year, month, useMonthFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const formatKg = (n) => `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg`;
    const formatMoney = (n) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const prevPeriod = () => {
        if (useMonthFilter) {
            if (month === 1) { setMonth(12); setYear(y => y - 1); }
            else setMonth(m => m - 1);
        } else {
            setYear(y => y - 1);
        }
    };

    const nextPeriod = () => {
        if (useMonthFilter) {
            if (month === 12) { setMonth(1); setYear(y => y + 1); }
            else setMonth(m => m + 1);
        } else {
            setYear(y => y + 1);
        }
    };

    const periodLabel = useMonthFilter
        ? `${months[month - 1]} ${year}`
        : `Año ${year}`;

    return (
        <div className="informes-cortes-container">
            <div className="informes-cortes-header">
                <div>
                    <h1>Ranking de Cortes</h1>
                    <p>Ventas de carnes — Top 10 por especie</p>
                </div>
                <button className="ic-refresh-btn" onClick={fetchData} title="Actualizar">
                    <RotateCcw size={16} />
                </button>
            </div>

            <div className="informes-cortes-filters">
                <button className="ic-nav-btn" onClick={prevPeriod}>
                    <ChevronLeft size={18} />
                </button>
                <div className="ic-period-selector">
                    <span className="ic-period-label">{periodLabel}</span>
                    <div className="ic-period-toggle">
                        <label>
                            <input
                                type="checkbox"
                                checked={useMonthFilter}
                                onChange={(e) => setUseMonthFilter(e.target.checked)}
                            />
                            Filtrar por mes
                        </label>
                    </div>
                </div>
                <button className="ic-nav-btn" onClick={nextPeriod}>
                    <ChevronRight size={18} />
                </button>
            </div>

            {loading && <p className="ic-loading">Cargando...</p>}

            {data && !loading && (
                <>
                    {/* Ranking general de especies */}
                    <section className="ic-section">
                        <h2>Ranking General por Especie</h2>
                        <div className="ic-especies-grid">
                            {data.rankingEspecies.map((esp) => {
                                const color = SPECIES_COLORS[esp.code] || { bg: '#6b7280', light: '#f9fafb' };
                                return (
                                    <div key={esp.code} className="ic-especie-card" style={{ borderLeftColor: color.bg }}>
                                        <span className="ic-especie-name">{esp.nombre}</span>
                                        <span className="ic-especie-kg">{formatKg(esp.total_kg)}</span>
                                        <span className="ic-especie-pct">
                                            {data.totalGeneral > 0
                                                ? `${((esp.total_kg / data.totalGeneral) * 100).toFixed(1)}%`
                                                : '0%'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Top 10 por especie */}
                    {['vaca', 'cerdo', 'pollo'].map((especie) => {
                        const cortes = data.rankingCortes[especie] || [];
                        const color = SPECIES_COLORS[especie] || { bg: '#6b7280', light: '#f9fafb' };
                        const chartData = cortes.map((c, i) => ({
                            label: c.corte.length > 15 ? c.corte.slice(0, 15) + '...' : c.corte,
                            value: c.total_kg,
                            fullLabel: c.corte,
                        }));

                        return (
                            <section key={especie} className="ic-section">
                                <h2 style={{ color: color.bg }}>
                                    Top 10 — {SPECIES_LABELS[especie]}
                                </h2>

                                <div className="ic-chart-wrapper" style={{ background: color.light }}>
                                    <BarChart
                                        data={chartData}
                                        formatValue={(n) => formatKg(n)}
                                        formatTooltip={(p) => `${p.fullLabel || p.label}: ${formatKg(p.value)}`}
                                        height={220}
                                    />
                                </div>

                                <table className="ic-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Corte</th>
                                            <th>Kilos</th>
                                            <th>Vendido</th>
                                            <th>Veces</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cortes.map((c, i) => (
                                            <tr key={c.corte}>
                                                <td>{i + 1}</td>
                                                <td>{c.corte}</td>
                                                <td>{formatKg(c.total_kg)}</td>
                                                <td>{formatMoney(c.total_vendido)}</td>
                                                <td>{c.veces_vendido}</td>
                                            </tr>
                                        ))}
                                        {cortes.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="ic-empty">Sin ventas en este período</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </section>
                        );
                    })}
                </>
            )}
        </div>
    );
}