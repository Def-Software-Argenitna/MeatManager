import React from 'react';
import {
  ActivityIndicator,
  FlatList,
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
          <Text style={styles.driverLocationValue}>{item.locationText || 'Sin tracking reciente'}</Text>
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
