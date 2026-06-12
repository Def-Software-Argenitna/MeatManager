import React from 'react';
import './ui.css';

/**
 * Gráfico de barras liviano, sin dependencias externas, alineado al
 * design system Crystal 3D Glass. Pensado para series chicas (ej: ventas
 * de los últimos 7 días, top productos).
 *
 * Props:
 * - data: Array<{ label: string, value: number, highlight?: boolean }>
 * - formatValue: (n) => string  → etiqueta sobre la barra (default: número)
 * - formatTooltip: (item) => string → title nativo al pasar el mouse
 * - height: alto del área de barras en px (default 180)
 * - emptyMessage: texto si no hay datos
 */
const BarChart = ({
    data = [],
    formatValue = (n) => String(n),
    formatTooltip = null,
    height = 180,
    emptyMessage = 'Sin datos para mostrar.',
}) => {
    const points = Array.isArray(data) ? data : [];
    const max = points.reduce((m, p) => Math.max(m, Number(p?.value) || 0), 0);

    if (points.length === 0) {
        return <p className="ui-chart-empty">{emptyMessage}</p>;
    }

    return (
        <div className="ui-barchart" style={{ '--ui-chart-height': `${height}px` }}>
            {points.map((point, index) => {
                const value = Number(point?.value) || 0;
                // Altura relativa al máximo; mínimo visible para valores > 0.
                const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
                const tooltip = formatTooltip
                    ? formatTooltip(point)
                    : `${point?.label}: ${formatValue(value)}`;
                return (
                    <div className="ui-barchart__col" key={`${point?.label}-${index}`} title={tooltip}>
                        <span className="ui-barchart__value">{formatValue(value)}</span>
                        <div className="ui-barchart__track">
                            <div
                                className={`ui-barchart__bar${point?.highlight ? ' ui-barchart__bar--highlight' : ''}`}
                                style={{ height: `${pct}%` }}
                            />
                        </div>
                        <span className="ui-barchart__label">{point?.label}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default BarChart;
