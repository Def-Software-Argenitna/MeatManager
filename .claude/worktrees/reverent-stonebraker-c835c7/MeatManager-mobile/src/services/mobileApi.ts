import { auth } from '../config/firebase';
import { apiBaseUrl } from '../config/env';
import type { MobileAccessProfile } from '../types/session';

type TableFetchOptions = {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
};

type LogisticsDriver = {
  id: number;
  clientId?: number;
  branchId?: number | null;
  firebaseUid?: string | null;
  email?: string | null;
  role?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  vehicle?: string | null;
  status?: string | null;
  licenses?: unknown[];
};

type ClientBranch = {
  id: number;
  clientId?: number;
  name?: string | null;
  internalCode?: string | null;
  address?: string | null;
  isBillable?: boolean;
  status?: string | null;
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

const extractApiError = (payload: any) => String(payload?.error || '').trim();

const toUserFacingSessionError = (deliveryPayload: any, profilePayload: any) => {
  const deliveryError = extractApiError(deliveryPayload).toLowerCase();
  const profileError = extractApiError(profilePayload).toLowerCase();

  if (deliveryError.includes('usuario inactivo') || profileError.includes('usuario inactivo')) {
    return 'Tu usuario esta inactivo. Pedi a un administrador que revise tu acceso.';
  }

  if (deliveryError.includes('cliente sin acceso') || profileError.includes('cliente sin acceso')) {
    return 'Tu cliente no tiene acceso activo en este momento. Contacta a soporte o al administrador.';
  }

  if (
    deliveryError.includes('licencias activas asignadas')
    || profileError.includes('licencias activas asignadas')
    || deliveryError.includes('acceso al modulo logistica')
  ) {
    return 'Tu cuenta todavia no tiene acceso habilitado para esta app. Pedi a un administrador que te asigne la licencia correcta.';
  }

  if (deliveryError.includes('usuario no encontrado en gestionclientes') || profileError.includes('usuario no encontrado en gestionclientes')) {
    return 'Tu cuenta todavia no termino de sincronizarse. Cerra sesion e intenta nuevamente en unos minutos.';
  }

  return 'No pudimos validar tu acceso en este momento. Intenta nuevamente en unos minutos.';
};

export async function fetchCurrentMobileProfile(): Promise<MobileAccessProfile> {
  const deliveryResponse = await apiFetch('/api/delivery/me');
  const deliveryPayload = await deliveryResponse.json().catch(() => ({}));

  if (deliveryResponse.ok && deliveryPayload?.profile) {
    return normalizeMobileProfile(deliveryPayload.profile);
  }

  const response = await apiFetch('/api/firebase-users/me');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.warn('[mobile access]', {
      apiBaseUrl,
      deliveryStatus: deliveryResponse.status,
      deliveryError: extractApiError(deliveryPayload),
      profileStatus: response.status,
      profileError: extractApiError(payload),
    });

    throw new Error(toUserFacingSessionError(deliveryPayload, payload));
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

export async function fetchLogisticsDrivers(): Promise<LogisticsDriver[]> {
  const response = await apiFetch('/api/logistics/drivers');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudieron leer los repartidores habilitados.');
  }

  return Array.isArray(payload.drivers) ? (payload.drivers as LogisticsDriver[]) : [];
}

export async function fetchClientBranches(): Promise<ClientBranch[]> {
  const response = await apiFetch('/api/client/branches');
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudieron leer las sucursales del cliente.');
  }

  return Array.isArray(payload.branches) ? (payload.branches as ClientBranch[]) : [];
}
