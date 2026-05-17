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
import { markOrderAsDelivered, registerOrderCollection } from '../services/deliveryService';
import type { DeliveryOrder } from '../types/delivery';
import { getOrderStatusColors, getOrderStatusLabel } from '../utils/orderStatus';

type Props = {
  order: DeliveryOrder;
};

export function OrderCard({ order }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(order.payment_method || '');
  const [collectionRegistered, setCollectionRegistered] = useState(order.paid === true);
  const statusColors = getOrderStatusColors(order.status);
  const requiresCollection = !collectionRegistered && (
    order.requires_collection === true
    || (order.paid !== true && String(order.payment_status || '').trim().toLowerCase() === 'pending_driver_collection')
    || ((order.amount_due || 0) > 0)
  );
  const paymentLabel = collectionRegistered || order.paid === true
    ? `Pago confirmado${selectedPaymentMethod ? ` · ${selectedPaymentMethod}` : (order.payment_method ? ` · ${order.payment_method}` : '')}`
    : String(order.payment_status || '').trim().toLowerCase() === 'pending_driver_collection'
      ? `Cobrar ${order.amount_due?.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }) || 'al entregar'}`
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
    if (requiresCollection) {
      Alert.alert('Cobro pendiente', 'Antes de confirmar la entrega tenés que registrar el cobro del pedido.');
      return;
    }

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

  const collectPayment = async () => {
    if (!selectedPaymentMethod.trim()) {
      Alert.alert('Elegí un medio de cobro', 'Seleccioná cómo te pagó el cliente antes de continuar.');
      return;
    }

    setIsCollecting(true);
    try {
      await registerOrderCollection(order.cloudId, selectedPaymentMethod, order.status);
      setCollectionRegistered(true);
      Alert.alert('Cobro registrado', `El pedido quedó marcado como cobrado por ${selectedPaymentMethod}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el cobro.';
      Alert.alert('Error', message);
    } finally {
      setIsCollecting(false);
    }
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

      {requiresCollection ? (
        <View style={styles.collectionBox}>
          <Text style={styles.collectionTitle}>Cobrar antes de entregar</Text>
          <Text style={styles.collectionSubtitle}>Elegí el medio con el que te pagó el cliente y registrá el cobro.</Text>
          <View style={styles.methodRow}>
            {['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta'].map((method) => (
              <Pressable
                key={method}
                style={[
                  styles.methodPill,
                  selectedPaymentMethod === method && styles.methodPillActive,
                ]}
                onPress={() => setSelectedPaymentMethod(method)}
              >
                <Text
                  style={[
                    styles.methodPillText,
                    selectedPaymentMethod === method && styles.methodPillTextActive,
                  ]}
                >
                  {method}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.collectButton,
              (!selectedPaymentMethod || isCollecting) && styles.collectButtonDisabled,
              pressed && styles.primaryButtonPressed,
            ]}
            disabled={!selectedPaymentMethod || isCollecting}
            onPress={collectPayment}
          >
            {isCollecting ? <ActivityIndicator color={theme.colors.white} /> : <Text style={styles.collectButtonText}>Registrar cobro</Text>}
          </Pressable>
        </View>
      ) : null}

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
          (order.status === 'delivered' || requiresCollection) && styles.primaryButtonDisabled,
          (pressed || isSubmitting) && styles.primaryButtonPressed,
        ]}
        disabled={isSubmitting || order.status === 'delivered' || requiresCollection}
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
  collectionBox: {
    backgroundColor: theme.colors.warningSoft,
    borderRadius: theme.radius.md,
    padding: 14,
    gap: 10,
  },
  collectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.text,
  },
  collectionSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.muted,
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  methodPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  methodPillActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  methodPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
  },
  methodPillTextActive: {
    color: theme.colors.white,
  },
  collectButton: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectButtonDisabled: {
    opacity: 0.55,
  },
  collectButtonText: {
    color: theme.colors.white,
    fontSize: 15,
    fontWeight: '800',
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
