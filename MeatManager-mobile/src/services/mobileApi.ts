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

export async function fetchCurrentMobileProfile(): Promise<MobileAccessProfile> {
  const response = await apiFetch('/api/firebase-users/me');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudo leer el perfil actual.');
  }

  return payload.user as MobileAccessProfile;
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
