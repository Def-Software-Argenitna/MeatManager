import React, { useEffect, useState } from 'react';
import './ui.css';

const BarChart = ({
    data = [],
    formatValue = (n) => String(n),
    formatTooltip = null,
    height = 180,
    emptyMessage = 'Sin datos para mostrar.',
}) => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setReady(true));
        return () => cancelAnimationFrame(id);
    }, []);

    const points = Array.isArray(data) ? data : [];
    const max = points.reduce((m, p) => Math.max(m, Number(p?.value) || 0), 0);

    if (points.length === 0) {
        return <p className="ui-chart-empty">{emptyMessage}</p>;
    }

    return (
        <div className="ui-barchart" style={{ '--ui-chart-height': `${height}px` }}>
            <div className="ui-barchart__grid">
                {[75, 50, 25].map(pct => (
                    <div key={pct} className="ui-barchart__gridline" style={{ bottom: `${pct}%` }} />
                ))}
            </div>
            <div className="ui-barchart__cols">
                {points.map((point, index) => {
                    const value = Number(point?.value) || 0;
                    const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 5 : 0) : 0;
                    const tooltip = formatTooltip
                        ? formatTooltip(point)
                        : `${point?.label}: ${formatValue(value)}`;
                    return (
                        <div
                            className="ui-barchart__col"
                            key={`${point?.label}-${index}`}
                            title={tooltip}
                        >
                            <span className={`ui-barchart__value${value === 0 ? ' ui-barchart__value--zero' : ''}`}>
                                {value === 0 ? '—' : formatValue(value)}
                            </span>
                            <div className="ui-barchart__track">
                                <div
                                    className={`ui-barchart__bar${point?.highlight ? ' ui-barchart__bar--highlight' : ''}`}
                                    style={{
                                        height: ready ? `${pct}%` : '0',
                                        transitionDelay: ready ? `${index * 0.06}s` : '0s',
                                    }}
                                />
                            </div>
                            <span className={`ui-barchart__label${point?.highlight ? ' ui-barchart__label--today' : ''}`}>
                                {point?.label}
                            </span>
                            {point?.highlight && <span className="ui-barchart__today-dot" aria-label="Hoy" />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default BarChart;
