import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Cpu, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { fetchTable, getRemoteSetting, saveTableRecord, upsertRemoteSetting } from '../utils/apiClient';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import './ConfiguracionBalanza.css';

const DEFAULT_SCALE_USERS = [1, 2, 3, 4].map((slotNo) => ({
    slot_no: slotNo,
    display_name: `VENDEDOR ${slotNo}`,
    active: 1,
}));

const EMPTY_SECTION_MAP = {
    category: '',
    sectionId: 2,
    sectionName: 'CARNICERIA',
};

const DEFAULT_MARQUEE_LINES = [1, 2, 3].map((index) => ({
    id: index,
    text: '',
    active: index === 1 ? 1 : 0,
}));

const parseJson = (raw, fallback) => {
    try {
        const parsed = JSON.parse(String(raw || ''));
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

const normalizeSectionMappings = (rawMappings) => {
    if (!Array.isArray(rawMappings)) return [];
    return rawMappings
        .map((row) => ({
            category: String(row?.category || '').trim(),
            sectionId: Math.max(1, Math.min(99, Number.parseInt(row?.sectionId, 10) || 2)),
            sectionName: String(row?.sectionName || 'CARNICERIA').trim().slice(0, 18).toUpperCase() || 'CARNICERIA',
        }))
        .filter((row) => row.category);
};

const normalizeMarqueeLines = (raw) => {
    if (!Array.isArray(raw)) return DEFAULT_MARQUEE_LINES;
    const rows = raw.map((item, index) => ({
        id: index + 1,
        text: String(item?.text || item || '').trim(),
        active: Number(item?.active ?? 1) === 0 ? 0 : 1,
    }));
    while (rows.length < 3) {
        rows.push({ id: rows.length + 1, text: '', active: 0 });
    }
    return rows.slice(0, 3);
};

const ConfiguracionBalanza = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    const [scaleUsers, setScaleUsers] = useState(DEFAULT_SCALE_USERS);
    const [ticketHeader, setTicketHeader] = useState({
        line1: '',
        line2: '',
        line3: '',
    });
    const [sectionMappings, setSectionMappings] = useState([EMPTY_SECTION_MAP]);
    const [marqueeLines, setMarqueeLines] = useState(DEFAULT_MARQUEE_LINES);
    const [categoryOptions, setCategoryOptions] = useState([]);

    const showMessage = useCallback((type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 4500);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [
                usersRows,
                line1,
                line2,
                line3,
                sectionMappingsRaw,
                marqueeRaw,
                productsRows,
                productCategoryRows,
            ] = await Promise.all([
                fetchTable('scale_users', { limit: 50, orderBy: 'slot_no', direction: 'ASC' }),
                getRemoteSetting('scale_ticket_header_line1'),
                getRemoteSetting('scale_ticket_header_line2'),
                getRemoteSetting('scale_ticket_header_line3'),
                getRemoteSetting('scale_section_mappings'),
                getRemoteSetting('scale_marquee_messages'),
                fetchTable('products', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
                fetchTable('product_categories', { limit: 500, orderBy: 'name', direction: 'ASC' }),
            ]);

            const usersBySlot = new Map((usersRows || []).map((row) => [Number(row.slot_no), row]));
            setScaleUsers(DEFAULT_SCALE_USERS.map((entry) => {
                const found = usersBySlot.get(entry.slot_no);
                return {
                    slot_no: entry.slot_no,
                    display_name: String(found?.display_name || entry.display_name),
                    active: Number(found?.active ?? 1) === 0 ? 0 : 1,
                };
            }));

            setTicketHeader({
                line1: String(line1 || ''),
                line2: String(line2 || ''),
                line3: String(line3 || ''),
            });

            const mappings = normalizeSectionMappings(parseJson(sectionMappingsRaw, []));
            setSectionMappings(mappings.length > 0 ? mappings : [EMPTY_SECTION_MAP]);
            setMarqueeLines(normalizeMarqueeLines(parseJson(marqueeRaw, [])));

            const fromProducts = (productsRows || []).map((row) => String(row?.category || '').trim()).filter(Boolean);
            const fromCatalog = (productCategoryRows || [])
                .map((row) => String(row?.name || row?.code || '').trim())
                .filter(Boolean);
            const unique = [...new Set([...fromProducts, ...fromCatalog])].sort((a, b) => a.localeCompare(b, 'es'));
            setCategoryOptions(unique);
        } catch (error) {
            showMessage('error', `No se pudo cargar Configuración Balanza: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [showMessage]);

    useEffect(() => {
        load();
    }, [load]);

    const activeMarqueeText = useMemo(() => {
        const active = marqueeLines.find((line) => Number(line.active) === 1 && String(line.text || '').trim());
        return String(active?.text || '').trim();
    }, [marqueeLines]);

    const saveAll = async () => {
        if (!isAdmin) {
            showMessage('error', 'Solo un administrador puede guardar configuración de balanza');
            return;
        }
        setSaving(true);
        try {
            for (const row of scaleUsers) {
                await saveTableRecord('scale_users', 'upsert', {
                    slot_no: Number(row.slot_no),
                    display_name: String(row.display_name || '').trim() || `VENDEDOR ${row.slot_no}`,
                    active: Number(row.active ?? 1) === 0 ? 0 : 1,
                });
            }

            const cleanMappings = normalizeSectionMappings(sectionMappings);
            const cleanMarquee = marqueeLines.map((line, index) => ({
                id: index + 1,
                text: String(line.text || '').trim().slice(0, 80),
                active: Number(line.active ?? 0) === 1 ? 1 : 0,
            }));

            await Promise.all([
                upsertRemoteSetting('scale_ticket_header_line1', String(ticketHeader.line1 || '').trim().slice(0, 18)),
                upsertRemoteSetting('scale_ticket_header_line2', String(ticketHeader.line2 || '').trim().slice(0, 34)),
                upsertRemoteSetting('scale_ticket_header_line3', String(ticketHeader.line3 || '').trim().slice(0, 34)),
                upsertRemoteSetting('scale_section_mappings', JSON.stringify(cleanMappings)),
                upsertRemoteSetting('scale_marquee_messages', JSON.stringify(cleanMarquee)),
                upsertRemoteSetting('scale_marquee_text', activeMarqueeText || ''),
            ]);

            showMessage('success', 'Configuración de balanza guardada y lista para sincronizar.');
            window.alert('Configuración de balanza guardada y lista para sincronizar.');
            await load();
        } catch (error) {
            showMessage('error', `Error al guardar configuración de balanza: ${error.message}`);
            window.alert(`Error al guardar configuración de balanza: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const updateMapping = (index, field, value) => {
        setSectionMappings((current) => current.map((row, rowIndex) => (
            rowIndex === index
                ? {
                    ...row,
                    [field]: field === 'sectionId'
                        ? Math.max(1, Math.min(99, Number.parseInt(value, 10) || 2))
                        : value,
                }
                : row
        )));
    };

    const removeMapping = (index) => {
        setSectionMappings((current) => {
            const next = current.filter((_, rowIndex) => rowIndex !== index);
            return next.length > 0 ? next : [EMPTY_SECTION_MAP];
        });
    };

    return (
        <div className="scale-config-page">
            <div className="scale-config-header">
                <div>
                    <h2><Cpu size={20} /> Configuración Balanza</h2>
                    <p>Definí vendedores, encabezado de ticket, secciones y marquesinas para sincronizar con CUORA.</p>
                </div>
                <button className="scale-config-save-btn" onClick={saveAll} disabled={loading || saving || !isAdmin}>
                    {saving ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
                    Guardar configuración
                </button>
            </div>

            <div className="scale-config-warning">
                Se requiere MeatManager Bridge instalado y en ejecucion para sincronizar esta configuracion con la balanza.
            </div>

            <div className="scale-config-grid">
                <section className="scale-card">
                    <h3>Usuarios Balanza</h3>
                    {scaleUsers.map((row) => (
                        <div key={row.slot_no} className="scale-vendor-row">
                            <span>Vendedor {row.slot_no}</span>
                            <input
                                value={row.display_name}
                                onChange={(e) => setScaleUsers((current) => current.map((entry) => (
                                    entry.slot_no === row.slot_no ? { ...entry, display_name: e.target.value } : entry
                                )))}
                                maxLength={18}
                                disabled={!isAdmin || loading}
                            />
                            <label>
                                <input
                                    type="checkbox"
                                    checked={Number(row.active) === 1}
                                    onChange={(e) => setScaleUsers((current) => current.map((entry) => (
                                        entry.slot_no === row.slot_no ? { ...entry, active: e.target.checked ? 1 : 0 } : entry
                                    )))}
                                    disabled={!isAdmin || loading}
                                />
                                Activo
                            </label>
                        </div>
                    ))}
                </section>

                <section className="scale-card">
                    <h3>Encabezado Ticket</h3>
                    <p className="scale-card-hint">CUORA MAX aplica Linea 1 y Linea 2 por protocolo. La Linea 3 queda reservada para futuros modelos.</p>
                    <input
                        value={ticketHeader.line1}
                        onChange={(e) => setTicketHeader((current) => ({ ...current, line1: e.target.value }))}
                        placeholder="Línea 1 (ej: CARNICERÍA CÉSAR)"
                        maxLength={18}
                        disabled={!isAdmin || loading}
                    />
                    <input
                        value={ticketHeader.line2}
                        onChange={(e) => setTicketHeader((current) => ({ ...current, line2: e.target.value }))}
                        placeholder="Línea 2"
                        maxLength={34}
                        disabled={!isAdmin || loading}
                    />
                    <input
                        value={ticketHeader.line3}
                        onChange={(e) => setTicketHeader((current) => ({ ...current, line3: e.target.value }))}
                        placeholder="Línea 3"
                        maxLength={34}
                        disabled={!isAdmin || loading}
                    />
                </section>
            </div>

            <section className="scale-card">
                <div className="scale-card-title-row">
                    <h3>Secciones Balanza ↔ Categorías MM</h3>
                    <button
                        className="scale-secondary-btn"
                        onClick={() => setSectionMappings((current) => [...current, { ...EMPTY_SECTION_MAP }])}
                        disabled={!isAdmin || loading}
                    >
                        <Plus size={16} />
                        Agregar vínculo
                    </button>
                </div>
                <p className="scale-card-hint">Cada categoría de MM puede enviar sus PLU a una sección específica de la balanza.</p>
                <div className="scale-mapping-list">
                    {sectionMappings.map((row, index) => (
                        <div key={`${index}-${row.category}-${row.sectionId}`} className="scale-mapping-row">
                            <select
                                value={row.category}
                                onChange={(e) => updateMapping(index, 'category', e.target.value)}
                                disabled={!isAdmin || loading}
                            >
                                <option value="">Seleccionar categoría</option>
                                {categoryOptions.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min="1"
                                max="99"
                                value={row.sectionId}
                                onChange={(e) => updateMapping(index, 'sectionId', e.target.value)}
                                disabled={!isAdmin || loading}
                            />
                            <input
                                value={row.sectionName}
                                onChange={(e) => updateMapping(index, 'sectionName', e.target.value.toUpperCase())}
                                maxLength={18}
                                placeholder="Nombre sección"
                                disabled={!isAdmin || loading}
                            />
                            <button
                                className="scale-icon-btn"
                                onClick={() => removeMapping(index)}
                                disabled={!isAdmin || loading}
                                title="Eliminar vínculo"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="scale-card">
                <h3>Publicidades / Marquesina</h3>
                <p className="scale-card-hint">La línea activa se envía automáticamente a la marquesina de la balanza.</p>
                <div className="scale-mapping-list">
                    {marqueeLines.map((line, index) => (
                        <div key={line.id} className="scale-marquee-row">
                            <span>Mensaje {index + 1}</span>
                            <input
                                value={line.text}
                                onChange={(e) => setMarqueeLines((current) => current.map((entry, rowIndex) => (
                                    rowIndex === index ? { ...entry, text: e.target.value } : entry
                                )))}
                                maxLength={80}
                                placeholder="Texto de marquesina"
                                disabled={!isAdmin || loading}
                            />
                            <label>
                                <input
                                    type="radio"
                                    checked={Number(line.active) === 1}
                                    onChange={() => setMarqueeLines((current) => current.map((entry, rowIndex) => ({
                                        ...entry,
                                        active: rowIndex === index ? 1 : 0,
                                    })))}
                                    disabled={!isAdmin || loading}
                                />
                                Activo
                            </label>
                        </div>
                    ))}
                </div>
            </section>

            {message && (
                <div className={`scale-toast ${message.type}`}>
                    <CheckCircle2 size={18} />
                    <span>{message.text}</span>
                </div>
            )}
        </div>
    );
};

export default ConfiguracionBalanza;
