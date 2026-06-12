import React from 'react';
import './ui.css';

/**
 * Spinner del design system Crystal 3D Glass.
 *
 * Props:
 * - size: diámetro en px (default 42)
 * - label: texto opcional debajo del spinner
 * - fullHeight: centra vertical y horizontalmente en un área alta (para
 *   estados de carga de página/ruta).
 */
const Spinner = ({ size = 42, label = '', fullHeight = false, className = '' }) => {
    const content = (
        <div className={`ui-spinner-wrap ${className}`}>
            <span
                className="ui-spinner"
                style={{ width: `${size}px`, height: `${size}px`, borderWidth: `${Math.max(2, Math.round(size / 14))}px` }}
                aria-hidden="true"
            />
            {label && <span className="ui-spinner-label">{label}</span>}
        </div>
    );

    if (!fullHeight) return content;

    return <div className="ui-spinner-fullheight" role="status" aria-live="polite">{content}</div>;
};

export default Spinner;
