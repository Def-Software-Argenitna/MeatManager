import { auth } from '../firebase';
import { buildApiUrl } from './runtimeConfig';

export const SUPPORT_SESSION_EXPIRED_EVENT = 'mm:support-session-expired';

export const hasTenantSession = () => !!sessionStorage.getItem('mm_tenant');
export const getStoredAuthToken = () => sessionStorage.getItem('mm_auth_token');
const getStoredTenantSession = () => {
    try {
        const raw = sessionStorage.getItem('mm_tenant');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};
const isSupportSession = (tenant) => tenant?.authMode === 'support';
const appendSupportClientIdToPath = (path, clientId) => {
    if (!clientId) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}clientId=${encodeURIComponent(String(clientId))}`;
};
const injectSupportClientIdIntoBody = (body, clientId) => {
    if (!clientId || body == null || typeof body !== 'string') {
        return body;
    }

    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.clientId) {
            return body;
        }
        return JSON.stringify({ ...parsed, clientId });
    } catch {
        return body;
    }
};
const setStoredAuthToken = (token) => {
    if (token) {
        _supportSessionExpiredNotified = false;
        sessionStorage.setItem('mm_auth_token', token);
        return;
    }
    sessionStorage.removeItem('mm_auth_token');
};

export const getAuthToken = async () => {
    if (!hasTenantSession()) return null;
    const tenant = getStoredTenantSession();
    if (isSupportSession(tenant)) {
        return getStoredAuthToken();
    }
    const user = auth.currentUser;
    if (user) {
        const token = await user.getIdToken();
        setStoredAuthToken(token);
        return token;
    }
    return getStoredAuthToken();
};

// ── Token in-flight cache ────────────────────────────────────────────────────
// Evita llamar getIdToken() N veces en paralelo (una por cada fetchTable).
// Si ya hay una Promise de token en curso se reutiliza la misma.
let _tokenPromise = null;
let _tokenExpiry = 0; // epoch ms estimado de expiración (55 min margen)
let _supportSessionExpiredNotified = false;

export const clearTokenCache = () => {
    _tokenPromise = null;
    _tokenExpiry = 0;
};

const clearLocalSessionState = () => {
    clearTokenCache();
    sessionStorage.removeItem('mm_tenant');
    sessionStorage.removeItem('mm_auth_token');
    sessionStorage.removeItem('mm_user');
    sessionStorage.removeItem('mm_perms');
    sessionStorage.removeItem('mm_access_profile');
};

const notifySupportSessionExpired = () => {
    if (_supportSessionExpiredNotified) return;
    _supportSessionExpiredNotified = true;
    clearLocalSessionState();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SUPPORT_SESSION_EXPIRED_EVENT, {
            detail: { reason: '401_unauthorized' },
        }));
    }
};

const getCachedToken = (forceRefresh = false) => {
    if (!hasTenantSession()) return Promise.resolve(null);
    const tenant = getStoredTenantSession();
    if (isSupportSession(tenant)) {
        return Promise.resolve(getStoredAuthToken());
    }
    const user = auth.currentUser;
    if (!user) return Promise.resolve(getStoredAuthToken());

    const now = Date.now();
    if (!forceRefresh && _tokenPromise && now < _tokenExpiry) {
        return _tokenPromise;
    }

    _tokenExpiry = now + 55 * 60 * 1000; // 55 min
    _tokenPromise = user.getIdToken(forceRefresh).then((token) => {
        setStoredAuthToken(token);
        return token;
    }).catch(() => {
        _tokenPromise = null;
        _tokenExpiry = 0;
        return getStoredAuthToken();
    });

    return _tokenPromise;
};

export const apiFetch = async (path, options = {}) => {
    const tenant = getStoredTenantSession();
    const scopedPath = isSupportSession(tenant) && tenant?.clientId
        ? appendSupportClientIdToPath(path, tenant.clientId)
        : path;
    const scopedBody = isSupportSession(tenant) && tenant?.clientId
        ? injectSupportClientIdIntoBody(options.body, tenant.clientId)
        : options.body;

    const buildHeaders = async (forcedRefresh = false) => {
        const token = await getCachedToken(forcedRefresh);
        if (forcedRefresh) { _tokenPromise = null; _tokenExpiry = 0; } // invalidar cache en retry

        const headers = {
            ...(scopedBody ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (isSupportSession(tenant) && tenant?.clientId) {
            headers['X-MM-Target-Client-Id'] = String(tenant.clientId);
        }

        return headers;
    };

    let response = await fetch(buildApiUrl(scopedPath), {
        ...options,
        body: scopedBody,
        headers: await buildHeaders(false),
    });

    if (response.status === 401 && auth.currentUser) {
        response = await fetch(buildApiUrl(scopedPath), {
            ...options,
            body: scopedBody,
            headers: await buildHeaders(true),
        });
    }

    if (response.status === 401 && isSupportSession(tenant)) {
        notifySupportSessionExpired();
    }

    return response;
};

export const getRemoteSetting = async (key) => {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(key)}`);

    if (!res.ok) return null;
    const data = await res.json();
    return data?.value ?? null;
};

