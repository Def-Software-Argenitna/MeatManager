import React, { useState } from 'react';
import {
    Database,
    Download,
    Upload,
    AlertTriangle,
    CheckCircle2,
    RefreshCw,
    ShieldAlert,
    Trash2
} from 'lucide-react';
import { exportFullBackup, importFullBackup } from '../utils/backupService';
import { desktopApi } from '../utils/desktopApi';
import './Maintenance.css';

const Maintenance = () => {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    const handleExport = async () => {
        setLoading(true);
        try {
            await exportFullBackup();
            setMessage({ type: 'success', text: 'Respaldo generado con éxito' });
        } catch {
            setMessage({ type: 'error', text: 'Error al generar respaldo' });
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setLoading(true);
        try {
            const success = await importFullBackup(file);
            if (success) {
                setMessage({ type: 'success', text: 'Datos restaurados con éxito. La aplicación se reiniciará.' });
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch {
            setMessage({ type: 'error', text: 'Error al restaurar el respaldo' });
        } finally {
            setLoading(false);
            e.target.value = ''; // Reset input
        }
    };

    const handleClearSync = async () => {
        setMessage({ type: 'error', text: 'La resincronización local fue retirada. La app ahora trabaja directo sobre MySQL.' });
    };

    const handleNukeGlobal = async () => {
        const step1 = confirm("¡ATENCIÓN! Estás por BORRAR TODA LA INFORMACIÓN de esta computadora. ¿Estás completamente seguro?");
        if (!step1) return;

        const step2 = confirm("¿Realmente querés perder todas las ventas, stock y configuraciones? Esta acción NO se puede deshacer.");
        if (!step2) return;

        const typed = prompt("Para confirmar la eliminación total, escribí 'BORRAR TODO' en mayúsculas:");
        if (typed !== 'BORRAR TODO') {
            alert("Operación cancelada. El texto ingresado no coincide.");
            return;
        }

        setMessage({ type: 'error', text: 'La base local IndexedDB fue retirada. Esta acción ya no aplica en la app actual.' });
    };

    return (
        <div className="maintenance-container animate-fade-in">
            <header className="maintenance-header">
                <Database size={32} className="text-primary" />
                <div>
                    <h1>Mantenimiento y Backup</h1>
                    <p>Gestiona la integridad de tus datos y copias de seguridad</p>
                </div>
            </header>

            <div className="maintenance-grid">
                {/* Backup Card */}
                <section className="maintenance-card">
                    <div className="card-icon export">
                        <Download size={24} />
                    </div>
                    <h3>Copia de Seguridad Total</h3>
                    <p>Descarga un archivo con toda la información de la app: stock, ventas, clientes, proveedores, precios, etc.</p>
                    <button
                        className="btn-maintenance export"
                        onClick={handleExport}
                        disabled={loading}
                    >
                        {loading ? <RefreshCw className="animate-spin" /> : <Download size={18} />}
                        Generar Backup (.json)
                    </button>
                </section>

                {/* Restore Card */}
                <section className="maintenance-card">
                    <div className="card-icon import">
                        <Upload size={24} />
                    </div>
                    <h3>Restaurar Backup</h3>
                    <p>Carga un archivo de respaldo previo. <strong className="text-danger">Aviso: Esto borrará los datos actuales.</strong></p>
                    <label className="btn-maintenance import">
                        <Upload size={18} />
                        Seleccionar Archivo
                        <input type="file" accept=".json" onChange={handleImport} hidden disabled={loading} />
                    </label>
                </section>

                {/* Cloud Sync Fix Card */}
                <section className="maintenance-card">
                    <div className="card-icon sync">
                        <RefreshCw size={24} />
                    </div>
                    <h3>Resetear Sincronización</h3>
                    <p>Si notas que faltan datos en la nube, puedes forzar una resincronización de todos los registros.</p>
                    <button
                        className="btn-maintenance sync"
                        onClick={handleClearSync}
                        disabled={loading}
                    >
                        <RefreshCw size={18} />
                        Forzar Resincronización
                    </button>
                </section>

                {/* Safety Card */}
                <section className="maintenance-card danger">
                    <div className="card-icon danger">
                        <ShieldAlert size={24} />
                    </div>
                    <h3>Zona de Riesgo</h3>
                    <p>Borrado completo de la base de datos local para limpiezas de temporada o cambio de dueño.</p>
                    <button
                        className="btn-maintenance danger"
                        onClick={handleNukeGlobal}
                        disabled={loading}
                    >
                        {loading ? <RefreshCw className="animate-spin" /> : <Trash2 size={18} />}
                        Borrar Todo el Local
                    </button>
                </section>
            </div>

            {message && (
                <div className={`maintenance-toast ${message.type}`}>
                    {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                    <span>{message.text}</span>
                    <button onClick={() => setMessage(null)}>&times;</button>
                </div>
            )}
        </div>
    );
};

export default Maintenance;
