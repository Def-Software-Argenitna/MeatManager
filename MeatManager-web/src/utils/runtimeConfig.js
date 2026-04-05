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
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;

    // In cloud environments the API base is already `/api`.
    // Many callers still pass paths prefixed with `/api/...`, so we dedupe here
    // to avoid generating `/api/api/...` and falling back to empty local sessions.
    if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
        normalizedPath = normalizedPath.slice(4);
    }

    return `${base}${normalizedPath}`;
};

export const isProductionApiRelative = () => getApiBaseUrl() === '/api';
