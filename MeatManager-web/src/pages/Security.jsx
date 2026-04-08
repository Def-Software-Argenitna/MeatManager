import React, { useState, useEffect, useCallback } from 'react';
import {
    ShieldCheck, Key, RefreshCw, CheckCircle2, AlertTriangle, Lock,
    Users, UserPlus, Pencil, Trash2, ToggleLeft, ToggleRight, X, Save
} from 'lucide-react';
import { ALL_ROUTES, useUser } from '../context/UserContext';
import { fetchTable, getRemoteSetting, upsertRemoteSetting } from '../utils/apiClient';
import './Security.css';

/* ── Helpers ────────────────────────────── */
const ALL_GROUPS = [...new Set(ALL_ROUTES.map(r => r.group))];
const DRIVER_PATH = '/logistica';

const EMPTY_FORM = {
    username: '',
    email: '',
    password: '',
    role: 'employee',
    accountType: 'internal',
    selectedPaths: [],
    assignedClientLicenseIds: [],
};

const hasLogisticsCapability = (license) => Boolean(
    license?.hasLogisticsCapability
    || license?.license?.hasLogisticsCapability
);

const isBaseLicense = (license) => {
    const internalCode = String(license?.internalCode || license?.license?.internalCode || '').trim().toLowerCase();
    const category = String(license?.category || license?.license?.category || '').trim().toLowerCase();
    const commercialName = String(license?.commercialName || license?.license?.commercialName || '').trim().toLowerCase();
    return (
        internalCode === 'base_mm'
        || category === 'base_webapp'
        || internalCode === 'superuser'
        || internalCode === 'su'
        || category.includes('superuser')
        || commercialName.includes('superuser')
    );
};

const inferAccountType = (user) => {
    if (user?.role === 'admin') return 'admin';
    const hasDriverPermission = Array.isArray(user?._perms) && user._perms.includes(DRIVER_PATH);
    const hasDriverLicense = Array.isArray(user?.assignedLicenses) && user.assignedLicenses.some((license) => hasLogisticsCapability(license));
    return hasDriverPermission || hasDriverLicense ? 'driver' : 'internal';
};

const getUserTypeMeta = (user) => {
    const accountType = inferAccountType(user);
    if (accountType === 'admin') {
        return {
            label: 'Administrador',
            accent: '#f59e0b',
            background: 'rgba(245,158,11,0.15)',
        };
    }
    if (accountType === 'driver') {
        return {
            label: 'Repartidor',
            accent: '#34d399',
            background: 'rgba(52,211,153,0.15)',
        };
    }
    return {
        label: 'Usuario interno',
        accent: '#60a5fa',
        background: 'rgba(59,130,246,0.15)',
    };
};

