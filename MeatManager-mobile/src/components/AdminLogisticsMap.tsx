import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Marker, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';

import type { DriverMapMarker, OrderMapMarker } from '../hooks/useAdminDashboard';
import { theme } from '../theme';

type Props = {
  driverMarkers: DriverMapMarker[];
  orderMarkers: OrderMapMarker[];
};

const DEFAULT_REGION = {
  latitude: -34.6037,
  longitude: -58.3816,
  latitudeDelta: 0.22,
  longitudeDelta: 0.22,
};

const statusLabel = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'delivered') return 'Entregado';
  if (normalized === 'assigned') return 'Asignado';
  if (normalized === 'on_route') return 'En reparto';
  if (normalized === 'arrived') return 'En puerta';
  return 'Pendiente';
};

const orderPinColor = (status: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'delivered') return '#18b26b';
  if (normalized === 'assigned' || normalized === 'on_route' || normalized === 'arrived') return '#3b82f6';
  return '#f59e0b';
};

export function AdminLogisticsMap({ driverMarkers, orderMarkers }: Props) {
  const mapRef = useRef<MapView | null>(null);
  const coordinates = useMemo<LatLng[]>(
    () => [
      ...driverMarkers.map((marker) => ({ latitude: marker.latitude, longitude: marker.longitude })),
      ...orderMarkers.map((marker) => ({ latitude: marker.latitude, longitude: marker.longitude })),
    ],
    [driverMarkers, orderMarkers],
  );

  useEffect(() => {
    if (!mapRef.current || coordinates.length === 0) return;

    const timeout = setTimeout(() => {
      if (!mapRef.current) return;
      if (coordinates.length === 1) {
        mapRef.current.animateToRegion({
          latitude: coordinates[0].latitude,
          longitude: coordinates[0].longitude,
          latitudeDelta: 0.045,
          longitudeDelta: 0.045,
        }, 350);
        return;
      }

      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 56, right: 56, bottom: 56, left: 56 },
        animated: true,
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [coordinates]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Mapa operativo</Text>
          <Text style={styles.subtitle}>Pedidos y repartidores en una sola vista.</Text>
        </View>
        <Pressable
          style={styles.fitButton}
          onPress={() => {
            if (!mapRef.current || coordinates.length === 0) return;
            mapRef.current.fitToCoordinates(coordinates, {
              edgePadding: { top: 56, right: 56, bottom: 56, left: 56 },
              animated: true,
            });
          }}
        >
          <Text style={styles.fitButtonText}>Centrar</Text>
        </Pressable>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDriver]} />
          <Text style={styles.legendText}>Repartidores</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendPending]} />
          <Text style={styles.legendText}>Pendientes</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendTransit]} />
          <Text style={styles.legendText}>En reparto</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendDelivered]} />
          <Text style={styles.legendText}>Entregados</Text>
        </View>
      </View>

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {driverMarkers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            pinColor="#ff7a00"
          >
            <Callout tooltip>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{marker.name}</Text>
                <Text style={styles.calloutText}>{marker.vehicle || 'Sin vehiculo cargado'}</Text>
                <Text style={styles.calloutText}>
                  {marker.online ? `${marker.activeOrderCount} pedidos activos` : 'Sin tracking reciente'}
                </Text>
                {marker.lastSyncText ? <Text style={styles.calloutMeta}>{marker.lastSyncText}</Text> : null}
              </View>
            </Callout>
          </Marker>
        ))}

        {orderMarkers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            pinColor={orderPinColor(marker.status)}
          >
            <Callout tooltip>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{marker.customerName}</Text>
                <Text style={styles.calloutText}>Pedido #{marker.orderId} · {statusLabel(marker.status)}</Text>
                {marker.address ? <Text style={styles.calloutText}>{marker.address}</Text> : null}
                {marker.driverName ? <Text style={styles.calloutText}>Repartidor: {marker.driverName}</Text> : null}
                <Text style={styles.calloutMeta}>
                  {marker.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {coordinates.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Todavia no hay puntos para mostrar</Text>
          <Text style={styles.emptyText}>Los pedidos con coordenadas y los repartidores con tracking van a aparecer aca.</Text>
        </View>
      ) : (
        <Text style={styles.footer}>
          {orderMarkers.length} pedidos con mapa · {driverMarkers.length} repartidores con tracking
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 4,
  },
  fitButton: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fitButtonText: {
    color: theme.colors.primary,
    fontWeight: '800',
    fontSize: 13,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  legendDriver: {
    backgroundColor: '#ff7a00',
  },
  legendPending: {
    backgroundColor: '#f59e0b',
  },
  legendTransit: {
    backgroundColor: '#3b82f6',
  },
  legendDelivered: {
    backgroundColor: '#18b26b',
  },
  legendText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  map: {
    height: 320,
    borderRadius: theme.radius.lg,
  },
  callout: {
    maxWidth: 240,
    backgroundColor: '#17171d',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#2c2f3d',
  },
  calloutTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  calloutText: {
    color: '#d4d6de',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  calloutMeta: {
    color: '#ff9c4a',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  emptyState: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    gap: 6,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontWeight: '800',
    fontSize: 15,
  },
  emptyText: {
    color: theme.colors.muted,
    lineHeight: 20,
  },
  footer: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
