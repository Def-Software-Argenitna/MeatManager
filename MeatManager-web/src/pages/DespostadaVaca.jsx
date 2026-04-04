import React, { useState } from 'react';
import { Save, RotateCcw, Check, ShieldCheck, TrendingUp, DollarSign } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useLicense } from '../context/LicenseContext';
import { scaleService } from '../utils/SerialScaleService';
import './DespostadaVaca.css';

// Detailed cuts mapping based on the provided diagram
const COW_MAP = [
    // --- CUARTO DELANTERO (LEFT SIDE) ---
    // Neck area
    { number: 1, id: 'azotillo', name: 'Azotillo', path: 'M 220,130 L 280,120 L 280,220 L 230,250 L 190,190 Z', category: 'delantero', labelX: 230, labelY: 180 },
    { number: 2, id: 'roast_beef', name: 'Roast Beef', path: 'M 280,110 L 380,110 L 380,190 L 280,200 Z', category: 'delantero', labelX: 330, labelY: 150 },

    // Shoulder area
    { number: 3, id: 'paleta', name: 'Paleta', path: 'M 230,250 L 280,220 L 380,200 L 380,310 L 270,320 Z', category: 'delantero', labelX: 300, labelY: 270 },
    { number: 4, id: 'palomita', name: 'Palomita', path: 'M 190,190 L 230,250 L 200,300 L 160,250 Z', category: 'delantero', labelX: 195, labelY: 240 },

    // Chest / Bottom Front
    { number: 5, id: 'tapa_asado', name: 'Tapa de Asado', path: 'M 270,320 L 500,330 L 480,380 L 300,380 Z', category: 'delantero', labelX: 390, labelY: 355 },
    { number: 6, id: 'osobuco_ant', name: 'Osobuco', path: 'M 280,380 L 340,380 L 330,550 L 290,550 L 300,450 Z', category: 'delantero', labelX: 315, labelY: 500 },

    // --- CORTES CENTRALES (Torso) ---
    // Top (Lomo/Bifes)
    { number: 7, id: 'bife_ancho', name: 'Bife Ancho', path: 'M 380,110 L 500,110 L 500,200 L 380,190 Z', category: 'centro', labelX: 440, labelY: 150 },
    { number: 8, id: 'bife_costilla', name: 'Bife Costilla', path: 'M 500,110 L 650,115 L 640,190 L 500,200 Z', category: 'centro', labelX: 570, labelY: 150 },
    { number: 9, id: 'lomo', name: 'Lomo', path: 'M 530,130 L 630,135 L 620,165 L 530,160 Z', category: 'centro', labelX: 580, labelY: 145 }, // Visual override

    // Mid/Bottom (Ribs/Flank)
    { number: 10, id: 'asado', name: 'Asado', path: 'M 380,200 L 500,200 L 510,330 L 380,310 Z', category: 'centro', labelX: 440, labelY: 260 },
    { number: 11, id: 'vacio', name: 'Vacío', path: 'M 500,200 L 640,190 L 670,310 L 510,330 Z', category: 'centro', labelX: 580, labelY: 260 },
    { number: 12, id: 'entrana', name: 'Entraña', path: 'M 520,220 L 550,220 L 560,320 L 530,320 Z', category: 'centro', labelX: 540, labelY: 270 }, // Vertical strip

    { number: 13, id: 'matambre', name: 'Matambre', path: 'M 300,380 L 600,380 L 620,420 L 320,420 Z', category: 'centro', labelX: 460, labelY: 400 },

    // --- CUARTO TRASERO (Right Side) ---
    { number: 14, id: 'cuadril', name: 'Cuadril', path: 'M 650,115 L 750,130 L 740,220 L 640,190 Z', category: 'trasero', labelX: 700, labelY: 160 },
    { number: 15, id: 'colita', name: 'Colita Cuadril', path: 'M 670,220 L 740,220 L 730,290 L 670,310 Z', category: 'trasero', labelX: 710, labelY: 250 },

    { number: 16, id: 'peceto', name: 'Peceto', path: 'M 750,180 L 800,220 L 790,360 L 740,350 Z', category: 'trasero', labelX: 770, labelY: 280 },
    { number: 17, id: 'cuadrada', name: 'Cuadrada', path: 'M 670,310 L 740,290 L 730,400 L 660,380 Z', category: 'trasero', labelX: 700, labelY: 350 },
    { number: 18, id: 'bola_lomo', name: 'Bola de Lomo', path: 'M 620,340 L 670,310 L 660,400 L 640,400 Z', category: 'trasero', labelX: 645, labelY: 370 },
    { number: 19, id: 'tapa_nalga', name: 'Tapa Nalga', path: 'M 660,400 L 730,400 L 710,480 L 670,480 Z', category: 'trasero', labelX: 695, labelY: 440 },

    { number: 20, id: 'osobuco_post', name: 'Osobuco', path: 'M 730,480 L 770,450 L 780,580 L 740,580 Z', category: 'trasero', labelX: 760, labelY: 520 },
];

