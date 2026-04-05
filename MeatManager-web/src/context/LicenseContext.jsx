import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initializeSettings } from '../db';
import { BRAND_CONFIG } from '../brandConfig';
import { desktopApi } from '../utils/desktopApi';
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

const isBaseLicense = (license) => {
    const code = normalizeToken(license?.internalCode);
    const category = normalizeToken(license?.category);
    return code === 'base_mm' || category === 'base_webapp';
};

const isSuperUserLicense = (license) => {
    const code = normalizeToken(license?.internalCode);
    const name = normalizeToken(license?.commercialName);
    const category = normalizeToken(license?.category);
    return ['superuser', 'su'].includes(code) || name === 'superuser' || category === 'superuser';
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
        const name = normalizeToken(license?.commercialName);
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
                await db.settings.put({ key: 'remote_support_whatsapp', value: data.support_whatsapp });
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
    const settings = useLiveQuery(() => db.settings.toArray());
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
            await initializeSettings();
            syncRemoteBranding();

            try {
                const hwid = await desktopApi.getMachineId();
                if (hwid) setMachineId(hwid);
            } catch (error) {
                console.warn('No se pudo obtener machineId:', error);
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (!settings) return;
        const instId = settings.find((setting) => setting.key === 'installation_id');
        if (instId) setInstallationId(instId.value);
    }, [settings]);

    useEffect(() => {
        db.settings.put({ key: 'license_mode', value: licenseMode }).catch(() => {});
        db.settings.put({ key: 'isPro', value: capabilities.isPro }).catch(() => {});
    }, [licenseMode, capabilities.isPro]);

    const currentSupportNumber = settings?.find((setting) => setting.key === 'remote_support_whatsapp')?.value || DEFAULT_SUPPORT;
    const hasModule = (moduleKey) => capabilities.isSuperUser || capabilities.modules.includes(moduleKey);

    return (
        <LicenseContext.Provider value={{
            licenseMode,
            isPro: capabilities.isPro,
            installationId,
            machineId,
            isBlocked: false,
            supportNumber: currentSupportNumber,
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
