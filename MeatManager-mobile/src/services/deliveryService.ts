import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { firestore } from '../config/firebase';
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

export async function updateDriverLocation(location: DriverLocation) {
  await setDoc(doc(firestore, 'drivers_locations', location.repartidor), location);
}

export async function markOrderAsDelivered(orderId: string) {
  await updateDoc(doc(firestore, 'orders_delivery', orderId), {
    status: 'delivered',
    delivered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
