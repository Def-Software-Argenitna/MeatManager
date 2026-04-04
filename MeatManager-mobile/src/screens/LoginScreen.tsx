import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { theme } from '../theme';

type Props = {
  onSubmit: (name: string) => Promise<void> | void;
};

export function LoginScreen({ onSubmit }: Props) {
  const [name, setName] = useState('');

  const handleSubmit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    await onSubmit(normalizedName);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.heroCard}>
        <Text style={styles.kicker}>MeatManager Mobile</Text>
        <Text style={styles.title}>Portal de reparto</Text>
        <Text style={styles.description}>
          Ingresá tu nombre para ver tus pedidos asignados y compartir tu ubicacion en tiempo real.
        </Text>

        <TextInput
          autoCapitalize="words"
          autoCorrect={false}
          onChangeText={setName}
          placeholder="Ej: Juan"
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
          value={name}
        />

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={handleSubmit}>
          <Text style={styles.buttonText}>Comenzar turno</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.background,
  },
  heroCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 32,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  kicker: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    color: theme.colors.text,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.muted,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: theme.colors.text,
  },
  button: {
    minHeight: 54,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  buttonPressed: {
    opacity: 0.84,
  },
  buttonText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
});
