import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { theme } from '../theme';
import { markOrderAsDelivered } from '../services/deliveryService';
import type { DeliveryOrder } from '../types/delivery';
import { getOrderStatusColors, getOrderStatusLabel } from '../utils/orderStatus';

type Props = {
  order: DeliveryOrder;
};

export function OrderCard({ order }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const statusColors = getOrderStatusColors(order.status);
  const paymentLabel = order.paid === true
    ? 'Pago confirmado'
    : order.payment_status
      ? String(order.payment_status)
      : order.amount_due && order.amount_due > 0
        ? `Cobrar ${order.amount_due.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}`
        : order.payment_method
          ? `Medio: ${order.payment_method}`
          : 'Cobro no informado';

  const openMaps = async () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;
    await Linking.openURL(url);
  };

  const callCustomer = async () => {
    if (!order.customer_phone) {
      Alert.alert('Sin telefono', 'Este pedido no tiene telefono de contacto.');
      return;
    }

    await Linking.openURL(`tel:${order.customer_phone}`);
  };

  const confirmDelivery = () => {
    Alert.alert('Confirmar entrega', `Marcar el pedido de ${order.customer_name} como entregado?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          setIsSubmitting(true);
          try {
            await markOrderAsDelivered(order.cloudId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'No se pudo actualizar el pedido.';
            Alert.alert('Error', message);
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.orderId}>#{order.id || order.cloudId}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColors.background }]}>
          <Text style={[styles.statusText, { color: statusColors.text }]}>
            {getOrderStatusLabel(order.status)}
          </Text>
        </View>
      </View>

      <Text style={styles.customerName}>{order.customer_name}</Text>

      <View style={styles.paymentBox}>
        <Text style={styles.paymentLabel}>Cobro</Text>
        <Text style={styles.paymentValue}>{paymentLabel}</Text>
      </View>

      <Text style={styles.addressLabel}>Direccion</Text>
      <Text style={styles.addressText}>{order.address || 'Sin direccion cargada'}</Text>

      <View style={styles.detailBox}>
        <Text style={styles.detailTitle}>Detalle del pedido</Text>
        <Text style={styles.detailText}>{order.items || 'Sin detalle disponible'}</Text>
      </View>

      <View style={styles.actionsRow}>
        <Pressable style={[styles.secondaryButton, styles.mapButton]} onPress={openMaps}>
          <Text style={styles.secondaryButtonText}>Abrir GPS</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, styles.callButton]} onPress={callCustomer}>
          <Text style={styles.secondaryButtonText}>Llamar</Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          order.status === 'delivered' && styles.primaryButtonDisabled,
          (pressed || isSubmitting) && styles.primaryButtonPressed,
        ]}
        disabled={isSubmitting || order.status === 'delivered'}
        onPress={confirmDelivery}
      >
        {isSubmitting ? (
          <ActivityIndicator color={theme.colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>
            {order.status === 'delivered' ? 'Pedido entregado' : 'Marcar como entregado'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderId: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.primary,
  },
  statusPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  customerName: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.colors.text,
  },
  paymentBox: {
    backgroundColor: theme.colors.successSoft,
    borderRadius: theme.radius.md,
    padding: 14,
    gap: 6,
  },
  paymentLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.success,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  paymentValue: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: theme.colors.text,
  },
  addressLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  addressText: {
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.text,
  },
  detailBox: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    gap: 8,
  },
  detailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  mapButton: {
    backgroundColor: theme.colors.infoSoft,
  },
  callButton: {
    backgroundColor: theme.colors.warningSoft,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.8,
  },
  primaryButtonDisabled: {
    backgroundColor: theme.colors.muted,
  },
  primaryButtonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
});
