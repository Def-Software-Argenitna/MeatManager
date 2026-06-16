
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useTenant } from './TenantContext';
import {
    createFirebaseUser,
    deleteFirebaseUser,
    fetchCurrentFirebaseUser,
    fetchClientBranches,
    fetchFirebaseUsers,
    replaceUserPermissions as replaceFirebaseUserPermissions,
    updateFirebaseUser,
} from '../utils/apiClient';
import { auth } from '../firebase';

// All navigable routes — used for permission management
export const ALL_ROUTES = [
    { path: '/',                        label: 'Dashboard',         group: 'Principal' },
    { path: '/ventas',                  label: 'Ventas',            group: 'Principal' },
    { path: '/ventas/historial',        label: 'Historial Ventas',  group: 'Principal' },
    { path: '/caja',                    label: 'Caja',              group: 'Principal' },
    { path: '/cierre-caja',             label: 'Caja (legado)',     group: 'Principal' },
    { path: '/compras',                 label: 'Compras',           group: 'Principal' },
    { path: '/stock',                   label: 'Stock',             group: 'Principal' },
    { path: '/clientes',                label: 'Clientes',          group: 'Principal' },
    { path: '/pedidos',                 label: 'Pedidos',           group: 'Principal' },
    { path: '/logistica',               label: 'Logística',         group: 'Principal' },
    { path: '/sucursales',              label: 'Sucursales',        group: 'Principal' },
    { path: '/menu-digital',            label: 'Menú Digital',      group: 'Principal' },
    { path: '/informes-pro',            label: 'Rendimiento PRO',   group: 'Principal' },
    { path: '/alimentos',               label: 'Pre-elaborados',    group: 'Principal' },
    { path: '/otros',                   label: 'Otros Items',       group: 'Principal' },
    { path: '/despostada/vaca',         label: 'Despostada Vaca',   group: 'Despostada' },
    { path: '/despostada/cerdo',        label: 'Despostada Cerdo',  group: 'Despostada' },
    { path: '/despostada/pollo',        label: 'Despostada Pollo',  group: 'Despostada' },
    { path: '/despostada/pescado',      label: 'Despostada Pescado',group: 'Despostada' },
    { path: '/config/pagos',            label: 'Medios de Pago',    group: 'Configuración' },
    { path: '/config/categorias',       label: 'Categorías',        group: 'Configuración' },
    { path: '/config/productos-compra', label: 'Artículos',         group: 'Configuración' },
    { path: '/config/promociones',      label: 'Promociones',       group: 'Configuración' },
    { path: '/config/whatsapp-marketing', label: 'Marketing WhatsApp', group: 'Configuración' },
    { path: '/config/proveedores',      label: 'Proveedores',       group: 'Configuración' },
    { path: '/config/sucursales-transfer', label: 'Transferencias Sucursales', group: 'Configuración' },
    { path: '/config/balanza',          label: 'Balanza',           group: 'Configuración' },
    { path: '/config/seguridad',        label: 'Usuarios y Licencias',group: 'Configuración' },
    { path: '/manual',                  label: 'Manual de Usuario', group: 'Configuración' },
];

const ALL_PATHS = ALL_ROUTES.map(r => r.path);

const UserContext = createContext(null);
const ACTIVE_BRANCH_KEY = 'mm_active_branch';
const ADMIN_GLOBAL_KEY = 'mm_admin_global';

const normalizeToken = (value) => String(value || '').trim().toLowerCase();
const normalizeLicenseKey = (value) => normalizeToken(value).replace(/[^a-z0-9]/g, '');

const normalizeUserLicense = (license) => ({
    ...license,
    clientLicenseId: license?.clientLicenseId ?? license?.id ?? null,
    hasLogisticsCapability: Boolean(
        license?.hasLogisticsCapability
        || license?.license?.hasLogisticsCapability
    ),
});

const isSuperUserLicense = (license) => {
    const candidates = [
        normalizeLicenseKey(license?.internalCode),
        normalizeLicenseKey(license?.commercialName),
        normalizeLicenseKey(license?.category),
    ].filter(Boolean);

    return candidates.some((token) => (
        token === 'su' ||
        token === 'superuser' ||
        token.includes('superuser')
    ));
};

