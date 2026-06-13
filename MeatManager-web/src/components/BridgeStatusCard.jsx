import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, DownloadCloud, Cpu } from 'lucide-react';
import { fetchBridgeStatus, sendBridgeCommand } from '../utils/apiClient';

const STATUS_META = {
    ok: { color: '#22c55e', label: 'Balanza conectada y al día' },
    warn: { color: '#f59e0b', label: 'Atención' },
    down: { color: '#ef4444', label: 'Bridge desconectado' },
    unknown: { color: '#9ca3af', label: 'Sin datos del bridge' },
};

const POLL_MS = 15000;

function timeAgo(iso) {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs)) return null;
    const s = Math.max(0, Math.round(diffMs / 1000));
    if (s < 60) return `hace ${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
}

export default function BridgeStatusCard({ isAdmin = false }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionMsg, setActionMsg] = useState(null);
    const timerRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const result = await fetchBridgeStatus();
            setData(result);
            setError(null);
        } catch (e) {
            setError(e.message || 'No se pudo obtener el estado');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        timerRef.current = setInterval(load, POLL_MS);
        return () => clearInterval(timerRef.current);
    }, [load]);

    const runCommand = async (type, label) => {
        setActionMsg(`Enviando: ${label}…`);
        try {
            await sendBridgeCommand(type);
            setActionMsg(`${label}: enviado. El bridge lo aplica en unos segundos.`);
            setTimeout(load, 8000);
        } catch (e) {
            setActionMsg(`Error: ${e.message}`);
        }
    };

    const bridge = data?.bridges?.[0] || null;
    const meta = STATUS_META[bridge?.status] || STATUS_META.unknown;

    const cardStyle = {
        border: '1px solid rgba(255,255,255,0.1)',
        borderLeft: `4px solid ${meta.color}`,
        borderRadius: 10,
        padding: '14px 18px',
        background: 'rgba(255,255,255,0.03)',
        marginBottom: 16,
    };
    const dot = { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: meta.color, marginRight: 8 };
    const detailStyle = { fontSize: 13, opacity: 0.8, marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' };
    const btn = {
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
        padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer',
    };

    if (loading && !data) {
        return <div style={cardStyle}><Cpu size={16} /> Consultando estado del bridge…</div>;
    }

    // Sin bridge reportado nunca: mantenemos el mensaje de ayuda original.
    if (!bridge || bridge.status === 'unknown') {
        return (
            <div style={cardStyle}>
                <span style={dot} />
                <strong>Bridge no detectado.</strong> Se requiere MeatManager Bridge instalado y en ejecución
                para sincronizar esta configuración con la balanza.
                {error && <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 6 }}>({error})</div>}
            </div>
        );
    }

    const updateAvailable = bridge.isUpToDate === false;

    return (
        <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
                <span style={dot} />
                {meta.label}
                {bridge.reasons?.length > 0 && bridge.status === 'warn' && (
                    <span style={{ fontWeight: 400, opacity: 0.85 }}> — {bridge.reasons.join(', ')}</span>
                )}
            </div>
            <div style={detailStyle}>
                <span>Versión: <strong>{bridge.version || 'desconocida'}</strong>
                    {bridge.isUpToDate === true && <span style={{ color: '#22c55e' }}> ✓ al día</span>}
                    {updateAvailable && data.latestVersion && <span style={{ color: '#f59e0b' }}> (hay {data.latestVersion})</span>}
                </span>
                <span>Balanza: {bridge.scaleReachable === false ? '⚠️ no responde' : (bridge.scaleReachable ? 'conectada' : '—')}</span>
                <span>Última venta leída: {timeAgo(bridge.lastTicketSyncAt) || '—'}</span>
                {bridge.online && <span>Latido: {timeAgo(bridge.lastSeenAt)}</span>}
            </div>
            {isAdmin && (
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button style={btn} onClick={() => runCommand('restart', 'Reiniciar bridge')}>
                        <RefreshCw size={14} /> Reiniciar
                    </button>
                    {updateAvailable && (
                        <button style={{ ...btn, borderColor: '#f59e0b' }} onClick={() => runCommand('apply_update', 'Actualizar bridge')}>
                            <DownloadCloud size={14} /> Actualizar a {data.latestVersion}
                        </button>
                    )}
                </div>
            )}
            {actionMsg && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>{actionMsg}</div>}
        </div>
    );
}
