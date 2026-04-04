import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Utensils, LogIn, AlertCircle } from 'lucide-react';
import { useTenant } from '../context/TenantContext';
import { useUser } from '../context/UserContext';
import '../styles/Login.css';

const Login = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { tenant, login: tenantLogin, logout: tenantLogout, loading: tenantLoading } = useTenant();
    const { currentUser, loadingUser } = useUser();
    const [tenantEmail, setTenantEmail] = useState('');
    const [tenantPassword, setTenantPassword] = useState('');
    const [tenantError, setTenantError] = useState('');
    const [loading, setLoading] = useState(false);
    const from = location.state?.from?.pathname || '/';

    useEffect(() => {
        if (tenant && currentUser && !loadingUser) {
            navigate(from, { replace: true });
        }
    }, [tenant, currentUser, loadingUser, navigate, from]);

    const handleTenantSubmit = async (e) => {
        e.preventDefault();
        if (!tenantEmail || !tenantPassword) {
            setTenantError('Completá email y contraseña');
            return;
        }

        setLoading(true);
        setTenantError('');
        const result = await tenantLogin(tenantEmail.trim(), tenantPassword);
        setLoading(false);

        if (!result.ok) {
            setTenantError(result.error);
        }
    };

    if (tenant) {
        return (
            <div className="login-container">
                <div className="login-card animate-fade-in" style={{ maxWidth: '420px', textAlign: 'center' }}>
                    <div className="login-header">
                        <div className="login-logo"><Utensils size={40} /></div>
                        <h1 className="login-title">MeatManager PRO</h1>
                        <p className="login-subtitle">¡Bienvenido, {tenant.empresa || tenant.email}!</p>
                    </div>

                    <div style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.95rem', lineHeight: 1.6 }}>
                        {loadingUser ? 'Cargando usuario...' : 'Ya estás conectado con esta empresa.'}
                    </div>
                    <div className="login-form" style={{ marginTop: '1.5rem' }}>
                        <button
                            type="button"
                            className="login-button"
                            onClick={() => navigate(from, { replace: true })}
                            disabled={loadingUser}
                        >
                            Ingresar al sistema
                        </button>
                        <button
                            type="button"
                            onClick={async () => { await tenantLogout(); }}
                            style={{
                                padding: '0.85rem',
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.12)',
                                color: '#cbd5e1',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            Cambiar empresa
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-container">
            <div className="login-card animate-fade-in" style={{ maxWidth: '420px' }}>
                <div className="login-header">
                    <div className="login-logo"><Utensils size={40} /></div>
                    <h1 className="login-title">MeatManager PRO</h1>
                    <p className="login-subtitle">Ingresá con tu cuenta de empresa</p>
                </div>

                <form onSubmit={handleTenantSubmit} className="login-form" style={{ marginTop: '1.5rem' }}>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            className="form-input"
                            type="email"
                            value={tenantEmail}
                            onChange={(e) => setTenantEmail(e.target.value)}
                            placeholder="tu@email.com"
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label>Contraseña</label>
                        <input
                            className="form-input"
                            type="password"
                            value={tenantPassword}
                            onChange={(e) => setTenantPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                        />
                    </div>

                    {tenantError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontSize: '0.85rem', background: 'rgba(239,68,68,0.1)', padding: '0.6rem 0.8rem', borderRadius: '8px' }}>
                            <AlertCircle size={16} />
                            {tenantError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || tenantLoading}
                        className="login-button"
                        style={{ opacity: loading || tenantLoading ? 0.7 : 1 }}
                    >
                        {loading || tenantLoading ? (
                            <span style={{ fontSize: '0.9rem' }}>Conectando...</span>
                        ) : (
                            <>
                                <LogIn size={18} /> Ingresar
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
