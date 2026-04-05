import React, { useEffect, useState } from 'react';
import { CheckCircle, Cpu, Globe } from 'lucide-react';
import { getRemoteSetting } from '../utils/apiClient';

const AiBackgroundManager = () => {
    const [status, setStatus] = useState({ enabled: false, model: 'llama3' });

    useEffect(() => {
        const initAI = async () => {
            const [aiEnabled, aiModel] = await Promise.all([
                getRemoteSetting('ai_enabled'),
                getRemoteSetting('ai_model'),
            ]);

            setStatus({
                enabled: aiEnabled === true || aiEnabled === 'true' || aiEnabled === 1 || aiEnabled === '1',
                model: aiModel || 'llama3'
            });
        };

        initAI();
    }, []);

    return (
        <div style={{
            position: 'fixed',
            bottom: '1rem',
            left: '1rem',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.5rem 1rem',
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            borderRadius: '2rem',
            fontSize: '0.75rem',
            backdropFilter: 'blur(5px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
            <Globe size={14} style={{ color: status.enabled ? '#22c55e' : '#94a3b8' }} />
            <span style={{ fontWeight: '600' }}>IA:</span>
            <span style={{ opacity: 0.9 }}>
                {status.enabled ? `Modo web listo (${status.model})` : 'Modo web desactivado'}
            </span>
            {status.enabled ? <CheckCircle size={14} className="text-success" /> : <Cpu size={14} />}
        </div>
    );
};

export default AiBackgroundManager;
