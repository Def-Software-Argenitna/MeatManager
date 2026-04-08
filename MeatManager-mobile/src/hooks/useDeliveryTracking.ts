import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';

import { ensureDriverLocationTracking, stopDriverLocationTracking } from '../services/backgroundLocationTask';
import { subscribeToAssignedOrders, updateDriverLocation } from '../services/deliveryService';
import type { DeliveryOrder } from '../types/delivery';

const FOREGROUND_TRACKING_TIME_INTERVAL_MS = 5000;
const FOREGROUND_TRACKING_DISTANCE_INTERVAL_METERS = 10;

const normalizeLocationError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Error desconocido');

  if (/NSLocation.*UsageDescription/i.test(rawMessage)) {
    return 'Esta version de la app no tiene habilitados correctamente los permisos nativos de ubicacion. Instalá una build nueva y volvé a probar.';
  }

  if (/denied|permission/i.test(rawMessage)) {
    return 'La app necesita permiso de ubicacion para compartir tu posicion.';
  }

  return 'No se pudo iniciar o sincronizar la ubicacion.';
};

type TrackingState = {
  orders: DeliveryOrder[];
  locationText: string;
  isTracking: boolean;
  syncError: string | null;
  locationError: string | null;
  isRefreshing: boolean;
  lastSyncText: string;
  reload: () => void;
  retryTracking: () => void;
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
  const [trackingTick, setTrackingTick] = useState(0);

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
      setLocationError(null);
      void stopDriverLocationTracking().catch(() => {});
      return;
    }

    const currentDriverName = driverName;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    async function startTracking() {
      try {
        const trackingSetup = await ensureDriverLocationTracking();

        if (!mounted) return;

        if (!trackingSetup.ok) {
          setLocationError(trackingSetup.error);
          setLocationText('Tracking en segundo plano deshabilitado');
          setIsTracking(false);
          return;
        }

        setLocationError(trackingSetup.warning || null);
        setIsTracking(true);

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }).catch(() => null);

        if (mounted && currentPosition) {
          const lat = currentPosition.coords.latitude;
          const lng = currentPosition.coords.longitude;
          setLocationText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);

          try {
            await updateDriverLocation({
              lat,
              lng,
              accuracy: currentPosition.coords.accuracy ?? null,
              speed: currentPosition.coords.speed ?? null,
              heading: currentPosition.coords.heading ?? null,
              repartidor: currentDriverName,
              time: new Date().toISOString(),
            });
          } catch (error) {
            console.warn('[delivery-tracking] immediate location sync failed', error);
            const message = normalizeLocationError(error);
            setLocationError(message);
          }
        } else {
          const lastKnownPosition = await Location.getLastKnownPositionAsync();
          if (mounted && lastKnownPosition) {
            setLocationText(`${lastKnownPosition.coords.latitude.toFixed(5)}, ${lastKnownPosition.coords.longitude.toFixed(5)}`);
          }
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: FOREGROUND_TRACKING_TIME_INTERVAL_MS,
            distanceInterval: FOREGROUND_TRACKING_DISTANCE_INTERVAL_METERS,
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
              console.warn('[delivery-tracking] watch location sync failed', error);
              const message = normalizeLocationError(error);
              setLocationError(message);
            }
          },
        );
      } catch (error) {
        if (!mounted) return;
        console.warn('[delivery-tracking] tracking bootstrap failed', error);
        setLocationError(normalizeLocationError(error));
        setLocationText('Tracking en segundo plano deshabilitado');
        setIsTracking(false);
      }
    }

    startTracking();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [driverName, trackingTick]);

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
      retryTracking: () => {
        setLocationError(null);
        setTrackingTick((value) => value + 1);
      },
    }),
    [isRefreshing, isTracking, lastSyncText, locationError, locationText, orders, syncError],
  );
}
