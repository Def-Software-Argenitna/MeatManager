import React, { useEffect, useMemo, useState } from 'react';
import { X, CreditCard, AlertTriangle, ArrowRight } from 'lucide-react';
import { fetchTable, changeSalePaymentMethod } from '../utils/apiClient';

// Modal para cambiar el MEDIO DE PAGO de una venta ya registrada (solo admin).
// El servidor revierte el efecto del medio viejo y aplica el nuevo en una sola
// transacción auditada; este modal solo elige el medio nuevo (y el cliente si el
// nuevo medio es cuenta corriente) y muestra el impacto antes de confirmar.
//
// Props:
//   sale:  { id, total, payment_method, clientId | client_id }
//   onClose(): cerrar sin cambios
//   onDone(result): cambio aplicado con éxito (el padre refresca su lista)

const fmt = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(Number(n) || 0);

// Mismo criterio de "cuenta corriente" que usa el backend (por tipo o por nombre).
const isCurrentAccount = (name, type) => {
    const n = String(name || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    return t === 'cuenta_corriente' || n.includes('cuenta corriente');
};

const clientLabel = (c) => {
    const first = String(c?.first_name || '').trim();
    const last = String(c?.last_name || '').trim();
    return [first, last].filter(Boolean).join(' ') || String(c?.name || '').trim() || `Cliente #${c?.id}`;
};

export default function CambiarMedioPagoModal({ sale, onClose, onDone }) {
    const [methods, setMethods] = useState([]);
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const [selectedMethodId, setSelectedMethodId] = useState('');
    const [selectedClientId, setSelectedClientId] = useState(
        sale?.clientId ?? sale?.client_id ?? ''
    );
    const [reason, setReason] = useState('');

    const saleTotal = Number(sale?.total) || 0;
    const oldMethodName = String(sale?.payment_method || '').trim();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [pm, cl] = await Promise.all([
                    fetchTable('payment_methods').catch(() => []),
                    fetchTable('clients').catch(() => []),
                ]);
                if (cancelled) return;
                // Excluimos el medio "mixto" (no se puede fijar como medio único) y
                // los deshabilitados. `enabled` puede venir undefined en catálogos viejos.
                const usable = (Array.isArray(pm) ? pm : []).filter((m) => {
                    const enabled = m?.enabled === undefined || m?.enabled === null
                        ? true
                        : (Number(m.enabled) === 1 || m.enabled === true);
                    const inactive = Number(m?.inactive) === 1 || m?.inactive === true;
                    const type = String(m?.type || '').toLowerCase();
                    const name = String(m?.name || '').toLowerCase();
                    const isMixed = type === 'mixed' || type === 'mixto' || name.includes('mixto');
                    return enabled && !inactive && !isMixed;
                });
                setMethods(usable);
                setClients(Array.isArray(cl) ? cl : []);
            } catch (e) {
                if (!cancelled) setError(e.message || 'No se pudieron cargar los datos');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const selectedMethod = useMemo(
        () => methods.find((m) => String(m.id) === String(selectedMethodId)) || null,
        [methods, selectedMethodId]
    );
    const newIsCC = selectedMethod
        ? isCurrentAccount(selectedMethod.name, selectedMethod.type)
        : false;
    const oldIsCC = isCurrentAccount(oldMethodName, null);

    const selectedClient = useMemo(
        () => clients.find((c) => String(c.id) === String(selectedClientId)) || null,
        [clients, selectedClientId]
    );

    const sameMethod = selectedMethod
        && String(selectedMethod.name || '').toLowerCase() === oldMethodName.toLowerCase();

    // Texto de impacto: qué va a pasar con la plata al confirmar.
    const impact = useMemo(() => {
        if (!selectedMethod) return null;
        if (newIsCC) {
            const name = selectedClient ? clientLabel(selectedClient) : 'el cliente';
            return `Se cargará ${fmt(saleTotal)} a la cuenta corriente de ${name}.`;
        }
        if (oldIsCC) {
            return `Se quitará la deuda de ${fmt(saleTotal)} de la cuenta corriente del cliente y ${fmt(saleTotal)} entrará como ${selectedMethod.name}.`;
        }
        return `En caja: se restará ${fmt(saleTotal)} de "${oldMethodName || 'medio anterior'}" y se sumará ${fmt(saleTotal)} a "${selectedMethod.name}".`;
    }, [selectedMethod, newIsCC, oldIsCC, selectedClient, saleTotal, oldMethodName]);

    const canConfirm = selectedMethod && !sameMethod && !saving
        && (!newIsCC || selectedClientId);

    const handleConfirm = async () => {
        if (!canConfirm) return;
        setSaving(true);
        setError(null);
        try {
            const result = await changeSalePaymentMethod(sale.id, {
                payment_method: selectedMethod.name,
                payment_method_id: selectedMethod.id,
                client_id: newIsCC ? Number(selectedClientId) : null,
                reason: reason.trim() || null,
            });
            onDone?.(result);
        } catch (e) {
            setError(e.message || 'No se pudo cambiar el medio de pago');
            setSaving(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 10000,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '14px',
                    width: 'min(460px, 96vw)',
                    maxHeight: '90vh', overflowY: 'auto',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                    color: 'var(--color-text-main)',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                        <CreditCard size={18} /> Cambiar medio de pago
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1 }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Resumen de la venta */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '0.75rem', padding: '0.65rem 0.85rem',
                        background: 'var(--color-bg-main)', border: '1px solid var(--color-border)',
                        borderRadius: '10px', flexWrap: 'wrap',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                            <span style={{
                                padding: '0.1rem 0.55rem', borderRadius: '999px',
                                border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
                            }}>{oldMethodName || 'Sin método'}</span>
                            {selectedMethod && !sameMethod && (
                                <>
                                    <ArrowRight size={14} />
                                    <span style={{
                                        padding: '0.1rem 0.55rem', borderRadius: '999px',
                                        border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                                    }}>{selectedMethod.name}</span>
                                </>
                            )}
                        </div>
                        <strong style={{ fontSize: '1rem' }}>{fmt(saleTotal)}</strong>
                    </div>

                    {loading ? (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                            Cargando medios de pago…
                        </div>
                    ) : (
                        <>
                            {/* Nuevo medio */}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Nuevo medio de pago</span>
                                <select
                                    value={selectedMethodId}
                                    onChange={(e) => setSelectedMethodId(e.target.value)}
                                    style={{
                                        padding: '0.55rem 0.7rem', borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-main)', color: 'var(--color-text-main)',
                                    }}
                                >
                                    <option value="">Elegí un medio…</option>
                                    {methods.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </label>

                            {/* Cliente (solo si el nuevo medio es cuenta corriente) */}
                            {newIsCC && (
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Cliente de cuenta corriente</span>
                                    <select
                                        value={selectedClientId}
                                        onChange={(e) => setSelectedClientId(e.target.value)}
                                        style={{
                                            padding: '0.55rem 0.7rem', borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-bg-main)', color: 'var(--color-text-main)',
                                        }}
                                    >
                                        <option value="">Elegí el cliente…</option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            {/* Motivo opcional */}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Motivo (opcional)</span>
                                <input
                                    type="text"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Ej: el cliente pagó en efectivo, no en transferencia"
                                    style={{
                                        padding: '0.55rem 0.7rem', borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-main)', color: 'var(--color-text-main)',
                                    }}
                                />
                            </label>

                            {/* Impacto */}
                            {impact && !sameMethod && (
                                <div style={{
                                    display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                                    padding: '0.65rem 0.85rem', borderRadius: '10px',
                                    background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
                                    fontSize: '0.82rem', color: 'var(--color-text-main)',
                                }}>
                                    <AlertTriangle size={16} color="#3b82f6" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                    <span>{impact}</span>
                                </div>
                            )}

                            {sameMethod && (
                                <div style={{ fontSize: '0.82rem', color: '#f59e0b' }}>
                                    La venta ya está registrada con ese medio de pago.
                                </div>
                            )}

                            {error && (
                                <div style={{
                                    display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                                    padding: '0.65rem 0.85rem', borderRadius: '10px',
                                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)',
                                    fontSize: '0.82rem', color: '#ef4444',
                                }}>
                                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                    <span>{error}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', padding: '1rem 1.25rem', borderTop: '1px solid var(--color-border)' }}>
                    <button
                        onClick={onClose}
                        disabled={saving}
                        style={{
                            background: 'transparent', color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)', borderRadius: '8px',
                            padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
                        }}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm}
                        style={{
                            background: canConfirm ? '#22c55e' : 'var(--color-border)',
                            color: canConfirm ? '#052e16' : 'var(--color-text-muted)',
                            border: 'none', borderRadius: '8px',
                            padding: '0.5rem 1rem', cursor: canConfirm ? 'pointer' : 'not-allowed',
                            fontWeight: 700, fontSize: '0.85rem',
                        }}
                    >
                        {saving ? 'Aplicando…' : 'Aplicar cambio'}
                    </button>
                </div>
            </div>
        </div>
    );
}