export const upsertRemoteSetting = async (key, value) => {
    const res = await apiFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({
            table: 'settings',
            operation: 'upsert',
            record: { key, value },
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `No se pudo guardar setting ${key}`);
    }

    return res.json();
};

export const fetchTable = async (table, options = {}) => {
    const query = new URLSearchParams();
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset) query.set('offset', String(options.offset));
    if (options.orderBy) query.set('orderBy', options.orderBy);
    if (options.direction) query.set('direction', options.direction);
    if (options.includeInactive) query.set('include_inactive', '1');

    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await apiFetch(`/api/table/${table}${suffix}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `No se pudo leer ${table}`);
    }
    const data = await res.json();
    return data?.rows || [];
};

export const saveTableRecord = async (table, operation, record, id) => {
    const res = await apiFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ table, operation, record, id }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `No se pudo guardar ${table}`);
    }

    return res.json();
};

export const fetchUsersBundle = async () => {
    const res = await apiFetch('/api/users');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer los usuarios');
    }
    return res.json();
};

export const fetchWhatsAppMarketingStatus = async () => {
    const res = await apiFetch('/api/whatsapp/status');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo leer la configuración de WhatsApp');
    }
    return res.json();
};

export const saveWhatsAppMarketingConfig = async (payload) => {
    const res = await apiFetch('/api/whatsapp/config', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo guardar la configuración de WhatsApp');
    }
    return res.json();
};

export const replaceUserPermissions = async (userId, paths) => {
    const res = await apiFetch(`/api/users/${userId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ paths }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron guardar los permisos');
    }

    return res.json();
};

export const fetchFirebaseUsers = async () => {
    const res = await apiFetch('/api/firebase-users');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer los usuarios web');
    }
    return res.json();
};

export const fetchCurrentFirebaseUser = async () => {
    const res = await apiFetch('/api/firebase-users/me');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo leer el usuario actual');
    }
    return res.json();
};

