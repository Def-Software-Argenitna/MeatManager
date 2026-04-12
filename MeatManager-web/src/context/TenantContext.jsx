import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { clearTokenCache, fetchInternalAdminClients, loginInternalAdmin } from '../utils/apiClient';

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

const isSupportSessionTenant = (tenant) => tenant?.authMode === 'support';

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
                setTenant((currentTenant) => {
                    if (isSupportSessionTenant(currentTenant)) {
                        return currentTenant;
                    }
                    sessionStorage.removeItem(SESSION_KEY);
                    sessionStorage.removeItem(TOKEN_KEY);
                    setAuthToken('');
                    return null;
                });
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
                if (!isSupportSessionTenant(tenant)) {
                    sessionStorage.removeItem(TOKEN_KEY);
                    setAuthToken('');
                }
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
    }, [tenant]);

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

    const loginSupport = async (identifier, password) => {
        try {
            const result = await loginInternalAdmin(identifier.trim(), password);
            const token = result?.token || '';
            const clientsPayload = await fetchInternalAdminClients(token);
            return {
                ok: true,
                token,
                admin: result?.admin || null,
                clients: clientsPayload?.clients || [],
            };
        } catch (error) {
            return { ok: false, error: error?.message || 'No se pudo iniciar sesión como SuperAdmin' };
        }
    };

    const activateSupportSession = async ({ token, admin, client }) => {
        if (!token || !admin || !client?.id) {
            return { ok: false, error: 'Faltan datos para ingresar al tenant' };
        }

        try {
            if (auth.currentUser) {
                await signOut(auth);
            }
        } catch {
            // Si Firebase no puede cerrar sesión igual continuamos con la sesión interna.
        }

        const nextTenant = {
            uid: `support-admin-${admin.id}`,
            email: admin.email || '',
            empresa: client.businessName || client.billingEmail || `Tenant ${client.id}`,
            clientId: client.id,
            taxId: client.taxId || '',
            status: client.status || '',
            authMode: 'support',
            supportAdmin: admin,
        };

        setTenant(nextTenant);
        setAuthToken(token);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextTenant));
        sessionStorage.setItem(TOKEN_KEY, token);
        return { ok: true };
    };

    const logout = async () => {
        try {
            if (!isSupportSessionTenant(tenant)) {
                await signOut(auth);
            }
        } finally {
            clearTokenCache();
            setTenant(null);
            setAuthToken('');
            sessionStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(TOKEN_KEY);
        }
    };

    const value = useMemo(() => ({
        tenant,
        login,
        loginSupport,
        activateSupportSession,
        logout,
        loading,
        authToken,
        isSupportSession: isSupportSessionTenant(tenant),
    }), [tenant, loading, authToken]);

    return (
        <TenantContext.Provider value={value}>
            {children}
        </TenantContext.Provider>
    );
};

export const useTenant = () => useContext(TenantContext);
