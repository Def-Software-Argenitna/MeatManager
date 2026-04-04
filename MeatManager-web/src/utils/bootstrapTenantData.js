import { db } from '../db';
import { auth } from '../firebase';
import { buildApiUrl } from './runtimeConfig';
import { getStoredAuthToken } from './apiClient';

const BOOTSTRAP_TABLES = ['settings', 'users', 'user_permissions', 'payment_methods', 'categories', 'suppliers', 'purchase_items', 'clients', 'prices', 'stock'];

const getToken = async () => {
    const storedToken = getStoredAuthToken();
    if (storedToken) return storedToken;
    const user = auth.currentUser;
    if (!user) return null;
    return user.getIdToken();
};

const normalizeSettings = (rows) =>
    rows.map((row) => ({
        key: row.key,
        value: row.value,
    }));

const upsertTable = async (tableName, rows) => {
    if (!db[tableName] || !Array.isArray(rows)) return;
    if (tableName === 'settings') {
        await db.settings.bulkPut(normalizeSettings(rows));
        return;
    }
    if (rows.length === 0) return;
    await db[tableName].bulkPut(rows);
};

export const bootstrapTenantData = async () => {
    const token = await getToken();
    if (!token) return { ok: false, error: 'No hay sesión activa' };

    const res = await fetch(buildApiUrl(`/bootstrap?tables=${BOOTSTRAP_TABLES.join(',')}`), {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.error || 'No se pudo obtener bootstrap' };
    }

    const data = await res.json();
    const tables = data?.tables || {};

    await db.transaction(
        'rw',
        db.settings,
        db.users,
        db.user_permissions,
        db.payment_methods,
        db.categories,
        db.suppliers,
        db.purchase_items,
        db.clients,
        db.prices,
        db.stock,
        async () => {
            for (const [tableName, rows] of Object.entries(tables)) {
                await upsertTable(tableName, rows);
            }
        }
    );

    return { ok: true };
};
