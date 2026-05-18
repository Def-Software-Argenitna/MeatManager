import React, { useEffect, useMemo, useState } from 'react';
import DirectionalReveal from '../components/DirectionalReveal';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import {
    fetchWhatsAppMarketingStatus,
    saveWhatsAppMarketingConfig,
} from '../utils/apiClient';
import './ConfiguracionWhatsAppMarketing.css';

const ConfiguracionWhatsAppMarketing = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    const [mode, setMode] = useState('free');
    const [inviteLink, setInviteLink] = useState('');
    const [autoBroadcastPromotions, setAutoBroadcastPromotions] = useState(false);
    const [phoneNumberId, setPhoneNumberId] = useState('');
    const [apiVersion, setApiVersion] = useState('v21.0');
    const [token, setToken] = useState('');
    const [updateToken, setUpdateToken] = useState(false);
    const [activePromotions, setActivePromotions] = useState([]);
    const [selectedPromotionId, setSelectedPromotionId] = useState('');
    const [promoPreview, setPromoPreview] = useState('');
    const [promoPreviewMeta, setPromoPreviewMeta] = useState(null);
    const [copyState, setCopyState] = useState('idle');
    const [cloudStatus, setCloudStatus] = useState({
        configured: false,
        hasToken: false,
    });

    useEffect(() => {
        const run = async () => {
            try {
                const payload = await fetchWhatsAppMarketingStatus();
                setMode(payload?.mode === 'paid' ? 'paid' : 'free');
                setInviteLink(String(payload?.inviteLink || ''));
                setAutoBroadcastPromotions(Boolean(payload?.autoBroadcastPromotions));
                setPhoneNumberId(String(payload?.cloud?.phoneNumberId || ''));
                setApiVersion(String(payload?.cloud?.apiVersion || 'v21.0'));
                const nextPromotions = Array.isArray(payload?.activePromotions) ? payload.activePromotions : [];
                setActivePromotions(nextPromotions);
                setSelectedPromotionId(String(payload?.promoPreviewMeta?.id || nextPromotions?.[0]?.id || ''));
                setPromoPreview(String(payload?.promoPreview || ''));
                setPromoPreviewMeta(payload?.promoPreviewMeta || null);
                setCloudStatus({
                    configured: Boolean(payload?.cloud?.configured),
                    hasToken: Boolean(payload?.cloud?.hasToken),
                });
            } catch (error) {
                setStatus({ type: 'error', text: error.message || 'No se pudo cargar la configuración.' });
            } finally {
                setLoading(false);
            }
        };
        run();
    }, []);

    const qrUrl = useMemo(() => {
        const link = String(inviteLink || '').trim();
        if (!link) return '';
        return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
    }, [inviteLink]);

    const selectedPromotion = useMemo(() => {
        const selectedId = Number(selectedPromotionId || 0);
        const list = Array.isArray(activePromotions) ? activePromotions : [];
        if (!selectedId) return list[0] || null;
        return list.find((promotion) => Number(promotion?.id || 0) === selectedId) || list[0] || null;
    }, [activePromotions, selectedPromotionId]);

    const selectedPromoMessage = useMemo(() => {
        const message = String(selectedPromotion?.message || promoPreview || '').trim();
        return message;
    }, [promoPreview, selectedPromotion]);

    const hasInviteLink = String(inviteLink || '').trim().length > 0;

    useEffect(() => {
        if (!selectedPromotion) {
            setPromoPreview('');
            setPromoPreviewMeta(null);
            return;
        }
        setPromoPreview(String(selectedPromotion.message || ''));
        setPromoPreviewMeta({
            id: Number(selectedPromotion.id || 0),
            productName: String(selectedPromotion.productName || '').trim(),
        });
    }, [selectedPromotion]);

    const copyText = async (text) => {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    };

    const copyPromoMessage = async (includeInviteLink = false) => {
        const text = String(selectedPromoMessage || '').trim();
        if (!text) {
            setStatus({ type: 'error', text: 'No hay una promo activa para copiar.' });
            setCopyState('error');
            return;
        }

        if (includeInviteLink && !hasInviteLink) {
            setStatus({ type: 'error', text: 'Carga un link de grupo/canal antes de copiar el mensaje con link.' });
            setCopyState('error');
            return;
        }

        const payload = includeInviteLink
            ? `${text}\n\nSumate al grupo/canal: ${String(inviteLink || '').trim()}`
            : text;

        try {
            await copyText(payload);
            setCopyState(includeInviteLink ? 'bundle' : 'message');
            setStatus({ type: 'ok', text: includeInviteLink ? 'Mensaje y link copiados al portapapeles.' : 'Mensaje de promo copiado al portapapeles.' });
            window.setTimeout(() => setCopyState('idle'), 2200);
        } catch (error) {
            setCopyState('error');
            setStatus({ type: 'error', text: includeInviteLink ? 'No se pudo copiar el mensaje con link.' : 'No se pudo copiar el mensaje de promo.' });
        }
    };

    const saveConfig = async () => {
        try {
            if (!isAdmin) return;
            setSaving(true);
            setStatus(null);
            await saveWhatsAppMarketingConfig({
                mode,
                inviteLink: String(inviteLink || '').trim(),
                autoBroadcastPromotions: Boolean(autoBroadcastPromotions),
                phoneNumberId: String(phoneNumberId || '').trim(),
                apiVersion: String(apiVersion || 'v21.0').trim(),
                updateToken,
                token: updateToken ? String(token || '').trim() : undefined,
            });
            setStatus({ type: 'ok', text: 'Configuración de WhatsApp guardada.' });
            if (updateToken) {
                setToken('');
                setUpdateToken(false);
                setCloudStatus((prev) => ({ ...prev, hasToken: true }));
            }
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo guardar la configuración.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="wa-marketing-loading">Cargando configuración de WhatsApp...</div>;
    }

    return (
        <div className="wa-marketing-page animate-fade-in">
            <DirectionalReveal className="neo-card wa-marketing-card" from="left" delay={0.06}>
                <header className="wa-marketing-header">
                    <h1>Marketing por WhatsApp</h1>
                    <p>Configura un flujo gratis con QR o activa el envío automático con API.</p>
                    {!isAdmin ? <div className="wa-marketing-readonly">Solo admin puede modificar esta sección.</div> : null}
                </header>

                <section className="wa-marketing-mode-switch">
                    <button
                        type="button"
                        className={mode === 'free' ? 'active' : ''}
                        onClick={() => setMode('free')}
                    >
                        Modo Gratis
                    </button>
                    <button
                        type="button"
                        className={mode === 'paid' ? 'active' : ''}
                        onClick={() => setMode('paid')}
                    >
                        Modo con Costo (API)
                    </button>
                </section>

                <section className="wa-marketing-grid">
                    <article className="wa-marketing-block">
                        <h2>Gratis: grupo/canal + QR</h2>
                        <p>
                            Ideal para empezar sin costo. Carga el link de invitación y comparte el QR para que los clientes se sumen.
                        </p>
                        <ol>
                            <li>Crea un grupo o canal de difusión en WhatsApp.</li>
                            <li>Copia el link de invitación.</li>
                            <li>Pega el link acá y muestra el QR en mostrador/redes.</li>
                            <li>Cuando crees una promo, la publicas manualmente en ese grupo/canal.</li>
                        </ol>
                        <label>
                            Link de invitación
                            <input
                                type="text"
                                value={inviteLink}
                                disabled={!isAdmin || saving}
                                onChange={(e) => setInviteLink(e.target.value)}
                                placeholder="https://chat.whatsapp.com/..."
                            />
                        </label>
                        {qrUrl ? (
                            <div className="wa-marketing-qr">
                                <img src={qrUrl} alt="QR de ingreso al grupo/canal de WhatsApp" />
                            </div>
                        ) : (
                            <div className="wa-marketing-qr-placeholder">Carga un link para generar el QR.</div>
                        )}
                        <div className="wa-marketing-copy-box">
                            <div className="wa-marketing-copy-header">
                                <h3>Mensaje sugerido para compartir</h3>
                                <div className="wa-marketing-copy-buttons">
                                    <button
                                        type="button"
                                        onClick={() => copyPromoMessage(false)}
                                        disabled={!selectedPromoMessage}
                                    >
                                        {copyState === 'message' ? 'Copiado' : 'Copiar mensaje'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => copyPromoMessage(true)}
                                        disabled={!selectedPromoMessage || !hasInviteLink}
                                    >
                                        {copyState === 'bundle' ? 'Copiado' : 'Copiar mensaje + link'}
                                    </button>
                                </div>
                            </div>
                            <label>
                                Promo activa para copiar
                                <select
                                    value={selectedPromotionId}
                                    onChange={(e) => setSelectedPromotionId(e.target.value)}
                                    disabled={!activePromotions.length}
                                >
                                    {activePromotions.length ? activePromotions.map((promotion) => (
                                        <option key={promotion.id} value={promotion.id}>
                                            #{promotion.id} · {promotion.productName || 'Promo activa'}
                                        </option>
                                    )) : <option value="">Sin promociones activas</option>}
                                </select>
                            </label>
                            <p>
                                Elige una promo activa y publícala manualmente en tu grupo o canal.
                                {promoPreviewMeta?.productName ? ` Promo actual: ${promoPreviewMeta.productName}.` : ''}
                            </p>
                            {selectedPromoMessage ? (
                                <pre className="wa-marketing-copy-preview">{selectedPromoMessage}</pre>
                            ) : (
                                <div className="wa-marketing-copy-empty">No hay una promo activa para copiar en este momento.</div>
                            )}
                        </div>
                    </article>

                    <article className="wa-marketing-block">
                        <h2>Con costo: envío automático</h2>
                        <p>
                            Beneficio: al crear una promo activa, se envía automáticamente a tus clientes con teléfono.
                        </p>
                        <ul>
                            <li>Más alcance inmediato y trazable.</li>
                            <li>No dependes de publicación manual.</li>
                            <li>Escala mejor cuando crece la base de clientes.</li>
                        </ul>
                        <label className="wa-checkbox">
                            <input
                                type="checkbox"
                                checked={autoBroadcastPromotions}
                                disabled={!isAdmin || saving}
                                onChange={(e) => setAutoBroadcastPromotions(e.target.checked)}
                            />
                            <span>Enviar promo automáticamente al crearla</span>
                        </label>
                        <label>
                            Phone Number ID (Meta)
                            <input
                                type="text"
                                value={phoneNumberId}
                                disabled={!isAdmin || saving}
                                onChange={(e) => setPhoneNumberId(e.target.value)}
                                placeholder="123456789012345"
                            />
                        </label>
                        <label>
                            API Version
                            <input
                                type="text"
                                value={apiVersion}
                                disabled={!isAdmin || saving}
                                onChange={(e) => setApiVersion(e.target.value)}
                                placeholder="v21.0"
                            />
                        </label>
                        <label className="wa-checkbox">
                            <input
                                type="checkbox"
                                checked={updateToken}
                                disabled={!isAdmin || saving}
                                onChange={(e) => setUpdateToken(e.target.checked)}
                            />
                            <span>Actualizar token de API</span>
                        </label>
                        {updateToken ? (
                            <label>
                                Access Token (Meta Cloud API)
                                <input
                                    type="password"
                                    value={token}
                                    disabled={!isAdmin || saving}
                                    onChange={(e) => setToken(e.target.value)}
                                    placeholder="EAA..."
                                />
                            </label>
                        ) : null}
                        <div className="wa-cloud-status">
                            Estado API: {cloudStatus.configured ? 'Configurada' : 'Incompleta'} ·
                            {' '}Token: {cloudStatus.hasToken ? 'Cargado' : 'Falta'}
                        </div>
                    </article>
                </section>

                <section className="wa-marketing-actions">
                    <button type="button" disabled={!isAdmin || saving} onClick={saveConfig}>
                        {saving ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                    {status ? (
                        <span className={status.type === 'ok' ? 'status-ok' : 'status-error'}>{status.text}</span>
                    ) : null}
                </section>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionWhatsAppMarketing;

