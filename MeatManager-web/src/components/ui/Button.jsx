import React, { forwardRef } from 'react';
import './ui.css';

/**
 * Botón unificado del design system Crystal 3D Glass.
 *
 * Reemplaza progresivamente a las variantes históricas
 * (neo-button, btn-primary, btn-secondary, btn-icon, etc.).
 *
 * Props:
 * - variant: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
 * - size: 'sm' | 'md' | 'lg'
 * - loading: muestra spinner y deshabilita el botón
 * - fullWidth: ocupa el 100% del contenedor
 * - icon: nodo a renderizar antes del texto (ej: <Save size={16} />)
 *   Si no hay children, el botón se vuelve cuadrado (acción de ícono).
 */
const Button = forwardRef(function Button(
    {
        variant = 'secondary',
        size = 'md',
        loading = false,
        fullWidth = false,
        icon = null,
        className = '',
        disabled = false,
        type = 'button',
        children,
        ...props
    },
    ref
) {
    const classes = [
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        fullWidth ? 'ui-btn--full' : '',
        icon && !children ? 'ui-btn--icononly' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <button
            ref={ref}
            type={type}
            className={classes}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? <span className="ui-btn__spinner" aria-hidden="true" /> : icon}
            {children}
        </button>
    );
});

export default Button;
