import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './ui.css';

/**
 * Modal unificado. Reusa las clases .modal-overlay / .modal-content
 * de index.css, así que se ve idéntico a los modales existentes,
 * pero centraliza: portal, cierre con Escape, click en el overlay
 * y estructura header/body/footer.
 *
 * Props:
 * - open: controla visibilidad
 * - onClose: callback de cierre (Escape, X, click afuera)
 * - title: texto o nodo del encabezado
 * - size: 'sm' | 'md' | 'lg'
 * - footer: nodo opcional (botones de acción)
 * - closeOnOverlay: default true
 */
const Modal = ({
    open,
    onClose,
    title,
    size = 'md',
    footer = null,
    closeOnOverlay = true,
    children,
}) => {
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div
            className="modal-overlay"
            onClick={closeOnOverlay ? () => onClose?.() : undefined}
        >
            <div
                className={`modal-content neo-card ui-modal ui-modal--${size}`}
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
            >
                {(title || onClose) && (
                    <div className="ui-modal__header">
                        <h2 className="ui-modal__title">{title}</h2>
                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Cerrar"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)', lineHeight: 0, padding: 0 }}
                            >
                                <X size={22} />
                            </button>
                        )}
                    </div>
                )}
                {children}
                {footer && <div className="ui-modal__footer">{footer}</div>}
            </div>
        </div>,
        document.body
    );
};

export default Modal;