const DespostadaVaca = () => {
    // Session State
    const [initialWeight, setInitialWeight] = useState('');
    const [selectedLotId, setSelectedLotId] = useState(null); // Linked to animal_lot
    const [selectedLotSupplier, setSelectedLotSupplier] = useState('');
    const [isSessionStarted, setIsSessionStarted] = useState(false);
    const [, setCostPerKg] = useState(0); // For PRO mode

    const { isPro } = useLicense();

    // DB Data
    const availableLots = useLiveQuery(() =>
        db.animal_lots?.where('status').equals('disponible').and(l => l.species === 'vaca').toArray()
    );

    // Workspace State
    const [selectedCutId, setSelectedCutId] = useState(null);
    const [currentWeight, setCurrentWeight] = useState(''); // Scale reading
    const [isScaleConnected, setIsScaleConnected] = useState(false);
    const [isSimulated, setIsSimulated] = useState(false);
    const [logs, setLogs] = useState([]);

    // Calculated
    const processedWeight = logs.reduce((acc, log) => acc + log.weight, 0);
    const yieldPercentage = isSessionStarted && initialWeight > 0
        ? ((processedWeight / initialWeight) * 100).toFixed(1)
        : 0;

    const startSession = async () => {
        if (!initialWeight || initialWeight <= 0) {
            alert("Por favor ingrese el peso inicial o seleccione un animal de stock.");
            return;
        }

        // If we selected a lot, mark it as in progress or just link it
        setIsSessionStarted(true);
    };

    const handleSelectLot = async (lot) => {
        setSelectedLotId(lot.id);
        setSelectedLotSupplier(lot.supplier || '');
        setInitialWeight(lot.weight);

        // PRO: Attempt to find the cost per kg from the original purchase
        if (isPro && lot.purchase_id) {
            const purchase = await db.compras.get(lot.purchase_id);
            if (purchase && purchase.items_detail) {
                // Find the item that generated this lot (matching species or general name)
                const itemMatch = purchase.items_detail.find(i =>
                    i.type === 'despostada' && (i.species === 'vaca' || i.name.toLowerCase().includes('res'))
                );
                if (itemMatch) {
                    // Calculate cost per kg: if unit is 'un', its unit_price / weight_of_this_lot
                    // if unit is 'kg', it's already unit_price
                    const cost = itemMatch.unit === 'kg' ? itemMatch.unit_price : (itemMatch.unit_price / (itemMatch.weight / itemMatch.quantity));
                    setCostPerKg(cost || 0);
                }
            }
        }
    };

    const finishSession = async () => {
        if (!isSessionStarted) return;

        if (window.confirm('¿Finalizar esta despostada? Se actualizará el stock de piezas enteras.')) {
            if (selectedLotId) {
                await db.animal_lots.update(selectedLotId, { status: 'despostado' });
            }

            // Optional: Save to despostada_logs
            await db.despostada_logs.add({
                type: 'vaca',
                date: new Date(),
                supplier: selectedLotSupplier,
                total_weight: initialWeight,
                yield_percentage: parseFloat(yieldPercentage),
                lot_id: selectedLotId,
                synced: 0
            });

            // Reset
            setIsSessionStarted(false);
            setLogs([]);
            setInitialWeight('');
            setSelectedLotId(null);
            setSelectedLotSupplier('');
            setCostPerKg(0);
            alert('Despostada finalizada con éxito.');
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

        const cutInfo = COW_MAP.find(c => c.id === selectedCutId);
        const weightVal = parseFloat(currentWeight);

        const newLog = {
            cutId: selectedCutId,
            cutName: cutInfo.name,
            weight: weightVal,
            timestamp: new Date()
        };

        setLogs([newLog, ...logs]);

        // Save to DB
        await db.stock.add({
            name: cutInfo.name,
            type: 'vaca',
            quantity: weightVal,
            updated_at: new Date(),
            synced: 0
        });

        // Reset for next cut
        setSelectedCutId(null);
        setCurrentWeight('');
    };

    const selectedCut = COW_MAP.find(c => c.id === selectedCutId);

    // Helper to check if a cut is already processed (simplified for now, logic could be more complex if multiple entries allowed)
    // For this simple version, we don't strictly block re-scanning, but we could highlight processed ones.
    const isCutProcessed = (id) => logs.some(l => l.cutId === id);

    return (
        <div className="despostada-container animate-fade-in">

            {/* HEADER: Configuration & Status */}
            <div className="session-setup">
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flex: 1 }}>
                    <div className="weight-input-group">
                        <label>Seleccionar de Stock (Media Res)</label>
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
                                💡 Recordá registrar la COMPRA de la Media Res para que aparezca acá.
                            </div>
                        )}
                    </div>

                    <div className="weight-input-group">
                        <label>Peso Inicial</label>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <input
                                type="number"
                                className="big-input"
                                placeholder="000.0"
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

                {/* NEW LEFT PANEL: Cuts List */}
                <div className="cuts-list-panel" style={{
                    backgroundColor: 'var(--color-bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', fontWeight: '700', fontSize: '0.9rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                        Lista de Cortes ({COW_MAP.length})
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {COW_MAP.map(cut => {
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
                        src="/vaca_argentina.png"
                        alt="Mapa de Cortes Argentinos"
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

                    <div className={`weighing - station ${selectedCutId ? 'active-station' : ''} `}>
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
        </div >
    );
};

export default DespostadaVaca;
