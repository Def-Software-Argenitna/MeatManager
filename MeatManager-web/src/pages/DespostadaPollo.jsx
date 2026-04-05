import React, { useState } from 'react';
import { Save, RotateCcw, Check } from 'lucide-react';
import { scaleService } from '../utils/SerialScaleService';
import { useLicense } from '../context/LicenseContext';
import { buildDespostadaLogPayload } from '../utils/despostadaSession';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import './DespostadaPollo.css';

// Detailed cuts mapping for chicken
const CHICKEN_MAP = [
    { number: 1, id: 'cabeza', name: 'Cabeza', category: 'cabeza' },
    { number: 2, id: 'cuello', name: 'Cuello', category: 'cuello' },
    { number: 3, id: 'espinazo', name: 'Espinazo', category: 'centro' },
    { number: 4, id: 'rabadilla', name: 'Rabadilla', category: 'trasero' },
    { number: 5, id: 'pechuga', name: 'Pechuga', category: 'pechuga' },
    { number: 6, id: 'alita', name: 'Alita', category: 'ala' },
    { number: 7, id: 'contramuslo', name: 'Contramuslo', category: 'pierna' },
    { number: 8, id: 'muslo', name: 'Muslo', category: 'pierna' },
    { number: 9, id: 'pecho', name: 'Pecho', category: 'pechuga' },
];

