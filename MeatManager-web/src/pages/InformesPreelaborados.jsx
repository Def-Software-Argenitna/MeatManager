import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import BarChart from '../components/ui/BarChart';
import './InformesCortes.css';

const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Ranking de pre-elaborados (milanesas, hamburguesas, chorizos, etc.).
// Complementa "Ranking de Cortes", que solo cuenta vaca/cerdo/pollo y deja
// los pre-elaborados afuera. Reusa el mismo estilo (InformesCortes.css).
export default function InformesPreelaborados() {
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [day, setDay] = useState(now.getDate());
    const [useMonthFilter, setUseMonthFilter] = useState(true);
    const [useDayFilter, setUseDayFilter] = useState(false);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ year: String(year) });
            if (useMonthFilter) params.set('month', String(month));
            if (useMonthFilter && useDayFilter) params.set('day', String(day));
            const res = await apiFetch(`/api/informes/preelaborados-ranking?${params}`);
            if (!res.ok) throw new Error('Error al obtener datos');
            setData(await res.json());
        } catch (err) {
            console.error(err);
            setError('No se pudo cargar el informe de pre-elaborados.');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [year, month, day, useMonthFilter, useDayFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const formatKg = (n) => `${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg`;
    const formatUn = (n) => `${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} un`;
    const formatMoney = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;

    const prevPeriod = () => {
        if (useMonthFilter && useDayFilter) {
            const prev = new Date(year, month - 1, day - 1);
            setYear(prev.getFullYear());
            setMonth(prev.getMonth() + 1);
            setDay(prev.getDate());
        } else if (useMonthFilter) {
            if (month === 1) { setMonth(12); setYear(y => y - 1); }
            else setMonth(m => m - 1);
        } else {
            setYear(y => y - 1);
        }
    };

    const nextPeriod = () => {
        if (useMonthFilter && useDayFilter) {
            const next = new Date(year, month - 1, day + 1);
            setYear(next.getFullYear());
            setMonth(next.getMonth() + 1);
            setDay(next.getDate());
        } else if (useMonthFilter) {
            if (month === 12) { setMonth(1); setYear(y => y + 1); }
            else setMonth(m => m + 1);
        } else {
            setYear(y => y + 1);
        }
    };

    const periodLabel = useMonthFilter && useDayFilter
        ? `${day} de ${months[month - 1]} ${year}`
        : useMonthFilter
        ? `${months[month - 1]} ${year}`
        : `Año ${year}`;

    const ranking = Array.isArray(data?.ranking) ? data.ranking : [];
    const totales = data?.totales || { total_kg: 0, total_unidades: 0, total_vendido: 0 };
    const hayUnidades = ranking.some((r) => Number(r.total_unidades) > 0);

    // Grafico: top 10 por kilos (los que se venden por peso).
    const chartData = ranking
        .filter((r) => Number(r.total_kg) > 0)
        .slice(0, 10)
        .map((r) => ({
            label: r.producto && r.producto.length > 14 ? r.producto.slice(0, 14) + '...' : r.producto,
            value: Number(r.total_kg) || 0,
            fullLabel: r.producto,
        }));

    return (
        <div className="informes-cortes-container">
            <div className="informes-cortes-header">
                <div>
                    <h1>Ranking de Pre-elaborados</h1>
                    <p>Milanesas, hamburguesas, chorizos y demás elaborados — kilos vendidos por producto</p>
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
                    <div className="ic-period-toggles">
                        <label>
                            <input
                                type="checkbox"
                                checked={useMonthFilter}
                                onChange={(e) => {
                                    setUseMonthFilter(e.target.checked);
                                    if (!e.target.checked) setUseDayFilter(false);
                                }}
                            />
                            Mes
                        </label>
                        {useMonthFilter && (
                            <label>
                                <input
                                    type="checkbox"
                                    checked={useDayFilter}
                                    onChange={(e) => setUseDayFilter(e.target.checked)}
                                />
                                Día
                            </label>
                        )}
                        {useMonthFilter && useDayFilter && (
                            <select
                                className="ic-day-select"
                                value={day}
                                onChange={(e) => setDay(Number(e.target.value))}
                            >
                                {Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
                <button className="ic-nav-btn" onClick={nextPeriod}>
                    <ChevronRight size={18} />
                </button>
            </div>

            {loading && <p className="ic-loading">Cargando...</p>}

            {error && !loading && <p className="ic-loading">{error}</p>}

            {data && !loading && !error && (
                <section className="ic-panel">
                    <div className="ic-panel-header">
                        <h3>
                            <span className="ic-especie-icon">🍖</span>
                            Pre-elaborados
                        </h3>
                        <span className="ic-total-label">
                            Total: <strong>{formatKg(totales.total_kg)}</strong>
                            {Number(totales.total_unidades) > 0 && <> · <strong>{formatUn(totales.total_unidades)}</strong></>}
                        </span>
                    </div>

                    {chartData.length > 0 && (
                        <div className="ic-especies-chart">
                            <BarChart
                                data={chartData}
                                formatValue={(n) => formatKg(n)}
                                formatTooltip={(p) => `${p.fullLabel || p.label}: ${formatKg(p.value)}`}
                                height={200}
                            />
                        </div>
                    )}

                    <table className="ic-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Producto</th>
                                <th>Kilos</th>
                                {hayUnidades && <th>Unidades</th>}
                                <th>Vendido</th>
                                <th>Veces</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ranking.map((r, i) => (
                                <tr key={r.producto || i}>
                                    <td className="ic-rank">{i + 1}</td>
                                    <td>{r.producto}</td>
                                    <td>{Number(r.total_kg) > 0 ? formatKg(r.total_kg) : '—'}</td>
                                    {hayUnidades && <td>{Number(r.total_unidades) > 0 ? formatUn(r.total_unidades) : '—'}</td>}
                                    <td>{formatMoney(r.total_vendido)}</td>
                                    <td>{r.veces_vendido}</td>
                                </tr>
                            ))}
                            {ranking.length === 0 && (
                                <tr>
                                    <td colSpan={hayUnidades ? 6 : 5} className="ic-empty">Sin ventas de pre-elaborados en este período</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}
