import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Building2, MapPin, Phone, ShieldCheck, User } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { useTenant } from '../context/TenantContext';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchClientBranches } from '../utils/apiClient';
import './Sucursales.css';

const Sucursales = () => {
    const { tenant } = useTenant();
    const { accessProfile, currentUser } = useUser();
    const branch = accessProfile?.branch || null;
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const [branches, setBranches] = useState([]);

    useEffect(() => {
        let cancelled = false;

        const loadBranches = async () => {
            try {
                const data = await fetchClientBranches();
                if (!cancelled) {
                    setBranches(Array.isArray(data?.branches) ? data.branches : []);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('[SUCURSALES] No se pudieron leer las sucursales del tenant', error);
                    setBranches([]);
                }
            }
        };

        loadBranches();
        return () => {
            cancelled = true;
        };
    }, []);

    const currentBranch = useMemo(() => {
        if (branch?.id) {
            const matchedBranch = branches.find((item) => String(item.id) === String(branch.id));
            if (matchedBranch) return matchedBranch;
        }
        return branch || null;
    }, [branch, branches]);

    return (
        <div className="sucursales-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header sucursales-readonly-header">
                
            </header>
            </DirectionalReveal>

            <div className="sucursal-readonly-grid">
                <DirectionalReveal className="neo-card sucursal-readonly-card" from="left" delay={0.12}>
                    <div className="sucursal-readonly-card-head">
                        <div className="sucursal-readonly-icon">
                            <ArrowLeftRight size={22} />
                        </div>
                        <div>
                            <h2>{currentBranch?.name || 'Sin sucursal asignada'}</h2>
                            <p>
                                {branches.length > 0
                                    ? `El tenant tiene ${branches.length} sucursal${branches.length === 1 ? '' : 'es'} activa${branches.length === 1 ? '' : 's'} en GdC.`
                                    : 'Este tenant todavía no tiene sucursales activas sincronizadas desde GdC.'}
                            </p>
                        </div>
                    </div>

                    <div className="sucursal-readonly-body">
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Empresa</span>
                            <span className="sucursal-readonly-value">{tenant?.empresa || accessProfile?.username || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Sucursal</span>
                            <span className="sucursal-readonly-value">{currentBranch?.name || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Código interno</span>
                            <span className="sucursal-readonly-value">{currentBranch?.internalCode || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Dirección</span>
                            <span className="sucursal-readonly-value">{currentBranch?.address || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Estado</span>
                            <span className={`sucursal-status-pill ${currentBranch?.status ? 'active' : 'muted'}`}>
                                {currentBranch?.status || 'Sin asignar'}
                            </span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Sucursales del tenant</span>
                            <span className="sucursal-readonly-value">
                                {branches.length > 0
                                    ? branches.map((item) => item.internalCode ? `${item.name} (${item.internalCode})` : item.name).join(' • ')
                                    : '-'}
                            </span>
                        </div>
                    </div>
                </DirectionalReveal>

                <DirectionalReveal className="neo-card sucursal-readonly-card sucursal-readonly-info" from="right" delay={0.18}>
                    <h3>Contexto actual</h3>
                    <div className="sucursal-info-list">
                        <div className="sucursal-info-item">
                            <Building2 size={18} />
                            <div>
                                <strong>Tenant</strong>
                                <span>{tenant?.empresa || tenant?.email || '-'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <User size={18} />
                            <div>
                                <strong>Usuario</strong>
                                <span>{currentUser?.username || currentUser?.email || '-'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <ShieldCheck size={18} />
                            <div>
                                <strong>Rol</strong>
                                <span>{isAdmin ? 'Administrador' : 'Operador'}</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <MapPin size={18} />
                            <div>
                                <strong>Origen de datos</strong>
                                <span>Gestión de Clientes (GdC)</span>
                            </div>
                        </div>
                        <div className="sucursal-info-item">
                            <Phone size={18} />
                            <div>
                                <strong>Edición</strong>
                                <span>Alta, cambios y asignación de sucursal se hacen en GdC.</span>
                            </div>
                        </div>
                    </div>
                </DirectionalReveal>
            </div>
        </div>
    );
};

export default Sucursales;
