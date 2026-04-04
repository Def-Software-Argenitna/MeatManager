import { env } from '../config/env';
import { storage } from './storage';

const buildApiUrl = (path: string) => `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined)
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || 'No se pudo completar la solicitud');
  }

  return response.json() as Promise<T>;
}

export async function fetchTable<T>(table: string, options: { limit?: number; orderBy?: string; direction?: 'ASC' | 'DESC' } = {}) {
  const query = new URLSearchParams();
  if (options.limit) query.set('limit', String(options.limit));
  if (options.orderBy) query.set('orderBy', options.orderBy);
  if (options.direction) query.set('direction', options.direction);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const data = await apiFetch<{ rows: T[] }>(`/api/table/${table}${suffix}`);
  return data.rows || [];
}

export async function fetchSetting(key: string) {
  return apiFetch<{ key: string; value: string | null }>(`/api/settings/${encodeURIComponent(key)}`);
}
