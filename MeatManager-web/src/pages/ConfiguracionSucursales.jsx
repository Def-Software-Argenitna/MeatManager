import React, { useEffect, useMemo, useState } from 'react';
import DirectionalReveal from '../components/DirectionalReveal';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchTable, getRemoteSetting, upsertRemoteSetting } from '../utils/apiClient';
import { COVERAGE_SETTINGS_KEY, DEFAULT_COVERAGE_RULES, normalizeCoverageKey, normalizeCoverageRules } from '../utils/branchTransferCoverage';
import './ConfiguracionSucursales.css';

const clampPercent = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(parsed, 100));
};

const mapRulesToDraft = (rules, categoryKeys) => {
    const draft = {
        defaultLowPct: Math.round((rules.default?.low ?? DEFAULT_COVERAGE_RULES.default.low) * 100),
        defaultMediumPct: Math.round((rules.default?.medium ?? DEFAULT_COVERAGE_RULES.default.medium) * 100),
        categories: {},
    };

    categoryKeys.forEach((key) => {
        const current = rules.categories?.[key];
        draft.categories[key] = {
            lowPct: Math.round((current?.low ?? draft.defaultLowPct / 100) * 100),
            mediumPct: Math.round((current?.medium ?? draft.defaultMediumPct / 100) * 100),
        };
    });

    return draft;
};

