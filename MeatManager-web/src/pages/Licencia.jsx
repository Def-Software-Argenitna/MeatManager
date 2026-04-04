import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Cpu, Crown, Copy, Check, Zap, MessageCircle, HelpCircle, Download, Upload, Database } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { BRAND_CONFIG } from '../brandConfig';
import './Licencia.css';

const Licencia = () => {
    const { licenseMode, isPro, installationId, activatePro, deactivatePro, supportNumber } = useLicense();
    const [keyInput, setKeyInput] = useState('');
    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState(null); // 'success', 'error'

    const handleCopy = () => {
        navigator.clipboard.writeText(installationId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleActivate = async () => {
        const success = await activatePro(keyInput);
        if (success) {
            setStatus('success');
            setKeyInput('');
        } else {
            setStatus('error');
        }
    };

    return (
        <div className="licencia-container animate-fade-in">
            <header style={{ marginBottom: '2rem' }}>
                <h1 className="page-title">Configuración del Licenciador</h1>
                <p className="page-description">Gestiona el estado y las capacidades de tu aplicación</p>
            </header>

            <div className="license-grid">
                {/* STATUS CARD */}
                <div className={`neo-card status-card ${isPro ? 'pro-border' : 'light-border'}`}>
                    <div className="status-icon">
                        {isPro ? <Crown size={48} color="gold" /> : <Zap size={48} color="var(--color-primary)" />}
                    </div>
                    <div className="status-info">
                        <h3>Versión actual: <span className={isPro ? 'text-pro' : 'text-primary'}>{licenseMode.toUpperCase()}</span></h3>
                        <p>{isPro ? 'Todas las funciones premium están desbloqueadas.' : 'Estás usando la versión base con funciones limitadas.'}</p>
                    </div>
                </div>

                {/* INSTALLATION ID */}
                <div className="neo-card info-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                        <Cpu className="text-muted" size={24} />
                        <h4>ID de Instalación</h4>
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>Proporciona este ID a soporte para generar tu llave de activación.</p>
                    <div className="copy-box">
                        <code className="inst-id">{installationId}</code>
                        <button className="copy-btn" onClick={handleCopy}>
                            {copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* ACTIVATION SECTION */}
            <div className="neo-card activation-section">
                <div className="activation-header">
                    <ShieldCheck size={28} />
                    <h3>{isPro ? 'Gestión de Licencia' : 'Activar Modo PRO'}</h3>
                </div>

                {!isPro ? (
                    <div className="activation-form">
                        <p style={{ marginBottom: '1.5rem' }}>Ingresa tu código de licencia para desbloquear trazabilidad avanzada, gestión de costos y rendimientos profesionales.</p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <input
                                type="text"
                                className={`neo-input ${status === 'error' ? 'input-error' : ''}`}
                                placeholder="XXXX-XXXX-XXXX-XXXX"
                                value={keyInput}
                                onChange={(e) => { setKeyInput(e.target.value.toUpperCase()); setStatus(null); }}
                            />
                            <button className="neo-button pro-btn" onClick={handleActivate}>
                                ACTIVAR AHORA
                            </button>
                        </div>
                        {status === 'error' && <p className="error-text">La llave ingresada no es válida para este ID de instalación.</p>}
                        {status === 'success' && <p className="success-text">¡Felicitaciones! Modo PRO activado con éxito.</p>}
                    </div>
                ) : (
                    <div className="activation-form">
                        <p style={{ color: '#22c55e', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ShieldCheck size={20} /> Licencia válida y activa.
                        </p>
                        <button
                            className="neo-button"
                            style={{ marginTop: '2rem', border: '1px solid var(--color-border)', background: 'transparent' }}
                            onClick={() => { if (confirm('¿Desactivar modo PRO?')) deactivatePro(); }}
                        >
                            Restablecer a Versión Light
                        </button>
                    </div>
                )}
            </div>

            <div className="features-comparison">
                <h3>Capacidades del Sistema</h3>
                <div className="features-grid">
                    <div className="feature-item active">
                        <Check size={16} /> Ventas y POS
                    </div>
                    <div className="feature-item active">
                        <Check size={16} /> Stock de Cortes
                    </div>
                    <div className="feature-item active">
                        <Check size={16} /> Compras Básicas
                    </div>
                    <div className={`feature-item ${isPro ? 'active' : 'locked'}`}>
                        {isPro ? <Check size={16} /> : <Zap size={16} />} Trazabilidad de Lotes
                    </div>
                    <div className={`feature-item ${isPro ? 'active' : 'locked'}`}>
                        {isPro ? <Check size={16} /> : <Zap size={16} />} Análisis de Rinde
                    </div>
                    <div className={`feature-item ${isPro ? 'active' : 'locked'}`}>
                        {isPro ? <Check size={16} /> : <Zap size={16} />} Costos Reales
                    </div>
                    <div className={`feature-item ${isPro ? 'active' : 'locked'}`}>
                        {isPro ? <Check size={16} /> : <Zap size={16} />} Cuentas de Proveedores
                    </div>
                </div>
            </div>

            {/* SUPPORT CONTACT (NEW) */}
            <div className="neo-card support-footer-card animate-fade-in" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid #3b82f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.75rem', background: '#dbeafe', borderRadius: '50%', color: '#3b82f6' }}>
                        <HelpCircle size={24} />
                    </div>
                    <div>
                        <h4 style={{ margin: 0 }}>Soporte Técnico Oficial</h4>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Hablá con **{BRAND_CONFIG.developer_name}** para cualquier consulta técnica.</p>
                    </div>
                </div>
                <button
                    className="neo-button"
                    style={{ background: '#25D366', color: 'white', border: 'none', gap: '0.5rem' }}
                    onClick={() => {
                        const msg = `Hola! Necesito soporte con mi licencia de *${BRAND_CONFIG.brand_name}*.\nID: ${installationId}`;
                        window.open(`https://wa.me/${supportNumber}?text=${encodeURIComponent(msg)}`, '_blank');
                    }}
                >
                    <MessageCircle size={18} /> Contactar Soporte
                </button>
            </div>
        </div>
    );
};

export default Licencia;
