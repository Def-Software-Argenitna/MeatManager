import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { palette } from '../../theme/palette';

export function LoginScreen() {
  const { signIn, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async () => {
    try {
      await signIn(email, password);
    } catch (error) {
      Alert.alert('No se pudo iniciar sesión', error instanceof Error ? error.message : 'Error desconocido');
    }
  };

  return (
    <LinearGradient colors={['#EADBC5', '#F6F0E5', '#FFFDF9']} style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>MeatManager</Text>
        <Text style={styles.title}>Administrador Mobile</Text>
        <Text style={styles.subtitle}>
          Acceso para dueños y administradores con visión rápida de cajas, sucursales e informes.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="admin@cliente.com"
          placeholderTextColor={palette.textMuted}
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={palette.textMuted}
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />

        <Pressable onPress={handleSubmit} style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }]}>
          <Text style={styles.buttonText}>{loading ? 'Ingresando...' : 'Entrar'}</Text>
        </Pressable>

        <Text style={styles.helper}>
          Usa el mismo Firebase Auth y el mismo backend multi-tenant que ya tiene MeatManager Web.
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24
  },
  hero: {
    gap: 8
  },
  kicker: {
    color: palette.primary,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2
  },
  title: {
    color: palette.text,
    fontSize: 36,
    fontWeight: '900'
  },
  subtitle: {
    color: palette.textMuted,
    lineHeight: 22
  },
  card: {
    backgroundColor: 'rgba(255,253,249,0.96)',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 24,
    padding: 20,
    gap: 12
  },
  label: {
    color: palette.text,
    fontWeight: '700'
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: palette.text
  },
  button: {
    marginTop: 8,
    backgroundColor: palette.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 16
  },
  helper: {
    marginTop: 6,
    color: palette.textMuted,
    lineHeight: 19
  }
});