const ConfiguracionSucursales = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);

    const [rules, setRules] = useState(DEFAULT_COVERAGE_RULES);
    const [draft, setDraft] = useState({ defaultLowPct: 25, defaultMediumPct: 75, categories: {} });
    const [categoriesDetected, setCategoriesDetected] = useState([]);
    const [customCategory, setCustomCategory] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const [rawRules, stockRows, productCategories] = await Promise.all([
                    getRemoteSetting(COVERAGE_SETTINGS_KEY),
                    fetchTable('stock', { limit: 10000, orderBy: 'id', direction: 'DESC' }).catch(() => []),
                    fetchTable('product_categories', { limit: 500, orderBy: 'name', direction: 'ASC' }).catch(() => []),
                ]);

                if (cancelled) return;

                const nextRules = normalizeCoverageRules(rawRules);
                const detected = new Set();

                (Array.isArray(stockRows) ? stockRows : []).forEach((row) => {
                    const key = normalizeCoverageKey(row?.type);
                    if (key) detected.add(key);
                });

                (Array.isArray(productCategories) ? productCategories : []).forEach((row) => {
                    const key = normalizeCoverageKey(row?.code || row?.name);
                    if (key) detected.add(key);
                });

                Object.keys(nextRules.categories || {}).forEach((key) => {
                    if (key) detected.add(key);
                });

                const detectedList = Array.from(detected).sort((a, b) => a.localeCompare(b, 'es'));
                setRules(nextRules);
                setCategoriesDetected(detectedList);
                setDraft(mapRulesToDraft(nextRules, detectedList));
            } catch (error) {
                if (!cancelled) {
                    setStatus({ type: 'error', text: error.message || 'No se pudieron cargar los umbrales.' });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, []);

    const orderedCategories = useMemo(() => {
        return Array.from(new Set([
            ...categoriesDetected,
            ...Object.keys(draft.categories || {}),
        ])).sort((a, b) => a.localeCompare(b, 'es'));
    }, [categoriesDetected, draft.categories]);

    const readOnly = !isAdmin;

    const updateDefault = (field, value) => {
        setDraft((prev) => ({ ...prev, [field]: clampPercent(value, prev[field]) }));
    };

    const updateCategory = (categoryKey, field, value) => {
        setDraft((prev) => ({
            ...prev,
            categories: {
                ...prev.categories,
                [categoryKey]: {
                    ...(prev.categories[categoryKey] || {
                        lowPct: prev.defaultLowPct,
                        mediumPct: prev.defaultMediumPct,
                    }),
                    [field]: clampPercent(value, prev.categories?.[categoryKey]?.[field] ?? prev.defaultLowPct),
                },
            },
        }));
    };

    const addCustomCategory = () => {
        const key = normalizeCoverageKey(customCategory);
        if (!key) return;
        setDraft((prev) => ({
            ...prev,
            categories: {
                ...prev.categories,
                [key]: prev.categories[key] || {
                    lowPct: prev.defaultLowPct,
                    mediumPct: prev.defaultMediumPct,
                },
            },
        }));
        setCategoriesDetected((prev) => Array.from(new Set([...prev, key])).sort((a, b) => a.localeCompare(b, 'es')));
        setCustomCategory('');
    };

    const removeCategory = (categoryKey) => {
        setDraft((prev) => {
            const next = { ...(prev.categories || {}) };
            delete next[categoryKey];
            return { ...prev, categories: next };
        });
    };

    const handleSave = async () => {
        const defaultLow = Number(draft.defaultLowPct) / 100;
        const defaultMedium = Number(draft.defaultMediumPct) / 100;
        if (!(defaultLow < defaultMedium)) {
            setStatus({ type: 'error', text: 'El umbral medio debe ser mayor al umbral bajo.' });
            return;
        }

        const payload = {
            default: { low: defaultLow, medium: defaultMedium },
            categories: {},
        };

        Object.entries(draft.categories || {}).forEach(([key, values]) => {
            const low = Number(values.lowPct) / 100;
            const medium = Number(values.mediumPct) / 100;
            if (Number.isFinite(low) && Number.isFinite(medium) && low < medium) {
                payload.categories[normalizeCoverageKey(key)] = { low, medium };
            }
        });

        try {
            setSaving(true);
            setStatus(null);
            await upsertRemoteSetting(COVERAGE_SETTINGS_KEY, JSON.stringify(payload));
            const normalized = normalizeCoverageRules(payload);
            setRules(normalized);
            setDraft(mapRulesToDraft(normalized, orderedCategories));
            setStatus({ type: 'ok', text: 'Configuración guardada correctamente.' });
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo guardar la configuración.' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="config-sucursales-loading">Cargando configuración de transferencias...</div>;
    }

    return (
        <div className="config-sucursales-page animate-fade-in">
            <DirectionalReveal className="neo-card config-sucursales-card" from="left" delay={0.06}>
                <header className="config-sucursales-header">
                    <h1>Configuración de Transferencias entre Sucursales</h1>
                    <p>
                        Definí los umbrales del semáforo que se usa al comparar stock origen vs destino.
                        Esta configuración impacta la pantalla de Sucursales.
                    </p>
                    {!isAdmin ? (
                        <div className="config-sucursales-readonly">
                            Solo un administrador puede modificar esta configuración.
                        </div>
                    ) : null}
                </header>

                <section className="config-sucursales-section">
                    <h2>Umbrales globales</h2>
                    <div className="config-sucursales-grid">
                        <label>
                            Bajo (%)
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={draft.defaultLowPct}
                                disabled={readOnly}
                                onChange={(e) => updateDefault('defaultLowPct', e.target.value)}
                            />
                        </label>
                        <label>
                            Medio (%)
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={draft.defaultMediumPct}
                                disabled={readOnly}
                                onChange={(e) => updateDefault('defaultMediumPct', e.target.value)}
                            />
                        </label>
                    </div>
                </section>

                <section className="config-sucursales-section">
                    <h2>Overrides por categoría</h2>
                    <div className="config-sucursales-add-row">
                        <input
                            type="text"
                            placeholder="Agregar categoría manual (ej: almacen)"
                            value={customCategory}
                            disabled={readOnly}
                            onChange={(e) => setCustomCategory(e.target.value)}
                        />
                        <button type="button" disabled={readOnly || !customCategory.trim()} onClick={addCustomCategory}>
                            Agregar
                        </button>
                    </div>

                    <div className="config-sucursales-category-list">
                        {orderedCategories.length === 0 ? (
                            <div className="config-sucursales-empty">No hay categorías detectadas todavía.</div>
                        ) : orderedCategories.map((categoryKey) => (
                            <div key={categoryKey} className="config-sucursales-category-row">
                                <strong>{categoryKey}</strong>
                                <div className="config-sucursales-category-inputs">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={draft.categories?.[categoryKey]?.lowPct ?? draft.defaultLowPct}
                                        disabled={readOnly}
                                        onChange={(e) => updateCategory(categoryKey, 'lowPct', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={draft.categories?.[categoryKey]?.mediumPct ?? draft.defaultMediumPct}
                                        disabled={readOnly}
                                        onChange={(e) => updateCategory(categoryKey, 'mediumPct', e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="danger"
                                        disabled={readOnly}
                                        onClick={() => removeCategory(categoryKey)}
                                    >
                                        Quitar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <footer className="config-sucursales-footer">
                    <button type="button" className="save-btn" disabled={readOnly || saving} onClick={handleSave}>
                        {saving ? 'Guardando...' : 'Guardar configuración'}
                    </button>
                    {status ? (
                        <span className={status.type === 'ok' ? 'status-ok' : 'status-error'}>{status.text}</span>
                    ) : null}
                    <span className="current-rules">
                        Activo: bajo {Math.round((rules.default?.low ?? 0) * 100)}% · medio {Math.round((rules.default?.medium ?? 0) * 100)}%
                    </span>
                </footer>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionSucursales;
