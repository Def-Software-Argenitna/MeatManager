import React, { useMemo, useState } from 'react';
import { ShieldCheck, Cpu, Crown, Copy, Check, Zap, MessageCircle, HelpCircle } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { BRAND_CONFIG } from '../brandConfig';
import './Licencia.css';

const Licencia = () => {
    const { licenseMode, isPro, isSuperUser, installationId, licenses, modules, featureFlags, supportNumber } = useLicense();
    const [copied, setCopied] = useState(false);

    const displayModules = useMemo(() => ([
        { key: 'despostada', label: 'Trazabilidad de Lotes' },
        { key: 'informes-pro', label: 'Análisis de Rinde' },
        { key: 'costos-reales', label: 'Costos Reales' },
        { key: 'proveedores-pro', label: 'Cuentas de Proveedores' },
        { key: 'logistica', label: 'Logística y Reparto' },
        { key: 'menu-digital', label: 'Menú Digital' },
    ]), []);
    const activeLicenseCount = licenses.length;
    const statusLabel = isSuperUser
        ? (activeLicenseCount > 1 ? `SUPERUSER + ${activeLicenseCount - 1}` : 'SUPERUSER')
        : licenseMode.toUpperCase();
    const statusDescription = isSuperUser
        ? (activeLicenseCount > 1
            ? `La licencia SuperUser habilita todos los módulos del sistema. Además tenés ${activeLicenseCount - 1} licencia${activeLicenseCount - 1 === 1 ? '' : 's'} activa${activeLicenseCount - 1 === 1 ? '' : 's'} adicional${activeLicenseCount - 1 === 1 ? '' : 'es'}.`
            : 'La licencia SuperUser habilita todos los módulos del sistema.')
        : isPro
            ? 'Hay módulos premium habilitados desde Gestión de Clientes.'
            : 'La cuenta tiene solo módulos base habilitados.';

    const handleCopy = () => {
        navigator.clipboard.writeText(installationId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="licencia-container animate-fade-in">
            <header className="page-header">
                
            </header>

            <div className="license-grid">
                <div className={`neo-card status-card ${isPro ? 'pro-border' : 'light-border'}`}>
                    <div className="status-icon">
                        {isPro ? <Crown size={48} color="gold" /> : <Zap size={48} color="var(--color-primary)" />}
                    </div>
                    <div className="status-info">
                        <h3>Estado actual: <span className={isPro ? 'text-pro' : 'text-primary'}>{statusLabel}</span></h3>
                        <p>{statusDescription}</p>
                    </div>
                </div>

                <div className="neo-card info-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                        <Cpu className="text-muted" size={24} />
                        <h4>ID de Instalación</h4>
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>Se mantiene para soporte técnico y sincronización del equipo, no para activar módulos por código.</p>
                    <div className="copy-box">
                        <code className="inst-id">{installationId}</code>
                        <button className="copy-btn" onClick={handleCopy}>
                            {copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} />}
                        </button>
                    </div>
                </div>
            </div>

            <div className="neo-card activation-section">
                <div className="activation-header">
                    <ShieldCheck size={28} />
                    <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0 }}>Licencias Activas</h3>
                        <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                            {activeLicenseCount} licencia{activeLicenseCount === 1 ? '' : 's'} activa{activeLicenseCount === 1 ? '' : 's'} en esta sesión
                        </p>
                    </div>
                </div>

                <div className="activation-form">
                    <p style={{ marginBottom: '1rem' }}>
                        Esta app ya no activa módulos con claves manuales. Las licencias web y módulos se asignan en Gestión de Clientes y se reflejan automáticamente en tu sesión.
                    </p>
                    <div className="license-list">
                        {licenses.length === 0 ? (
                            <p className="error-text" style={{ margin: 0 }}>No hay licencias web activas asignadas a este usuario.</p>
                        ) : (
                            licenses.map((license, index) => (
                                <div key={`${license.clientLicenseId || license.licenseId || 'license'}-${index}`} className="license-item">
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                                        <div style={{ fontWeight: 700 }}>{license.commercialName || license.internalCode}</div>
                                        <span className="license-badge">Activa</span>
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                                        {license.internalCode || 'SIN_CODIGO'} · {license.category || 'sin categoría'}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="features-comparison">
                <h3>Módulos Habilitados</h3>
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
                    {displayModules.map((moduleItem) => (
                        <div key={moduleItem.key} className={`feature-item ${modules.includes(moduleItem.key) ? 'active' : 'locked'}`}>
                            {modules.includes(moduleItem.key) ? <Check size={16} /> : <Zap size={16} />} {moduleItem.label}
                        </div>
                    ))}
                </div>
                {featureFlags.length > 0 && (
                    <div style={{ marginTop: '1rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        Feature flags: {featureFlags.join(', ')}
                    </div>
                )}
            </div>

            <div className="neo-card support-footer-card animate-fade-in" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid #3b82f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.75rem', background: '#dbeafe', borderRadius: '50%', color: '#3b82f6' }}>
                        <HelpCircle size={24} />
                    </div>
                    <div>
                        <h4 style={{ margin: 0 }}>Soporte Técnico Oficial</h4>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Si falta un módulo, la corrección se hace en Gestión de Clientes y no desde esta pantalla.</p>
                    </div>
                </div>
                <button
                    className="neo-button"
                    style={{ background: '#25D366', color: 'white', border: 'none', gap: '0.5rem' }}
                    onClick={() => {
                        const msg = `Hola! Necesito soporte con las licencias de *${BRAND_CONFIG.brand_name}*.\nID: ${installationId}`;
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
