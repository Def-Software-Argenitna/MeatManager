import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Beef, LogIn, AlertCircle, ShieldCheck, Search, MapPin } from 'lucide-react';
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
    const {
        currentUser,
        loadingUser,
        activeBranch,
        selectActiveBranch,
        refreshClientBranches,
    } = useUser();
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
    const [clientBranches, setClientBranches] = useState([]);
    const [branchLoading, setBranchLoading] = useState(false);
    const [branchCheckComplete, setBranchCheckComplete] = useState(false);
    const [branchError, setBranchError] = useState('');
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [selectedSupportBranchId, setSelectedSupportBranchId] = useState('');
    const [loading, setLoading] = useState(false);
    const from = location.state?.from?.pathname || '/';
    const isAdminUser = currentUser?.role === 'admin';
    const requiresBranchSelection = tenant && currentUser && isAdminUser && clientBranches.length > 1 && !activeBranch?.id;
    const waitingForBranchCheck = tenant && currentUser && isAdminUser && !branchCheckComplete;
    const hasBranchBlockingError = tenant && currentUser && isAdminUser && branchCheckComplete && Boolean(branchError);
    const selectedSupportClient = useMemo(
        () => supportClients.find((client) => String(client.id) === String(selectedClientId)) || null,
        [supportClients, selectedClientId]
    );
    const selectedSupportBranches = useMemo(
        () => (Array.isArray(selectedSupportClient?.branches) ? selectedSupportClient.branches : []),
        [selectedSupportClient]
    );

    useEffect(() => {
        if (tenant && currentUser && !loadingUser && !waitingForBranchCheck && !requiresBranchSelection && !hasBranchBlockingError) {
            navigate(from, { replace: true });
        }
    }, [tenant, currentUser, loadingUser, waitingForBranchCheck, requiresBranchSelection, hasBranchBlockingError, navigate, from]);

    useEffect(() => {
        let cancelled = false;

        const loadBranches = async () => {
            if (!tenant || !currentUser || !isAdminUser || loadingUser) {
                setClientBranches([]);
                setSelectedBranchId('');
                setBranchCheckComplete(!tenant || !currentUser || !isAdminUser);
                return;
            }

            setBranchLoading(true);
            setBranchCheckComplete(false);
            setBranchError('');
            try {
                const branches = await refreshClientBranches();
                if (cancelled) return;
                setClientBranches(branches);

                const savedBranchStillExists = activeBranch?.id
                    ? branches.some((branch) => String(branch.id) === String(activeBranch.id))
                    : false;

                if (activeBranch?.id && !savedBranchStillExists) {
                    selectActiveBranch(null);
                }

                if (branches.length === 1 && !activeBranch?.id) {
                    selectActiveBranch(branches[0]);
                } else if (branches.length > 1) {
                    setSelectedBranchId(String(
                        savedBranchStillExists ? activeBranch.id : branches[0]?.id || ''
                    ));
                }
            } catch (error) {
                if (!cancelled) {
                    setBranchError(error?.message || 'No se pudieron leer las sucursales del cliente');
                }
            } finally {
                if (!cancelled) {
                    setBranchLoading(false);
                    setBranchCheckComplete(true);
                }
            }
        };

        loadBranches();

        return () => {
            cancelled = true;
        };
    }, [tenant, currentUser, isAdminUser, loadingUser, activeBranch?.id, refreshClientBranches, selectActiveBranch]);

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

    useEffect(() => {
        if (!supportToken) {
            setSelectedSupportBranchId('');
            return;
        }
        const firstBranchId = selectedSupportBranches[0]?.id;
        const currentBranchStillExists = selectedSupportBranchId
            ? selectedSupportBranches.some((branch) => String(branch.id) === String(selectedSupportBranchId))
            : false;
        if (!currentBranchStillExists) {
            setSelectedSupportBranchId(firstBranchId ? String(firstBranchId) : '');
        }
    }, [supportToken, selectedClientId, selectedSupportBranches, selectedSupportBranchId]);

    const handleSupportAccess = async () => {
        const selectedClient = selectedSupportClient;
        if (!selectedClient) {
            setSupportError('Seleccioná un tenant para continuar');
            return;
        }
        const selectedBranch = selectedSupportBranches.find((branch) => String(branch.id) === String(selectedSupportBranchId)) || null;
        if (selectedSupportBranches.length > 1 && !selectedBranch) {
            setSupportError('Seleccioná una sucursal para continuar');
            return;
        }

        setLoading(true);
        const result = await activateSupportSession({
            token: supportToken,
            admin: supportAdmin,
            client: selectedClient,
            branch: selectedBranch || selectedSupportBranches[0] || null,
        });
        setLoading(false);

        if (!result.ok) {
            setSupportError(result.error);
        }
    };

    const handleBranchAccess = () => {
        const selectedBranch = clientBranches.find((branch) => String(branch.id) === String(selectedBranchId));
        if (!selectedBranch) {
            setBranchError('Seleccioná una sucursal para continuar');
            return;
        }
        selectActiveBranch(selectedBranch);
        navigate(from, { replace: true });
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

                    {requiresBranchSelection || hasBranchBlockingError ? (
                        <div className="login-form" style={{ marginTop: '1.5rem', textAlign: 'left' }}>
                            <div className="login-support-note">
                                <MapPin size={16} />
                                Seleccioná la sucursal con la que vas a operar.
                            </div>
                            {requiresBranchSelection && (
                                <div className="form-group">
                                    <label>Sucursal</label>
                                    <select
                                        className="form-input"
                                        value={selectedBranchId}
                                        onChange={(e) => setSelectedBranchId(e.target.value)}
                                        disabled={branchLoading}
                                    >
                                        {clientBranches.map((branch) => (
                                            <option key={branch.id} value={branch.id}>
                                                {branch.name}{branch.internalCode ? ` (${branch.internalCode})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {branchError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontSize: '0.85rem', background: 'rgba(239,68,68,0.1)', padding: '0.6rem 0.8rem', borderRadius: '8px' }}>
                                    <AlertCircle size={16} />
                                    {branchError}
                                </div>
                            )}
                            <button
                                type="button"
                                className="login-button"
                                onClick={handleBranchAccess}
                                disabled={branchLoading || !selectedBranchId || hasBranchBlockingError}
                                style={{ opacity: branchLoading || !selectedBranchId || hasBranchBlockingError ? 0.7 : 1 }}
                            >
                                <LogIn size={18} /> Entrar a la sucursal
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.95rem', lineHeight: 1.6 }}>
                                {loadingUser || branchLoading
                                    ? 'Cargando usuario...'
                                    : activeBranch?.name
                                        ? `Vas a operar en ${activeBranch.name}.`
                                        : 'Ya estás conectado con esta empresa.'}
                            </div>
                            <div className="login-form" style={{ marginTop: '1.5rem' }}>
                                <button
                                    type="button"
                                    className="login-button"
                                    onClick={() => navigate(from, { replace: true })}
                                    disabled={loadingUser || branchLoading}
                                >
                                    Ingresar al sistema
                                </button>
                            </div>
                        </>
                    )}
                    <div className="login-form" style={{ marginTop: requiresBranchSelection ? '1rem' : 0 }}>
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
                            Acceso exclusivo para administradores de Def-Software
                        </div>

                        <div className="form-group">
                            <label>Email o usuario interno</label>
                            <input
                                className="form-input"
                                type="text"
                                value={supportIdentifier}
                                onChange={(e) => setSupportIdentifier(e.target.value)}
                                placeholder=""
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

                                <div className="form-group">
                                    <label>Sucursal para operar</label>
                                    {selectedSupportBranches.length ? (
                                        <select
                                            className="form-input"
                                            value={selectedSupportBranchId}
                                            onChange={(e) => setSelectedSupportBranchId(e.target.value)}
                                        >
                                            {selectedSupportBranches.map((branch) => (
                                                <option key={branch.id} value={branch.id}>
                                                    {branch.name}{branch.internalCode ? ` (${branch.internalCode})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <div className="login-support-note">
                                            <MapPin size={16} />
                                            Este tenant no tiene sucursales activas cargadas.
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    disabled={loading || !selectedClientId || (selectedSupportBranches.length > 1 && !selectedSupportBranchId)}
                                    className="login-button"
                                    style={{ opacity: loading || !selectedClientId || (selectedSupportBranches.length > 1 && !selectedSupportBranchId) ? 0.7 : 1 }}
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
