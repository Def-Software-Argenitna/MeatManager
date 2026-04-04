import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

import { apiBaseUrl } from '../config/env';
import { auth, firestore } from '../config/firebase';
import type { DeliveryOrder, DriverLocation } from '../types/delivery';

export function subscribeToAssignedOrders(
  driverName: string,
  onData: (orders: DeliveryOrder[]) => void,
  onError: (error: Error) => void,
) {
  const ordersQuery = query(
    collection(firestore, 'orders_delivery'),
    where('repartidor', '==', driverName),
    where('status', 'in', ['pending', 'ready']),
  );

  return onSnapshot(
    ordersQuery,
    (snapshot) => {
      const orders = snapshot.docs.map((entry) => ({
        cloudId: entry.id,
        ...(entry.data() as Omit<DeliveryOrder, 'cloudId'>),
      }));

      orders.sort((left, right) => {
        const leftDate = new Date(left.updated_at || 0).getTime();
        const rightDate = new Date(right.updated_at || 0).getTime();
        return rightDate - leftDate;
      });

      onData(orders);
    },
    (error) => {
      onError(error);
    },
  );
}

export async function updateDriverLocation(location: DriverLocation & {
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No hay una sesion autenticada para reportar ubicacion.');
  }

  const token = await currentUser.getIdToken();
  const response = await fetch(`${apiBaseUrl}/api/delivery/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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
  await updateDoc(doc(firestore, 'orders_delivery', orderId), {
    status: 'delivered',
    delivered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
