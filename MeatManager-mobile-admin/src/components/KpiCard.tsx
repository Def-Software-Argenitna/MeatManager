import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette } from '../theme/palette';

type Props = {
  label: string;
  value: string;
  detail?: string;
};

export function KpiCard({ label, value, detail }: Props) {
  return (
    <LinearGradient
      colors={['#FFF8ED', '#F4E4CD']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    minHeight: 132,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E7D2B4',
    justifyContent: 'space-between'
  },
  label: {
    color: palette.textMuted,
    fontSize: 13,
    fontWeight: '700'
  },
  value: {
    color: palette.primaryDark,
    fontSize: 24,
    fontWeight: '900'
  },
  detail: {
    color: palette.text,
    fontSize: 12
  }
});