const hasSuperUserLicense = (licenses, options = {}) => {
    const list = Array.isArray(licenses) ? licenses : [];
    const currentUserId = String(options.currentUserId || '');
    const isOwnerFallback = Boolean(options.isOwnerFallback);

    return list.some((license) => (
        isSuperUserLicense(license)
        && (
            isOwnerFallback
            || String(license?.assignedUserId || '') === currentUserId
        )
    ));
};

export const isEffectiveAdminUser = (currentUser, accessProfile) => Boolean(
    currentUser?.role === 'admin'
    || hasSuperUserLicense(accessProfile?.licenses, {
        role: currentUser?.role,
        currentUserId: currentUser?.id,
        isOwnerFallback: accessProfile?.isOwnerFallback,
    })
);

const restoreSession = () => {
    try {
        const u = sessionStorage.getItem('mm_user');
        const p = sessionStorage.getItem('mm_perms');
        const a = sessionStorage.getItem('mm_access_profile');
        const b = sessionStorage.getItem(ACTIVE_BRANCH_KEY);
        const g = sessionStorage.getItem(ADMIN_GLOBAL_KEY);
        
        const user = u ? JSON.parse(u) : null;
        const perms = p ? JSON.parse(p) : [];
        const accessProfile = a ? JSON.parse(a) : null;
        let activeBranch = b ? JSON.parse(b) : null;
        const adminGlobalMode = g === 'true';
        
        if (!activeBranch && accessProfile?.branch?.id) {
            activeBranch = accessProfile.branch;
        }
        
        return {
            user,
            perms,
            accessProfile,
            activeBranch,
            adminGlobalMode,
        };
    } catch {
        return { user: null, perms: [], accessProfile: null, activeBranch: null, adminGlobalMode: false };
    }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const UserProvider = ({ children }) => {
    const { tenant, loading: loadingTenant, authToken } = useTenant();
    const { user: savedUser, perms: savedPerms, accessProfile: savedAccessProfile, activeBranch: savedActiveBranch, adminGlobalMode: savedAdminGlobalMode } = restoreSession();
    const [currentUser, setCurrentUser] = useState(savedUser);
    const [userPerms, setUserPerms] = useState(savedPerms);
    const [accessProfile, setAccessProfile] = useState(savedAccessProfile);
    const [activeBranch, setActiveBranch] = useState(savedActiveBranch);
    const [adminGlobalMode, setAdminGlobalModeRaw] = useState(savedAdminGlobalMode);
    const [loadingUser, setLoadingUser] = useState(false);
    const [users, setUsers] = useState([]);
    const [licensePool, setLicensePool] = useState([]);
    const profileRecoveryRef = useRef('');

    const applyResolvedUser = useCallback((userData) => {
        const perms = (userData?.role === 'admin') ? ALL_PATHS : (userData?.perms || []);
        
        // Determinar la sucursal activa
        let activeBranchToUse = null;
        
        if (userData?.role === 'admin') {
            const savedAdminGlobal = sessionStorage.getItem(ADMIN_GLOBAL_KEY) === 'true';
            if (savedAdminGlobal) {
                activeBranchToUse = null;
            } else {
                const savedBranch = (() => {
                    try {
                        const raw = sessionStorage.getItem(ACTIVE_BRANCH_KEY);
                        return raw ? JSON.parse(raw) : null;
                    } catch {
                        return null;
                    }
                })();
                const canUseSavedBranch = (
                    savedBranch?.id
                    && (!savedBranch?.clientId || String(savedBranch.clientId) === String(userData?.clientId || ''))
                );
                activeBranchToUse = canUseSavedBranch ? savedBranch : (userData?.branch || null);
            }
        } else {
            // Para usuarios normales: SIEMPRE usar la sucursal que viene del API
            activeBranchToUse = userData?.branch || null;
        }
        
        const effectiveUserData = {
            ...userData,
            branch: activeBranchToUse,
        };
        const sessionUser = {
            id: effectiveUserData?.id || effectiveUserData?.uid || effectiveUserData?.email,
            uid: effectiveUserData?.uid || null,
            email: effectiveUserData?.email,
            username: effectiveUserData?.username || effectiveUserData?.empresa || effectiveUserData?.email,
            role: effectiveUserData?.role || 'employee',
        };
        setCurrentUser(sessionUser);
        setUserPerms(perms);
        setAccessProfile(effectiveUserData);
        setActiveBranch(activeBranchToUse);
        
        // Guardar la sucursal activa en sessionStorage
        if (activeBranchToUse) {
            sessionStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(activeBranchToUse));
        } else if (userData?.role !== 'admin') {
            // Solo limpiar si NO es admin y no tiene sucursal
            sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        }
        
        sessionStorage.setItem('mm_user', JSON.stringify(sessionUser));
        sessionStorage.setItem('mm_perms', JSON.stringify(perms));
        sessionStorage.setItem('mm_access_profile', JSON.stringify(effectiveUserData));
        return { ok: true };
    }, []);

    const applyOwnerFallback = useCallback(({ uid, email }) => {
        const ownerSession = {
            id: uid || email,
            uid: uid || null,
            email,
            username: tenant?.empresa || email,
            role: 'admin',
        };
        const fallbackProfile = {
            ...ownerSession,
            active: 1,
            perms: ALL_PATHS,
            licenses: [],
        };
        setCurrentUser(ownerSession);
        setUserPerms(ALL_PATHS);
        setAccessProfile(fallbackProfile);
        setActiveBranch(null);
        sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        sessionStorage.setItem('mm_user', JSON.stringify(ownerSession));
        sessionStorage.setItem('mm_perms', JSON.stringify(ALL_PATHS));
        sessionStorage.setItem('mm_access_profile', JSON.stringify(fallbackProfile));
        return { ok: true };
    }, [tenant]);

    const resolveRemoteUserProfile = useCallback(async () => {
        const maxAttempts = 4;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                if (auth.currentUser) {
                    await auth.currentUser.getIdToken(attempt > 0);
                }

                const payload = await fetchCurrentFirebaseUser();
                if (payload?.user) {
                    return payload.user;
                }
            } catch (error) {
                if (attempt === maxAttempts - 1) {
                    throw error;
                }
            }

            await delay(250 * (attempt + 1));
        }

        return null;
    }, []);

    const login = useCallback(async ({ uid, email }) => {
        setLoadingUser(true);
        try {
            const userData = await resolveRemoteUserProfile();
            if (!userData) {
                if (tenant?.email && email === tenant.email) {
                    return applyOwnerFallback({ uid, email });
                }
                return { ok: false, error: 'Usuario inactivo o no encontrado' };
            }
            if (!userData.active) return { ok: false, error: 'Usuario inactivo o no encontrado' };
            return applyResolvedUser(userData);
        } catch (error) {
            if (tenant?.email && email === tenant.email) {
                try {
                    const retryUser = await resolveRemoteUserProfile();
                    if (retryUser) {
                        return applyResolvedUser(retryUser);
                    }
                } catch {
                    // Fall back to the local owner session only after exhausting authenticated retries.
                }
                return applyOwnerFallback({ uid, email });
            }
            return { ok: false, error: error?.message || 'Usuario inactivo o no encontrado' };
        } finally {
            setLoadingUser(false);
        }
    }, [applyOwnerFallback, applyResolvedUser, resolveRemoteUserProfile, tenant]);

    const logout = useCallback(() => {
        setCurrentUser(null);
        setUserPerms([]);
        setAccessProfile(null);
        setActiveBranch(null);
        setAdminGlobalModeRaw(false);
        setUsers([]);
        setLicensePool([]);
        sessionStorage.removeItem('mm_user');
        sessionStorage.removeItem('mm_perms');
        sessionStorage.removeItem('mm_access_profile');
        sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        sessionStorage.removeItem(ADMIN_GLOBAL_KEY);
    }, []);

    const setAdminGlobalMode = useCallback((mode) => {
        setAdminGlobalModeRaw(mode);
        if (mode) {
            sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
            setActiveBranch(null);
            sessionStorage.setItem(ADMIN_GLOBAL_KEY, 'true');
            setAccessProfile((currentProfile) => {
                if (!currentProfile) return currentProfile;
                const nextProfile = { ...currentProfile, branch: null };
                sessionStorage.setItem('mm_access_profile', JSON.stringify(nextProfile));
                return nextProfile;
            });
        } else {
            sessionStorage.setItem(ADMIN_GLOBAL_KEY, 'false');
        }
    }, []);

    const selectActiveBranch = useCallback((branch) => {
        // When selecting a specific branch, exit global mode
        setAdminGlobalModeRaw(false);
        sessionStorage.setItem(ADMIN_GLOBAL_KEY, 'false');
        const normalizedBranch = branch?.id ? {
            id: Number(branch.id),
            clientId: branch.clientId ?? accessProfile?.clientId ?? null,
            name: branch.name || `Sucursal ${branch.id}`,
            internalCode: branch.internalCode || null,
            address: branch.address || null,
            status: branch.status || 'ACTIVE',
        } : null;

        setActiveBranch(normalizedBranch);
        setAccessProfile((currentProfile) => {
            if (!currentProfile) return currentProfile;
            const nextProfile = { ...currentProfile, branch: normalizedBranch };
            sessionStorage.setItem('mm_access_profile', JSON.stringify(nextProfile));
            return nextProfile;
        });

        if (normalizedBranch) {
            sessionStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(normalizedBranch));
        } else {
            sessionStorage.removeItem(ACTIVE_BRANCH_KEY);
        }

        // Re-consultamos el perfil con el header de la sucursal recién elegida
        // (X-MM-Active-Branch-Id) para que el backend recorte licencias/módulos
        // a lo habilitado en ESA sucursal. Sin esto, cambiar de sucursal dejaba
        // los módulos de la anterior hasta re-loguear (ej. ver Despostada en una
        // sucursal que no la tiene licenciada). Best-effort: si falla, queda el
        // cambio de sucursal local y se corrige en el próximo refresh.
        fetchCurrentFirebaseUser()
            .then((payload) => {
                if (payload?.user) applyResolvedUser(payload.user);
            })
            .catch(() => { /* best effort */ });
    }, [accessProfile?.clientId, applyResolvedUser]);

    const refreshClientBranches = useCallback(async () => {
        const data = await fetchClientBranches();
        return Array.isArray(data?.branches) ? data.branches : [];
    }, []);

    useEffect(() => {
        let cancelled = false;

        const syncUser = async () => {
            if (loadingTenant) return;

            if (!tenant?.email) {
                logout();
                return;
            }

            if (!authToken) {
                return;
            }

            setLoadingUser(true);
            try {
                const result = await login({ uid: tenant.uid, email: tenant.email });
                if (!result.ok && !cancelled) {
                    setCurrentUser(null);
                    setUserPerms([]);
                    setAccessProfile(null);
                }
            } finally {
                if (!cancelled) {
                    setLoadingUser(false);
                }
            }
        };

        syncUser();

        return () => {
            cancelled = true;
        };
    }, [tenant, loadingTenant, authToken, login, logout]);

    useEffect(() => {
        const tenantEmail = String(tenant?.email || '').trim().toLowerCase();
        const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
        const hasNoLicenses = Array.isArray(accessProfile?.licenses) && accessProfile.licenses.length === 0;
        const needsRecovery =
            Boolean(tenantEmail) &&
            tenantEmail === currentEmail &&
            currentUser?.role === 'admin' &&
            hasNoLicenses &&
            Boolean(authToken) &&
            !loadingUser;

        if (!needsRecovery) {
            profileRecoveryRef.current = '';
            return;
        }

        const recoveryKey = `${tenant?.uid || tenantEmail}:${currentEmail}`;
        if (profileRecoveryRef.current === recoveryKey) return;
        profileRecoveryRef.current = recoveryKey;

        let cancelled = false;

        const recoverProfile = async () => {
            try {
                const remoteUser = await resolveRemoteUserProfile();

                if (!cancelled && remoteUser && Array.isArray(remoteUser.licenses) && remoteUser.licenses.length > 0) {
                    applyResolvedUser(remoteUser);
                }
            } catch {
                // Silent retry guard: if remote profile is unavailable, keep current fallback session.
            }
        };

        recoverProfile();

        return () => {
            cancelled = true;
        };
    }, [accessProfile?.licenses, applyResolvedUser, authToken, currentUser?.email, currentUser?.role, loadingUser, resolveRemoteUserProfile, tenant?.email, tenant?.uid]);


    // Admin always true; employee checks permission list
    const hasAccess = (path) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return true;
        return userPerms.includes(path);
    };

    const refreshUsers = useCallback(async () => {
        const data = await fetchFirebaseUsers();
        const nextUsers = (data?.users || []).map((user) => {
            const assignedLicenses = Array.isArray(user?.assignedLicenses)
                ? user.assignedLicenses.map(normalizeUserLicense)
                : Array.isArray(user?.licenses)
                    ? user.licenses
                        .filter((license) => {
                            const assignedUserId = String(license?.assignedUserId || '');
                            const currentUserId = String(user?.id || '');
                            return !assignedUserId || assignedUserId === currentUserId;
                        })
                        .map(normalizeUserLicense)
                    : [];

            return {
                ...user,
                assignedLicenses,
                _perms: user.perms || [],
            };
        });

        const fallbackLicensePool = nextUsers.flatMap((user) => (
            (user.assignedLicenses || []).map((license) => ({
                id: Number(license?.clientLicenseId || license?.id || 0) || null,
                userId: user?.id ?? null,
                clientId: user?.clientId ?? null,
                status: 'ACTIVE',
                user: {
                    id: user?.id ?? null,
                    name: String(user?.username || '').split(' ')[0] || user?.email || '',
                    lastname: String(user?.username || '').split(' ').slice(1).join(' '),
                    email: user?.email || '',
                },
                license: {
                    id: license?.licenseId ?? null,
                    commercialName: license?.commercialName || '',
                    internalCode: license?.internalCode || '',
                    category: license?.category || '',
                    billingScope: license?.billingScope || '',
                    appliesToWebapp: Boolean(license?.appliesToWebapp),
                    featureFlags: license?.featureFlags || [],
                    hasLogisticsCapability: Boolean(license?.hasLogisticsCapability),
                },
            }))
        )).filter((assignment) => assignment.id != null);

        setUsers(nextUsers);
        setLicensePool(Array.isArray(data?.licensePool) && data.licensePool.length > 0 ? data.licensePool : fallbackLicensePool);
        return nextUsers;
    }, []);

    const saveUserRecord = useCallback(async (table, operation, record, id) => {
        if (table !== 'users') {
            throw new Error('Tabla de usuarios no soportada');
        }

        if (operation === 'insert') {
            const result = await createFirebaseUser(record);
            await refreshUsers();
            return { insertId: result.user?.id || result.user?.uid };
        }

        if (operation === 'update') {
            await updateFirebaseUser(id, record);
            await refreshUsers();
            return { ok: true };
        }

        if (operation === 'delete') {
            await deleteFirebaseUser(id);
            await refreshUsers();
            return { ok: true };
        }

        throw new Error('Operación de usuario no soportada');
    }, [refreshUsers]);

    const replaceUserPermissions = useCallback(async (userId, paths) => {
        await replaceFirebaseUserPermissions(userId, paths);
        await refreshUsers();
        if (currentUser?.id === userId) {
            setUserPerms(paths);
            sessionStorage.setItem('mm_perms', JSON.stringify(paths));
        }
        return { ok: true };
    }, [currentUser?.id, refreshUsers]);

    return (
        <UserContext.Provider value={{
            currentUser,
            accessProfile,
            login,
            logout,
            hasAccess,
            userPerms,
            loadingUser,
            users,
            licensePool,
            activeBranch,
            selectActiveBranch,
            adminGlobalMode,
            setAdminGlobalMode,
            refreshClientBranches,
            refreshUsers,
            saveTableRecord: saveUserRecord,
            replaceUserPermissions,
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => useContext(UserContext);
