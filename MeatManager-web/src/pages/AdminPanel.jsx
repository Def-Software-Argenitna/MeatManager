import React from 'react';
import { ShieldCheck, RefreshCw, ArrowRightLeft } from 'lucide-react';
import './AdminPanel.css';

const AdminPanel = () => {
    return (
        <div className="admin-panel-container animate-fade-in">
            <header className="admin-header">
                <div className="admin-brand">
                    <ShieldCheck size={32} color="gold" />
                    <div>
                        <h1>MeatManager Control Center</h1>
                        <p>Licencias administradas desde Gestión de Clientes</p>
                    </div>
                </div>
            </header>

            <main className="admin-content">
                <section className="admin-card table-card">
                    <div className="table-header" style={{ alignItems: 'center' }}>
                        <h3><RefreshCw size={20} /> Flujo Nuevo de Licencias</h3>
                    </div>
                    <div className="admin-table-wrapper" style={{ padding: '1.5rem' }}>
                        <div style={{ display: 'grid', gap: '1rem', color: 'var(--color-text-main)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700 }}>
                                <ArrowRightLeft size={18} />
                                El activador por código y Firestore quedó fuera de uso.
                            </div>
                            <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                                Las licencias web, módulos y permisos ahora se gestionan desde la app Gestión de Clientes en MySQL.
                                Firebase queda solo para autenticación.
                            </div>
                            <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                                Flujo vigente: crear cliente y asignar licencias en Gestión de Clientes, sincronizar usuario con Firebase,
                                guardar `firebaseUid` en MySQL y dejar que la app resuelva acceso al iniciar sesión.
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default AdminPanel;
