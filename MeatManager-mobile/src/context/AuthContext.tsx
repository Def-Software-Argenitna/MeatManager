import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { UserProfile } from '../data/types';
import { loginWithEmail, logoutSession, restoreSession } from '../services/auth';

type AuthContextValue = {
  user: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    restoreSession()
      .then((storedUser) => {
        if (storedUser) setUser(storedUser);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async signIn(email: string, password: string) {
      setLoading(true);
      try {
        const nextUser = await loginWithEmail(email, password);
        if (nextUser.role !== 'admin') {
          throw new Error('Esta app está pensada para usuarios administradores.');
        }
        setUser(nextUser);
      } finally {
        setLoading(false);
      }
    },
    async signOut() {
      setLoading(true);
      try {
        await logoutSession();
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
}
