import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BranchCard } from '../../components/BranchCard';
import type { BranchFinanceCard } from '../../data/types';
import { getBranchFinanceCards } from '../../services/dashboard';
import { globalStyles } from '../../theme/styles';

export function BranchesScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchFinanceCard[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      setBranches(await getBranchFinanceCards());
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
        <Text style={globalStyles.title}>Sucursales y cajas</Text>
        <Text style={globalStyles.subtitle}>
          Directorio operativo de sucursales registrado en `settings.registered_branches`.
        </Text>
      </View>

      <View style={globalStyles.card}>
        <Text style={globalStyles.sectionTitle}>Estado de integración</Text>
        <Text style={globalStyles.subtitle}>
          La web actual ya guarda sucursales y exporta snapshots locales, pero el backend todavía no expone saldos y movimientos por sucursal.
        </Text>
      </View>

      {branches.map((branch) => (
        <BranchCard key={branch.code} branch={branch} />
      ))}
    </ScrollView>
  );
}