/* ── User modal ─────────────────────────── */
const UserModal = ({ user, onClose, onSaved, toast, saveRecord, replacePermissions, licensePool = [] }) => {
    const [form, setForm] = useState(() => {
        if (!user) return EMPTY_FORM;
        return {
            username: user.username,
            email: user.email || '',
            password: '',
            role: user.role,
            accountType: inferAccountType(user),
            selectedPaths: (user._perms || []).filter((pathValue) => pathValue !== DRIVER_PATH),
            assignedClientLicenseIds: (user.assignedLicenses || []).map((license) => String(license.clientLicenseId)),
        };
    });
    const [loading, setLoading] = useState(false);
    const availablePerUserLicenses = licensePool.filter((assignment) => (
        String(assignment?.license?.billingScope || '').trim() === 'per_user'
    ));
    const logisticsLicenses = availablePerUserLicenses.filter((assignment) => hasLogisticsCapability(assignment));
    const optionalPerUserLicenses = availablePerUserLicenses.filter((assignment) => !hasLogisticsCapability(assignment));

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const togglePath = (path) => {
        setForm(f => ({
            ...f,
            selectedPaths: f.selectedPaths.includes(path)
                ? f.selectedPaths.filter(p => p !== path)
                : [...f.selectedPaths, path],
        }));
    };

    const toggleGroup = (group) => {
        const groupPaths = ALL_ROUTES.filter(r => r.group === group).map(r => r.path);
        const allSelected = groupPaths.every(p => form.selectedPaths.includes(p));
        setForm(f => ({
            ...f,
            selectedPaths: allSelected
                ? f.selectedPaths.filter(p => !groupPaths.includes(p))
                : [...new Set([...f.selectedPaths, ...groupPaths])],
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.username.trim()) return toast('error', 'El nombre de usuario es requerido');
        if (!form.email.trim()) return toast('error', 'El email es requerido');
        if (!/\S+@\S+\.\S+/.test(form.email.trim())) return toast('error', 'Ingresá un email válido');
        if (!user && form.password.length < 6) return toast('error', 'La contraseña debe tener al menos 6 caracteres');
        if (form.password && form.password.length < 6) return toast('error', 'La contraseña debe tener al menos 6 caracteres');
        const normalizedRole = form.accountType === 'admin' ? 'admin' : 'employee';
        const normalizedPerms = form.accountType === 'driver'
            ? [DRIVER_PATH]
            : form.accountType === 'internal'
                ? form.selectedPaths.filter((pathValue) => pathValue !== DRIVER_PATH)
                : [];

        if (
            normalizedRole === 'employee'
            && normalizedPerms.includes(DRIVER_PATH)
            && !logisticsLicenses.some((assignment) => (
                form.assignedClientLicenseIds.includes(String(assignment.id))
                && hasLogisticsCapability(assignment)
            ))
        ) {
            return toast('error', 'Para habilitar Logística, el usuario debe tener una licencia de entregas asignada');
        }

        setLoading(true);
        try {
            let userId = user?.id;
            if (user) {
                const update = {
                    username: form.username.trim(),
                    email: form.email.trim().toLowerCase(),
                    role: normalizedRole,
                    perms: normalizedPerms,
                    assignedClientLicenseIds: form.assignedClientLicenseIds.map((licenseId) => Number(licenseId)),
                };
                if (form.password) update.password = form.password;
                await saveRecord('users', 'update', update, userId);
            } else {
                const result = await saveRecord('users', 'insert', {
                    username: form.username.trim(),
                    email: form.email.trim().toLowerCase(),
                    password: form.password,
                    role: normalizedRole,
                    active: 1,
                    perms: normalizedPerms,
                    assignedClientLicenseIds: form.assignedClientLicenseIds.map((licenseId) => Number(licenseId)),
                });
                userId = result.insertId;
            }
            await replacePermissions(userId, normalizedPerms);

            toast('success', user ? 'Usuario actualizado' : 'Usuario creado');
            onSaved();
            onClose();
        } catch (err) {
            toast('error', 'Error al guardar: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '2rem 1rem', overflowY: 'auto',
        }} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={{
                background: 'var(--color-surface, #1e293b)', borderRadius: '16px',
                width: '100%', maxWidth: '560px', padding: '2rem',
                border: '1px solid rgba(255,255,255,0.1)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <UserPlus size={20} /> {user ? 'Editar Usuario' : 'Nuevo Usuario'}
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                        <label>Nombre de usuario</label>
                        <input
                            className="security-input"
                            value={form.username}
                            onChange={e => set('username', e.target.value)}
                            placeholder="Ej: María, Cajero 1..."
                            maxLength={40}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                        <label>Email de acceso</label>
                        <input
                            className="security-input"
                            type="email"
                            value={form.email}
                            onChange={e => set('email', e.target.value)}
                            placeholder="usuario@empresa.com"
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                        <label>Contraseña {user ? '(dejar vacío para no cambiar)' : '(mínimo 6 caracteres)'}</label>
                        <input
                            className="security-input"
                            type="password"
                            value={form.password}
                            onChange={e => set('password', e.target.value)}
                            placeholder={user ? '••••••' : 'Nueva contraseña'}
                            maxLength={128}
                        />
                    </div>

                    <div className="security-section" style={{ marginBottom: '1.5rem' }}>
                        <label className="security-section-title">Tipo de usuario</label>
                        <div className="security-account-types">
                            {[
                                {
                                    value: 'admin',
                                    title: 'Administrador',
                                    description: 'Acceso total a la web de MeatManager para gestionar el tenant.',
                                },
                                {
                                    value: 'internal',
                                    title: 'Usuario interno',
                                    description: 'Cajeros, vendedores u operadores con permisos configurables.',
                                },
                                {
                                    value: 'driver',
                                    title: 'Repartidor',
                                    description: logisticsLicenses.length > 0
                                        ? 'Usa logística y requiere una licencia de repartidor asignada.'
                                        : 'No hay licencias de repartidor disponibles para asignar.',
                                    disabled: logisticsLicenses.length === 0,
                                },
                            ].map((accountTypeOption) => (
                                <button
                                    key={accountTypeOption.value}
                                    type="button"
                                    className={`security-account-card ${form.accountType === accountTypeOption.value ? 'is-selected' : ''}`}
                                    disabled={Boolean(accountTypeOption.disabled)}
                                    onClick={() => set('accountType', accountTypeOption.value)}
                                >
                                    <span className="security-account-card-title">{accountTypeOption.title}</span>
                                    <span className="security-account-card-description">{accountTypeOption.description}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {form.accountType === 'internal' && (
                        <div className="security-section" style={{ marginBottom: '1.5rem' }}>
                            <label className="security-section-title">
                                Permisos del usuario interno
                            </label>
                            {ALL_GROUPS.map(group => {
                                const groupRoutes = ALL_ROUTES.filter((r) => r.group === group && r.path !== DRIVER_PATH);
                                const allSel = groupRoutes.every(r => form.selectedPaths.includes(r.path));
                                const someSel = groupRoutes.some(r => form.selectedPaths.includes(r.path));
                                if (groupRoutes.length === 0) return null;
                                return (
                                    <div key={group} style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '0.75rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: '600', marginBottom: '0.5rem' }}>
                                            <input
                                                type="checkbox"
                                                checked={allSel}
                                                ref={el => { if (el) el.indeterminate = !allSel && someSel; }}
                                                onChange={() => toggleGroup(group)}
                                            />
                                            {group}
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.3rem', paddingLeft: '1.5rem' }}>
                                            {groupRoutes.map(r => (
                                                <label key={r.path} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={form.selectedPaths.includes(r.path)}
                                                        onChange={() => togglePath(r.path)}
                                                    />
                                                    {r.label}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {form.accountType === 'driver' && (
                        <div className="security-section" style={{ marginBottom: '1.5rem' }}>
                            <label className="security-section-title">
                                Licencias de repartidor disponibles
                            </label>
                            <div className="security-license-list">
                                {logisticsLicenses.map((assignment) => {
                                    const assignedToCurrentUser = user && String(assignment.userId || '') === String(user.id);
                                    const assignedToOtherUser = assignment.userId != null && !assignedToCurrentUser;
                                    const checked = form.assignedClientLicenseIds.includes(String(assignment.id));

                                    return (
                                        <label
                                            key={assignment.id}
                                            className={`security-license-item ${assignedToOtherUser ? 'is-disabled' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={assignedToOtherUser}
                                                onChange={() => {
                                                    setForm((current) => ({
                                                        ...current,
                                                        assignedClientLicenseIds: checked
                                                            ? current.assignedClientLicenseIds.filter((id) => id !== String(assignment.id))
                                                            : [...current.assignedClientLicenseIds, String(assignment.id)],
                                                    }));
                                                }}
                                            />
                                            <div>
                                                <div className="security-license-title">
                                                    {assignment.license?.commercialName || 'Licencia de repartidor'}
                                                </div>
                                                <div className="security-license-description">
                                                    {assignedToOtherUser
                                                        ? `Asignada a ${assignment.user?.name || 'otro usuario'} ${assignment.user?.lastname || ''}`.trim()
                                                        : 'Habilita logística y seguimiento desde la app móvil'}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                                {logisticsLicenses.length === 0 && (
                                    <div className="security-empty-note">
                                        El tenant no tiene licencias de repartidor libres para asignar.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {(form.accountType === 'internal' || form.accountType === 'admin') && (
                        <div className="security-section" style={{ marginBottom: '1.5rem' }}>
                            <label className="security-section-title">
                                Licencias adicionales disponibles
                            </label>
                            <div className="security-license-list">
                                {optionalPerUserLicenses.map((assignment) => {
                                    const assignedToCurrentUser = user && String(assignment.userId || '') === String(user.id);
                                    const assignedToOtherUser = assignment.userId != null && !assignedToCurrentUser;
                                    const checked = form.assignedClientLicenseIds.includes(String(assignment.id));

                                    return (
                                        <label
                                            key={assignment.id}
                                            className={`security-license-item ${assignedToOtherUser ? 'is-disabled' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={assignedToOtherUser}
                                                onChange={() => {
                                                    setForm((current) => ({
                                                        ...current,
                                                        assignedClientLicenseIds: checked
                                                            ? current.assignedClientLicenseIds.filter((id) => id !== String(assignment.id))
                                                            : [...current.assignedClientLicenseIds, String(assignment.id)],
                                                    }));
                                                }}
                                            />
                                            <div>
                                                <div className="security-license-title">
                                                    {assignment.license?.commercialName || 'Licencia'}
                                                </div>
                                                <div className="security-license-description">
                                                    {assignedToOtherUser
                                                        ? `Asignada a ${assignment.user?.name || 'otro usuario'} ${assignment.user?.lastname || ''}`.trim()
                                                        : 'Disponible para asignar a este usuario'}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                                {optionalPerUserLicenses.length === 0 && (
                                    <div className="security-empty-note">
                                        No hay licencias adicionales por usuario disponibles en este tenant.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="security-section" style={{ marginBottom: '1.5rem' }}>
                        <label className="security-section-title">
                            Resumen de acceso
                        </label>
                        <div className="security-summary-box">
                            {form.accountType === 'admin' && (
                                <span>Este usuario tendrá acceso administrativo completo a MeatManager.</span>
                            )}
                            {form.accountType === 'internal' && (
                                <span>Este usuario podrá ingresar con los permisos que selecciones arriba. No necesita licencia de repartidor.</span>
                            )}
                            {form.accountType === 'driver' && (
                                <span>Este usuario se registrará como repartidor y necesita al menos una licencia logística asignada.</span>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} className="btn-security secondary">Cancelar</button>
                        <button type="submit" className="btn-security primary" disabled={loading}>
                            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                            {user ? 'Guardar Cambios' : 'Crear Usuario'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

/* ── Main component ─────────────────────── */
const Security = () => {
    const { currentUser, users, licensePool, refreshUsers, saveTableRecord: saveRecord, replaceUserPermissions } = useUser();
    const isAdmin = currentUser?.role === 'admin';
    const hasBaseLicense = licensePool.some((assignment) => isBaseLicense(assignment?.license));
    const availablePerUserLicenses = licensePool.filter((assignment) => String(assignment?.license?.billingScope || '').trim() === 'per_user');
    const availableLogisticsLicenses = availablePerUserLicenses.filter((assignment) => hasLogisticsCapability(assignment));
    const [activeTab, setActiveTab] = useState('pin');
    const [message, setMessage] = useState(null);

    // PIN tab state
    const [loading, setLoading] = useState(false);
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [storedPin, setStoredPin] = useState('1234');
    const [deleteCode, setDeleteCode] = useState('');
    const [confirmDeleteCode, setConfirmDeleteCode] = useState('');
    const [storedDeleteCode, setStoredDeleteCode] = useState('');

    // Users tab state
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [deletedTickets, setDeletedTickets] = useState([]);

    const toast = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 4000);
    };

    useEffect(() => {
        const loadSecuritySettings = async () => {
            const remoteMasterPin = await getRemoteSetting('master_pin');
            const remoteDeleteCode = await getRemoteSetting('ticket_delete_authorization_code');
            setStoredPin(remoteMasterPin || '1234');
            setStoredDeleteCode(remoteDeleteCode || '');
        };
        loadSecuritySettings();
    }, []);

    const loadUsers = useCallback(async () => {
        await refreshUsers();
    }, [refreshUsers]);

    useEffect(() => {
        if (activeTab === 'usuarios') loadUsers();
    }, [activeTab, loadUsers]);

    const loadDeletedTickets = useCallback(async () => {
        const history = await fetchTable('deleted_sales_history', {
            limit: 500,
            orderBy: 'deleted_at',
            direction: 'DESC',
        });
        setDeletedTickets(history);
    }, []);

    useEffect(() => {
        if (activeTab === 'tickets' && isAdmin) loadDeletedTickets();
    }, [activeTab, isAdmin, loadDeletedTickets]);

    const handleUpdatePin = async (e) => {
        e.preventDefault();
        if (currentPin !== storedPin) return toast('error', 'El PIN actual es incorrecto');
        if (newPin.length < 4) return toast('error', 'El nuevo PIN debe tener al menos 4 números');
        if (newPin !== confirmPin) return toast('error', 'Los nuevos PIN no coinciden');

        setLoading(true);
        try {
            await upsertRemoteSetting('master_pin', newPin);
            setStoredPin(newPin);
            setCurrentPin(''); setNewPin(''); setConfirmPin('');
            toast('success', 'PIN de Administración actualizado correctamente');
        } catch {
            toast('error', 'Error al actualizar el PIN');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateDeleteCode = async (e) => {
        e.preventDefault();
        if (!isAdmin) return toast('error', 'Solo un administrador puede cambiar este código');
        if (deleteCode.length < 4) return toast('error', 'El código debe tener al menos 4 dígitos');
        if (deleteCode !== confirmDeleteCode) return toast('error', 'Los códigos no coinciden');

        try {
            await upsertRemoteSetting('ticket_delete_authorization_code', deleteCode);
            setStoredDeleteCode(deleteCode);
            setDeleteCode('');
            setConfirmDeleteCode('');
            toast('success', 'Código de autorización para borrar tickets actualizado');
        } catch (err) {
            toast('error', 'Error al guardar el código: ' + err.message);
        }
    };

    const handleToggleActive = async (user) => {
        const activeAdmins = users.filter(u => u.role === 'admin' && u.active === 1);
        if (user.active === 1 && user.role === 'admin' && activeAdmins.length <= 1) {
            return toast('error', 'No podés desactivar el único administrador activo');
        }
        await saveRecord('users', 'update', { active: user.active === 1 ? 0 : 1 }, user.id);
        loadUsers();
    };

    const handleDelete = async (user) => {
        const activeAdmins = users.filter(u => u.role === 'admin' && u.active === 1);
        if (user.role === 'admin' && activeAdmins.length <= 1) {
            return toast('error', 'No podés eliminar el único administrador');
        }
        if (user.id === currentUser?.id) {
            return toast('error', 'No podés eliminar tu propio usuario');
        }
        if (!window.confirm(`¿Eliminar al usuario "${user.username}"?`)) return;
        await replaceUserPermissions(user.id, []);
        await saveRecord('users', 'delete', null, user.id);
        loadUsers();
        toast('success', `Usuario "${user.username}" eliminado`);
    };

    const openCreate = () => {
        if (!isAdmin) return toast('error', 'Solo un administrador puede crear usuarios');
        setEditingUser(null);
        setShowModal(true);
    };
    const openEdit = (user) => {
        if (!isAdmin) return toast('error', 'Solo un administrador puede editar usuarios');
        setEditingUser(user);
        setShowModal(true);
    };

    const tabStyle = (tab) => ({
        padding: '0.6rem 1.4rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontWeight: '600', fontSize: '0.9rem',
        background: activeTab === tab ? 'var(--color-primary, #f59e0b)' : 'rgba(255,255,255,0.06)',
        color: activeTab === tab ? '#000' : '#9ca3af',
        transition: 'all 0.2s',
    });

    return (
        <div className="security-container animate-fade-in">
            <header className="security-header">
                <ShieldCheck size={32} className="text-gold" />
                <div>
                    <h1>Seguridad y Usuarios</h1>
                    <p>Gestioná claves de administración y permisos de usuario</p>
                </div>
            </header>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <button style={tabStyle('pin')} onClick={() => setActiveTab('pin')}>
                    🔐 PIN de Admin
                </button>
                <button style={tabStyle('usuarios')} onClick={() => setActiveTab('usuarios')}>
                    👥 Usuarios
                </button>
                {isAdmin && (
                    <button style={tabStyle('tickets')} onClick={() => setActiveTab('tickets')}>
                        🧾 Tickets Borrados
                    </button>
                )}
            </div>

            {/* ── PIN Tab ───────────────────────────────── */}
            {activeTab === 'pin' && (
                <div className="security-grid">
                    <section className="security-card neo-card">
                        <div className="card-header">
                            <Key size={24} className="icon-header" />
                            <h3>Cambiar PIN Maestro</h3>
                        </div>
                        <p className="card-desc">Este PIN protege el <strong>Modo Master</strong> y permite ver el stock global de todas las sucursales.</p>

                        <form className="security-form" onSubmit={handleUpdatePin}>
                            <div className="form-group">
                                <label>PIN Actual:</label>
                                <input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value)} placeholder="****" maxLength={8} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Nuevo PIN:</label>
                                    <input type="password" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Nuevo" maxLength={8} />
                                </div>
                                <div className="form-group">
                                    <label>Confirmar Nuevo PIN:</label>
                                    <input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} placeholder="Repetir" maxLength={8} />
                                </div>
                            </div>
                            <button type="submit" className="btn-security primary" disabled={loading || !newPin}>
                                {loading ? <RefreshCw className="animate-spin" /> : <Lock size={18} />}
                                Actualizar PIN Maestro
                            </button>
                        </form>
                    </section>

                    {isAdmin && (
                        <section className="security-card neo-card">
                            <div className="card-header">
                                <Trash2 size={24} className="icon-header" />
                                <h3>Código de Autorización para Borrar Tickets</h3>
                            </div>
                            <p className="card-desc">Cada eliminación de ticket exige este código maestro. Compartilo sólo con personal autorizado.</p>

                            <form className="security-form" onSubmit={handleUpdateDeleteCode}>
                                <div className="form-group">
                                    <label>Código actual configurado:</label>
                                    <input type="text" value={storedDeleteCode ? 'Configurado' : 'Sin configurar'} disabled />
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Nuevo código:</label>
                                        <input
                                            type="password"
                                            value={deleteCode}
                                            onChange={e => setDeleteCode(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                            placeholder="Mínimo 4 dígitos"
                                            maxLength={12}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Confirmar código:</label>
                                        <input
                                            type="password"
                                            value={confirmDeleteCode}
                                            onChange={e => setConfirmDeleteCode(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                            placeholder="Repetir código"
                                            maxLength={12}
                                        />
                                    </div>
                                </div>
                                <button type="submit" className="btn-security primary" disabled={!deleteCode || !confirmDeleteCode}>
                                    <Key size={18} />
                                    Guardar Código de Borrado
                                </button>
                            </form>
                        </section>
                    )}

                    <div className="security-info-box">
                        <div className="info-icon"><AlertTriangle size={32} /></div>
                        <h4>¡Atención!</h4>
                        <p>No compartas el PIN Maestro ni el código de borrado de tickets con personal no autorizado.</p>
                    </div>
                </div>
            )}

            {/* ── Users Tab ─────────────────────────────── */}
            {activeTab === 'usuarios' && (
                <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div className="neo-card" style={{ padding: '1rem 1.25rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Licencia base
                            </div>
                            <div style={{ marginTop: '0.45rem', fontWeight: '700', color: hasBaseLicense ? '#34d399' : '#f87171' }}>
                                {hasBaseLicense ? 'Base / SuperUser activa' : 'No activa'}
                            </div>
                        </div>
                        <div className="neo-card" style={{ padding: '1rem 1.25rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Licencias por usuario disponibles
                            </div>
                            <div style={{ marginTop: '0.45rem', fontWeight: '700', color: '#fff' }}>
                                {availablePerUserLicenses.length}
                            </div>
                        </div>
                        <div className="neo-card" style={{ padding: '1rem 1.25rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Licencias de logística disponibles
                            </div>
                            <div style={{ marginTop: '0.45rem', fontWeight: '700', color: availableLogisticsLicenses.length > 0 ? '#f59e0b' : '#9ca3af' }}>
                                {availableLogisticsLicenses.length}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.9rem' }}>
                            {users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}
                        </p>
                        <button className="btn-security primary" onClick={openCreate} disabled={!isAdmin} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: isAdmin ? 1 : 0.55 }}>
                            <UserPlus size={16} /> Nuevo Usuario
                        </button>
                    </div>

                    {!isAdmin && (
                        <div className="neo-card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>
                            Solo el usuario administrador puede crear, editar, activar o eliminar usuarios.
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {users.map(user => (
                            <div key={user.id} className="neo-card" style={{
                                display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem',
                                opacity: user.active === 0 ? 0.5 : 1,
                            }}>
                                {/* Avatar */}
                                <div style={{
                                    width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
                                    background: user.role === 'admin'
                                        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                        : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '1.1rem', fontWeight: '800', color: '#fff',
                                }}>
                                    {user.username.charAt(0).toUpperCase()}
                                </div>

                                {/* Info */}
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {user.username}
                                        {user.id === currentUser?.id && (
                                            <span style={{ fontSize: '0.7rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '0.1rem 0.5rem', borderRadius: '999px' }}>
                                                (vos)
                                            </span>
                                        )}
                                    </div>
                                    {user.email && (
                                        <div style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                                            {user.email}
                                        </div>
                                    )}
                                    {(user.assignedLicenses || []).length > 0 && (
                                        <div style={{ fontSize: '0.82rem', color: '#d1d5db', marginTop: '0.25rem' }}>
                                            Licencias: {user.assignedLicenses.map((license) => (
                                                hasLogisticsCapability(license)
                                                    ? `${license.commercialName} (Logística)`
                                                    : license.commercialName
                                            )).join(', ')}
                                        </div>
                                    )}
                                    <div style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', gap: '0.75rem', marginTop: '0.2rem' }}>
                                        <span style={{
                                            padding: '0.1rem 0.5rem', borderRadius: '999px', fontWeight: '600',
                                            background: getUserTypeMeta(user).background,
                                            color: getUserTypeMeta(user).accent,
                                        }}>
                                            {getUserTypeMeta(user).label}
                                        </span>
                                        {user.role === 'employee' && (
                                            <span>{user._perms?.length || 0} permiso{user._perms?.length !== 1 ? 's' : ''}</span>
                                        )}
                                        {user.branch?.name && (
                                            <span>Sucursal: {user.branch.name}</span>
                                        )}
                                        {user.active === 0 && <span style={{ color: '#ef4444' }}>Inactivo</span>}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button title="Editar" onClick={() => openEdit(user)} disabled={!isAdmin}
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.5rem', cursor: isAdmin ? 'pointer' : 'not-allowed', color: '#9ca3af', opacity: isAdmin ? 1 : 0.45 }}>
                                        <Pencil size={16} />
                                    </button>
                                    <button title={user.active === 1 ? 'Desactivar' : 'Activar'} onClick={() => isAdmin && handleToggleActive(user)} disabled={!isAdmin}
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.5rem', cursor: isAdmin ? 'pointer' : 'not-allowed', color: user.active === 1 ? '#22c55e' : '#6b7280', opacity: isAdmin ? 1 : 0.45 }}>
                                        {user.active === 1 ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                    </button>
                                    <button title="Eliminar" onClick={() => isAdmin && handleDelete(user)} disabled={!isAdmin}
                                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '0.5rem', cursor: isAdmin ? 'pointer' : 'not-allowed', color: '#ef4444', opacity: isAdmin ? 1 : 0.45 }}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {users.length === 0 && (
                            <div className="neo-card" style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
                                <Users size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
                                <p>No hay usuarios. Creá el primero.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'tickets' && isAdmin && (
                <div>
                    <div className="neo-card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.4rem' }}>Historial de Tickets Borrados</h3>
                        <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.9rem' }}>
                            Cada ticket eliminado queda auditado con comprobante, importe, usuario y fecha de borrado.
                        </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {deletedTickets.map((ticket) => (
                            <div key={ticket.id} className="neo-card" style={{ padding: '1rem 1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                                            {ticket.receipt_code || `Venta ${String(ticket.sale_id || '').padStart(4, '0')}`}
                                        </div>
                                        <div style={{ color: '#9ca3af', fontSize: '0.84rem', marginTop: '0.25rem' }}>
                                            Venta: {ticket.sale_date ? new Date(ticket.sale_date).toLocaleString('es-AR') : 'Sin fecha'} | Borrado: {ticket.deleted_at ? new Date(ticket.deleted_at).toLocaleString('es-AR') : 'Sin fecha'}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 800, color: '#ef4444' }}>
                                            ${Number(ticket.total || 0).toLocaleString('es-AR')}
                                        </div>
                                        <div style={{ color: '#9ca3af', fontSize: '0.84rem', marginTop: '0.25rem' }}>
                                            {ticket.payment_method || 'Sin medio'} | {ticket.deleted_by_username || 'Sin usuario'}
                                        </div>
                                    </div>
                                </div>

                                {Array.isArray(ticket.items_snapshot) && ticket.items_snapshot.length > 0 && (
                                    <div style={{ marginTop: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
                                        <div style={{ color: '#9ca3af', fontSize: '0.8rem', marginBottom: '0.45rem' }}>Items del ticket</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            {ticket.items_snapshot.map((item, index) => (
                                                <div key={`${ticket.id}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.88rem' }}>
                                                    <span>{item.product_name}</span>
                                                    <span style={{ color: '#9ca3af' }}>
                                                        {Number(item.quantity || 0).toLocaleString('es-AR')} x ${Number(item.price || 0).toLocaleString('es-AR')}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {deletedTickets.length === 0 && (
                            <div className="neo-card" style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
                                <Trash2 size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
                                <p>No hay tickets borrados registrados.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal */}
            {showModal && isAdmin && (
                <UserModal
                    user={editingUser}
                    onClose={() => setShowModal(false)}
                    onSaved={loadUsers}
                    toast={toast}
                    saveRecord={saveRecord}
                    replacePermissions={replaceUserPermissions}
                    licensePool={licensePool}
                />
            )}

            {/* Toast */}
            {message && (
                <div className={`security-toast ${message.type}`}>
                    {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                    <span>{message.text}</span>
                    <button onClick={() => setMessage(null)}>&times;</button>
                </div>
            )}
        </div>
    );
};

export default Security;
