import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import './ui.css';

const ToastContext = createContext(null);

const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

const DEFAULT_DURATION = { success: 3500, info: 4000, warning: 5000, error: 6000 };

let toastSeq = 0;

/**
 * Sistema de notificaciones no invasivas (reemplazo progresivo de alert()).
 *
 * Uso:
 *   const toast = useToast();
 *   toast.success('Venta registrada');
 *   toast.error('No se pudo guardar la categoría');
 */
export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const timersRef = useRef(new Map());

    const dismiss = useCallback((id) => {
        // Marca como saliente para animar, luego remueve
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 220);
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    }, []);

    const show = useCallback((message, { type = 'info', duration } = {}) => {
        const id = ++toastSeq;
        const ms = duration ?? DEFAULT_DURATION[type] ?? 4000;
        setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
        const timer = setTimeout(() => dismiss(id), ms);
        timersRef.current.set(id, timer);
        return id;
    }, [dismiss]);

    const api = useMemo(() => ({
        show,
        dismiss,
        success: (message, opts) => show(message, { ...opts, type: 'success' }),
        error: (message, opts) => show(message, { ...opts, type: 'error' }),
        warning: (message, opts) => show(message, { ...opts, type: 'warning' }),
        info: (message, opts) => show(message, { ...opts, type: 'info' }),
    }), [show, dismiss]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            {createPortal(
                <div className="ui-toast-viewport" role="status" aria-live="polite">
                    {toasts.map((toast) => {
                        const Icon = ICONS[toast.type] || Info;
                        return (
                            <div
                                key={toast.id}
                                className={`ui-toast ui-toast--${toast.type}${toast.leaving ? ' ui-toast--leaving' : ''}`}
                            >
                                <span className="ui-toast__icon"><Icon size={18} /></span>
                                <span className="ui-toast__message">{toast.message}</span>
                                <button
                                    type="button"
                                    className="ui-toast__close"
                                    onClick={() => dismiss(toast.id)}
                                    aria-label="Cerrar notificación"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        );
                    })}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        // Fallback seguro: si una página se renderiza fuera del provider,
        // no rompemos la app; degradamos a console.
        return {
            show: (m) => console.warn('[toast sin provider]', m),
            dismiss: () => {},
            success: (m) => console.log('[toast]', m),
            error: (m) => console.error('[toast]', m),
            warning: (m) => console.warn('[toast]', m),
            info: (m) => console.info('[toast]', m),
        };
    }
    return ctx;
};