export const loginInternalAdmin = async (identifier, password) => {
    const res = await fetch(buildApiUrl('/api/internal-admin/login'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo iniciar sesión como SuperAdmin');
    }

    return res.json();
};

export const fetchInternalAdminClients = async (token, search = '') => {
    const query = new URLSearchParams();
    if (String(search || '').trim()) {
        query.set('search', String(search).trim());
    }

    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(buildApiUrl(`/api/internal-admin/clients${suffix}`), {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer los tenants');
    }

    return res.json();
};

export const fetchClientBranches = async () => {
    const res = await apiFetch('/api/client/branches');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer las sucursales del cliente');
    }
    return res.json();
};

export const fetchBranchTransfers = async ({ direction, status } = {}) => {
    const query = new URLSearchParams();
    if (direction) query.set('direction', direction);
    if (status) query.set('status', status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await apiFetch(`/api/branch-transfers${suffix}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer las transferencias');
    }
    return res.json();
};

export const createBranchTransfer = async (payload) => {
    const res = await apiFetch('/api/branch-transfers', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo crear el remito');
    }
    return res.json();
};

export const receiveBranchTransfer = async (transferId) => {
    const res = await apiFetch(`/api/branch-transfers/${encodeURIComponent(transferId)}/receive`, {
        method: 'POST',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo confirmar la recepcion');
    }
    return res.json();
};

export const fetchLogisticsDrivers = async () => {
    const res = await apiFetch('/api/logistics/drivers');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudieron leer los repartidores habilitados');
    }
    return res.json();
};

export const fetchLiveDrivers = async () => {
    const res = await apiFetch('/api/logistics/drivers/live');
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo leer el mapa en tiempo real');
    }
    return res.json();
};

export const assignLogisticsOrder = async (orderId, payload) => {
    const res = await apiFetch(`/api/logistics/orders/${encodeURIComponent(orderId)}/assign`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo asignar el pedido');
    }

    return res.json();
};

export const updateLogisticsOrderStatus = async (orderId, payload) => {
    const res = await apiFetch(`/api/delivery/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo actualizar el pedido logístico');
    }

    return res.json();
};

export const createFirebaseUser = async (record) => {
    const res = await apiFetch('/api/firebase-users', {
        method: 'POST',
        body: JSON.stringify(record),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo crear el usuario web');
    }

    return res.json();
};

export const updateFirebaseUser = async (userId, record) => {
    const res = await apiFetch(`/api/firebase-users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify(record),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo actualizar el usuario web');
    }

    return res.json();
};

export const deleteFirebaseUser = async (userId) => {
    const res = await apiFetch(`/api/firebase-users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo eliminar el usuario web');
    }

    return res.json();
};

export const getNextRemoteReceiptData = async (counterKey, branchKey = 'branch_code') => {
    const res = await apiFetch('/api/sequences/next', {
        method: 'POST',
        body: JSON.stringify({ counterKey, branchKey }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo obtener el próximo comprobante');
    }

    return res.json();
};

export const requestCashWithdrawalAuthorization = async (payload) => {
    const res = await apiFetch('/api/cash/withdrawals/request-authorization', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo enviar el codigo de autorizacion');
    }

    return res.json();
};

export const verifyCashWithdrawalAuthorization = async (payload) => {
    const res = await apiFetch('/api/cash/withdrawals/verify-authorization', {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo validar el codigo de autorizacion');
    }

    return res.json();
};

// ── Venta atómica ─────────────────────────────────────────────────────────

// Venta atomica: registra venta + items + descuento de stock + balance cliente
// en una sola transaccion en el servidor.
export const createVenta = async (payload) => {
    const res = await apiFetch('/api/ventas', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al registrar la venta');
    }
    return res.json();
};

// Anula una venta de forma atomica: restaura stock + revierte balance + historial.
export const deleteVenta = async (id, { deleted_by_user_id, deleted_by_username } = {}) => {
    const res = await apiFetch(`/api/ventas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ deleted_by_user_id, deleted_by_username }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al anular la venta');
    }
    return res.json();
};

export const fetchScaleTicketByBarcode = async (barcode) => {
    const code = String(barcode || '').trim();
    if (!code) throw new Error('barcode requerido');
    const res = await apiFetch(`/api/scale/tickets/by-barcode/${encodeURIComponent(code)}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo leer ticket de balanza');
    }
    return res.json();
};

// Compra atomica: registra compra + items + stock + animal_lots + caja
// en una sola transaccion en el servidor.
export const createCompra = async (payload) => {
    const res = await apiFetch('/api/compras', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al registrar la compra');
    }
    return res.json();
};
