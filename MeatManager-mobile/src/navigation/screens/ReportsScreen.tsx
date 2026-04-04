import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SalesReport } from '../../data/types';
import { getSalesReports } from '../../services/dashboard';
import { palette } from '../../theme/palette';
import { globalStyles } from '../../theme/styles';
import { formatCurrency } from '../../utils/format';

export function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<SalesReport[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      setReports(await getSalesReports());
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
      <View>
        <Text style={globalStyles.title}>Informes</Text>
        <Text style={globalStyles.subtitle}>
          KPIs comerciales armados desde `ventas` y `caja_movimientos` del tenant actual.
        </Text>
      </View>

      {reports.map((report) => (
        <View key={report.title} style={styles.card}>
          <View style={globalStyles.rowBetween}>
            <Text style={styles.title}>{report.title}</Text>
            <Text style={styles.variation}>{report.variation}</Text>
          </View>
          <Text style={styles.value}>{formatCurrency(report.value)}</Text>
        </View>
      ))}

      <View style={globalStyles.card}>
        <Text style={globalStyles.sectionTitle}>Siguiente paso recomendado</Text>
        <Text style={globalStyles.subtitle}>
          Crear endpoints agregados por sucursal para ventas, caja y stock. Con eso esta misma app puede pasar de MVP ejecutivo a tablero operativo real por sucursal.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 12
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: palette.text
  },
  variation: {
    color: palette.secondary,
    fontWeight: '800'
  },
  value: {
    color: palette.primaryDark,
    fontSize: 28,
    fontWeight: '900'
  }
});
