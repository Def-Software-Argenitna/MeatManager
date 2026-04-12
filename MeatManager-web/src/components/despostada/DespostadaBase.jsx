import React, { useEffect, useState } from 'react';
import { Check, DollarSign, Package, RotateCcw, Save, Scale, ScanLine, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { useLicense } from '../../context/LicenseContext';
import DirectionalReveal from '../DirectionalReveal';
import { scaleService } from '../../utils/SerialScaleService';
import { buildDespostadaLogPayload } from '../../utils/despostadaSession';
import { fetchTable, saveTableRecord } from '../../utils/apiClient';
import './DespostadaBase.css';

const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const formatKg = (value, digits = 2) => `${toNumber(value).toFixed(digits)} kg`;

const formatCurrency = (value) => new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2
}).format(toNumber(value));

const defaultLotLabel = (lot) => {
    const lotDate = lot?.date || 'Sin fecha';
    const supplier = lot?.supplier || 'Sin proveedor';
    return `${lotDate} - ${supplier} - ${formatKg(lot?.weight ?? 0, 1)}`;
};

const getCutMatch = (purchaseItem, species, hints = []) => {
    if (!purchaseItem) return false;
    const normalizedSpecies = String(species || '').toLowerCase();
    const normalizedName = String(purchaseItem.name || '').toLowerCase();
    const purchaseSpecies = String(purchaseItem.species || '').toLowerCase();

    if (purchaseItem.type !== 'despostada') return false;
    if (purchaseSpecies === normalizedSpecies) return true;
    return hints.some((hint) => normalizedName.includes(String(hint || '').toLowerCase()));
};

const resolveCostPerKg = (lot, compras, species, hints) => {
    if (!lot?.purchase_id) return 0;
    const purchase = compras.find((item) => Number(item.id) === Number(lot.purchase_id));
    const items = Array.isArray(purchase?.items_detail) ? purchase.items_detail : [];
    const itemMatch = items.find((item) => getCutMatch(item, species, hints));
    if (!itemMatch) return 0;

    const unitPrice = toNumber(itemMatch.unit_price);
    if (itemMatch.unit === 'kg') return unitPrice;

    const weight = toNumber(itemMatch.weight);
    const quantity = toNumber(itemMatch.quantity);
    if (weight > 0 && quantity > 0) {
        return unitPrice / (weight / quantity);
    }

    return unitPrice;
};

const connectionLabel = (isConnected, isSimulated) => {
    if (isConnected) return { text: 'Conectada', tone: 'good' };
    if (isSimulated) return { text: 'Modo test', tone: 'warn' };
    return { text: 'Desconectada', tone: 'bad' };
};

