import React, { useState, useEffect } from 'react';
import { fdb } from '../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { BRAND_CONFIG } from '../brandConfig';
import {
    ShieldCheck,
    Users,
    Key,
    Power,
    Trash2,
    Search,
    RefreshCw,
    Award,
    Clock
} from 'lucide-react';
import './AdminPanel.css';

const AdminPanel = () => {
    const [registrations, setRegistrations] = useState([]);
    const [licenses, setLicenses] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [manualId, setManualId] = useState('');
    const [generatedKey, setGeneratedKey] = useState('');

    useEffect(() => {
        // Listen for all device registrations
        const qReg = query(collection(fdb, "registrations"), orderBy("registeredAt", "desc"));
        const unsubReg = onSnapshot(qReg, (snapshot) => {
            const regs = [];
            snapshot.forEach(doc => regs.push(doc.data()));
            setRegistrations(regs);
        });

        // Listen for active licenses
        const unsubLic = onSnapshot(collection(fdb, "licenses"), (snapshot) => {
            const lics = {};
            snapshot.forEach(doc => {
                lics[doc.id] = doc.data();
            });
            setLicenses(lics);
        });

        return () => {
            unsubReg();
            unsubLic();
        };
    }, []);

    const generateKey = (id) => {
        if (!id) return '';
        const salt = BRAND_CONFIG.license_salt;
        let str = id + salt;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
        return `MM-PRO-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
    };

    const handleActivatePro = async (id) => {
        const key = generateKey(id);
        await setDoc(doc(fdb, "licenses", id), {
            status: 'pro',
            key: key,
            activatedAt: new Date().toISOString(),
            activatedBy: 'Admin Panel'
        });
    };

    const handleDeactivate = async (id) => {
        if (confirm(`¿Quitar licencia PRO a ${id}?`)) {
            await deleteDoc(doc(fdb, "licenses", id));
        }
    };

    const filteredRegs = registrations.filter(r =>
        r.installationId.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="admin-panel-container animate-fade-in">
            <header className="admin-header">
                <div className="admin-brand">
                    <ShieldCheck size={32} color="gold" />
                    <div>
                        <h1>MeatManager Control Center</h1>
                        <p>Gestión de Licencias y Activaciones Cloud</p>
                    </div>
                </div>
                <div className="admin-stats">
                    <div className="stat-pill">
                        <Users size={16} /> {registrations.length} Instalaciones
                    </div>
                    <div className="stat-pill pro">
                        <Award size={16} /> {Object.values(licenses).filter(l => l.status === 'pro').length} Licencias PRO
                    </div>
                </div>
            </header>

            <main className="admin-content">
                <section className="admin-card generator-card">
                    <h3><Key size={20} /> Generador de Claves Manual (Offline)</h3>
                    <div className="gen-form">
                        <input
                            type="text"
                            placeholder="Pegar ID de Instalación..."
                            value={manualId}
                            onChange={(e) => {
                                setManualId(e.target.value);
                                setGeneratedKey(generateKey(e.target.value));
                            }}
                            className="admin-input"
                        />
                        <div className="result-key">
                            <code>{generatedKey || 'MM-PRO-XXXX-XXXX'}</code>
                            <button onClick={() => navigator.clipboard.writeText(generatedKey)}>Copiar</button>
                        </div>
                    </div>
                    <p className="hint">Usá esto si el cliente no tiene internet y necesitás pasarle la clave por WhatsApp.</p>
                </section>

                <section className="admin-card table-card">
                    <div className="table-header">
                        <h3><RefreshCw size={20} /> Instalaciones Recientes</h3>
                        <div className="search-box">
                            <Search size={18} />
                            <input
                                type="text"
                                placeholder="Buscar por ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="admin-table-wrapper">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>ID de Instalación</th>
                                    <th>Fecha Registro</th>
                                    <th>Estado Actual</th>
                                    <th>Acciones Rápidas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRegs.map(reg => {
                                    const license = licenses[reg.installationId];
                                    const isPro = license?.status === 'pro';

                                    return (
                                        <tr key={reg.installationId} className={isPro ? 'row-pro' : ''}>
                                            <td className="id-cell">
                                                <code>{reg.installationId}</code>
                                            </td>
                                            <td className="date-cell">
                                                <div className="date-main">
                                                    <Clock size={12} /> {new Date(reg.registeredAt).toLocaleDateString()}
                                                </div>
                                                <small>{new Date(reg.registeredAt).toLocaleTimeString()}</small>
                                            </td>
                                            <td>
                                                {isPro ? (
                                                    <span className="badge pro">PRO ACTIVADO</span>
                                                ) : (
                                                    <span className="badge pending">LIGHT / PENDIENTE</span>
                                                )}
                                            </td>
                                            <td className="actions-cell">
                                                {isPro ? (
                                                    <button className="btn-action off" onClick={() => handleDeactivate(reg.installationId)}>
                                                        <Power size={16} /> Desactivar
                                                    </button>
                                                ) : (
                                                    <button className="btn-action on" onClick={() => handleActivatePro(reg.installationId)}>
                                                        <ShieldCheck size={16} /> Habilitar PRO
                                                    </button>
                                                )}
                                                <button className="btn-action icon" onClick={() => navigator.clipboard.writeText(generateKey(reg.installationId))} title="Ver Clave">
                                                    <Key size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default AdminPanel;
