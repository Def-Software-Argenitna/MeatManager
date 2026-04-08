import React from 'react';
import { ArrowLeftRight, Building2, MapPin, Phone, ShieldCheck, User } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { useTenant } from '../context/TenantContext';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import './Sucursales.css';

const Sucursales = () => {
    const { tenant } = useTenant();
    const { accessProfile, currentUser } = useUser();
    const branch = accessProfile?.branch || null;
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);

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
                            <h2>{branch?.name || 'Sin sucursal asignada'}</h2>
                            <p>
                                {branch
                                    ? 'Datos sincronizados desde Gestión de Clientes.'
                                    : 'Este usuario no tiene una sucursal asignada en GdC.'}
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
                            <span className="sucursal-readonly-value">{branch?.name || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Código interno</span>
                            <span className="sucursal-readonly-value">{branch?.internalCode || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Dirección</span>
                            <span className="sucursal-readonly-value">{branch?.address || '-'}</span>
                        </div>
                        <div className="sucursal-readonly-row">
                            <span className="sucursal-readonly-label">Estado</span>
                            <span className={`sucursal-status-pill ${branch?.status ? 'active' : 'muted'}`}>
                                {branch?.status || 'Sin asignar'}
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
                                <span>{tenant?.email || '-'}</span>
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
