
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useTenant } from './TenantContext';
import {
    createFirebaseUser,
    deleteFirebaseUser,
    fetchCurrentFirebaseUser,
    fetchFirebaseUsers,
    replaceUserPermissions as replaceFirebaseUserPermissions,
    updateFirebaseUser,
} from '../utils/apiClient';

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
    { path: '/config/productos-compra', label: 'Catálogo Compras',  group: 'Configuración' },
    { path: '/config/proveedores',      label: 'Proveedores',       group: 'Configuración' },
    { path: '/config/licencia',         label: 'Licencia',          group: 'Configuración' },
    { path: '/config/seguridad',        label: 'Seguridad/Usuarios',group: 'Configuración' },
    { path: '/manual',                  label: 'Manual de Usuario', group: 'Configuración' },
];

const ALL_PATHS = ALL_ROUTES.map(r => r.path);

const UserContext = createContext(null);

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const hasSuperUserLicense = (licenses) => {
    const list = Array.isArray(licenses) ? licenses : [];
    return list.some((license) => (
        ['superuser', 'su'].includes(normalizeToken(license?.internalCode)) ||
        normalizeToken(license?.commercialName) === 'superuser' ||
        normalizeToken(license?.category) === 'superuser'
    ));
};

const restoreSession = () => {
    try {
        const u = sessionStorage.getItem('mm_user');
        const p = sessionStorage.getItem('mm_perms');
        const a = sessionStorage.getItem('mm_access_profile');
        return {
            user: u ? JSON.parse(u) : null,
            perms: p ? JSON.parse(p) : [],
            accessProfile: a ? JSON.parse(a) : null,
        };
    } catch {
        return { user: null, perms: [], accessProfile: null };
    }
};

export const UserProvider = ({ children }) => {
    const { tenant, loading: loadingTenant, authToken } = useTenant();
    const { user: savedUser, perms: savedPerms, accessProfile: savedAccessProfile } = restoreSession();
    const [currentUser, setCurrentUser] = useState(savedUser);
    const [userPerms, setUserPerms] = useState(savedPerms);
    const [accessProfile, setAccessProfile] = useState(savedAccessProfile);
    const [loadingUser, setLoadingUser] = useState(false);
    const [users, setUsers] = useState([]);

    const login = useCallback(async ({ uid, email }) => {
        setLoadingUser(true);
        try {
            const payload = await fetchCurrentFirebaseUser();
            const userData = payload?.user || null;
            if (!userData) {
                if (tenant?.email && email === tenant.email) {
                    const ownerSession = {
                        id: uid || email,
                        uid: uid || null,
                        email,
                        username: tenant.empresa || email,
                        role: 'admin',
                    };
                    setCurrentUser(ownerSession);
                    setUserPerms(ALL_PATHS);
                    setAccessProfile({
                        ...ownerSession,
                        active: 1,
                        perms: ALL_PATHS,
                        licenses: [],
                    });
                    sessionStorage.setItem('mm_user', JSON.stringify(ownerSession));
                    sessionStorage.setItem('mm_perms', JSON.stringify(ALL_PATHS));
                    sessionStorage.setItem('mm_access_profile', JSON.stringify({
                        ...ownerSession,
                        active: 1,
                        perms: ALL_PATHS,
                        licenses: [],
                    }));
                    return { ok: true };
                }
                return { ok: false, error: 'Usuario inactivo o no encontrado' };
            }
            if (!userData.active) return { ok: false, error: 'Usuario inactivo o no encontrado' };
            const superUser = hasSuperUserLicense(userData.licenses);
            const perms = (userData.role === 'admin' || superUser) ? ALL_PATHS : (userData.perms || []);
            const sessionUser = {
                id: userData.id || userData.uid || userData.email,
                uid: userData.uid || null,
                email: userData.email,
                username: userData.username || userData.empresa || userData.email,
                role: userData.role || 'employee',
            };
            setCurrentUser(sessionUser);
            setUserPerms(perms);
            setAccessProfile(userData);
            sessionStorage.setItem('mm_user', JSON.stringify(sessionUser));
            sessionStorage.setItem('mm_perms', JSON.stringify(perms));
            sessionStorage.setItem('mm_access_profile', JSON.stringify(userData));
            return { ok: true };
        } catch (error) {
            if (tenant?.email && email === tenant.email) {
                const ownerSession = {
                    id: uid || email,
                    uid: uid || null,
                    email,
                    username: tenant.empresa || email,
                    role: 'admin',
                };
                setCurrentUser(ownerSession);
                setUserPerms(ALL_PATHS);
                setAccessProfile({
                    ...ownerSession,
                    active: 1,
                    perms: ALL_PATHS,
                    licenses: [],
                });
                sessionStorage.setItem('mm_user', JSON.stringify(ownerSession));
                sessionStorage.setItem('mm_perms', JSON.stringify(ALL_PATHS));
                sessionStorage.setItem('mm_access_profile', JSON.stringify({
                    ...ownerSession,
                    active: 1,
                    perms: ALL_PATHS,
                    licenses: [],
                }));
                return { ok: true };
            }
            return { ok: false, error: error?.message || 'Usuario inactivo o no encontrado' };
        } finally {
            setLoadingUser(false);
        }
    }, [tenant]);

    const logout = useCallback(() => {
        setCurrentUser(null);
        setUserPerms([]);
        setAccessProfile(null);
        sessionStorage.removeItem('mm_user');
        sessionStorage.removeItem('mm_perms');
        sessionStorage.removeItem('mm_access_profile');
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
    }, [tenant, authToken, loadingTenant, login, logout]);


    // Admin always true; employee checks permission list
    const hasAccess = (path) => {
        if (!currentUser) return false;
        if (hasSuperUserLicense(accessProfile?.licenses)) return true;
        if (currentUser.role === 'admin') return true;
        return userPerms.includes(path);
    };

    const refreshUsers = useCallback(async () => {
        const data = await fetchFirebaseUsers();
        const nextUsers = (data?.users || []).map((user) => ({
            ...user,
            _perms: user.perms || [],
        }));
        setUsers(nextUsers);
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
            refreshUsers,
            saveTableRecord: saveUserRecord,
            replaceUserPermissions,
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => useContext(UserContext);
