import React, { useState, useEffect } from 'react';
import DirectionalReveal from '../components/DirectionalReveal';
import { getRemoteSetting, upsertRemoteSetting } from '../utils/apiClient';
import './ConfiguracionPrecio.css';

const ConfiguracionPrecio = () => {
    const [config, setConfig] = useState({
        formato: '4d2d', // '4d2d' = 4 dígitos + 2 decimales, '6d' = 6 dígitos sin decimales
    });

    useEffect(() => {
        const load = async () => {
            const formato = await getRemoteSetting('precio_formato');
            setConfig({ formato: formato || '4d2d' });
        };
        load();
    }, []);

    const handleSave = async () => {
        await upsertRemoteSetting('precio_formato', config.formato);
        alert('Configuración guardada');
    };

    return (
        <div className="config-precio-page animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                <h1 className="page-title">Formato de Precio</h1>
                <p className="page-description">Definí cómo interpreta y muestra los precios el sistema.</p>
            </header>
            </DirectionalReveal>

            <DirectionalReveal className="neo-card config-precio-card" from="down" delay={0.1}>
                <h2 className="config-precio-title">Configuración de Precio</h2>
                <div className="config-precio-field">
                    <label>Formato de precio</label>
                    <select className="neo-input" value={config.formato} onChange={e => setConfig({ formato: e.target.value })}>
                        <option value="4d2d">4 dígitos + 2 decimales (ej: 1234.56)</option>
                        <option value="6d">6 dígitos sin decimales (ej: 123456)</option>
                    </select>
                </div>

                <div className="config-precio-preview">
                    <div className="config-precio-preview-label">Vista rápida</div>
                    <div className="config-precio-preview-value">
                        {config.formato === '4d2d' ? '1234.56' : '123456'}
                    </div>
                </div>

                <button className="neo-button config-precio-btn" onClick={handleSave}>Guardar</button>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionPrecio;
