import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';

import { subscribeToAssignedOrders, updateDriverLocation } from '../services/deliveryService';
import type { DeliveryOrder } from '../types/delivery';

type TrackingState = {
  orders: DeliveryOrder[];
  locationText: string;
  isTracking: boolean;
  syncError: string | null;
  locationError: string | null;
  isRefreshing: boolean;
  lastSyncText: string;
  reload: () => void;
};

export function useDeliveryTracking(driverName: string | null): TrackingState {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [locationText, setLocationText] = useState('Esperando permiso de ubicacion...');
  const [isTracking, setIsTracking] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastSyncText, setLastSyncText] = useState('Sincronizacion pendiente');

  useEffect(() => {
    if (!driverName) {
      setOrders([]);
      return;
    }

    const unsubscribe = subscribeToAssignedOrders(
      driverName,
      (nextOrders) => {
        setOrders(nextOrders);
        setSyncError(null);
        setLastSyncText(`Actualizado ${new Date().toLocaleTimeString()}`);
        setIsRefreshing(false);
      },
      (error) => {
        setSyncError(error.message);
        setIsRefreshing(false);
      },
    );

    return unsubscribe;
  }, [driverName, refreshTick]);

  useEffect(() => {
    if (!driverName) {
      setIsTracking(false);
      setLocationText('Sesion cerrada');
      return;
    }

    const currentDriverName = driverName;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    async function startTracking() {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!mounted) return;

      if (permission.status !== 'granted') {
        setLocationError('La app necesita permiso de ubicacion para rastrear entregas.');
        setLocationText('Permiso de ubicacion denegado');
        setIsTracking(false);
        return;
      }

      setLocationError(null);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 25,
        },
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          if (!mounted) return;

          setLocationText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          setIsTracking(true);

          try {
            await updateDriverLocation({
              lat,
              lng,
              accuracy: position.coords.accuracy ?? null,
              speed: position.coords.speed ?? null,
              heading: position.coords.heading ?? null,
              repartidor: currentDriverName,
              time: new Date().toISOString(),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo sincronizar ubicacion.';
            setLocationError(message);
          }
        },
      );
    }

    startTracking();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [driverName]);

  return useMemo(
    () => ({
      orders,
      locationText,
      isTracking,
      syncError,
      locationError,
      isRefreshing,
      lastSyncText,
      reload: () => {
        setIsRefreshing(true);
        setRefreshTick((value) => value + 1);
      },
    }),
    [isRefreshing, isTracking, lastSyncText, locationError, locationText, orders, syncError],
  );
}
