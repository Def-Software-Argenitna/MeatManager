import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Beef, LogIn, AlertCircle, ShieldCheck, Search } from 'lucide-react';
import { useTenant } from '../context/TenantContext';
import { useUser } from '../context/UserContext';
import '../styles/Login.css';

const Login = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {
        tenant,
        login: tenantLogin,
        loginSupport,
        activateSupportSession,
        logout: tenantLogout,
        loading: tenantLoading,
        isSupportSession,
    } = useTenant();
    const { currentUser, loadingUser } = useUser();
    const [mode, setMode] = useState('tenant');
    const [tenantEmail, setTenantEmail] = useState('');
    const [tenantPassword, setTenantPassword] = useState('');
    const [tenantError, setTenantError] = useState('');
    const [supportIdentifier, setSupportIdentifier] = useState('');
    const [supportPassword, setSupportPassword] = useState('');
    const [supportError, setSupportError] = useState('');
    const [supportToken, setSupportToken] = useState('');
    const [supportAdmin, setSupportAdmin] = useState(null);
    const [supportClients, setSupportClients] = useState([]);
    const [supportSearch, setSupportSearch] = useState('');
    const [selectedClientId, setSelectedClientId] = useState('');
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

    const handleSupportSubmit = async (e) => {
        e.preventDefault();
        if (!supportIdentifier || !supportPassword) {
            setSupportError('Completá email/usuario y contraseña');
            return;
        }

        setLoading(true);
        setSupportError('');
        const result = await loginSupport(supportIdentifier.trim(), supportPassword);
        setLoading(false);

        if (!result.ok) {
            setSupportError(result.error);
            return;
        }

        setSupportToken(result.token || '');
        setSupportAdmin(result.admin || null);
        setSupportClients(result.clients || []);
        setSelectedClientId(String(result.clients?.[0]?.id || ''));
    };

    const handleSupportAccess = async () => {
        const selectedClient = supportClients.find((client) => String(client.id) === String(selectedClientId));
        if (!selectedClient) {
            setSupportError('Seleccioná un tenant para continuar');
            return;
        }

        setLoading(true);
        const result = await activateSupportSession({
            token: supportToken,
            admin: supportAdmin,
            client: selectedClient,
        });
        setLoading(false);

        if (!result.ok) {
            setSupportError(result.error);
        }
    };

    const filteredSupportClients = supportClients.filter((client) => {
        const query = String(supportSearch || '').trim().toLowerCase();
        if (!query) return true;
        return (
            String(client.businessName || '').toLowerCase().includes(query)
            || String(client.taxId || '').toLowerCase().includes(query)
            || String(client.billingEmail || '').toLowerCase().includes(query)
        );
    });

    if (tenant) {
        return (
            <div className="login-container">
                <div className="login-card animate-fade-in" style={{ maxWidth: '420px', textAlign: 'center' }}>
                    <div className="login-header">
                        <div className="login-brand">
                            <div className="login-logo"><Beef size={34} /></div>
                            <h1 className="login-title">MeatManager</h1>
                        </div>
                        <p className="login-subtitle">
                            {isSupportSession
                                ? `Sesión DEF sobre ${tenant.empresa || tenant.email}`
                                : `¡Bienvenido, ${tenant.empresa || tenant.email}!`}
                        </p>
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
                    <div className="login-brand">
                        <div className="login-logo"><Beef size={34} /></div>
                        <h1 className="login-title">MeatManager</h1>
                    </div>
                    <p className="login-subtitle">
                        {mode === 'tenant' ? 'Ingresá con tu cuenta de empresa' : 'Acceso interno DEF Software'}
                    </p>
                </div>

                <div className="login-mode-switch">
                    <button
                        type="button"
                        className={`login-mode-button ${mode === 'tenant' ? 'active' : ''}`}
                        onClick={() => setMode('tenant')}
                    >
                        Empresa
                    </button>
                    <button
                        type="button"
                        className={`login-mode-button ${mode === 'support' ? 'active' : ''}`}
                        onClick={() => setMode('support')}
                    >
                        Soporte DEF
                    </button>
                </div>

                {mode === 'tenant' ? (
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
                ) : (
                    <form onSubmit={handleSupportSubmit} className="login-form" style={{ marginTop: '1.5rem' }}>
                        <div className="login-support-note">
                            <ShieldCheck size={16} />
                            Acceso interno no visible para el cliente.
                        </div>

                        <div className="form-group">
                            <label>Email o usuario interno</label>
                            <input
                                className="form-input"
                                type="text"
                                value={supportIdentifier}
                                onChange={(e) => setSupportIdentifier(e.target.value)}
                                placeholder="admin@def-software.com"
                                autoComplete="username"
                            />
                        </div>

                        <div className="form-group">
                            <label>Contraseña interna</label>
                            <input
                                className="form-input"
                                type="password"
                                value={supportPassword}
                                onChange={(e) => setSupportPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="current-password"
                            />
                        </div>

                        {supportError && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontSize: '0.85rem', background: 'rgba(239,68,68,0.1)', padding: '0.6rem 0.8rem', borderRadius: '8px' }}>
                                <AlertCircle size={16} />
                                {supportError}
                            </div>
                        )}

                        {!supportToken ? (
                            <button
                                type="submit"
                                disabled={loading || tenantLoading}
                                className="login-button"
                                style={{ opacity: loading || tenantLoading ? 0.7 : 1 }}
                            >
                                {loading || tenantLoading ? (
                                    <span style={{ fontSize: '0.9rem' }}>Validando...</span>
                                ) : (
                                    <>
                                        <ShieldCheck size={18} /> Validar SuperAdmin
                                    </>
                                )}
                            </button>
                        ) : (
                            <>
                                <div className="form-group">
                                    <label>Buscar tenant</label>
                                    <div className="login-search-input">
                                        <Search size={16} />
                                        <input
                                            className="form-input"
                                            type="text"
                                            value={supportSearch}
                                            onChange={(e) => setSupportSearch(e.target.value)}
                                            placeholder="Nombre, CUIT o email"
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Tenant destino</label>
                                    <select
                                        className="form-input"
                                        value={selectedClientId}
                                        onChange={(e) => setSelectedClientId(e.target.value)}
                                    >
                                        {filteredSupportClients.map((client) => (
                                            <option key={client.id} value={client.id}>
                                                {client.businessName} | {client.taxId} | {client.status}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <button
                                    type="button"
                                    disabled={loading || !selectedClientId}
                                    className="login-button"
                                    style={{ opacity: loading || !selectedClientId ? 0.7 : 1 }}
                                    onClick={handleSupportAccess}
                                >
                                    {loading ? (
                                        <span style={{ fontSize: '0.9rem' }}>Ingresando...</span>
                                    ) : (
                                        <>
                                            <LogIn size={18} /> Ingresar al tenant
                                        </>
                                    )}
                                </button>
                            </>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
};

export default Login;
