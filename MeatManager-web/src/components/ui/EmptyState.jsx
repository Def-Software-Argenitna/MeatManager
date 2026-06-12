import React from 'react';
import './ui.css';

/**
 * Estado vacío del design system Crystal 3D Glass: ícono + título + texto.
 * Reemplaza a los mensajes sueltos tipo "No hay datos..." para que las
 * pantallas sin contenido se vean cuidadas y consistentes.
 *
 * Props:
 * - icon: componente de ícono (ej: lucide ShoppingCart). Opcional.
 * - title: título principal (string o nodo).
 * - description: texto secundario opcional.
 * - action: nodo opcional (ej: un <Button>) para una acción sugerida.
 * - compact: versión con menos padding (para paneles chicos).
 */
const EmptyState = ({ icon: Icon, title, description, action = null, compact = false, className = '' }) => (
    <div className={`ui-empty${compact ? ' ui-empty--compact' : ''} ${className}`}>
        {Icon && (
            <div className="ui-empty__icon" aria-hidden="true">
                <Icon size={compact ? 28 : 40} strokeWidth={1.6} />
            </div>
        )}
        {title && <p className="ui-empty__title">{title}</p>}
        {description && <p className="ui-empty__desc">{description}</p>}
        {action && <div className="ui-empty__action">{action}</div>}
    </div>
);

export default EmptyState;
