import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';

const SESSION_KEY = 'mm_tenant';
const TOKEN_KEY = 'mm_auth_token';

const TenantContext = createContext(null);

const restoreTenant = () => {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const mapFirebaseUserToTenant = (user) => ({
    uid: user.uid,
    email: user.email || '',
    empresa: user.displayName || user.email || '',
});

export const TenantProvider = ({ children }) => {
    const [tenant, setTenant] = useState(restoreTenant);
    const [loading, setLoading] = useState(true);
    const [authToken, setAuthToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                setTenant(null);
                sessionStorage.removeItem(SESSION_KEY);
                sessionStorage.removeItem(TOKEN_KEY);
                setLoading(false);
                return;
            }

            try {
                const token = await user.getIdToken();
                if (token) {
                    sessionStorage.setItem(TOKEN_KEY, token);
                    setAuthToken(token);
                }
                const nextTenant = mapFirebaseUserToTenant(user);
                setTenant(nextTenant);
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextTenant));
            } catch (error) {
                console.error('[TENANT BOOTSTRAP ERROR]', error);
                const nextTenant = mapFirebaseUserToTenant(user);
                setTenant(nextTenant);
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextTenant));
            } finally {
                setLoading(false);
            }
        });

        return unsubscribe;
    }, []);

    useEffect(() => {
        const unsubscribe = onIdTokenChanged(auth, async (user) => {
            if (!user) {
                sessionStorage.removeItem(TOKEN_KEY);
                setAuthToken('');
                return;
            }

            try {
                const token = await user.getIdToken();
                if (token) {
                    sessionStorage.setItem(TOKEN_KEY, token);
                    setAuthToken(token);
                }
            } catch (error) {
                console.error('[AUTH TOKEN REFRESH ERROR]', error);
            }
        });

        return unsubscribe;
    }, []);

    const login = async (email, password) => {
        try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
            return { ok: true };
        } catch (err) {
            const code = err?.code || '';
            if (
                code === 'auth/invalid-credential' ||
                code === 'auth/user-not-found' ||
                code === 'auth/wrong-password' ||
                code === 'auth/invalid-login-credentials'
            ) {
                return { ok: false, error: 'Email o contraseña incorrectos' };
            }
            if (code === 'auth/too-many-requests') {
                return { ok: false, error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };
            }
            if (code === 'auth/network-request-failed') {
                return { ok: false, error: 'Sin conexión con Firebase. Verificá internet e intentá de nuevo.' };
            }
            return { ok: false, error: err?.message || 'No se pudo iniciar sesión' };
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
        } finally {
            setTenant(null);
            setAuthToken('');
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(TOKEN_KEY);
        }
    };

    const value = useMemo(() => ({
        tenant,
        login,
        logout,
        loading,
        authToken,
    }), [tenant, loading, authToken]);

    return (
        <TenantContext.Provider value={value}>
            {children}
        </TenantContext.Provider>
    );
};

export const useTenant = () => useContext(TenantContext);
