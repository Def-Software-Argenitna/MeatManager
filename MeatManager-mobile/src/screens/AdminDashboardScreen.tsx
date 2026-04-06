import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAdminDashboard } from '../hooks/useAdminDashboard';
import { theme } from '../theme';
import type { MobileAccessProfile } from '../types/session';

type Props = {
  profile: MobileAccessProfile;
  onLogout: () => Promise<void> | void;
};

const currency = (value: number) =>
  value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const openDriverMap = async (latitude: number | null, longitude: number | null) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  await Linking.openURL(url);
};

export function AdminDashboardScreen({ profile, onLogout }: Props) {
  const {
    isLoading,
    error,
    selectedBranchCode,
    selectedBranchName,
    branchOptions,
    setSelectedBranchCode,
    salesTodayTotal,
    salesMonthTotal,
    salesTodayCount,
    cashInDrawerTotal,
    pendingDeliveries,
    deliveredOrders,
    drivers,
    cashClosures,
    reload,
  } = useAdminDashboard();

  if (isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={drivers}
      keyExtractor={(item) => item.name}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={reload} tintColor={theme.colors.primary} />}
      ListHeaderComponent={
        <View style={styles.headerBlock}>
          <View style={styles.hero}>
            <View style={styles.heroHeader}>
              <View style={styles.heroText}>
                <Text style={styles.eyebrow}>Panel admin</Text>
                <Text style={styles.title}>{profile.username || 'Administracion'}</Text>
                <Text style={styles.subtitle}>Caja, ventas y seguimiento del tenant en un solo lugar.</Text>
              </View>
              <Pressable style={styles.logoutButton} onPress={onLogout}>
                <Text style={styles.logoutButtonText}>Salir</Text>
              </Pressable>
            </View>
            <View style={styles.branchSelector}>
              {branchOptions.map((branch) => (
                <Pressable
                  key={branch.code}
                  style={[
                    styles.branchPill,
                    selectedBranchCode === branch.code && styles.branchPillActive,
                  ]}
                  onPress={() => setSelectedBranchCode(branch.code)}
                >
                  <Text
                    style={[
                      styles.branchPillText,
                      selectedBranchCode === branch.code && styles.branchPillTextActive,
                    ]}
                  >
                    {branch.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Caja actual</Text>
              <Text style={styles.metricValue}>{currency(cashInDrawerTotal)}</Text>
              <Text style={styles.metricHint}>{selectedBranchName}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Ventas hoy</Text>
              <Text style={styles.metricValue}>{currency(salesTodayTotal)}</Text>
              <Text style={styles.metricHint}>{salesTodayCount} tickets</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Ventas del mes</Text>
              <Text style={styles.metricValue}>{currency(salesMonthTotal)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Logistica</Text>
              <Text style={styles.metricValue}>{pendingDeliveries}</Text>
              <Text style={styles.metricHint}>{deliveredOrders} entregados</Text>
            </View>
          </View>

          {error ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>Atencion</Text>
              <Text style={styles.warningText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Ultimos cierres de caja</Text>
          <View style={styles.closuresList}>
            {cashClosures.length > 0 ? (
              cashClosures.map((closure) => (
                <View key={closure.id} style={styles.closureCard}>
                  <View style={styles.closureHeader}>
                    <View>
                      <Text style={styles.closureTitle}>{closure.branchName}</Text>
                      <Text style={styles.closureMeta}>{closure.closureDate}</Text>
                      {closure.closedAtText ? <Text style={styles.closureMeta}>{closure.closedAtText}</Text> : null}
                    </View>
                    <Text style={[styles.closureDiff, closure.difference >= 0 ? styles.closureDiffPositive : styles.closureDiffNegative]}>
                      {closure.difference >= 0 ? '+' : ''}{currency(closure.difference)}
                    </Text>
                  </View>
                  <View style={styles.closureStatsRow}>
                    <View style={styles.closureStat}>
                      <Text style={styles.closureStatLabel}>Teorico</Text>
                      <Text style={styles.closureStatValue}>{currency(closure.theoreticalCash)}</Text>
                    </View>
                    <View style={styles.closureStat}>
                      <Text style={styles.closureStatLabel}>Contado</Text>
                      <Text style={styles.closureStatValue}>{currency(closure.countedCash)}</Text>
                    </View>
                    <View style={styles.closureStat}>
                      <Text style={styles.closureStatLabel}>Ventas</Text>
                      <Text style={styles.closureStatValue}>{currency(closure.totalSales)}</Text>
                    </View>
                  </View>
                  {closure.notes ? <Text style={styles.closureNotes}>{closure.notes}</Text> : null}
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Sin cierres recientes</Text>
                <Text style={styles.emptyText}>Los nuevos cierres de caja se van a listar aca segun la sucursal seleccionada.</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>Repartidores</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.driverCard}>
          <View style={styles.driverHeader}>
            <View>
              <Text style={styles.driverName}>{item.name}</Text>
              <Text style={styles.driverVehicle}>{item.vehicle || 'Sin vehiculo cargado'}</Text>
            </View>
            <View style={[styles.statusPill, item.online ? styles.onlinePill : styles.offlinePill]}>
              <Text style={[styles.statusPillText, { color: item.online ? theme.colors.success : theme.colors.muted }]}>
                {item.online ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.driverStatsRow}>
            <View style={styles.driverStat}>
              <Text style={styles.driverStatValue}>{item.pendingCount}</Text>
              <Text style={styles.driverStatLabel}>Pendientes</Text>
            </View>
            <View style={styles.driverStat}>
              <Text style={styles.driverStatValue}>{item.deliveredCount}</Text>
              <Text style={styles.driverStatLabel}>Entregados</Text>
            </View>
            <View style={styles.driverStat}>
              <Text style={styles.driverStatValue}>{item.activeOrderCount}</Text>
              <Text style={styles.driverStatLabel}>Activos</Text>
            </View>
          </View>

          <Text style={styles.driverLocationLabel}>Ultima ubicacion</Text>
          {item.locationText ? (
            <Pressable
              style={styles.mapCard}
              onPress={() => openDriverMap(item.latitude, item.longitude)}
            >
              <View style={styles.mapCardRow}>
                <View style={styles.mapPin} />
                <View style={styles.mapTextBlock}>
                  <Text style={styles.driverLocationValue}>{item.locationText}</Text>
                  <Text style={styles.driverLocationMeta}>
                    {item.lastSyncText || 'Sin horario de sincronizacion'}
                  </Text>
                </View>
                <Text style={styles.mapAction}>Ver mapa</Text>
              </View>
            </Pressable>
          ) : (
            <Text style={styles.driverLocationValue}>Sin tracking reciente</Text>
          )}
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No hay repartidores cargados</Text>
          <Text style={styles.emptyText}>Cuando haya choferes y pedidos asignados, los vas a ver aca.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 18,
    paddingBottom: 32,
  },
  headerBlock: {
    gap: 14,
    marginBottom: 18,
  },
  hero: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.lg,
    padding: 22,
    gap: 6,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
  },
  heroText: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.white,
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.muted,
    lineHeight: 22,
    fontSize: 15,
  },
  logoutButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  logoutButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  branchSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  branchPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  branchPillActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  branchPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
  },
  branchPillTextActive: {
    color: theme.colors.white,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: '48%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metricLabel: {
    color: theme.colors.muted,
    textTransform: 'uppercase',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 8,
  },
  metricHint: {
    color: theme.colors.muted,
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
  },
  warningCard: {
    borderRadius: theme.radius.md,
    padding: 16,
    backgroundColor: theme.colors.warningSoft,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  warningTitle: {
    color: theme.colors.warning,
    fontWeight: '800',
    marginBottom: 4,
  },
  warningText: {
    color: theme.colors.text,
    lineHeight: 21,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: theme.colors.text,
    marginTop: 4,
  },
  closuresList: {
    gap: 12,
  },
  closureCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  closureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
  },
  closureTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  closureMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  closureDiff: {
    fontSize: 15,
    fontWeight: '900',
  },
  closureDiffPositive: {
    color: theme.colors.success,
  },
  closureDiffNegative: {
    color: theme.colors.danger,
  },
  closureStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  closureStat: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 12,
  },
  closureStatLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  closureStatValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  closureNotes: {
    color: theme.colors.muted,
    lineHeight: 20,
  },
  driverCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  driverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
  },
  driverName: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
  },
  driverVehicle: {
    marginTop: 4,
    color: theme.colors.muted,
    fontSize: 14,
  },
  statusPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  onlinePill: {
    backgroundColor: theme.colors.successSoft,
  },
  offlinePill: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  driverStatsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  driverStat: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 12,
    alignItems: 'center',
  },
  driverStatValue: {
    fontSize: 20,
    fontWeight: '900',
    color: theme.colors.text,
  },
  driverStatLabel: {
    fontSize: 12,
    marginTop: 4,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  driverLocationLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  driverLocationValue: {
    color: theme.colors.text,
    lineHeight: 21,
  },
  driverLocationMeta: {
    color: theme.colors.muted,
    lineHeight: 18,
    marginTop: 4,
    fontSize: 13,
  },
  mapCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  mapCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mapPin: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  mapTextBlock: {
    flex: 1,
  },
  mapAction: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 22,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    color: theme.colors.muted,
    lineHeight: 22,
  },
});
