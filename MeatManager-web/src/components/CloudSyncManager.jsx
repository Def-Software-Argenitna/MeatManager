import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getUnsyncedCount } from '../db';
import { fdb } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useLicense } from '../context/LicenseContext';
import { Cloud, RefreshCw } from 'lucide-react';

const CloudSyncManager = () => {
    const isTenantSession = Boolean(sessionStorage.getItem('mm_tenant'));

    const { installationId } = useLicense();
    const [isSyncing, setIsSyncing] = useState(false);

    const settings = useLiveQuery(() => db.settings.toArray());
    const unsyncedCount = useLiveQuery(() => getUnsyncedCount());

    // Check if cloud is enabled via settings (This is controlled by Pablo for the Abono)
    const isCloudEnabled = settings?.find(s => s.key === 'cloud_enabled')?.value === true;

    useEffect(() => {
        if (isTenantSession || !isCloudEnabled || !installationId || isSyncing || unsyncedCount === 0) return;

        const performSync = async () => {
            setIsSyncing(true);
            try {
                const tables = ['ventas', 'ventas_items', 'stock', 'clients', 'suppliers', 'compras', 'compras_items', 'despostada_logs'];
                let syncedAny = false;

                for (const tableName of tables) {
                    const unsyncedItems = await db[tableName].where('synced').equals(0).limit(50).toArray();

                    if (unsyncedItems.length > 0) {
                        syncedAny = true;
                        for (const item of unsyncedItems) {
                            const { id, ...rest } = item;
                            const docRef = doc(fdb, "installations", installationId, tableName, id.toString());
                            await setDoc(docRef, {
                                ...rest,
                                updated_at: new Date().toISOString(),
                                _internalId: id
                            });
                            await db[tableName].update(id, { synced: 1 });
                        }
                    }
                }

                // If we synced some items, immediately check for more after a short delay
                if (syncedAny) {
                    setTimeout(performSync, 1000);
                }
            } catch (err) {
                console.error("Cloud Sync Error:", err);
            } finally {
                setIsSyncing(false);
            }
        };

        const timeout = setTimeout(performSync, 3000);
        return () => clearTimeout(timeout);
    }, [unsyncedCount, isCloudEnabled, installationId, isSyncing, isTenantSession]);

    if (isTenantSession || !isCloudEnabled) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            background: 'var(--color-bg-card)',
            borderRadius: '2rem',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.8rem',
            color: 'var(--color-text-muted)',
            backdropFilter: 'blur(10px)'
        }}>
            {isSyncing ? (
                <>
                    <RefreshCw size={16} className="animate-spin text-primary" />
                    <span>Sincronizando... ({unsyncedCount})</span>
                </>
            ) : (
                <>
                    <Cloud size={16} className="text-success" />
                    <span>Nube al día</span>
                </>
            )}
        </div>
    );
};

export default CloudSyncManager;