const DespostadaBase = ({
    species,
    title,
    subtitle,
    heroImage,
    cutMap,
    lotSpecies,
    lotLabel = 'Stock disponible',
    lotEmptyLabel = '-- No hay stock disponible --',
    lotPlaceholderLabel = '-- Seleccionar o ingreso manual --',
    manualHint = 'Recordá registrar la compra para que el lote aparezca acá.',
    noWeightMessage = 'Por favor ingrese el peso inicial o seleccione un animal de stock.',
    finishConfirm = '¿Finalizar esta despostada?',
    finishSuccess = 'Despostada finalizada con éxito.',
    finishFailure = 'No se pudo finalizar la despostada.',
    lockedDescription = 'La despostada se habilita desde Gestión de Clientes, no por código local.',
    lockedCtaLabel = 'Ver estado de licencias',
    purchaseHints = [],
    accent = '#ef4444',
}) => {
    const { hasModule } = useLicense();
    const hasDespostadaModule = hasModule('despostada');

    const [initialWeight, setInitialWeight] = useState('');
    const [selectedLotId, setSelectedLotId] = useState(null);
    const [selectedLotSupplier, setSelectedLotSupplier] = useState('');
    const [isSessionStarted, setIsSessionStarted] = useState(false);
    const [costPerKg, setCostPerKg] = useState(0);
    const [availableLots, setAvailableLots] = useState([]);
    const [compras, setCompras] = useState([]);
    const [selectedCutId, setSelectedCutId] = useState(null);
    const [currentWeight, setCurrentWeight] = useState('');
    const [isScaleConnected, setIsScaleConnected] = useState(false);
    const [isSimulated, setIsSimulated] = useState(false);
    const [logs, setLogs] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    const loadDespostadaData = React.useCallback(async () => {
        const [lotRows, comprasRows] = await Promise.all([
            fetchTable('animal_lots'),
            fetchTable('compras'),
        ]);

        setAvailableLots((Array.isArray(lotRows) ? lotRows : []).filter((lot) => lot.status === 'disponible' && lot.species === lotSpecies));
        setCompras(Array.isArray(comprasRows) ? comprasRows : []);
    }, [lotSpecies]);

    useEffect(() => {
        loadDespostadaData().catch((error) => console.error(`Error cargando despostada ${species}:`, error));
    }, [loadDespostadaData, species]);

    const processedWeight = logs.reduce((acc, log) => acc + toNumber(log.weight), 0);
    const totalWeight = toNumber(initialWeight);
    const yieldPercentage = isSessionStarted && totalWeight > 0
        ? ((toNumber(processedWeight) / totalWeight) * 100).toFixed(1)
        : 0;
    const mermaWeight = Math.max(totalWeight - toNumber(processedWeight), 0);
    const mermaPercentage = totalWeight > 0 ? ((mermaWeight / totalWeight) * 100).toFixed(1) : 0;
    const estimatedTotalCost = totalWeight * toNumber(costPerKg);
    const selectedCut = cutMap.find((cut) => cut.id === selectedCutId) || null;
    const scaleState = connectionLabel(isScaleConnected, isSimulated);
    const hasWorkingState = isSessionStarted && Boolean(selectedCutId);

    if (!hasDespostadaModule) {
        return (
            <div className="despostada-locked animate-fade-in">
                <DirectionalReveal className="despostada-locked-card" from="down" delay={0.04}>
                    <div className="despostada-kicker">
                        <ShieldCheck size={14} /> Módulo premium
                    </div>
                    <h2>Módulo de Despostada</h2>
                    <p>{lockedDescription}</p>
                    <div style={{ marginTop: '1.25rem' }}>
                        <button
                            className="despostada-button"
                            onClick={() => { window.location.hash = '#/config/licencia'; }}
                        >
                            {lockedCtaLabel}
                        </button>
                    </div>
                </DirectionalReveal>
            </div>
        );
    }

    const resetSession = (withConfirmation = false) => {
        const shouldReset = !withConfirmation || window.confirm('¿Reiniciar sesión?');
        if (!shouldReset) return;

        setIsSessionStarted(false);
        setLogs([]);
        setInitialWeight('');
        setSelectedLotId(null);
        setSelectedLotSupplier('');
        setCostPerKg(0);
        setSelectedCutId(null);
        setCurrentWeight('');
        setIsScaleConnected(false);
        setIsSimulated(false);
    };

    const handleSelectLot = (lot) => {
        setSelectedLotId(lot.id);
        setSelectedLotSupplier(lot.supplier || '');
        setInitialWeight(lot.weight);
        setCostPerKg(resolveCostPerKg(lot, compras, species, purchaseHints));
    };

    const startSession = async () => {
        if (!initialWeight || totalWeight <= 0) {
            window.alert(noWeightMessage);
            return;
        }
        setIsSessionStarted(true);
    };

    const finishSession = async () => {
        if (!isSessionStarted || isSaving) return;

        if (!window.confirm(finishConfirm)) return;

        setIsSaving(true);
        try {
            if (selectedLotId) {
                await saveTableRecord('animal_lots', 'update', { status: 'despostado' }, selectedLotId);
            }

            const selectedLot = availableLots.find((lot) => lot.id === selectedLotId) || null;
            await saveTableRecord('despostada_logs', 'insert', buildDespostadaLogPayload({
                type: species,
                supplier: selectedLotSupplier,
                initialWeight,
                yieldPercentage,
                cuts: logs,
                selectedLot,
                costPerKg
            }));

            await loadDespostadaData();
            resetSession(false);
            window.alert(finishSuccess);
        } catch (error) {
            console.error(`Error finalizando despostada ${species}:`, error);
            window.alert(finishFailure);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCutClick = (id) => {
        if (!isSessionStarted) return;
        setSelectedCutId(id);
        setCurrentWeight('');
        if (isScaleConnected || isSimulated) {
            handleReadScale();
        }
    };

    const handleConnectScale = async () => {
        const success = await scaleService.requestPort();
        if (!success) {
            window.alert('⚠️ No se detectó ninguna balanza.\n\nVerificá que:\n• La balanza esté encendida\n• El cable USB esté conectado\n• Instalaste el driver del fabricante\n\nSi no tenés balanza, usá el Modo Test.');
            return;
        }

        const connected = await scaleService.connect();
        setIsScaleConnected(connected);
        if (connected) {
            setIsSimulated(false);
            window.alert('✅ Balanza conectada correctamente.');
        } else {
            window.alert('⚠️ No se pudo abrir el puerto serie. Probá desconectar y volver a conectar el cable.');
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
        if (!selectedCutId || !currentWeight || isSaving) return;

        const cutInfo = cutMap.find((cut) => cut.id === selectedCutId);
        if (!cutInfo) return;

        const weightVal = toNumber(currentWeight);
        if (weightVal <= 0) return;

        const newLog = {
            cutId: selectedCutId,
            cutNumber: cutInfo.number,
            cutName: cutInfo.name,
            cutCategory: cutInfo.category,
            weight: weightVal,
            timestamp: new Date()
        };

        setLogs((prev) => [newLog, ...prev]);
        setSelectedCutId(null);
        setCurrentWeight('');

        try {
            await saveTableRecord('stock', 'insert', {
                name: cutInfo.name,
                type: species,
                quantity: weightVal,
                updated_at: new Date().toISOString(),
            });
        } catch (error) {
            console.error(`Error guardando corte ${species}:`, error);
            window.alert('No se pudo guardar el corte en stock.');
        }
    };

    const isCutProcessed = (id) => logs.some((log) => log.cutId === id);
    const totalCuts = logs.length;

    return (
        <div
            className="despostada-module animate-fade-in"
            style={{
                '--despostada-accent': accent,
                '--despostada-accent-soft': `${accent}22`,
                '--despostada-glow': `${accent}2e`,
                '--despostada-art-image': `url(${heroImage})`
            }}
        >
            <DirectionalReveal className="despostada-hero" from="up" delay={0.04}>
                <div className="despostada-hero-grid">
                    <div>
                        <div className="despostada-kicker">
                            <Sparkles size={14} /> Módulo premium
                        </div>
                        <h1>{title}</h1>
                        <p>{subtitle}</p>
                        <div className="despostada-chip-row">
                            <span className="despostada-chip">
                                <Package size={14} /> {lotLabel}
                            </span>
                            <span className="despostada-chip">
                                <Scale size={14} /> {scaleState.text}
                            </span>
                            <span className="despostada-chip">
                                <TrendingUp size={14} /> {isSessionStarted ? `${yieldPercentage}% de rendimiento` : 'Listo para iniciar'}
                            </span>
                        </div>
                    </div>

                    <div className="despostada-hero-art">
                        <div className="despostada-hero-art-badge">
                            <ScanLine size={14} />
                            {isSessionStarted ? 'Lote en proceso' : 'Panel operativo'}
                        </div>
                    </div>
                </div>
            </DirectionalReveal>

            <DirectionalReveal className="despostada-summary-grid" from="up" delay={0.09}>
                <div className="despostada-summary-card">
                    <div className="label"><Package size={12} /> Peso inicial</div>
                    <div className="value">{formatKg(initialWeight, 2)}</div>
                    <div className="subvalue">{selectedLotSupplier || 'Sin lote seleccionado'}</div>
                </div>
                <div className="despostada-summary-card">
                    <div className="label"><TrendingUp size={12} /> Procesado</div>
                    <div className="value">{formatKg(processedWeight, 2)}</div>
                    <div className="subvalue">{totalCuts} cortes registrados</div>
                </div>
                <div className="despostada-summary-card">
                    <div className="label"><ShieldCheck size={12} /> Rendimiento</div>
                    <div className="value">{isSessionStarted ? `${yieldPercentage}%` : '0%'}</div>
                    <div className="subvalue">
                        Merma {formatKg(mermaWeight, 2)} · {mermaPercentage}% del lote
                    </div>
                </div>
                <div className="despostada-summary-card">
                    <div className="label"><DollarSign size={12} /> Costo estimado</div>
                    <div className="value">{costPerKg > 0 ? formatCurrency(estimatedTotalCost) : 'No calculado'}</div>
                    <div className="subvalue">{costPerKg > 0 ? `${formatCurrency(costPerKg)} por kg de origen` : 'Se calcula al tomar un lote ligado a compra'}</div>
                </div>
            </DirectionalReveal>

            <DirectionalReveal className="despostada-setup" from="up" delay={0.13}>
                <div className="despostada-setup-grid">
                    <div className="despostada-field">
                        <label>{lotLabel}</label>
                        <select
                            className="despostada-select"
                            disabled={isSessionStarted}
                            value={selectedLotId || ''}
                            onChange={(event) => {
                                const lotId = Number(event.target.value);
                                if (!lotId) {
                                    setSelectedLotId(null);
                                    setSelectedLotSupplier('');
                                    setInitialWeight('');
                                    setCostPerKg(0);
                                    return;
                                }

                                const lot = availableLots.find((item) => Number(item.id) === lotId);
                                if (lot) {
                                    handleSelectLot(lot);
                                }
                            }}
                        >
                            <option value="">{availableLots.length === 0 ? lotEmptyLabel : lotPlaceholderLabel}</option>
                            {availableLots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                    {defaultLotLabel(lot)}
                                </option>
                            ))}
                        </select>
                        {availableLots.length === 0 && !isSessionStarted && (
                            <div className="despostada-helper warn">{manualHint}</div>
                        )}
                    </div>

                    <div className="despostada-field">
                        <label>Peso inicial</label>
                        <div className="despostada-number-row">
                            <input
                                type="number"
                                className="despostada-number"
                                placeholder="000.0"
                                value={initialWeight}
                                disabled={isSessionStarted || selectedLotId}
                                onChange={(event) => setInitialWeight(event.target.value)}
                            />
                            <span>kg</span>
                        </div>
                    </div>

                    <div className="despostada-actions">
                        {!isSessionStarted ? (
                            <button className="despostada-button" onClick={startSession}>
                                <Sparkles size={16} /> Iniciar lote
                            </button>
                        ) : (
                            <>
                                <button className="despostada-button-secondary" onClick={finishSession} disabled={isSaving}>
                                    <Check size={16} /> {isSaving ? 'Guardando...' : 'Finalizar'}
                                </button>
                                <button className="despostada-button-ghost" onClick={() => resetSession(true)} disabled={isSaving}>
                                    <RotateCcw size={16} /> Reiniciar
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div>
                    <div className="despostada-helper" style={{ marginBottom: '0.55rem' }}>
                        {isSessionStarted ? 'El lote ya está activo y listo para registrar cortes.' : 'Ajustá el peso o elegí un lote para habilitar el trabajo.'}
                    </div>
                    <div className="despostada-meter">
                        <span style={{ width: `${Math.min(Number(yieldPercentage) || 0, 100)}%` }} />
                    </div>
                    <div className="despostada-helper ghost" style={{ marginTop: '0.45rem' }}>
                        Procesado: {formatKg(processedWeight, 2)} · Merma: {formatKg(mermaWeight, 2)}
                    </div>
                </div>
            </DirectionalReveal>

            <DirectionalReveal className="despostada-workspace" from="up" delay={0.16}>
                <div className="despostada-panel despostada-cut-list">
                    <div className="despostada-panel-header">
                        <div className="despostada-panel-title">
                            <Package size={16} />
                            Cortes
                        </div>
                        <div className="despostada-panel-subtitle">{cutMap.length} piezas</div>
                    </div>
                    <div className="despostada-cut-list-items">
                        {cutMap.map((cut) => {
                            const isProcessed = isCutProcessed(cut.id);
                            const isSelected = selectedCutId === cut.id;
                            return (
                                <button
                                    key={cut.id}
                                    className={`despostada-cut-item ${isSelected ? 'is-selected' : ''} ${isProcessed ? 'is-processed' : ''}`}
                                    onClick={() => handleCutClick(cut.id)}
                                    disabled={!isSessionStarted}
                                >
                                    <span className="despostada-cut-number">{cut.number}</span>
                                    <span className="despostada-cut-main">
                                        <strong>{cut.name}</strong>
                                        <span>{cut.category}</span>
                                    </span>
                                    {isProcessed && <Check size={16} className="despostada-cut-status" />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="despostada-panel despostada-map">
                    <img
                        src={heroImage}
                        alt={title}
                    />
                    <div className="despostada-map-mask" />
                    {!isSessionStarted && (
                        <div className="despostada-map-locked">
                            <h3>Lote sin iniciar</h3>
                            <p>Configurá el peso inicial para habilitar el flujo de desposte y registrar los cortes con trazabilidad completa.</p>
                        </div>
                    )}
                    <div className="despostada-map-card">
                        <span className="despostada-map-pill">
                            <Scale size={14} /> {scaleState.text}
                        </span>
                        <span className="despostada-map-pill">
                            <Check size={14} /> {totalCuts} registros
                        </span>
                        {selectedLotSupplier && (
                            <span className="despostada-map-pill">
                                <Package size={14} /> {selectedLotSupplier}
                            </span>
                        )}
                    </div>
                </div>

                <div className="despostada-work-panel">
                    <div className={`despostada-work-card ${hasWorkingState ? 'despostada-work-active' : ''}`}>
                        <div className="despostada-work-card-body">
                            <div className="despostada-status-line">
                                <div>
                                    <div className="state">Despostando</div>
                                    <div className="cut-name">
                                        {selectedCut ? `${selectedCut.number}. ${selectedCut.name}` : 'Esperando selección'}
                                    </div>
                                </div>
                                {selectedCut && (
                                    <button
                                        className="despostada-button-ghost"
                                        style={{ minHeight: '2.4rem', paddingInline: '0.8rem' }}
                                        onClick={() => setSelectedCutId(null)}
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </div>

                            {selectedCut ? (
                                <>
                                    <div className="despostada-scale-box">
                                        <div className="despostada-scale-header">
                                            <div className="despostada-scale-status">
                                                <Scale size={14} />
                                                Lectura balanza
                                            </div>
                                            <div className="despostada-scale-status">
                                                <span className={`dot ${scaleState.tone}`} />
                                                {scaleState.text}
                                            </div>
                                        </div>
                                        <div className="despostada-scale-display">
                                            <input
                                                type="number"
                                                value={currentWeight}
                                                onChange={(event) => setCurrentWeight(event.target.value)}
                                                placeholder="0.000"
                                                autoFocus
                                            />
                                            <span className="unit">kg</span>
                                        </div>
                                        {isSimulated && (
                                            <div className="despostada-note">
                                                <strong>Modo test activo:</strong> pesos simulados. Apagalo cuando quieras volver a la balanza real.
                                            </div>
                                        )}
                                        <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <button className="despostada-button-secondary" onClick={handleConnectScale} disabled={isScaleConnected}>
                                                <ScanLine size={16} /> Conectar balanza
                                            </button>
                                            {isScaleConnected && (
                                                <button className="despostada-button-ghost" onClick={() => setIsScaleConnected(false)}>
                                                    Desconectar
                                                </button>
                                            )}
                                            <button
                                                className="despostada-button-ghost"
                                                onClick={() => setIsSimulated((prev) => {
                                                    const next = !prev;
                                                    if (next) {
                                                        setIsScaleConnected(false);
                                                    }
                                                    return next;
                                                })}
                                            >
                                                <span className="despostada-chip" style={{ padding: '0.28rem 0.55rem', margin: '-0.15rem 0' }}>
                                                    {isSimulated ? 'ON' : 'OFF'}
                                                </span>
                                                Modo test
                                            </button>
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        {(isScaleConnected || isSimulated) && (
                                            <button className="despostada-button-secondary" onClick={handleReadScale}>
                                                <Scale size={16} /> Re-pesar
                                            </button>
                                        )}
                                        <button
                                            className="despostada-button"
                                            onClick={confirmCut}
                                            disabled={!currentWeight || isSaving}
                                            style={{ flex: '1 1 180px' }}
                                        >
                                            <Save size={16} /> Registrar corte
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="despostada-helper" style={{ padding: '0.6rem 0 0.2rem' }}>
                                    Seleccioná un corte para activar la balanza y registrar el peso.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="despostada-work-card" style={{ minHeight: 0, flex: 1 }}>
                        <div className="despostada-panel-header">
                            <div className="despostada-panel-title">
                                <TrendingUp size={16} />
                                Historial del lote
                            </div>
                            <div className="despostada-panel-subtitle">{logs.length} items</div>
                        </div>
                        <div className="despostada-log-list">
                            {logs.length === 0 ? (
                                <div style={{ padding: '1rem', color: 'var(--despostada-muted)' }}>
                                    Todavía no hay cortes registrados en esta sesión.
                                </div>
                            ) : (
                                [...logs].map((log, index) => (
                                    <div key={`${log.cutId}-${index}`} className="despostada-log-item">
                                        <div>
                                            <strong>{log.cutName}</strong>
                                            <span>{log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <div className="despostada-log-weight">
                                            {formatKg(log.weight, 3)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </DirectionalReveal>
        </div>
    );
};

export default DespostadaBase;
