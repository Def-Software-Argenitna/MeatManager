import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BRAND_CONFIG } from '../brandConfig';
import { desktopApi } from '../utils/desktopApi';
import { getRemoteSetting, upsertRemoteSetting } from '../utils/apiClient';
import { useUser } from './UserContext';

const LicenseContext = createContext();
const DEFAULT_SUPPORT = BRAND_CONFIG.support_whatsapp;

const BASE_MODULES = ['dashboard', 'ventas', 'stock', 'compras', 'clientes', 'billing'];
const PREMIUM_MODULES = ['despostada', 'informes-pro', 'logistica', 'menu-digital', 'costos-reales', 'proveedores-pro'];
const ALL_MODULES = [...new Set([...BASE_MODULES, ...PREMIUM_MODULES])];

const FEATURE_ALIASES = {
    dashboard: 'dashboard',
    clients: 'clientes',
    billing: 'billing',
    sales: 'ventas',
    ventas: 'ventas',
    stock: 'stock',
    compras: 'compras',
    purchases: 'compras',
    despostada: 'despostada',
    trazabilidad: 'despostada',
    traceability: 'despostada',
    lots: 'despostada',
    lotes: 'despostada',
    rendimiento: 'informes-pro',
    rinde: 'informes-pro',
    analytics: 'informes-pro',
    informes: 'informes-pro',
    'informes-pro': 'informes-pro',
    logistics: 'logistica',
    logistica: 'logistica',
    delivery: 'logistica',
    deliveries: 'logistica',
    envios: 'logistica',
    shipping: 'logistica',
    menu: 'menu-digital',
    'menu-digital': 'menu-digital',
    menu_digital: 'menu-digital',
    webpage: 'menu-digital',
    website: 'menu-digital',
    costs: 'costos-reales',
    costos: 'costos-reales',
    'costos-reales': 'costos-reales',
    proveedores: 'proveedores-pro',
    suppliers: 'proveedores-pro',
};

const normalizeToken = (value) => String(value || '').trim().toLowerCase();
const normalizeLicenseKey = (value) => normalizeToken(value).replace(/[^a-z0-9]/g, '');

const isBaseLicense = (license) => {
    const code = normalizeToken(license?.internalCode);
    const category = normalizeToken(license?.category);
    return code === 'base_mm' || category === 'base_webapp';
};

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

const extractFeatureTokens = (value) => {
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

const buildLicenseCapabilities = (licenses, options = {}) => {
    const normalizedLicenses = Array.isArray(licenses) ? licenses : [];
    const rawFlags = new Set();
    const modules = new Set(BASE_MODULES);
    let hasSuperUser = false;

    for (const license of normalizedLicenses) {
        for (const token of extractFeatureTokens(license?.featureFlags)) {
            rawFlags.add(normalizeToken(token));
        }

        const code = normalizeToken(license?.internalCode);
        const category = normalizeToken(license?.category);

        if (isSuperUserLicense(license)) {
            hasSuperUser = true;
        }

        if (code === 'base_mm' || category === 'base_webapp') {
            BASE_MODULES.forEach((moduleKey) => modules.add(moduleKey));
        }

        if (code === 'man_webpage') {
            modules.add('menu-digital');
        }
    }

    for (const token of rawFlags) {
        const alias = FEATURE_ALIASES[token];
        if (alias) modules.add(alias);
    }

    if (hasSuperUser) {
        ALL_MODULES.forEach((moduleKey) => modules.add(moduleKey));
        rawFlags.add('superuser');
    }

    if (options.tenantHasDeliveryLicense) {
        modules.add('logistica');
        rawFlags.add('logistica');
    }

    return {
        modules: Array.from(modules).sort(),
        featureFlags: Array.from(rawFlags).sort(),
        isPro: hasSuperUser || PREMIUM_MODULES.some((moduleKey) => modules.has(moduleKey)),
        isSuperUser: hasSuperUser,
    };
};

const normalizeVisibleLicenses = (licenses) => {
    const normalizedLicenses = Array.isArray(licenses) ? [...licenses] : [];
    const hasSuperUser = normalizedLicenses.some(isSuperUserLicense);
    const hasBase = normalizedLicenses.some(isBaseLicense);

    if (hasSuperUser && !hasBase) {
        normalizedLicenses.unshift({
            clientLicenseId: 'implicit-base-mm',
            licenseId: 'implicit-base-mm',
            commercialName: 'Licencia MeatManager',
            internalCode: 'BASE_MM',
            category: 'base_webapp',
            billingScope: 'implicit',
            appliesToWebapp: true,
            featureFlags: ['dashboard', 'clients', 'billing'],
            implicit: true,
        });
    }

    return normalizedLicenses;
};

const syncRemoteBranding = async () => {
    if (!BRAND_CONFIG.sync_url) return;
    try {
        const response = await fetch(BRAND_CONFIG.sync_url);
        if (response.ok) {
            const data = await response.json();
            if (data.support_whatsapp) {
                await upsertRemoteSetting('remote_support_whatsapp', data.support_whatsapp);
            }
        }
    } catch {
        console.log('Offline mode: Using local brand config.');
    }
};

export const LicenseProvider = ({ children }) => {
    const { accessProfile } = useUser();
    const [installationId, setInstallationId] = useState('');
    const [machineId, setMachineId] = useState('');
    const [supportNumber, setSupportNumber] = useState(DEFAULT_SUPPORT);
    const licenses = useMemo(() => normalizeVisibleLicenses(accessProfile?.licenses || []), [accessProfile]);
    const capabilities = useMemo(
        () => buildLicenseCapabilities(licenses, {
            tenantHasDeliveryLicense: Boolean(accessProfile?.tenantHasDeliveryLicense),
        }),
        [accessProfile?.tenantHasDeliveryLicense, licenses],
    );
    const licenseMode = capabilities.isPro ? 'pro' : 'base';

    useEffect(() => {
        const init = async () => {
            try {
                const hwid = await desktopApi.getMachineId();
                if (hwid) setMachineId(hwid);
            } catch (error) {
                console.warn('No se pudo obtener machineId:', error);
            }

            try {
                const [instId, remoteSupport] = await Promise.all([
                    getRemoteSetting('installation_id'),
                    getRemoteSetting('remote_support_whatsapp'),
                ]);
                if (instId) setInstallationId(instId);
                if (remoteSupport) setSupportNumber(remoteSupport);
            } catch (error) {
                console.warn('No se pudieron leer settings remotas de licencia:', error);
            }

            syncRemoteBranding().then(async () => {
                try {
                    const refreshedSupport = await getRemoteSetting('remote_support_whatsapp');
                    if (refreshedSupport) setSupportNumber(refreshedSupport);
                } catch {
                    // noop
                }
            });
        };
        init();
    }, []);

    useEffect(() => {
        upsertRemoteSetting('license_mode', licenseMode).catch(() => {});
        upsertRemoteSetting('isPro', capabilities.isPro).catch(() => {});
    }, [licenseMode, capabilities.isPro]);

    const hasModule = (moduleKey) => capabilities.isSuperUser || capabilities.modules.includes(moduleKey);

    return (
        <LicenseContext.Provider value={{
            licenseMode,
            isPro: capabilities.isPro,
            installationId,
            machineId,
            isBlocked: false,
            supportNumber,
            licenses,
            featureFlags: capabilities.featureFlags,
            modules: capabilities.modules,
            isSuperUser: capabilities.isSuperUser,
            hasModule,
        }}>
            {children}
        </LicenseContext.Provider>
    );
};

export const useLicense = () => useContext(LicenseContext);
