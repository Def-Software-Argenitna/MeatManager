import { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

import { auth } from '../config/firebase';
import { fetchCurrentMobileProfile } from '../services/mobileApi';
import type { MobileAccessProfile, MobileAppMode, MobileLicense } from '../types/session';

type LoginResult = {
  ok: boolean;
  error?: string;
};

const FEATURE_ALIASES: Record<string, string> = {
  logistics: 'logistica',
  logistica: 'logistica',
  delivery: 'logistica',
  deliveries: 'logistica',
  envios: 'logistica',
  shipping: 'logistica',
  entrega: 'logistica',
  entregas: 'logistica',
  reparto: 'logistica',
  repartos: 'logistica',
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

const normalizeToken = (value: unknown) => String(value || '').trim().toLowerCase();

const hasLogisticsToken = (token: string) =>
  token === 'logistica' ||
  token.includes('delivery') ||
  token.includes('logistic') ||
  token.includes('envio') ||
  token.includes('entrega') ||
  token.includes('repart');

const extractFeatureTokens = (value: MobileLicense['featureFlags']): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractFeatureTokens);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return extractFeatureTokens(JSON.parse(trimmed));
    } catch {
      return trimmed.includes(',') ? trimmed.split(',').flatMap(extractFeatureTokens) : [trimmed];
    }
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  }
  return [];
};

const hasLogisticsAccess = (profile: MobileAccessProfile | null) => {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (Array.isArray(profile.perms) && profile.perms.includes('/logistica')) return true;

  return (Array.isArray(profile.licenses) ? profile.licenses : []).some((license) => {
    const tokens = [
      normalizeToken(license.internalCode),
      normalizeToken(license.commercialName),
      normalizeToken(license.category),
      ...extractFeatureTokens(license.featureFlags).map(normalizeToken),
    ].filter(Boolean);

    return tokens.some((token) => FEATURE_ALIASES[token] === 'logistica' || hasLogisticsToken(token));
  });
};

const getDriverName = (user: User | null, profile: MobileAccessProfile | null) => {
  const profileName = String(profile?.username || '').trim();
  if (profileName) return profileName;

  const displayName = String(user?.displayName || '').trim();
  if (displayName) return displayName;

  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;

  return email.split('@')[0];
};

const getAppMode = (profile: MobileAccessProfile | null): MobileAppMode => {
  if (!profile) return 'restricted';
  if (profile.role === 'admin') return 'admin';
  if (hasLogisticsAccess(profile)) return 'driver';
  return 'restricted';
};

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<MobileAccessProfile | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setSessionError(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setSessionError(null);

      try {
        const nextProfile = await fetchCurrentMobileProfile();
        setProfile(nextProfile);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'No se pudo validar el acceso del usuario.';
        setProfile(null);
        setSessionError(message);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  return useMemo(
    () => ({
      user,
      profile,
      sessionError,
      isLoading,
      appMode: getAppMode(profile),
      driverName: getDriverName(user, profile),
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
    [isLoading, profile, sessionError, user],
  );
}
