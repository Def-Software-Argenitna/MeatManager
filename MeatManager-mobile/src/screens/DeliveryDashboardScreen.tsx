import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OrderCard } from '../components/OrderCard';
import { useAuthSession } from '../hooks/useAuthSession';
import { useDeliveryTracking } from '../hooks/useDeliveryTracking';
import { theme } from '../theme';
import { LoginScreen } from './LoginScreen';
import { AdminDashboardScreen } from './AdminDashboardScreen';

export function DeliveryDashboardScreen() {
  const { user, profile, appMode, driverName, login, logout, isLoading, sessionError } = useAuthSession();
  const { orders, isTracking, permissionError, isRefreshing, lastSyncText, reload } =
    useDeliveryTracking(appMode === 'driver' ? driverName || null : null);
  const deliveredOrders = useMemo(() => orders.filter((order) => order.status === 'delivered'), [orders]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled'), [orders]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSubmit={async (email, password) => {
          return login(email, password);
        }}
      />
    );
  }

  if (sessionError) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <Text style={styles.centerTitle}>No pudimos validar tu acceso</Text>
          <Text style={styles.centerText}>{sessionError}</Text>
          <Pressable style={styles.centerButton} onPress={logout}>
            <Text style={styles.centerButtonText}>Cerrar sesion</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (appMode === 'admin' && profile) {
    return (
      <SafeAreaView style={styles.screen}>
        <AdminDashboardScreen profile={profile} />
      </SafeAreaView>
    );
  }

  if (appMode !== 'driver') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <Text style={styles.centerTitle}>Sin acceso movil habilitado</Text>
          <Text style={styles.centerText}>
            Este usuario no tiene permisos o licencias para usar esta app. Revisá el rol y las licencias asignadas en el panel web.
          </Text>
          <Pressable style={styles.centerButton} onPress={logout}>
            <Text style={styles.centerButtonText}>Cerrar sesion</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.cloudId}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={reload} tintColor={theme.colors.primary} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.hero}>
              <View style={styles.heroText}>
                <Text style={styles.eyebrow}>Turno activo</Text>
                <Text style={styles.title}>Hola, {driverName || user.email || 'Repartidor'}</Text>
                <Text style={styles.subtitle}>
                  {isTracking ? 'En linea y rastreando' : 'Seguimiento pausado'}
                </Text>
              </View>
              <Pressable style={styles.logoutButton} onPress={logout}>
                <Text style={styles.logoutButtonText}>Salir</Text>
              </Pressable>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Pendientes</Text>
                <Text style={styles.metricValue}>{pendingOrders.length}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Entregados</Text>
                <Text style={styles.metricValue}>{deliveredOrders.length}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Activos</Text>
                <Text style={styles.metricValue}>{orders.length}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Ultima sync</Text>
                <Text style={styles.metricValueSmall}>{lastSyncText}</Text>
              </View>
            </View>

            {permissionError ? (
              <Pressable
                style={styles.warningCard}
                onPress={() => Alert.alert('Seguimiento', permissionError || '')}
              >
                <Text style={styles.warningTitle}>Atencion con la sincronizacion</Text>
                <Text style={styles.warningText}>{permissionError}</Text>
              </Pressable>
            ) : null}

            <Text style={styles.sectionTitle}>Pedidos para entregar</Text>
            <Text style={styles.sectionSubtitle}>
              Los pedidos activos se sincronizan en tiempo real. Si el pedido ya informa pago o cobro pendiente, lo vas a ver dentro de la tarjeta.
            </Text>
          </View>
        }
        renderItem={({ item }) => <OrderCard order={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No hay pedidos activos</Text>
            <Text style={styles.emptyText}>
              Pendientes: {pendingOrders.length} · Entregados: {deliveredOrders.length}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingScreen: {
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
    backgroundColor: theme.colors.primary,
    borderRadius: 28,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroText: {
    flex: 1,
    paddingRight: 16,
    gap: 4,
  },
  eyebrow: {
    color: '#ffd1ad',
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
    color: '#ffe4cf',
    fontSize: 15,
    lineHeight: 22,
  },
  logoutButton: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  logoutButtonText: {
    color: theme.colors.white,
    fontWeight: '800',
  },
  metricsRow: {
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
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: theme.colors.muted,
    fontWeight: '700',
  },
  metricValue: {
    marginTop: 8,
    fontSize: 28,
    fontWeight: '900',
    color: theme.colors.text,
  },
  metricValueSmall: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: theme.colors.text,
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
  sectionSubtitle: {
    color: theme.colors.muted,
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
  centerCard: {
    margin: 18,
    marginTop: 40,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
  },
  centerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.colors.text,
  },
  centerText: {
    color: theme.colors.muted,
    lineHeight: 22,
  },
  centerButton: {
    marginTop: 8,
    minHeight: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButtonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
});
