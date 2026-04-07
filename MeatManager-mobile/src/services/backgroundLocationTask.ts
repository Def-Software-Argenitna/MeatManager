import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { auth } from '../config/firebase';
import { updateDriverLocation } from './deliveryService';

const DRIVER_LOCATION_TASK = 'meatmanager-driver-location-task';
const TRACKING_ENABLED_KEY = 'meatmanager.driverTracking.enabled';
const TRACKING_TIME_INTERVAL_MS = 5000;
const TRACKING_DISTANCE_INTERVAL_METERS = 10;

type TrackingBootstrapResult =
  | { ok: true; warning?: string | null }
  | { ok: false; error: string };

const getLatestLocation = (data: Location.LocationTaskOptions | { locations?: Location.LocationObject[] } | null | undefined) => {
  const nextLocations = Array.isArray((data as { locations?: Location.LocationObject[] } | null)?.locations)
    ? (data as { locations?: Location.LocationObject[] }).locations ?? []
    : [];
  return nextLocations.length > 0 ? nextLocations[nextLocations.length - 1] : null;
};

if (!(globalThis as { __mmDriverLocationTaskDefined?: boolean }).__mmDriverLocationTaskDefined) {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[driver-location-task]', error.message);
      return;
    }

    const isEnabled = await AsyncStorage.getItem(TRACKING_ENABLED_KEY);
    if (isEnabled !== 'true') {
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      return;
    }

    const latestLocation = getLatestLocation(data as { locations?: Location.LocationObject[] } | null | undefined);
    if (!latestLocation) {
      return;
    }

    try {
      await updateDriverLocation({
        lat: latestLocation.coords.latitude,
        lng: latestLocation.coords.longitude,
        accuracy: latestLocation.coords.accuracy ?? null,
        speed: latestLocation.coords.speed ?? null,
        heading: latestLocation.coords.heading ?? null,
        repartidor: currentUser.displayName || currentUser.email || 'Repartidor',
        time: latestLocation.timestamp ? new Date(latestLocation.timestamp).toISOString() : new Date().toISOString(),
      });
    } catch (taskError) {
      console.warn(
        '[driver-location-task] no se pudo sincronizar ubicacion',
        taskError instanceof Error ? taskError.message : taskError,
      );
    }
  });

  (globalThis as { __mmDriverLocationTaskDefined?: boolean }).__mmDriverLocationTaskDefined = true;
}

export async function ensureDriverLocationTracking(): Promise<TrackingBootstrapResult> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    return { ok: false, error: 'Activa la ubicacion del dispositivo para compartir tu posicion.' };
  }

  let foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    foreground = await Location.requestForegroundPermissionsAsync();
  }

  if (foreground.status !== 'granted') {
    return {
      ok: false,
      error: foreground.canAskAgain === false
        ? 'La ubicacion esta bloqueada para esta app. Habilitala desde los ajustes del dispositivo.'
        : 'La app necesita permiso de ubicacion para rastrear entregas.',
    };
  }

  let background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted' && background.canAskAgain !== false) {
    background = await Location.requestBackgroundPermissionsAsync();
  }

  if (background.status !== 'granted') {
    await AsyncStorage.setItem(TRACKING_ENABLED_KEY, 'false');
    return {
      ok: true,
      warning: 'La app comparte ubicacion mientras esta abierta. Para seguir rastreando en segundo plano, habilita el permiso "Permitir siempre".',
    };
  }

  await AsyncStorage.setItem(TRACKING_ENABLED_KEY, 'true');

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: TRACKING_TIME_INTERVAL_MS,
      distanceInterval: TRACKING_DISTANCE_INTERVAL_METERS,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'MeatManager esta compartiendo tu ubicacion',
        notificationBody: 'El seguimiento de repartos sigue activo mientras la app esta en segundo plano.',
        notificationColor: '#ff7a00',
        killServiceOnDestroy: true,
      },
    });
  }

  return { ok: true, warning: null };
}

export async function stopDriverLocationTracking() {
  await AsyncStorage.setItem(TRACKING_ENABLED_KEY, 'false');

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (alreadyStarted) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
}
