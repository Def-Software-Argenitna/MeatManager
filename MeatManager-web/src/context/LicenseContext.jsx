import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initializeSettings } from '../db';
import { BRAND_CONFIG } from '../brandConfig';
import { fdb } from '../firebase';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { desktopApi } from '../utils/desktopApi';

const LicenseContext = createContext();
const DEFAULT_SUPPORT = BRAND_CONFIG.support_whatsapp;

const verifyIntegrity = (key, instId, salt) => {
    if (!key || !instId || !salt) return false;
    let str = instId + salt;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
    const expected = `MM-PRO-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
    return key === expected;
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
        console.log("Offline mode: Using local brand config.");
    }
};

export const LicenseProvider = ({ children }) => {
    const [licenseMode, setLicenseMode] = useState('light');
    const [installationId, setInstallationId] = useState('');
    const [machineId, setMachineId] = useState('');   // hardware fingerprint real
    const [isBlocked, setIsBlocked] = useState(false); // licencia válida pero en PC no autorizada

    const settings = useLiveQuery(() => db.settings.toArray());

    // 1. Init: obtener hardware fingerprint desde Electron
    useEffect(() => {
        const init = async () => {
            await initializeSettings();
            syncRemoteBranding();

            try {
                const hwid = await desktopApi.getMachineId();
                if (hwid) setMachineId(hwid);
            } catch (e) {
                console.warn('No se pudo obtener machineId:', e);
            }
        };
        init();
    }, []);

    // 2. Cloud license listener — se activa cuando tenemos installationId
    useEffect(() => {
        if (!installationId) return;

        // Auto-registrar este equipo en Firebase (para que Pablo lo vea)
        const registerDevice = async () => {
            try {
                const regRef = doc(fdb, "registrations", installationId);
                const snap = await getDoc(regRef);
                if (!snap.exists()) {
                    await setDoc(regRef, {
                        installationId,
                        machineId: machineId || 'unknown',
                        registeredAt: new Date().toISOString(),
                        brand: BRAND_CONFIG.brand_name,
                        status: 'pending'
                    });
                } else if (machineId && !snap.data().machineId) {
                    // Actualizar con machineId si faltaba
                    await setDoc(regRef, { machineId }, { merge: true });
                }
            } catch {
                console.log("Offline or Config not ready: Registration skipped.");
            }
        };
        registerDevice();

        // Escuchar cambios en la licencia cloud
        const unsub = onSnapshot(doc(fdb, "licenses", installationId), async (docSnap) => {
            if (docSnap.exists()) {
                const cloudData = docSnap.data();

                // ── VERIFICACIÓN DE HARDWARE ─────────────────────────────
                // Si la licencia tiene un machineId registrado y no coincide
                // con el hardware actual → bloquear (PC no autorizada)
                if (machineId && cloudData.machineId && cloudData.machineId !== machineId) {
                    setIsBlocked(true);
                    setLicenseMode('light');
                    await db.settings.put({ key: 'license_mode', value: 'light' });
                    return;
                }
                // ────────────────────────────────────────────────────────

                setIsBlocked(false);
                if (cloudData.status === 'pro') {
                    setLicenseMode('pro');
                    await db.settings.put({ key: 'license_mode', value: 'pro' });
                } else {
                    setLicenseMode('light');
                    await db.settings.put({ key: 'license_mode', value: 'light' });
                }
            }
        });

        return () => unsub();
    }, [installationId, machineId]);

    const currentSupportNumber = settings?.find(s => s.key === 'remote_support_whatsapp')?.value || DEFAULT_SUPPORT;

    const isPro = licenseMode === 'pro';

    const activatePro = async (key) => {
        const isValidLocal = verifyIntegrity(key, installationId, BRAND_CONFIG.license_salt);

        if (isValidLocal) {
            await db.settings.put({ key: 'license_mode', value: 'pro' });
            await db.settings.put({ key: 'license_key', value: key });

            try {
                // Guardar machineId en Firebase → bloquea la licencia a este hardware
                await setDoc(doc(fdb, "licenses", installationId), {
                    key,
                    status: 'pro',
                    machineId: machineId || null,
                    activatedAt: new Date().toISOString()
                });
            } catch {
                console.warn("Cloud sync failed, using local activation for now.");
            }

            setIsBlocked(false);
            return true;
        }
        return false;
    };

    async function deactivatePro() {
        await db.settings.put({ key: 'license_mode', value: 'light' });
    }

    useEffect(() => {
        if (!settings) return;

        const mode = settings.find(s => s.key === 'license_mode');
        const instId = settings.find(s => s.key === 'installation_id');
        const storedKey = settings.find(s => s.key === 'license_key');

        if (instId) setInstallationId(instId.value);

        if (mode?.value === 'pro' && storedKey?.value) {
            const syncLocalLicense = async () => {
                const isValid = verifyIntegrity(storedKey.value, instId?.value, BRAND_CONFIG.license_salt);
                if (isValid) {
                    setLicenseMode('pro');
                } else {
                    await deactivatePro();
                }
            };
            syncLocalLicense();
        }
    }, [settings]);

    return (
        <LicenseContext.Provider value={{
            licenseMode, isPro, installationId, machineId, isBlocked,
            activatePro, deactivatePro, supportNumber: currentSupportNumber
        }}>
            {children}
        </LicenseContext.Provider>
    );
};

export const useLicense = () => useContext(LicenseContext);
