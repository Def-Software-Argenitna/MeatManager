import { reportClientError } from './apiClient';

let installed = false;

const toErrorPayload = (error, fallbackMessage) => {
    if (error instanceof Error) {
        return {
            message: error.message || fallbackMessage,
            stack: error.stack || null,
        };
    }

    return {
        message: String(error || fallbackMessage),
        stack: null,
    };
};

export const installGlobalErrorReporting = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    window.addEventListener('error', (event) => {
        const payload = toErrorPayload(event.error, event.message || 'Error de frontend');
        reportClientError({
            ...payload,
            path: window.location.href,
            metadata: {
                filename: event.filename || null,
                lineno: event.lineno || null,
                colno: event.colno || null,
            },
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const payload = toErrorPayload(event.reason, 'Promesa rechazada sin manejar');
        reportClientError({
            ...payload,
            path: window.location.href,
            metadata: {
                type: 'unhandledrejection',
            },
        });
    });
};

export const reportReactError = (error, errorInfo) => {
    const payload = toErrorPayload(error, 'Error de React');
    reportClientError({
        ...payload,
        path: window.location.href,
        metadata: {
            componentStack: errorInfo?.componentStack || null,
        },
    });
};

