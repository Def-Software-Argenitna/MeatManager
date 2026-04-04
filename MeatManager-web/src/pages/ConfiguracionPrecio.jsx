import React, { useState, useEffect } from 'react';
import { db } from '../db';
import './ConfiguracionPrecio.css';

const ConfiguracionPrecio = () => {
    const [config, setConfig] = useState({
        formato: '4d2d', // '4d2d' = 4 dígitos + 2 decimales, '6d' = 6 dígitos sin decimales
    });

    useEffect(() => {
        const load = async () => {
            const formato = await db.settings.get('precio_formato');
            setConfig({ formato: formato?.value || '4d2d' });
        };
        load();
    }, []);

    const handleSave = async () => {
        await db.settings.put({ key: 'precio_formato', value: config.formato });
        alert('Configuración guardada');
    };

    return (
        <div className="neo-card" style={{ maxWidth: 400, margin: '2rem auto', padding: '2rem' }}>
            <h2>Configuración de Precio</h2>
            <div style={{ margin: '1rem 0' }}>
                <label>Formato de precio:</label>
                <select value={config.formato} onChange={e => setConfig({ formato: e.target.value })}>
                    <option value="4d2d">4 dígitos + 2 decimales (ej: 1234.56)</option>
                    <option value="6d">6 dígitos sin decimales (ej: 123456)</option>
                </select>
            </div>
            <button className="neo-button" onClick={handleSave}>Guardar</button>
        </div>
    );
};

export default ConfiguracionPrecio;
