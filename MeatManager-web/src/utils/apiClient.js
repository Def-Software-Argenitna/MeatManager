import { auth } from '../firebase';
import { buildApiUrl } from './runtimeConfig';

export const hasTenantSession = () => !!sessionStorage.getItem('mm_tenant');
export const getStoredAuthToken = () => sessionStorage.getItem('mm_auth_token');
const setStoredAuthToken = (token) => {
    if (token) {
        sessionStorage.setItem('mm_auth_token', token);
        return;
    }
    sessionStorage.removeItem('mm_auth_token');
};

export const getAuthToken = async () => {
    if (!hasTenantSession()) return null;
    const user = auth.currentUser;
    if (user) {
        const token = await user.getIdToken();
        setStoredAuthToken(token);
        return token;
    }
    return getStoredAuthToken();
};

export const apiFetch = async (path, options = {}) => {
    const buildHeaders = async (forcedRefresh = false) => {
        let token = null;
        if (hasTenantSession()) {
            if (auth.currentUser) {
                token = await auth.currentUser.getIdToken(forcedRefresh);
                setStoredAuthToken(token);
            } else if (!forcedRefresh) {
                token = getStoredAuthToken();
            }
        }

        const headers = {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    };

    let response = await fetch(buildApiUrl(path), {
        ...options,
        headers: await buildHeaders(false),
    });

    if (response.status === 401 && auth.currentUser) {
        response = await fetch(buildApiUrl(path), {
            ...options,
            headers: await buildHeaders(true),
        });
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
