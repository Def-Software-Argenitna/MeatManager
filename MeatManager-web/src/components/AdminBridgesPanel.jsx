import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, RefreshCw, DownloadCloud } from 'lucide-react';
import { fetchAdminBridges, sendBridgeCommand } from '../utils/apiClient';

const STATUS_META = {
    ok: { color: '#22c55e', label: 'OK' },
    warn: { color: '#f59e0b', label: 'Atención' },
    down: { color: '#ef4444', label: 'Caído' },
    unknown: { color: '#9ca3af', label: 'Sin datos' },
};
const POLL_MS = 15000;

function timeAgo(iso) {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs)) return '—';
    const s = Math.max(0, Math.round(diffMs / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} d`;
}

export default function AdminBridgesPanel() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const timerRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const result = await fetchAdminBridges();
            setData(result);
            setError(null);
        } catch (e) {
            setError(e.message);
        }
    }, []);

    useEffect(() => {
        load();
        timerRef.current = setInterval(load, POLL_MS);
        return () => clearInterval(timerRef.current);
    }, [load]);

    const runCommand = async (deviceKey, type, label) => {
        // El comando se encola por tenant; aclaramos que es a nivel cuenta.
        if (!window.confirm(`${label} para el cliente del device ${deviceKey}?`)) return;
        setBusy(`${deviceKey}:${type}`);
        try {
            await sendBridgeCommand(type);
            setTimeout(load, 8000);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    const bridges = data?.bridges || [];
    const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, opacity: 0.7, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)' };
    const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.06)' };
    const dot = (c) => ({ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: c, marginRight: 6 });
    const miniBtn = { fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', marginRight: 6 };

    return (
        <div className="admin-table-wrapper" style={{ padding: '1rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ opacity: 0.7, fontSize: 13 }}>
                    {data ? `${bridges.length} bridge(s) · última versión: ${data.latestVersion || 'no verificada'}` : 'Cargando…'}
                </span>
                <button style={miniBtn} onClick={load}><RefreshCw size={13} /> Refrescar</button>
            </div>
            {error && <div style={{ color: '#f59e0b', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={th}>Estado</th>
                        <th style={th}>Equipo</th>
                        <th style={th}>Cliente</th>
                        <th style={th}>Versión</th>
                        <th style={th}>Balanza</th>
                        <th style={th}>Última venta</th>
                        <th style={th}>Latido</th>
                        <th style={th}>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    {bridges.map((b) => {
                        const meta = STATUS_META[b.status] || STATUS_META.unknown;
                        return (
                            <tr key={b.deviceId}>
                                <td style={td}><span style={dot(meta.color)} />{meta.label}
                                    {b.reasons?.length > 0 && b.status !== 'ok' && (
                                        <div style={{ fontSize: 11, opacity: 0.6 }}>{b.reasons.join(', ')}</div>
                                    )}
                                </td>
                                <td style={td}>{b.hostname || b.deviceId}</td>
                                <td style={td}>#{b.clientId}{b.branchId ? ` / suc ${b.branchId}` : ''}</td>
                                <td style={td}>
                                    {b.version || '—'}
                                    {b.isUpToDate === true && <span style={{ color: '#22c55e' }}> ✓</span>}
                                    {b.isUpToDate === false && <span style={{ color: '#f59e0b' }}> ↑</span>}
                                </td>
                                <td style={td}>{b.scaleReachable === false ? '⚠️' : (b.scaleReachable ? 'OK' : '—')}</td>
                                <td style={td}>{timeAgo(b.lastTicketSyncAt)}</td>
                                <td style={td}>{timeAgo(b.lastSeenAt)}</td>
                                <td style={td}>
                                    <button style={miniBtn} disabled={busy} onClick={() => runCommand(b.hostname || b.deviceId, 'restart', 'Reiniciar bridge')}>
                                        <RefreshCw size={12} /> Reiniciar
                                    </button>
                                    {b.isUpToDate === false && (
                                        <button style={{ ...miniBtn, borderColor: '#f59e0b' }} disabled={busy} onClick={() => runCommand(b.hostname || b.deviceId, 'apply_update', 'Actualizar bridge')}>
                                            <DownloadCloud size={12} /> Actualizar
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                    {bridges.length === 0 && data && (
                        <tr><td style={td} colSpan={8}>No hay bridges registrados.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
