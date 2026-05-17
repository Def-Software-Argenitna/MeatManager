/**
 * useOfflineQueue — Cola de ventas pendientes para cuando no hay conexión.
 *
 * Estrategia:
 *  - Cada venta fallida por error de red se guarda en localStorage.
 *  - Al volver la conexión (evento 'online') o en cada mount, se intenta
 *    drenar la cola llamando al endpoint correspondiente.
 *  - Si una venta drena exitosamente se elimina de la cola.
 *  - Si falla de nuevo por red, se deja en cola para el próximo intento.
 *  - Si falla con error 4xx (datos inválidos) se descarta del queue para
 *    no bloquear los demás items.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const QUEUE_KEY = 'mm_offline_ventas_queue';

const readQueue = () => {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
        return [];
    }
};

const writeQueue = (items) => {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch {
        // localStorage lleno — no hacer nada crítico
    }
};

const isNetworkError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    return !navigator.onLine || msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout');
};

export const useOfflineQueue = ({ onVentaSynced } = {}) => {
    const [queue, setQueue] = useState(readQueue);
    const [isSyncing, setIsSyncing] = useState(false);
    const syncRef = useRef(false);
    // Guardar callback en ref para evitar recrear drain en cada render
    const onVentaSyncedRef = useRef(onVentaSynced);
    useEffect(() => { onVentaSyncedRef.current = onVentaSynced; }, [onVentaSynced]);

    const refreshQueue = useCallback(() => {
        setQueue(readQueue());
    }, []);

    // Encolar una venta fallida
    const enqueue = useCallback((payload) => {
        const entry = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            payload,
            enqueuedAt: new Date().toISOString(),
            retries: 0,
        };
        const current = readQueue();
        const updated = [...current, entry];
        writeQueue(updated);
        setQueue(updated);
        return entry.id;
    }, []);

    // Intentar drenar la cola
    const drain = useCallback(async () => {
        if (syncRef.current) return;
        const current = readQueue();
        if (current.length === 0) return;
        if (!navigator.onLine) return;

        syncRef.current = true;
        setIsSyncing(true);

        let remaining = [...current];

        for (const entry of current) {
            try {
                const token = sessionStorage.getItem('mm_auth_token') || '';
                const res = await fetch('/api/ventas', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify(entry.payload),
                });

                if (res.ok) {
                    // Éxito — quitar de cola
                    remaining = remaining.filter((e) => e.id !== entry.id);
                    writeQueue(remaining);
                    setQueue([...remaining]);
                    if (onVentaSyncedRef.current) onVentaSyncedRef.current(entry);
                } else if (res.status >= 400 && res.status < 500) {
                    // Error del cliente (datos inválidos) — descartar para no bloquear
                    console.warn(`[OFFLINE QUEUE] Venta ${entry.id} descartada — HTTP ${res.status}`);
                    remaining = remaining.filter((e) => e.id !== entry.id);
                    writeQueue(remaining);
                    setQueue([...remaining]);
                }
                // 5xx → dejar en cola, reintentar después
            } catch (err) {
                if (!isNetworkError(err)) {
                    // Error inesperado no de red — descartar
                    console.error(`[OFFLINE QUEUE] Error inesperado, descartando venta ${entry.id}:`, err);
                    remaining = remaining.filter((e) => e.id !== entry.id);
                    writeQueue(remaining);
                    setQueue([...remaining]);
                }
                // Si es error de red → dejar en cola
            }
        }

        syncRef.current = false;
        setIsSyncing(false);
    }, []); // onVentaSynced se leen por ref — no necesita estar en deps

    // Drenar al montar y cuando vuelve la conexión
    useEffect(() => {
        drain();
        window.addEventListener('online', drain);
        return () => window.removeEventListener('online', drain);
    }, [drain]);

    return {
        queue,
        queueLength: queue.length,
        isOnline: navigator.onLine,
        isSyncing,
        enqueue,
        drain,
        refreshQueue,
    };
};
