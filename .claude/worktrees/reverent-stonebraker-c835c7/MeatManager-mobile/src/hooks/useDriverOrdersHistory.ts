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

const formatCurrency = (value: number) =>
  value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const normalizeNumeric = (value: unknown) => {
  if (value == null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const formatOrderItem = (item: Record<string, unknown>) => {
  const name = String(
    item.name ||
    item.label ||
    item.product_name ||
    item.productName ||
    item.title ||
    'Producto'
  ).trim();

  const quantity = normalizeNumeric(item.quantity);
  const unit = String(item.unit || '').trim();
  const subtotal = normalizeNumeric(item.subtotal);
  const price = normalizeNumeric(item.price);

  const parts = [name];

  if (quantity != null) {
    parts.push(unit ? `${quantity} ${unit}` : `x${quantity}`);
  }

  if (price != null) {
    parts.push(`Precio ${formatCurrency(price)}`);
  }

  if (subtotal != null) {
    parts.push(`Subtotal ${formatCurrency(subtotal)}`);
  }

  return `• ${parts.join(' · ')}`;
};

const normalizeItems = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 'Sin detalle disponible';
    try {
      return normalizeItems(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return formatOrderItem(item as Record<string, unknown>);
        }
        return JSON.stringify(item);
      })
      .join('\n');
  }
  if (value && typeof value === 'object') {
    if ('items' in value) {
      return normalizeItems((value as Record<string, unknown>).items);
    }
    return formatOrderItem(value as Record<string, unknown>);
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