const DespostadaPollo = () => {
    const { hasModule } = useLicense();
    // Session State
    const [initialWeight, setInitialWeight] = useState('');
    const [selectedLotId, setSelectedLotId] = useState(null);
    const [selectedLotSupplier, setSelectedLotSupplier] = useState('');
    const [costPerKg, setCostPerKg] = useState(0);
    const [isSessionStarted, setIsSessionStarted] = useState(false);
    const [availableLots, setAvailableLots] = useState([]);
    const [compras, setCompras] = useState([]);

    const loadDespostadaData = React.useCallback(async () => {
        const [lotRows, comprasRows] = await Promise.all([
            fetchTable('animal_lots'),
            fetchTable('compras'),
        ]);
        setAvailableLots((Array.isArray(lotRows) ? lotRows : []).filter((lot) => lot.status === 'disponible' && lot.species === 'pollo'));
        setCompras(Array.isArray(comprasRows) ? comprasRows : []);
    }, []);

    React.useEffect(() => {
        loadDespostadaData().catch((error) => console.error('Error cargando despostada pollo:', error));
    }, [loadDespostadaData]);

    // Workspace State
    const [selectedCutId, setSelectedCutId] = useState(null);
    const [currentWeight, setCurrentWeight] = useState('');
    const [isScaleConnected, setIsScaleConnected] = useState(false);
    const [isSimulated, setIsSimulated] = useState(false);
    const [logs, setLogs] = useState([]);

    // Calculated
    const processedWeight = logs.reduce((acc, log) => acc + log.weight, 0);
    const yieldPercentage = isSessionStarted && initialWeight > 0
        ? ((processedWeight / initialWeight) * 100).toFixed(1)
        : 0;

    if (!hasModule('despostada')) {
        return (
            <div className="pro-locked-container animate-fade-in">
                <h2>Módulo de Despostada</h2>
                <p>La despostada se habilita desde Gestión de Clientes, no por código local.</p>
                <button className="neo-button pro-btn" onClick={() => window.location.hash = '#/config/licencia'}>
                    Ver estado de licencias
                </button>
            </div>
        );
    }

    const startSession = async () => {
        if (!initialWeight || initialWeight <= 0) {
            alert("Por favor ingrese el peso inicial o seleccione un animal de stock.");
            return;
        }
        setIsSessionStarted(true);
    };

    const handleSelectLot = async (lot) => {
        setSelectedLotId(lot.id);
        setSelectedLotSupplier(lot.supplier || '');
        setInitialWeight(lot.weight);

        if (lot.purchase_id) {
            const purchase = compras.find((item) => Number(item.id) === Number(lot.purchase_id));
            if (purchase?.items_detail) {
                const itemMatch = purchase.items_detail.find(i =>
                    i.type === 'despostada' && (i.species === 'pollo' || i.name.toLowerCase().includes('pollo'))
                );
                if (itemMatch) {
                    const cost = itemMatch.unit === 'kg'
                        ? itemMatch.unit_price
                        : (itemMatch.unit_price / (itemMatch.weight / itemMatch.quantity));
                    setCostPerKg(cost || 0);
                }
            }
        }
    };

    const finishSession = async () => {
        if (!isSessionStarted) return;

        if (window.confirm('¿Finalizar troceado de pollo?')) {
            if (selectedLotId) {
                await saveTableRecord('animal_lots', 'update', { status: 'despostado' }, selectedLotId);
            }

            const selectedLot = availableLots?.find((lot) => lot.id === selectedLotId) || null;
            await saveTableRecord('despostada_logs', 'insert', buildDespostadaLogPayload({
                type: 'pollo',
                supplier: selectedLotSupplier,
                initialWeight,
                yieldPercentage,
                cuts: logs,
                selectedLot,
                costPerKg
            }));
            await loadDespostadaData();

            setIsSessionStarted(false);
            setLogs([]);
            setInitialWeight('');
            setSelectedLotId(null);
            setSelectedLotSupplier('');
            setCostPerKg(0);
            alert('Proceso finalizado.');
        }
    };

    const handleCutClick = (id) => {
        if (!isSessionStarted) return;
        setSelectedCutId(id);
        setCurrentWeight('');

        // Auto-read if scale is connected
        if (isScaleConnected || isSimulated) {
            handleReadScale();
        }
    };

    const handleConnectScale = async () => {
        const success = await scaleService.requestPort();
        if (!success) {
            alert("⚠️ No se detectó ninguna balanza.\n\nVerificá que:\n• La balanza esté encendida\n• El cable USB esté conectado\n• Instalaste el driver del fabricante\n\nSi no tenés balanza, usá el Modo Test.");
            return;
        }
        const connected = await scaleService.connect();
        setIsScaleConnected(connected);
        if (connected) {
            setIsSimulated(false);
            alert("✅ Balanza conectada correctamente.");
        } else {
            alert("⚠️ No se pudo abrir el puerto serie. Probá desconectar y volver a conectar el cable.");
        }
    };

    const handleReadScale = async () => {
        if (isSimulated) {
            const weight = (Math.random() * 5 + 1).toFixed(3);
            setCurrentWeight(weight);
            return;
        }

        if (!isScaleConnected) return;
        const weight = await scaleService.readWeight();
        if (weight !== null) {
            setCurrentWeight(weight.toString());
        }
    };

    const confirmCut = async () => {
        if (!selectedCutId || !currentWeight) return;

        const cutInfo = CHICKEN_MAP.find(c => c.id === selectedCutId);
        const weightVal = parseFloat(currentWeight);

        const newLog = {
            cutId: selectedCutId,
            cutNumber: cutInfo.number,
            cutName: cutInfo.name,
            cutCategory: cutInfo.category,
            weight: weightVal,
            timestamp: new Date()
        };

        setLogs([newLog, ...logs]);

        // Save to DB
        await saveTableRecord('stock', 'insert', {
            name: cutInfo.name,
            type: 'pollo',
            quantity: weightVal,
            updated_at: new Date().toISOString(),
        });

        // Reset for next cut
        setSelectedCutId(null);
        setCurrentWeight('');
    };

    const selectedCut = CHICKEN_MAP.find(c => c.id === selectedCutId);
    const isCutProcessed = (id) => logs.some(l => l.cutId === id);

    return (
        <div className="despostada-container animate-fade-in">

            {/* HEADER: Configuration & Status */}
            <div className="session-setup">
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flex: 1 }}>
                    <div className="weight-input-group">
                        <label>Stock Disponible (Cajón/Pollo Entero)</label>
                        <select
                            className="neo-input"
                            disabled={isSessionStarted}
                            value={selectedLotId || ''}
                            onChange={(e) => {
                                const lot = availableLots.find(l => l.id === parseInt(e.target.value));
                                if (lot) handleSelectLot(lot);
                                else { setSelectedLotId(null); setInitialWeight(''); }
                            }}
                        >
                            <option value="">
                                {availableLots?.length === 0 ? '-- No hay stock en cámara --' : '-- Seleccionar o Ingreso Manual --'}
                            </option>
                            {availableLots?.map(l => (
                                <option key={l.id} value={l.id}>
                                    {l.date} - {l.supplier} - {l.weight} kg
                                </option>
                            ))}
                        </select>
                        {availableLots?.length === 0 && !isSessionStarted && (
                            <div style={{ fontSize: '0.75rem', color: 'orange', marginTop: '0.25rem' }}>
                                💡 Recordá registrar la COMPRA del pollo para que aparezca acá.
                            </div>
                        )}
                    </div>

                    <div className="weight-input-group">
                        <label>Peso Inicial</label>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <input
                                type="number"
                                className="big-input"
                                placeholder="00.0"
                                value={initialWeight}
                                disabled={isSessionStarted || selectedLotId}
                                onChange={(e) => setInitialWeight(e.target.value)}
                            />
                            <span style={{ fontSize: '1.5rem', fontWeight: '500', color: 'var(--color-text-muted)' }}>kg</span>
                        </div>
                    </div>

                    {!isSessionStarted ? (
                        <button className="action-btn" style={{ width: 'auto', padding: '0.5rem 2rem' }} onClick={startSession}>
                            INICIAR LOTE
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="neo-button" style={{ color: '#22c55e', borderColor: '#22c55e' }} onClick={finishSession}>
                                <Check size={16} /> FINALIZAR
                            </button>
                            <button
                                className="nav-item"
                                style={{ width: 'auto', border: '1px solid var(--color-border)' }}
                                onClick={() => { if (confirm('¿Reiniciar sesión?')) { setIsSessionStarted(false); setLogs([]); setInitialWeight(''); setSelectedLotId(null); } }}
                            >
                                <RotateCcw size={16} /> Reiniciar
                            </button>
                        </div>
                    )}
                </div>

                {isSessionStarted && (
                    <div style={{ textAlign: 'right', minWidth: '200px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>Rendimiento</span>
                            <span style={{ fontWeight: '700', color: yieldPercentage > 70 ? '#22c55e' : 'var(--color-text-main)' }}>
                                {yieldPercentage}%
                            </span>
                        </div>
                        <div className="yield-meter">
                            <div className="yield-fill" style={{ width: `${Math.min(yieldPercentage, 100)}%`, backgroundColor: yieldPercentage > 70 ? '#22c55e' : 'var(--color-primary)' }}></div>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                            Procesado: {processedWeight.toFixed(2)} kg
                        </div>
                    </div>
                )}
            </div>

            <div className="workspace-area" style={{ gridTemplateColumns: '280px 1fr 350px' }}>

                {/* LEFT PANEL: Cuts List */}
                <div className="cuts-list-panel" style={{
                    backgroundColor: 'var(--color-bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', fontWeight: '700', fontSize: '0.9rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                        Lista de Cortes ({CHICKEN_MAP.length})
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {CHICKEN_MAP.map(cut => {
                            const isProcessed = isCutProcessed(cut.id);
                            const isSelected = selectedCutId === cut.id;

                            return (
                                <button
                                    key={cut.id}
                                    onClick={() => handleCutClick(cut.id)}
                                    disabled={!isSessionStarted}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        border: 'none',
                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        background: isSelected ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                                        color: isSelected ? '#ef4444' : (isProcessed ? '#22c55e' : 'var(--color-text-main)'),
                                        cursor: isSessionStarted ? 'pointer' : 'not-allowed',
                                        textAlign: 'left',
                                        transition: 'all 0.2s',
                                        opacity: isSessionStarted ? 1 : 0.5
                                    }}
                                >
                                    <span style={{
                                        fontWeight: '700',
                                        marginRight: '0.75rem',
                                        width: '24px',
                                        textAlign: 'right',
                                        color: isSelected ? '#ef4444' : 'var(--color-text-muted)'
                                    }}>
                                        {cut.number}.
                                    </span>
                                    <span style={{ flex: 1, fontWeight: isSelected ? '600' : '400' }}>
                                        {cut.name}
                                    </span>
                                    {isProcessed && <Check size={16} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* MIDDLE: Static Reference Image Only */}
                <div className="visual-map-container" style={{ backgroundColor: '#111', padding: 0 }}>
                    <img
                        src="/pollo_argentino.png"
                        alt="Mapa de Cortes de Pollo"
                        style={{
                            width: '90%',
                            height: 'auto',
                            maxHeight: '90%',
                            objectFit: 'contain',
                            filter: isSessionStarted ? 'none' : 'grayscale(100%) blur(2px)',
                            transition: 'all 0.5s ease',
                            opacity: isSessionStarted ? 1 : 0.5
                        }}
                    />

                    {/* Hint Overlay */}
                    {!isSessionStarted && (
                        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}>
                            <span style={{ fontSize: '2rem', fontWeight: '700', color: '#fff', textShadow: '0 2px 10px #000' }}>LOTE SIN INICIAR</span>
                            <span style={{ color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)', padding: '0.5rem 1.5rem', borderRadius: '50px', border: '1px solid rgba(255,255,255,0.2)' }}>
                                Configure el peso para habilitar los cortes
                            </span>
                        </div>
                    )}
                </div>

                {/* RIGHT: High Contrast Work Panel */}
                <div className="control-panel">

                    <div className={`weighing-station ${selectedCutId ? 'active-station' : ''}`}>
                        <div className="station-header">
                            {selectedCutId ? (
                                <>
                                    <div style={{ color: 'var(--color-primary)', fontSize: '0.9rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>DESPOSTANDO</div>
                                    <div className="selected-cut-name animate-fade-in">{selectedCut?.number}. {selectedCut?.name}</div>
                                </>
                            ) : (
                                <div style={{ padding: '2rem 0', color: 'var(--color-text-muted)' }}>
                                    Esperando selección...
                                </div>
                            )}
                        </div>

                        {selectedCutId && (
                            <div className="animate-fade-in">
                                <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <label style={{ fontSize: '0.9rem', color: '#22c55e' }}>Lectura Balanza</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {(isScaleConnected || isSimulated) && (
                                                <button
                                                    onClick={handleReadScale}
                                                    style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', color: '#fff' }}
                                                >
                                                    RE-PESAR
                                                </button>
                                            )}
                                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                {isScaleConnected ? '🟢 Conectada' : (isSimulated ? '🔵 Simulado' : '🔴 Desconectada')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="scale-input-wrapper">
                                        <input
                                            type="number"
                                            className="scale-display"
                                            value={currentWeight}
                                            onChange={(e) => setCurrentWeight(e.target.value)}
                                            placeholder="0.000"
                                            autoFocus
                                        />
                                        <span className="unit-label">kg</span>
                                    </div>

                                    {isSimulated && (
                                        <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '6px', color: '#bfdbfe', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                            <span><strong>Modo Test activo:</strong> pesos simulados. Presiona el botón para salir.</span>
                                        </div>
                                    )}

                                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <button
                                            onClick={handleConnectScale}
                                            className="neo-button"
                                            disabled={isScaleConnected}
                                            style={{ fontSize: '0.75rem', padding: '0.5rem', opacity: isScaleConnected ? 0.6 : 1 }}
                                        >
                                            CONECTAR BALANZA
                                        </button>
                                        {isScaleConnected && (
                                            <button
                                                onClick={() => setIsScaleConnected(false)}
                                                className="neo-button"
                                                style={{ fontSize: '0.75rem', padding: '0.5rem' }}
                                            >
                                                DESCONECTAR
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setIsSimulated(prev => {
                                                const next = !prev;
                                                if (next) {
                                                    setIsScaleConnected(false);
                                                }
                                                return next;
                                            })}
                                            className="nav-item"
                                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        >
                                            <span style={{ width: '36px', height: '18px', borderRadius: '999px', background: isSimulated ? '#22c55e' : '#6b7280', position: 'relative', transition: 'background 0.2s' }}>
                                                <span style={{ position: 'absolute', top: '2px', left: isSimulated ? '18px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }}></span>
                                            </span>
                                            MODO TEST
                                        </button>
                                    </div>
                                </div>

                                <button
                                    className="action-btn"
                                    disabled={!currentWeight}
                                    onClick={confirmCut}
                                    style={{ height: '60px', fontSize: '1.2rem' }}
                                >
                                    <Save size={24} />
                                    REGISTRAR CORTE
                                </button>

                                <button
                                    style={{ width: '100%', marginTop: '1rem', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0.5rem' }}
                                    onClick={() => setSelectedCutId(null)}
                                >
                                    Cancelar selección
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="cuts-log">
                        <div className="log-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Historial del Lote</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{logs.length} items</span>
                        </div>
                        <div className="log-list">
                            {[...logs].map((log, idx) => (
                                <div key={idx} className="log-item animate-fade-in">
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontWeight: '500' }}>{log.cutName}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <span style={{ fontWeight: '700', color: 'var(--color-text-main)' }}>{log.weight.toFixed(3)} kg</span>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default DespostadaPollo;
