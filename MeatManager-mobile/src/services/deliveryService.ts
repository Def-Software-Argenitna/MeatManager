import { apiBaseUrl } from '../config/env';
import { auth } from '../config/firebase';
import type { DeliveryOrder, DeliveryOrderStatus, DriverLocation } from '../types/delivery';

const CURRENT_SHIFT_DELIVERY_STATUSES = ['pending', 'assigned', 'on_route', 'arrived', 'delivered'];
const DRIVER_ORDERS_REFRESH_INTERVAL_MS = 10000;

const isSameLocalDay = (value?: string) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

const normalizeOrderStatus = (value: unknown): DeliveryOrderStatus => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'ready') return 'assigned';
  if (token === 'assigned' || token === 'on_route' || token === 'arrived' || token === 'delivered' || token === 'failed' || token === 'cancelled') {
    return token;
  }
  return 'pending';
};

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

const mapApiOrderToMobileOrder = (order: any): DeliveryOrder => ({
  cloudId: String(order?.id || order?.cloudId || ''),
  id: order?.id,
  customer_name: order?.customerName || order?.customer_name || 'Cliente',
  customer_phone: order?.customerPhone || order?.customer_phone || undefined,
  address: order?.address || 'Sin direccion cargada',
  items: normalizeItems(order?.items),
  repartidor: order?.driver?.name || order?.repartidor || '',
  status: normalizeOrderStatus(order?.status || order?.rawStatus),
  total: order?.total == null ? undefined : Number(order.total),
  updated_at: order?.statusUpdatedAt || order?.updated_at || order?.createdAt || undefined,
  delivered_at: order?.deliveredAt || order?.delivered_at || undefined,
  delivery_date: order?.deliveryDate || order?.delivery_date || undefined,
  payment_method: order?.paymentMethod || order?.payment_method || undefined,
  payment_status: order?.paymentStatus || order?.payment_status || undefined,
  paid: order?.paid === true,
  amount_due: order?.amountDue == null && order?.amount_due == null
    ? undefined
    : Number(order?.amountDue ?? order?.amount_due),
  requires_collection: (order?.paid === true)
    ? false
    : (String(order?.paymentStatus || order?.payment_status || '').trim().toLowerCase() === 'pending_driver_collection'
      || Number(order?.amountDue ?? order?.amount_due ?? 0) > 0),
});

async function getAuthHeaders() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No hay una sesion autenticada para usar logística.');
  }

  const token = await currentUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function deliveryFetch(path: string, options: RequestInit = {}) {
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

async function fetchAssignedOrders(): Promise<DeliveryOrder[]> {
  const response = await deliveryFetch(`/api/delivery/orders?status=${CURRENT_SHIFT_DELIVERY_STATUSES.join(',')}&limit=100`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudieron leer los pedidos asignados.');
  }

  const orders: DeliveryOrder[] = Array.isArray(payload.orders) ? payload.orders.map(mapApiOrderToMobileOrder) : [];

  return orders.filter((order) => {
    if (order.status !== 'delivered') return true;
    return isSameLocalDay(order.delivered_at) || isSameLocalDay(order.updated_at) || isSameLocalDay(order.delivery_date);
  });
}

export function subscribeToAssignedOrders(
  _driverName: string,
  onData: (orders: DeliveryOrder[]) => void,
  onError: (error: Error) => void,
) {
  let active = true;

  const load = async () => {
    try {
      const orders = await fetchAssignedOrders();
      if (active) {
        onData(orders);
      }
    } catch (error) {
      if (active) {
        onError(error instanceof Error ? error : new Error('No se pudieron sincronizar los pedidos.'));
      }
    }
  };

  load();
  const interval = setInterval(load, DRIVER_ORDERS_REFRESH_INTERVAL_MS);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

export async function updateDriverLocation(
  location: DriverLocation & {
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  },
) {
  const response = await deliveryFetch('/api/delivery/location', {
    method: 'POST',
    body: JSON.stringify({
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy ?? null,
      speed: location.speed ?? null,
      heading: location.heading ?? null,
      time: location.time,
      repartidor: location.repartidor,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo sincronizar ubicacion con la API.');
  }
}

export async function markOrderAsDelivered(orderId: string) {
  const response = await deliveryFetch(`/api/delivery/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'delivered' }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo marcar el pedido como entregado.');
  }
}

export async function registerOrderCollection(orderId: string, paymentMethod: string, status: DeliveryOrderStatus = 'assigned') {
  const response = await deliveryFetch(`/api/delivery/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'POST',
    body: JSON.stringify({
      status,
      paymentStatus: 'paid',
      paymentMethod,
      paid: true,
      amountDue: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo registrar el cobro.');
  }
}
