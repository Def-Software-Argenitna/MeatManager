import { apiBaseUrl } from '../config/env';
import { auth } from '../config/firebase';
import type { DeliveryOrder, DeliveryOrderStatus, DriverLocation } from '../types/delivery';

const ACTIVE_DELIVERY_STATUSES = ['pending', 'assigned', 'on_route', 'arrived'];

const normalizeOrderStatus = (value: unknown): DeliveryOrderStatus => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'ready') return 'assigned';
  if (token === 'assigned' || token === 'on_route' || token === 'arrived' || token === 'delivered' || token === 'failed' || token === 'cancelled') {
    return token;
  }
  return 'pending';
};

const normalizeItems = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'name' in item) {
          const quantity = 'quantity' in item ? ` x${String(item.quantity)}` : '';
          return `${String(item.name)}${quantity}`;
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
  payment_method: order?.paymentMethod || order?.payment_method || undefined,
  payment_status: order?.paymentStatus || order?.payment_status || undefined,
  paid: order?.paid === true,
  amount_due: order?.amountDue == null && order?.amount_due == null
    ? undefined
    : Number(order?.amountDue ?? order?.amount_due),
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
  const response = await deliveryFetch(`/api/delivery/orders?status=${ACTIVE_DELIVERY_STATUSES.join(',')}&limit=100`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'No se pudieron leer los pedidos asignados.');
  }

  return Array.isArray(payload.orders) ? payload.orders.map(mapApiOrderToMobileOrder) : [];
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
  const interval = setInterval(load, 15000);

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
