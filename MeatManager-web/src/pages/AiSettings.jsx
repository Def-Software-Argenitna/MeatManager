import React, { useState, useEffect } from 'react';
import {
    Cpu,
    Bot,
    Settings2,
    Zap,
    AlertCircle,
    CheckCircle2,
} from 'lucide-react';
import { getRemoteSetting, upsertRemoteSetting } from '../utils/apiClient';
import './AiSettings.css';

const AiSettings = () => {
    const [config, setConfig] = useState({
        tgToken: '',
        aiModel: 'llama3',
        aiEnabled: false
    });
    const [status, setStatus] = useState('idle');
    useEffect(() => {
        const loadSettings = async () => {
            const [tgToken, aiModel, aiEnabled] = await Promise.all([
                getRemoteSetting('tg_bot_token'),
                getRemoteSetting('ai_model'),
                getRemoteSetting('ai_enabled'),
            ]);

            setConfig({
                tgToken: tgToken || '',
                aiModel: aiModel || 'llama3',
                aiEnabled: aiEnabled === true || aiEnabled === 'true' || aiEnabled === 1 || aiEnabled === '1'
            });
        };
        loadSettings();
    }, []);

    const handleSave = async () => {
        setStatus('saving');
        try {
            await Promise.all([
                upsertRemoteSetting('tg_bot_token', config.tgToken),
                upsertRemoteSetting('ai_model', config.aiModel),
                upsertRemoteSetting('ai_enabled', config.aiEnabled),
            ]);

            setStatus('success');
            setTimeout(() => setStatus('idle'), 3000);
        } catch {
            setStatus('error');
        }
    };

    return (
        <div className="ai-settings-container animate-fade-in">
            <header className="ai-settings-header">
                <div className="header-icon">
                    <Cpu size={32} />
                    <Bot size={20} className="badge-icon" />
                </div>
                <div>
                    <h1>Asistente de IA Local</h1>
                    <p>Configura tu asistente personal basado en Llama 3 para reportes y Telegram</p>
                </div>
            </header>

            <div className="ai-grid">
                {/* AI Model Config */}
                <section className="settings-card">
                    <h3><Zap size={20} className="text-primary" /> IA en versión web</h3>
                    <p className="description">
                        Esta versión funciona como cliente web. Si usás Ollama local o un backend de IA, el navegador debe poder acceder a ese endpoint.
                    </p>

                    <div className="form-group">
                        <label>Modelo de Lenguaje</label>
                        <select
                            value={config.aiModel}
                            onChange={(e) => setConfig({ ...config, aiModel: e.target.value })}
                            className="ai-input"
                        >
                            <option value="llama3">Llama 3 (Equilibrado)</option>
                            <option value="llama3.2:1b">Llama 3.2 1B (Ligero - Recomendado)</option>
                            <option value="mistral">Mistral</option>
                            <option value="phi3">Phi-3 (Microsoft - Muy liviano)</option>
                        </select>
                        <small>El modelo se guarda para las consultas IA de la app web.</small>
                    </div>

                    <div className="toggle-group">
                        <span>Habilitar Asistente</span>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={config.aiEnabled}
                                onChange={(e) => setConfig({ ...config, aiEnabled: e.target.checked })}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </section>

                {/* Telegram Config */}
                <section className="settings-card">
                    <h3><Bot size={20} className="text-info" /> Token de integración</h3>
                    <p className="description">
                        El token queda guardado para una futura integración backend. En navegador no se inicia ningún bot local.
                    </p>

                    <div className="form-group">
                        <label>Token del Bot (@BotFather)</label>
                        <input
                            type="password"
                            placeholder="712345678:AAE..."
                            value={config.tgToken}
                            onChange={(e) => setConfig({ ...config, tgToken: e.target.value })}
                            className="ai-input"
                        />
                    </div>

                    <div className="steps-box">
                        <h4>Modo web</h4>
                        <ol>
                            <li>Guardá el token y el modelo desde esta pantalla.</li>
                            <li>La ejecución del bot debe resolverse en backend, no en el navegador.</li>
                            <li>La IA de la app sigue disponible como cliente web.</li>
                        </ol>
                    </div>
                </section>
            </div>

            <footer className="ai-footer">
                {status === 'success' && <div className="status-msg success"><CheckCircle2 size={16} /> Configuración guardada</div>}
                {status === 'error' && <div className="status-msg error"><AlertCircle size={16} /> Error al guardar</div>}

                <button className="btn-save-ai" onClick={handleSave} disabled={status === 'saving'}>
                    {status === 'saving' ? <Settings2 className="animate-spin" /> : <CheckCircle2 size={18} />}
                    Guardar Configuración Web
                </button>
            </footer>
        </div>
    );
};

export default AiSettings;
