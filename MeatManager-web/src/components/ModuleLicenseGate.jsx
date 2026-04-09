import React from 'react';
import { Lock, Mail } from 'lucide-react';
import './ModuleLicenseGate.css';

const ModuleLicenseGate = ({ locked, moduleName, children }) => (
    <div className="module-license-gate">
        <div className={`module-license-gate__content ${locked ? 'is-locked' : ''}`}>
            {children}
        </div>

        {locked && (
            <div className="module-license-gate__overlay">
                <div className="module-license-gate__card">
                    <div className="module-license-gate__icon">
                        <Lock size={24} />
                    </div>
                    <h2>{moduleName}</h2>
                    <p>Se requiere la compra de una licencia para utilizar este módulo.</p>
                    <div className="module-license-gate__contact">
                        <Mail size={16} />
                        <span>Comunicarse a info@def-software.com para solicitarla</span>
                    </div>
                </div>
            </div>
        )}
    </div>
);

export default ModuleLicenseGate;
