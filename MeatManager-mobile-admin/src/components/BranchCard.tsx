import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BranchFinanceCard as BranchFinanceCardType } from '../data/types';
import { palette } from '../theme/palette';
import { formatCurrency, formatDateTime } from '../utils/format';

export function BranchCard({ branch }: { branch: BranchFinanceCardType }) {
  const pending = branch.status === 'pending_backend';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.branchCode}>Sucursal {branch.code}</Text>
          <Text style={styles.branchName}>{branch.name}</Text>
          <Text style={styles.location}>{branch.locality}</Text>
        </View>
        <View style={[styles.badge, pending ? styles.badgePending : styles.badgeConnected]}>
          <Text style={[styles.badgeText, pending ? styles.badgeTextPending : styles.badgeTextConnected]}>
            {pending ? 'Falta backend' : 'Conectada'}
          </Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <MaterialCommunityIcons name="account-tie" size={18} color={palette.secondary} />
        <Text style={styles.infoText}>{branch.manager}</Text>
      </View>
      <View style={styles.infoRow}>
        <MaterialCommunityIcons name="phone-outline" size={18} color={palette.secondary} />
        <Text style={styles.infoText}>{branch.phone}</Text>
      </View>

      <View style={styles.footer}>
        <View>
          <Text style={styles.metricLabel}>Caja</Text>
          <Text style={styles.metricValue}>
            {branch.cashBalance == null ? 'Pendiente' : formatCurrency(branch.cashBalance)}
          </Text>
        </View>
        <View>
          <Text style={styles.metricLabel}>Ventas hoy</Text>
          <Text style={styles.metricValue}>
            {branch.salesToday == null ? 'Pendiente' : formatCurrency(branch.salesToday)}
          </Text>
        </View>
      </View>

      <Text style={styles.syncText}>
        {branch.lastSync ? `Última sync ${formatDateTime(branch.lastSync)}` : 'Sin datos por sucursal en API actual'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 10
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  branchCode: {
    color: palette.accent,
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase'
  },
  branchName: {
    color: palette.text,
    fontWeight: '900',
    fontSize: 19
  },
  location: {
    color: palette.textMuted
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  badgePending: {
    backgroundColor: '#F9E8CA'
  },
  badgeConnected: {
    backgroundColor: '#D7F1E0'
  },
  badgeText: {
    fontWeight: '800',
    fontSize: 12
  },
  badgeTextPending: {
    color: palette.warning
  },
  badgeTextConnected: {
    color: palette.success
  },
  infoRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  infoText: {
    color: palette.text,
    fontSize: 14
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6
  },
  metricLabel: {
    color: palette.textMuted,
    fontSize: 12
  },
  metricValue: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '900'
  },
  syncText: {
    color: palette.textMuted,
    fontSize: 12
  }
});
