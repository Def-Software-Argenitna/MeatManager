import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeliveryDashboardScreen } from './src/screens/DeliveryDashboardScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DeliveryDashboardScreen />
    </SafeAreaProvider>
  );
}
