import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KpiCard } from '../../components/KpiCard';
import { useAuth } from '../../context/AuthContext';
import type { DashboardSummary } from '../../data/types';
import { getDashboardSummary } from '../../services/dashboard';
import { globalStyles } from '../../theme/styles';
import { formatCompactNumber, formatCurrency } from '../../utils/format';

export function DashboardScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const nextSummary = await getDashboardSummary();
      setSummary(nextSummary);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <ScrollView
      style={globalStyles.screen}
      contentContainerStyle={[globalStyles.content, { paddingTop: insets.top + 12 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
    >
      <View style={styles.hero}>
        <Text style={globalStyles.title}>Hola, {user?.username?.split(' ')[0]}</Text>
        <Text style={globalStyles.subtitle}>
          Resumen ejecutivo para seguir ventas, caja y sucursales desde el celular.
        </Text>
      </View>

      <View style={styles.grid}>
        <KpiCard
          label="Ventas hoy"
          value={formatCurrency(summary?.salesToday || 0)}
          detail={`${formatCompactNumber(summary?.salesCountToday || 0)} tickets`}
        />
        <KpiCard
          label="Caja estimada"
          value={formatCurrency(summary?.cashInDrawer || 0)}
          detail="Ingresos manuales - egresos manuales"
        />
        <KpiCard
          label="Ventas del mes"
          value={formatCurrency(summary?.salesMonth || 0)}
          detail="Tenant completo"
        />
        <KpiCard
          label="Sucursales registradas"
          value={String(summary?.branchesCount || 0)}
          detail="Leídas desde settings.registered_branches"
        />
      </View>

      <View style={globalStyles.card}>
        <Text style={globalStyles.sectionTitle}>Caja del día</Text>
        <View style={globalStyles.rowBetween}>
          <Text style={styles.label}>Ingresos manuales</Text>
          <Text style={styles.positive}>{formatCurrency(summary?.manualIncomes || 0)}</Text>
        </View>
        <View style={globalStyles.rowBetween}>
          <Text style={styles.label}>Egresos manuales</Text>
          <Text style={styles.negative}>{formatCurrency(summary?.manualExpenses || 0)}</Text>
        </View>
        <Text style={styles.caption}>
          En el backend actual `caja_movimientos` no trae dimensión por sucursal. Por eso esta pantalla resume el tenant completo.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: 6
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12
  },
  label: {
    fontSize: 15
  },
  positive: {
    fontSize: 16,
    fontWeight: '900',
    color: '#2F7D4E'
  },
  negative: {
    fontSize: 16,
    fontWeight: '900',
    color: '#B64031'
  },
  caption: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#6F6258'
  }
});
