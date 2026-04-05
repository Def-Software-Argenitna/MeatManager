import { useEffect, useMemo, useState } from 'react';

import { fetchTableRows } from '../services/mobileApi';
import type { DeliveryOrder } from '../types/delivery';

type PedidoRow = {
  id?: number | string;
  customer_name?: string;
  customer_phone?: string;
  address?: string;
  items?: unknown;
  repartidor?: string;
  status?: string;
  total?: number | string;
  updated_at?: string;
  delivered_at?: string;
  delivery_date?: string;
};

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase();

const normalizeItems = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'name' in item) {
          return String(item.name);
        }
        return JSON.stringify(item);
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return 'Sin detalle disponible';
    }
  }
  return 'Sin detalle disponible';
};

export function useDriverOrdersHistory(driverName: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      if (!driverName) {
        setOrders([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const rows = await fetchTableRows<PedidoRow>('pedidos', {
          limit: 500,
          orderBy: 'created_at',
          direction: 'DESC',
        });

        if (cancelled) return;

        const normalizedDriver = normalizeName(driverName);
        const nextOrders = rows
          .filter((row) => normalizeName(row.repartidor) === normalizedDriver)
          .map((row) => ({
            cloudId: String(row.id || `${row.customer_name || 'pedido'}-${row.delivery_date || ''}`),
            id: row.id,
            customer_name: row.customer_name || 'Cliente',
            customer_phone: row.customer_phone || undefined,
            address: row.address || 'Sin direccion cargada',
            items: normalizeItems(row.items),
            repartidor: row.repartidor || driverName,
            status:
              row.status === 'delivered'
                ? 'delivered'
                : row.status === 'cancelled'
                  ? 'cancelled'
                  : row.status === 'on_route'
                    ? 'on_route'
                    : row.status === 'arrived'
                      ? 'arrived'
                      : row.status === 'ready' || row.status === 'assigned'
                        ? 'assigned'
                        : 'pending',
            total: row.total == null ? undefined : Number(row.total),
            updated_at: row.updated_at || undefined,
            delivered_at: row.delivered_at || undefined,
          } satisfies DeliveryOrder));

        setOrders(nextOrders);
      } catch (nextError) {
        if (cancelled) return;
        const message = nextError instanceof Error ? nextError.message : 'No se pudo leer historial.';
        setError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, [driverName]);

  return useMemo(
    () => ({
      isLoading,
      error,
      orders,
      deliveredOrders: orders.filter((order) => order.status === 'delivered'),
      pendingOrders: orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled'),
    }),
    [error, isLoading, orders],
  );
}
