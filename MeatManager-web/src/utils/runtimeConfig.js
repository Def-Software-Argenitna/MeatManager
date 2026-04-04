const trimSlash = (value) => String(value || '').replace(/\/$/, '');

const isBrowser = typeof window !== 'undefined';
const hostname = isBrowser ? window.location.hostname : '';
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

export const getApiBaseUrl = () => {
    const explicit = trimSlash(import.meta.env.VITE_API_URL);
    if (explicit) return explicit;

    if (isBrowser && !isLocalHost) {
        return '/api';
    }

    return 'http://127.0.0.1:3001';
};

export const buildApiUrl = (path = '') => {
    const base = getApiBaseUrl();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
};

export const isProductionApiRelative = () => getApiBaseUrl() === '/api';
