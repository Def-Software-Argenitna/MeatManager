import { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

import { auth } from '../config/firebase';

type LoginResult = {
  ok: boolean;
  error?: string;
};

const mapFirebaseError = (code?: string) => {
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-login-credentials'
  ) {
    return 'Email o contrasena incorrectos';
  }

  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Proba de nuevo en unos minutos.';
  }

  if (code === 'auth/network-request-failed') {
    return 'Sin conexion con Firebase. Verifica internet e intenta de nuevo.';
  }

  return 'No se pudo iniciar sesion';
};

const getDriverNameFromUser = (user: User | null) => {
  if (!user) return null;

  const displayName = String(user.displayName || '').trim();
  if (displayName) return displayName;

  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return null;

  return email.split('@')[0];
};

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  return useMemo(
    () => ({
      user,
      isLoading,
      driverName: getDriverNameFromUser(user),
      login: async (email: string, password: string): Promise<LoginResult> => {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
          return { ok: true };
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
          return { ok: false, error: mapFirebaseError(code) };
        }
      },
      logout: async () => {
        await signOut(auth);
      },
    }),
    [isLoading, user],
  );
}
