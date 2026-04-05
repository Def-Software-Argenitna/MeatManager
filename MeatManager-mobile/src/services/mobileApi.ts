import { auth } from '../config/firebase';
import { apiBaseUrl } from '../config/env';
import type { MobileAccessProfile } from '../types/session';

type TableFetchOptions = {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
};

async function getAuthHeaders() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No hay una sesion autenticada.');
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = await getAuthHeaders();
  return fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
      ...(options.headers || {}),
    },
  });
}

const normalizeMobileProfile = (profile: any): MobileAccessProfile => ({
  id: profile?.id ?? profile?.firebaseUid ?? profile?.email ?? 'unknown',
  uid: profile?.uid ?? profile?.firebaseUid ?? null,
  firebaseUid: profile?.firebaseUid ?? profile?.uid ?? null,
  email: profile?.email ?? null,
  username: profile?.username || profile?.name || profile?.email || 'Usuario',
  role: profile?.role === 'admin' ? 'admin' : 'employee',
  active: Number(profile?.active ?? 1),
  perms: Array.isArray(profile?.perms) ? profile.perms : [],
  clientId: profile?.clientId,
  branchId: profile?.branchId ?? null,
  clientStatus: profile?.clientStatus,
  logisticsEnabled: Boolean(profile?.logisticsEnabled),
  tenantHasDeliveryLicense: Boolean(profile?.tenantHasDeliveryLicense),
  licenses: Array.isArray(profile?.licenses) ? profile.licenses : [],
});

export async function fetchCurrentMobileProfile(): Promise<MobileAccessProfile> {
  const deliveryResponse = await apiFetch('/api/delivery/me');
  const deliveryPayload = await deliveryResponse.json().catch(() => ({}));

  if (deliveryResponse.ok && deliveryPayload?.profile) {
    return normalizeMobileProfile(deliveryPayload.profile);
  }

  const response = await apiFetch('/api/firebase-users/me');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(deliveryPayload.error || payload.error || 'No se pudo leer el perfil actual.');
  }

  return normalizeMobileProfile(payload.user);
}

export async function fetchTableRows<T>(table: string, options: TableFetchOptions = {}): Promise<T[]> {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.offset) query.set('offset', String(options.offset));
  if (options.orderBy) query.set('orderBy', options.orderBy);
  if (options.direction) query.set('direction', options.direction);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await apiFetch(`/api/table/${table}${suffix}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `No se pudo leer ${table}.`);
  }

  return Array.isArray(payload.rows) ? (payload.rows as T[]) : [];
}

export async function fetchDriverLocations() {
  const response = await apiFetch('/api/delivery/locations');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudieron leer las ubicaciones.');
  }

  return Array.isArray(payload.locations) ? payload.locations : [];
}
