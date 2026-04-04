import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { DashboardScreen } from './screens/DashboardScreen';
import { BranchesScreen } from './screens/BranchesScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { palette } from '../theme/palette';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function AdminTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 72,
          paddingTop: 8,
          paddingBottom: 8
        },
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
            Inicio: 'view-dashboard-outline',
            Sucursales: 'store-outline',
            Informes: 'chart-line'
          };

          return <MaterialCommunityIcons name={iconMap[route.name]} size={size} color={color} />;
        }
      })}
    >
      <Tab.Screen name="Inicio" component={DashboardScreen} />
      <Tab.Screen name="Sucursales" component={BranchesScreen} />
      <Tab.Screen name="Informes" component={ReportsScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="AdminTabs" component={AdminTabs} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
