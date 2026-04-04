import React, { useEffect, useRef, useState } from 'react';
import { Barcode, X, Loader } from 'lucide-react';

// Tiempo máximo entre caracteres para considerarlo un scanner (ms)
// Un humano tipea ~150ms+; un scanner USB < 30ms por caracter
const SCANNER_CHAR_INTERVAL = 80;
// Tiempo de inactividad para auto-enviar si no llega Enter
const SCANNER_COMMIT_TIMEOUT = 150;

const handleBarcodeData = (onScan, code) => {
    console.log('📦 Código escaneado:', code);
    onScan(code);
};

const BarcodeScanner = ({ onScan, onError, isActive = true }) => {
    const [scannedCode, setScannedCode] = useState('');
    const [showCamera, setShowCamera] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const scannInputRef = useRef('');
    const lastKeyTimeRef = useRef(0);
    const commitTimerRef = useRef(null);
    const cameraRef = useRef(null);
    const streamRef = useRef(null);

    // Captura de escáner USB (teclado) con detección por velocidad
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e) => {
            if (e.target.tagName === 'TEXTAREA' ||
                e.target.contentEditable === 'true') {
                return;
            }

            const now = Date.now();
            const timeSinceLast = now - lastKeyTimeRef.current;

            // Enter = enviar código inmediatamente
            if (e.key === 'Enter') {
                if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
                if (scannInputRef.current.length >= 4) {
                    e.preventDefault();
                    handleBarcodeData(onScan, scannInputRef.current);
                }
                scannInputRef.current = '';
                lastKeyTimeRef.current = 0;
                setScannedCode('');
                return;
            }

            // Escape = limpiar
            if (e.key === 'Escape') {
                if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
                scannInputRef.current = '';
                lastKeyTimeRef.current = 0;
                setScannedCode('');
                return;
            }

            // Si el intervalo es muy largo (>80ms), probablemente es tipeo humano — resetear buffer
            if (timeSinceLast > SCANNER_CHAR_INTERVAL && scannInputRef.current.length > 0 && timeSinceLast < 2000) {
                // Si ya teníamos suficiente en el buffer, intentar enviarlo antes de resetear
                // (algunos scanners no envían Enter al final)
                if (scannInputRef.current.length >= 8) {
                    handleBarcodeData(onScan, scannInputRef.current);
                }
                scannInputRef.current = '';
                setScannedCode('');
            }

            // Aceptar caracteres alfanuméricos y especiales de códigos de barras
            if (e.key.length === 1 && /[\w\d\-.,;:]/.test(e.key)) {
                scannInputRef.current += e.key;
                lastKeyTimeRef.current = now;
                setScannedCode(scannInputRef.current);

                // Auto-commit si no llega Enter y el código ya tiene longitud de EAN-13
                if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
                if (scannInputRef.current.length >= 13) {
                    commitTimerRef.current = setTimeout(() => {
                        if (scannInputRef.current.length >= 8) {
                            handleBarcodeData(onScan, scannInputRef.current);
                            scannInputRef.current = '';
                            lastKeyTimeRef.current = 0;
                            setScannedCode('');
                        }
                    }, SCANNER_COMMIT_TIMEOUT);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        };
    }, [isActive, onError, onScan]);

    // Cámara (opcional, para futuros escaneos móviles)
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            if (cameraRef.current) {
                cameraRef.current.srcObject = stream;
                streamRef.current = stream;
                setIsCameraReady(true);
            }
        } catch (err) {
            onError('No se pudo acceder a la cámara: ' + err.message);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            setIsCameraReady(false);
            setShowCamera(false);
        }
    };

    return (
        <div className="barcode-scanner-widget">
            {/* Estado del escáner USB */}
            <div className="scanner-status">
                <div className="scanner-indicator">
                    <div className={`scanner-dot ${isActive ? 'active' : 'inactive'}`} />
                    <span>{isActive ? 'Escáner Activo' : 'Escáner Inactivo'}</span>
                </div>

                {showCamera && (
                    <button
                        className="btn-close-camera"
                        onClick={stopCamera}
                        title="Cerrar cámara"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Input invisible para capturar datos del escáner */}
            <input
                id="barcode-input"
                type="text"
                value={scannedCode}
                onChange={() => {}} // Read-only
                placeholder="Acercá el código de barras..."
                className="barcode-input-hidden"
                autoFocus
                tabIndex={0}
            />

            {/* Preview del código en tiempo real */}
            {scannedCode && (
                <div className="barcode-preview">
                    <Barcode size={16} />
                    <span>{scannedCode}</span>
                    <button
                        onClick={() => {
                            scannInputRef.current = '';
                            setScannedCode('');
                        }}
                        className="btn-clear"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Botón para cámara (futuro) */}
            {!showCamera && (
                <button
                    className="btn-camera-toggle"
                    onClick={() => {
                        setShowCamera(true);
                        startCamera();
                    }}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                >
                    📷 Cámara (Beta)
                </button>
            )}

            {/* Área de cámara */}
            {showCamera && (
                <div className="camera-container">
                    <video
                        ref={cameraRef}
                        autoPlay
                        playsInline
                        style={{ width: '100%', borderRadius: '4px' }}
                    />
                    {!isCameraReady && (
                        <div className="camera-loading">
                            <Loader size={24} className="spin" />
                            <p>Iniciando cámara...</p>
                        </div>
                    )}
                </div>
            )}

            <style jsx>{`
                .barcode-scanner-widget {
                    padding: 12px;
                    background: linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%);
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    border: 1px solid #dee2e6;
                }

                .scanner-status {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    background: white;
                    border-radius: 6px;
                    font-size: 0.85rem;
                    font-weight: 500;
                }

                .scanner-indicator {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .scanner-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    transition: all 0.3s ease;
                }

                .scanner-dot.active {
                    background: #10b981;
                    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
                }

                .scanner-dot.inactive {
                    background: #ef4444;
                }

                .barcode-input-hidden {
                    position: absolute;
                    left: -9999px;
                    opacity: 0;
                }

                .barcode-preview {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: white;
                    border: 2px solid #3b82f6;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: 600;
                    color: #1e40af;
                }

                .btn-clear {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: #ef4444;
                    padding: 4px;
                    display: flex;
                    align-items: center;
                    margin-left: auto;
                    transition: color 0.2s;
                }

                .btn-clear:hover {
                    color: #dc2626;
                }

                .btn-camera-toggle {
                    padding: 6px 8px;
                    background: #8b5cf6;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.75rem;
                    transition: background 0.2s;
                }

                .btn-camera-toggle:hover {
                    background: #7c3aed;
                }

                .btn-close-camera {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: #6b7280;
                    padding: 4px;
                    display: flex;
                    align-items: center;
                    transition: color 0.2s;
                }

                .btn-close-camera:hover {
                    color: #1f2937;
                }

                .camera-container {
                    position: relative;
                    width: 100%;
                    max-height: 200px;
                    background: #000;
                    border-radius: 6px;
                    overflow: hidden;
                }

                .camera-loading {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    font-size: 0.85rem;
                }

                .spin {
                    animation: spin 1s linear infinite;
                }

                @keyframes spin {
                    from {
                        transform: rotate(0deg);
                    }
                    to {
                        transform: rotate(360deg);
                    }
                }
            `}</style>
        </div>
    );
};

export default BarcodeScanner;
