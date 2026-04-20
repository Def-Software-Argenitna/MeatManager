import React, { useEffect, useMemo, useState } from 'react';
import {
    FiTag, FiEdit2, FiCopy, FiTrash2, FiSave, FiPlus,
    FiX, FiCheckCircle, FiClock, FiBox, FiMapPin,
    FiInfo, FiActivity, FiXCircle, FiSearch
} from 'react-icons/fi';
import DirectionalReveal from '../components/DirectionalReveal';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchClientBranches, fetchTable, saveTableRecord } from '../utils/apiClient';
import { normalizePluCode, normalizePromotion, PROMO_END_CONDITIONS, PROMO_PRICE_MODES, PROMO_STOCK_MODES } from '../utils/promotions';
import './ConfiguracionPromociones.css';

const toNumber = (value, decimals = 2) => {
    const normalizedRaw = String(value ?? '').trim();
    const normalized = normalizedRaw.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 0;
    const factor = 10 ** decimals;
    return Math.round(parsed * factor) / factor;
};

const formatKg = (value) => toNumber(value, 3).toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatMoney = (value) => toNumber(value, 2).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normalizeText = (value) => String(value || '').trim().toLowerCase();
const normalizeNullableNumber = (value, decimals = 3) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '';
    return String(toNumber(parsed, decimals));
};

const endConditionLabel = (value) => {
    if (value === PROMO_END_CONDITIONS.STOCK) return 'Agotar stock promo';
    if (value === PROMO_END_CONDITIONS.SOLD_KG) return 'Hasta kg vendidos';
    if (value === PROMO_END_CONDITIONS.DATE) return 'Hasta fecha';
    return 'Sin fin';
};

const KG_PRESETS = ['0.500', '1.000', '1.500', '2.000', '3.000', '5.000'];
const PROMO_PLU_STEP = 1000;
const PROMO_SUFFIX_REGEX = /(?:_|\s*)P(\d+)$/i;
const getPromoBaseName = (promoName, fallback = '') => {
    const raw = String(promoName || '').trim();
    if (!raw) return String(fallback || '').trim();
    const normalized = raw.replace(PROMO_SUFFIX_REGEX, '').replace(/[_\s]+$/, '').trim();
    return normalized || raw;
};
const buildPromoGroupKey = (row) => {
    const baseName = getPromoBaseName(row?.promo_name, row?.product_name);
    return [
        Number(row?.product_id || 0),
        row?.branch_id == null ? 'all' : Number(row?.branch_id),
        normalizeText(baseName),
        normalizeText(row?.stock_mode || PROMO_STOCK_MODES.ALL),
        normalizeNullableNumber(row?.stock_cap_kg_limit, 3),
        normalizeText(row?.end_condition || PROMO_END_CONDITIONS.NONE),
        normalizeNullableNumber(row?.sold_kg_limit, 3),
        row?.end_date ? String(row.end_date).slice(0, 16) : '',
        normalizeText(row?.notes || ''),
    ].join('|');
};
const sortPromoTierRows = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((row) => Number(row?.id || 0) > 0)
    .slice()
    .sort((a, b) => {
        const minDiff = Number(a?.min_qty_kg || 0) - Number(b?.min_qty_kg || 0);
        if (Math.abs(minDiff) > 0.0005) return minDiff;
        return Number(a?.id || 0) - Number(b?.id || 0);
    });
const isStructuredPromoTier = (row) => {
    const promoName = String(row?.promo_name || '').trim();
    const promoPlu = normalizePluCode(row?.promo_plu);
    return PROMO_SUFFIX_REGEX.test(promoName) || (promoPlu && Number(promoPlu) >= 1000);
};
const splitGroupRows = (rows) => {
    const sortedRows = sortPromoTierRows(rows);
    const structuredRows = sortedRows.filter(isStructuredPromoTier);
    const workingRows = structuredRows.length > 0 ? structuredRows : sortedRows;
    const workingIds = new Set(workingRows.map((row) => Number(row.id)));
    const staleRows = sortedRows.filter((row) => !workingIds.has(Number(row.id)));
    return {
        workingRows,
        orderedEditableRows: [...workingRows, ...staleRows],
        allRows: sortedRows,
    };
};
const createEmptyTier = (priceMode = PROMO_PRICE_MODES.TOTAL_KG) => ({
    min_qty_kg: '',
    promo_total_price: '',
    promo_price_mode: priceMode,
});

const emptyForm = {
    branch_id: '',
    category_id_filter: '',
    product_id: '',
    product_name: '',
    promo_name: '',
    promo_plu: '',
    promo_unit_price: '',
    min_qty_kg: '',
    promo_total_price: '',
    promo_price_mode: PROMO_PRICE_MODES.TOTAL_KG,
    stock_mode: PROMO_STOCK_MODES.ALL,
    stock_cap_kg_limit: '',
    end_condition: PROMO_END_CONDITIONS.NONE,
    sold_kg_limit: '',
    end_date: '',
    active: true,
    notes: '',
};

const ConfiguracionPromociones = () => {
    const { currentUser, accessProfile } = useUser();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const readOnly = !isAdmin;

    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [branches, setBranches] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [stockRows, setStockRows] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [editingTierIds, setEditingTierIds] = useState([]);
    const [form, setForm] = useState(emptyForm);
    const [extraPromoTiers, setExtraPromoTiers] = useState([]);
    const [listBranchFilter, setListBranchFilter] = useState('');
    const [listSearch, setListSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const [productRows, promotionRows, categoryRows, branchBundle, stockItems] = await Promise.all([
                fetchTable('products', { orderBy: 'name', direction: 'ASC', limit: 10000 }).catch(() => []),
                fetchTable('promotions', { orderBy: 'id', direction: 'DESC', limit: 5000 }).catch(() => []),
                fetchTable('product_categories', { orderBy: 'name', direction: 'ASC', limit: 5000 }).catch(() => []),
                fetchClientBranches().catch(() => ({ branches: [] })),
                fetchTable('stock', { orderBy: 'updated_at', direction: 'DESC', limit: 5000 }).catch(() => []),
            ]);

            setProducts(Array.isArray(productRows) ? productRows : []);
            setPromotions((Array.isArray(promotionRows) ? promotionRows : []).map(normalizePromotion));
            setCategories(Array.isArray(categoryRows) ? categoryRows : []);
            setBranches(Array.isArray(branchBundle?.branches) ? branchBundle.branches : []);
            setStockRows(Array.isArray(stockItems) ? stockItems : []);
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudieron cargar las promociones.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const productsById = useMemo(() => {
        const map = new Map();
        (products || []).forEach((product) => {
            map.set(Number(product.id), product);
        });
        return map;
    }, [products]);

    const categoryOptions = useMemo(() => {
        if (!Array.isArray(categories) || categories.length === 0) return [];
        return categories
            .map((category) => ({
                id: Number(category.id),
                name: String(category.name || category.code || `Categoria ${category.id}`),
            }))
            .filter((category) => Number.isFinite(category.id) && category.id > 0 && category.name.trim().length > 0)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }, [categories]);

    const filteredProducts = useMemo(() => {
        const selectedCategoryId = form.category_id_filter ? Number(form.category_id_filter) : null;
        if (!selectedCategoryId) return [];
        return (products || [])
            .filter((product) => Number(product?.category_id || 0) === selectedCategoryId)
            .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'es'));
    }, [form.category_id_filter, products]);

    const filteredRows = useMemo(() => {
        const list = Array.isArray(promotions) ? promotions : [];
        const branchId = Number(listBranchFilter || 0);
        const search = normalizeText(listSearch);
        return list
            .filter((row) => {
                if (!branchId) return true;
                return Number(row.branch_id || 0) === branchId;
            })
            .filter((row) => {
                if (!search) return true;
                const productName = normalizeText(row?.product_name);
                const promoName = normalizeText(row?.promo_name);
                const promoPlu = normalizeText(row?.promo_plu);
                return productName.includes(search) || promoName.includes(search) || promoPlu.includes(search);
            })
            .slice()
            .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    }, [listBranchFilter, listSearch, promotions]);

    const promotionGroups = useMemo(() => {
        const grouped = new Map();
        filteredRows.forEach((row) => {
            const key = buildPromoGroupKey(row);
            const existing = grouped.get(key);
            if (existing) {
                existing.tiers.push(row);
                if (Number(row?.id || 0) > Number(existing.representative?.id || 0)) {
                    existing.representative = row;
                }
                return;
            }
            grouped.set(key, {
                key,
                representative: row,
                tiers: [row],
            });
        });

        return Array.from(grouped.values())
            .map((group) => ({
                ...group,
                tiers: [...group.tiers].sort((a, b) => {
                    const minDiff = Number(a?.min_qty_kg || 0) - Number(b?.min_qty_kg || 0);
                    if (Math.abs(minDiff) > 0.0005) return minDiff;
                    return Number(a?.id || 0) - Number(b?.id || 0);
                }),
            }))
            .sort((a, b) => Number(b?.representative?.id || 0) - Number(a?.representative?.id || 0));
    }, [filteredRows]);

    const activeGroups = useMemo(
        () => promotionGroups.filter((group) => group.representative?.active),
        [promotionGroups]
    );

    const inactiveGroups = useMemo(
        () => promotionGroups.filter((group) => !group.representative?.active),
        [promotionGroups]
    );
    const tiersByGroupKey = useMemo(() => {
        const grouped = new Map();
        (Array.isArray(promotions) ? promotions : []).forEach((row) => {
            const key = buildPromoGroupKey(row);
            const current = grouped.get(key) || [];
            current.push(row);
            grouped.set(key, current);
        });
        grouped.forEach((rows, key) => {
            grouped.set(
                key,
                rows.slice().sort((a, b) => {
                    const minDiff = Number(a?.min_qty_kg || 0) - Number(b?.min_qty_kg || 0);
                    if (Math.abs(minDiff) > 0.0005) return minDiff;
                    return Number(a?.id || 0) - Number(b?.id || 0);
                })
            );
        });
        return grouped;
    }, [promotions]);
    const stockByIdentity = useMemo(() => {
        const byProduct = new Map();
        const byName = new Map();
        const normalizeName = (value) => String(value || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const addQty = (map, key, qty) => {
            map.set(key, toNumber((map.get(key) || 0) + qty, 3));
        };

        (Array.isArray(stockRows) ? stockRows : []).forEach((row) => {
            const qty = Number(row?.quantity);
            if (!Number.isFinite(qty) || Math.abs(qty) <= 0.000001) return;
            const branchId = Number(row?.branch_id);
            const branchKey = Number.isFinite(branchId) && branchId > 0 ? String(branchId) : 'all';
            const productId = Number(row?.product_id);
            if (Number.isFinite(productId) && productId > 0) {
                addQty(byProduct, `${productId}|${branchKey}`, qty);
                addQty(byProduct, `${productId}|*`, qty);
            }
            const normalizedName = normalizeName(row?.name);
            if (normalizedName) {
                addQty(byName, `${normalizedName}|${branchKey}`, qty);
                addQty(byName, `${normalizedName}|*`, qty);
            }
        });

        return { byProduct, byName };
    }, [stockRows]);
    const getPromoStockQty = (promoRow) => {
        const branchId = Number(promoRow?.branch_id);
        const scopedBranch = Number.isFinite(branchId) && branchId > 0 ? String(branchId) : null;
        const productId = Number(promoRow?.product_id);
        const normalizedName = String(promoRow?.product_name || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if (Number.isFinite(productId) && productId > 0) {
            if (scopedBranch) {
                return toNumber(
                    (stockByIdentity.byProduct.get(`${productId}|${scopedBranch}`) || 0)
                    + (stockByIdentity.byProduct.get(`${productId}|all`) || 0),
                    3
                );
            }
            return toNumber(stockByIdentity.byProduct.get(`${productId}|*`) || 0, 3);
        }

        if (!normalizedName) return 0;
        if (scopedBranch) {
            return toNumber(
                (stockByIdentity.byName.get(`${normalizedName}|${scopedBranch}`) || 0)
                + (stockByIdentity.byName.get(`${normalizedName}|all`) || 0),
                3
            );
        }
        return toNumber(stockByIdentity.byName.get(`${normalizedName}|*`) || 0, 3);
    };

    const branchesById = useMemo(() => {
        const map = new Map();
        (Array.isArray(branches) ? branches : []).forEach((branch) => {
            const id = Number(branch?.id);
            if (Number.isFinite(id) && id > 0) {
                map.set(id, {
                    id,
                    name: String(branch?.name || `Sucursal ${id}`).trim(),
                });
            }
        });
        return map;
    }, [branches]);

    const selectedCategoryName = useMemo(() => {
        if (!form.category_id_filter) return '';
        const found = categoryOptions.find((category) => Number(category.id) === Number(form.category_id_filter));
        return found?.name || '';
    }, [categoryOptions, form.category_id_filter]);

    const selectedProductName = useMemo(() => {
        if (!form.product_id) return '';
        const product = productsById.get(Number(form.product_id));
        return String(product?.name || form.product_name || '');
    }, [form.product_id, form.product_name, productsById]);
    const selectedProduct = useMemo(() => {
        if (!form.product_id) return null;
        return productsById.get(Number(form.product_id)) || null;
    }, [form.product_id, productsById]);
    const selectedProductBasePrice = useMemo(() => {
        if (!selectedProduct) return 0;
        const directPrice = Number(selectedProduct?.current_price);
        if (Number.isFinite(directPrice) && directPrice > 0) return toNumber(directPrice, 2);
        const fallbackPrice = Number(selectedProduct?.price);
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) return toNumber(fallbackPrice, 2);
        return 0;
    }, [selectedProduct]);
    const selectedProductUnitLabel = useMemo(() => {
        const unitRaw = String(selectedProduct?.unit || 'kg').trim().toLowerCase();
        if (unitRaw === 'kg') return 'kg';
        if (unitRaw === 'unidad' || unitRaw === 'unidades' || unitRaw === 'un') return 'unidad';
        return unitRaw || 'kg';
    }, [selectedProduct]);

    const promoSuggestion = useMemo(() => {
        if (!selectedProduct) return { nextPromoNumber: 1, suggestedName: '', suggestedPlu: '' };

        const productId = Number(selectedProduct.id);
        const productName = String(selectedProduct.name || '').trim();
        const basePlu = Number(normalizePluCode(selectedProduct.plu));
        const relatedPromos = (Array.isArray(promotions) ? promotions : []).filter((row) => Number(row?.product_id || 0) === productId);

        const usedNumbers = relatedPromos
            .map((row) => {
                const match = String(row?.promo_name || '').trim().match(PROMO_SUFFIX_REGEX);
                return match ? Number(match[1]) : 0;
            })
            .filter((value) => Number.isFinite(value) && value > 0);

        const nextPromoNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
        const suggestedName = productName ? `${productName}_P${nextPromoNumber}` : '';
        const suggestedPlu = basePlu > 0 ? String((nextPromoNumber * PROMO_PLU_STEP) + basePlu) : '';

        return { nextPromoNumber, suggestedName, suggestedPlu };
    }, [promotions, selectedProduct]);

    const selectedBranchName = useMemo(() => {
        if (!form.branch_id) return 'Todas las sucursales';
        return branchesById.get(Number(form.branch_id))?.name || 'Sucursal seleccionada';
    }, [branchesById, form.branch_id]);

    const setField = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const selectProduct = (productIdRaw) => {
        const productId = productIdRaw ? Number(productIdRaw) : null;
        if (!productId) {
            setForm((prev) => ({ ...prev, product_id: '', product_name: '', promo_name: '', promo_plu: '' }));
            return;
        }
        const product = productsById.get(productId);
        const productName = String(product?.name || '');
        const basePlu = Number(normalizePluCode(product?.plu));
        const relatedPromos = (Array.isArray(promotions) ? promotions : []).filter((row) => Number(row?.product_id || 0) === productId);
        const usedNumbers = relatedPromos
            .map((row) => {
                const match = String(row?.promo_name || '').trim().match(PROMO_SUFFIX_REGEX);
                return match ? Number(match[1]) : 0;
            })
            .filter((value) => Number.isFinite(value) && value > 0);
        const nextPromoNumber = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
        const suggestedPromoName = productName ? `${productName}_P${nextPromoNumber}` : '';
        const suggestedPromoPlu = basePlu > 0 ? String((nextPromoNumber * PROMO_PLU_STEP) + basePlu) : '';

        setForm((prev) => ({
            ...prev,
            product_id: String(productId),
            product_name: productName,
            promo_name: suggestedPromoName,
            promo_plu: suggestedPromoPlu,
            promo_unit_price: prev.promo_unit_price || '',
        }));
    };

    const resetForm = () => {
        setEditingId(null);
        setEditingTierIds([]);
        setForm(emptyForm);
        setExtraPromoTiers([]);
        setStatus(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const buildTierDraftFromRow = (row) => ({
        min_qty_kg: String(toNumber(row?.min_qty_kg, 3)),
        promo_total_price: String(toNumber(row?.promo_total_price, 2)),
        promo_price_mode: row?.promo_price_mode || PROMO_PRICE_MODES.TOTAL_KG,
    });

    const startEditRows = (rows) => {
        const { workingRows, orderedEditableRows } = splitGroupRows(rows);
        const baseRow = workingRows[0];
        if (!baseRow) return;
        const isoEndDate = baseRow.end_date ? String(baseRow.end_date).slice(0, 16) : '';
        setEditingId(Number(baseRow.id));
        setEditingTierIds(orderedEditableRows.map((row) => Number(row.id)).filter((idValue) => Number.isFinite(idValue) && idValue > 0));
        setForm({
            branch_id: baseRow.branch_id != null ? String(baseRow.branch_id) : '',
            category_id_filter: baseRow.product_id != null ? String(productsById.get(Number(baseRow.product_id))?.category_id || '') : '',
            product_id: baseRow.product_id != null ? String(baseRow.product_id) : '',
            product_name: String(baseRow.product_name || ''),
            promo_name: String(baseRow.promo_name || ''),
            promo_plu: normalizePluCode(baseRow.promo_plu),
            promo_unit_price: baseRow.promo_unit_price != null ? String(toNumber(baseRow.promo_unit_price, 2)) : '',
            min_qty_kg: String(toNumber(baseRow.min_qty_kg, 3)),
            promo_total_price: String(toNumber(baseRow.promo_total_price, 2)),
            promo_price_mode: baseRow.promo_price_mode || PROMO_PRICE_MODES.TOTAL_KG,
            stock_mode: baseRow.stock_mode || PROMO_STOCK_MODES.ALL,
            stock_cap_kg_limit: baseRow.stock_cap_kg_limit != null ? String(toNumber(baseRow.stock_cap_kg_limit, 3)) : '',
            end_condition: baseRow.end_condition || PROMO_END_CONDITIONS.NONE,
            sold_kg_limit: baseRow.sold_kg_limit != null ? String(toNumber(baseRow.sold_kg_limit, 3)) : '',
            end_date: isoEndDate,
            active: baseRow.active === true || Number(baseRow.active) === 1,
            notes: String(baseRow.notes || ''),
        });
        setExtraPromoTiers(workingRows.slice(1).map(buildTierDraftFromRow));
        setStatus(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const duplicatePromotion = (row) => {
        const groupKey = buildPromoGroupKey(row);
        const relatedRows = (Array.isArray(promotions) ? promotions : []).filter((item) => buildPromoGroupKey(item) === groupKey);
        const { workingRows } = splitGroupRows(relatedRows.length > 0 ? relatedRows : [row]);
        const baseRow = workingRows[0];
        if (!baseRow) return;
        const isoEndDate = baseRow.end_date ? String(baseRow.end_date).slice(0, 16) : '';
        setEditingId(null);
        setEditingTierIds([]);
        setForm({
            branch_id: baseRow.branch_id != null ? String(baseRow.branch_id) : '',
            category_id_filter: baseRow.product_id != null ? String(productsById.get(Number(baseRow.product_id))?.category_id || '') : '',
            product_id: baseRow.product_id != null ? String(baseRow.product_id) : '',
            product_name: String(baseRow.product_name || ''),
            promo_name: String(baseRow.promo_name || ''),
            promo_plu: normalizePluCode(baseRow.promo_plu),
            promo_unit_price: baseRow.promo_unit_price != null ? String(toNumber(baseRow.promo_unit_price, 2)) : '',
            min_qty_kg: String(toNumber(baseRow.min_qty_kg, 3)),
            promo_total_price: String(toNumber(baseRow.promo_total_price, 2)),
            promo_price_mode: baseRow.promo_price_mode || PROMO_PRICE_MODES.TOTAL_KG,
            stock_mode: baseRow.stock_mode || PROMO_STOCK_MODES.ALL,
            stock_cap_kg_limit: baseRow.stock_cap_kg_limit != null ? String(toNumber(baseRow.stock_cap_kg_limit, 3)) : '',
            end_condition: baseRow.end_condition || PROMO_END_CONDITIONS.NONE,
            sold_kg_limit: baseRow.sold_kg_limit != null ? String(toNumber(baseRow.sold_kg_limit, 3)) : '',
            end_date: isoEndDate,
            active: baseRow.active === true || Number(baseRow.active) === 1,
            notes: String(baseRow.notes || ''),
        });
        setExtraPromoTiers(workingRows.slice(1).map(buildTierDraftFromRow));
        setStatus({ type: 'ok', text: 'Promo duplicada al formulario. Ajusta y guarda.' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const addExtraTier = () => {
        setExtraPromoTiers((prev) => ([
            ...prev,
            createEmptyTier(form.promo_price_mode || PROMO_PRICE_MODES.TOTAL_KG),
        ]));
    };

    const updateExtraTier = (index, patch) => {
        setExtraPromoTiers((prev) => prev.map((tier, tierIndex) => (
            tierIndex === index ? { ...tier, ...patch } : tier
        )));
    };

    const removeExtraTier = (index) => {
        setExtraPromoTiers((prev) => prev.filter((_, tierIndex) => tierIndex !== index));
    };

    const buildNormalizedTiers = () => {
        const baseTier = {
            min_qty_kg: form.min_qty_kg,
            promo_total_price: form.promo_total_price,
            promo_price_mode: form.promo_price_mode,
        };
        const all = [baseTier, ...(Array.isArray(extraPromoTiers) ? extraPromoTiers : [])];

        return all.map((tier) => ({
            min_qty_kg: toNumber(tier?.min_qty_kg, 3),
            promo_total_price: toNumber(tier?.promo_total_price, 2),
            promo_price_mode: tier?.promo_price_mode === PROMO_PRICE_MODES.PER_KG
                ? PROMO_PRICE_MODES.PER_KG
                : PROMO_PRICE_MODES.TOTAL_KG,
        }));
    };

    const buildTierPromoIdentity = (tierIndex) => {
        const rawPromoName = String(form.promo_name || '').trim();
        const nameMatch = rawPromoName.match(PROMO_SUFFIX_REGEX);
        const namePrefix = (nameMatch ? rawPromoName.replace(PROMO_SUFFIX_REGEX, '') : rawPromoName).replace(/[_\s]+$/, '');
        const defaultPromoNumber = editingId ? 1 : promoSuggestion.nextPromoNumber;
        const startPromoNumber = nameMatch ? Number(nameMatch[1]) : defaultPromoNumber;

        const normalizedPromoPlu = Number(normalizePluCode(form.promo_plu));
        const sequentialPromoPlu = normalizedPromoPlu > 0
            ? String(normalizedPromoPlu + (tierIndex * PROMO_PLU_STEP))
            : '';

        return {
            promo_name: namePrefix ? `${namePrefix}_P${startPromoNumber + tierIndex}` : rawPromoName,
            promo_plu: sequentialPromoPlu,
        };
    };

    const tierPayloadPreview = useMemo(() => {
        const normalized = buildNormalizedTiers().sort((a, b) => a.min_qty_kg - b.min_qty_kg);
        return normalized.map((tier, index) => ({
            ...tier,
            ...buildTierPromoIdentity(index),
        }));
    }, [
        editingId,
        extraPromoTiers,
        form.min_qty_kg,
        form.promo_name,
        form.promo_plu,
        form.promo_price_mode,
        form.promo_total_price,
        promoSuggestion.nextPromoNumber,
    ]);

    const tierCodesPreviewText = useMemo(
        () => tierPayloadPreview.map((tier) => tier.promo_plu).filter(Boolean).join(', '),
        [tierPayloadPreview]
    );
    const tierCodeSummary = useMemo(
        () => tierPayloadPreview
            .filter((tier) => tier.promo_plu)
            .map((tier, index) => `${tier.promo_name || `P${index + 1}`}: ${tier.promo_plu}`)
            .join(' · '),
        [tierPayloadPreview]
    );

    const togglePromoStatus = async (rows) => {
        try {
            setSaving(true);
            const targetRows = (Array.isArray(rows) ? rows : [rows])
                .filter((row) => Number(row?.id || 0) > 0);
            if (targetRows.length === 0) return;
            const newActiveStatus = !targetRows[0].active;

            for (const row of targetRows) {
                await saveTableRecord('promotions', 'update', { active: newActiveStatus ? 1 : 0 }, row.id);
            }
            await loadData();
            const groupText = targetRows.length > 1 ? ` (${targetRows.length} niveles)` : '';
            setStatus({ type: 'ok', text: `Promoción ${newActiveStatus ? 'activada' : 'desactivada'} correctamente${groupText}.` });

            const editedIds = new Set(
                (Array.isArray(editingTierIds) && editingTierIds.length > 0
                    ? editingTierIds
                    : [editingId])
                    .map((idValue) => Number(idValue))
            );
            if (targetRows.some((row) => editedIds.has(Number(row.id)))) {
                setForm((prev) => ({ ...prev, active: newActiveStatus }));
            }
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo cambiar el estado de la promoción.' });
        } finally {
            setSaving(false);
        }
    };

    const validateForm = () => {
        const productName = String(form.product_name || '').trim();
        const promoName = String(form.promo_name || '').trim();
        const tiers = buildNormalizedTiers();
        const sorted = [...tiers].sort((a, b) => a.min_qty_kg - b.min_qty_kg);

        if (!productName) throw new Error('Selecciona un articulo para la promo.');
        if (!promoName) throw new Error('Ingresa un nombre para el codigo promo.');

        tiers.forEach((tier, index) => {
            if (!(tier.min_qty_kg > 0)) throw new Error(`El mínimo en kg del nivel ${index + 1} debe ser mayor a 0.`);
            if (!(tier.promo_total_price > 0)) throw new Error(`El precio promo del nivel ${index + 1} debe ser mayor a 0.`);
        });

        const tierPromoPluValues = sorted.map((_, index) => buildTierPromoIdentity(index).promo_plu);
        tierPromoPluValues.forEach((promoPlu, index) => {
            if (!promoPlu || Number(promoPlu) < 1000) {
                throw new Error(`El PLU de promo del nivel ${index + 1} debe ser numérico y mayor o igual a 1000.`);
            }
        });
        if (new Set(tierPromoPluValues).size !== tierPromoPluValues.length) {
            throw new Error('Los niveles no pueden compartir el mismo PLU de promo.');
        }
        const editingIdsSet = new Set(
            (Array.isArray(editingTierIds) && editingTierIds.length > 0
                ? editingTierIds
                : [editingId])
                .map((idValue) => Number(idValue))
                .filter((idValue) => Number.isFinite(idValue) && idValue > 0)
        );
        const duplicatedPromoPlu = tierPromoPluValues.find((promoPlu) => (
            (Array.isArray(promotions) ? promotions : []).some((row) => (
                normalizePluCode(row?.promo_plu) === promoPlu
                && !editingIdsSet.has(Number(row?.id || 0))
            ))
        ));
        if (duplicatedPromoPlu) throw new Error(`El PLU promo ${duplicatedPromoPlu} ya existe. Usa otro código base.`);

        for (let i = 1; i < sorted.length; i += 1) {
            if (Math.abs(sorted[i].min_qty_kg - sorted[i - 1].min_qty_kg) < 0.0005) {
                throw new Error('No puede haber niveles con el mismo mínimo de kg.');
            }
        }

        if (form.stock_mode === PROMO_STOCK_MODES.FIXED) {
            const cap = toNumber(form.stock_cap_kg_limit, 3);
            if (!(cap > 0)) throw new Error('Si el stock promo es fijo, define kg validos.');
        }

        if (form.end_condition === PROMO_END_CONDITIONS.SOLD_KG) {
            const soldLimit = toNumber(form.sold_kg_limit, 3);
            if (!(soldLimit > 0)) throw new Error('Define el tope de kg vendidos para finalizar la promo.');
        }

        if (form.end_condition === PROMO_END_CONDITIONS.DATE) {
            const endDate = new Date(form.end_date);
            if (!form.end_date || Number.isNaN(endDate.getTime())) {
                throw new Error('Define una fecha de finalizacion valida.');
            }
        }
    };

    const previewLine = useMemo(() => {
        const product = selectedProductName || 'Artículo';
        const branchScope = form.branch_id ? `Solo en ${selectedBranchName}` : 'Disponible en todas las sucursales';
        const tiers = tierPayloadPreview.filter((tier) => tier.min_qty_kg > 0 && tier.promo_total_price > 0);
        const stockRule = form.stock_mode === PROMO_STOCK_MODES.FIXED
            ? `Cupo promo: ${form.stock_cap_kg_limit ? `${formatKg(form.stock_cap_kg_limit)} kg` : 'X kg'}`
            : '';

        let endRule = 'Sin fin';
        if (form.end_condition === PROMO_END_CONDITIONS.STOCK) endRule = 'Finaliza al agotar stock promo';
        if (form.end_condition === PROMO_END_CONDITIONS.SOLD_KG) endRule = `Finaliza en ${form.sold_kg_limit ? `${formatKg(form.sold_kg_limit)} kg vendidos` : 'X kg vendidos'}`;
        if (form.end_condition === PROMO_END_CONDITIONS.DATE) endRule = `Finaliza el ${form.end_date ? new Date(form.end_date).toLocaleString('es-AR') : 'dd/mm/aaaa hh:mm'}`;

        return (
            <div className="promo-preview-content">
                <strong><FiTag className="icon-mr"/> {product}</strong>
                {tiers.length ? (
                    <div style={{ marginTop: '0.35rem', display: 'grid', gap: '0.2rem' }}>
                        {tiers.map((tier, index) => (
                            <div key={`${tier.min_qty_kg}-${tier.promo_total_price}-${index}`}>
                                Desde {formatKg(tier.min_qty_kg)} kg: {' '}
                                <span className="highlight-price">
                                    {tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG
                                        ? `$${formatMoney(tier.promo_total_price)} por kg`
                                        : `$${formatMoney(tier.promo_total_price)} total`}
                                </span>
                                {tier.promo_plu ? (
                                    <span style={{ marginLeft: '0.55rem', fontSize: '0.75rem', opacity: 0.9 }}>
                                        · Código {tier.promo_plu}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ marginTop: '0.35rem' }}>Define al menos un nivel de promo.</div>
                )}
                <div className="preview-badges">
                    <span className="preview-badge"><FiMapPin /> {branchScope}</span>
                    {stockRule && <span className="preview-badge"><FiBox /> {stockRule}</span>}
                    <span className="preview-badge"><FiClock /> {endRule}</span>
                </div>
            </div>
        );
    }, [form.branch_id, form.end_condition, form.end_date, form.sold_kg_limit, form.stock_cap_kg_limit, form.stock_mode, selectedBranchName, selectedProductName, tierPayloadPreview]);

    const savePromotion = async ({ keepCreating = false } = {}) => {
        try {
            validateForm();
            setSaving(true);
            setStatus(null);
            const currentCategoryId = String(form.category_id_filter || '');
            const tiers = buildNormalizedTiers().sort((a, b) => a.min_qty_kg - b.min_qty_kg);
            const tierPayloads = tiers.map((tier, index) => {
                const identity = buildTierPromoIdentity(index);
                return { ...tier, ...identity };
            });
            const createdPromoCodes = tierPayloads.map((tier) => tier.promo_plu).filter(Boolean);
            const createdPromoIdentity = createdPromoCodes.length
                ? ` Códigos: ${createdPromoCodes.join(', ')}.`
                : '';

            const basePayload = {
                branch_id: form.branch_id ? Number(form.branch_id) : null,
                product_id: form.product_id ? Number(form.product_id) : null,
                product_name: String(form.product_name || '').trim(),
                stock_mode: form.stock_mode || PROMO_STOCK_MODES.ALL,
                stock_cap_kg_limit: form.stock_mode === PROMO_STOCK_MODES.FIXED
                    ? toNumber(form.stock_cap_kg_limit, 3)
                    : null,
                end_condition: form.end_condition || PROMO_END_CONDITIONS.NONE,
                sold_kg_limit: form.end_condition === PROMO_END_CONDITIONS.SOLD_KG
                    ? toNumber(form.sold_kg_limit, 3)
                    : null,
                end_date: form.end_condition === PROMO_END_CONDITIONS.DATE
                    ? new Date(form.end_date).toISOString()
                    : null,
                active: form.active ? 1 : 0,
                notes: String(form.notes || '').trim() || null,
            };

            let totalQueuedBroadcast = 0;
            let createdCount = 0;
            if (editingId) {
                const editableTierIds = (Array.isArray(editingTierIds) && editingTierIds.length > 0
                    ? editingTierIds
                    : [editingId])
                    .map((idValue) => Number(idValue))
                    .filter((idValue) => Number.isFinite(idValue) && idValue > 0);

                for (let index = 0; index < tierPayloads.length; index += 1) {
                    const tier = tierPayloads[index];
                    const tierPayload = {
                        ...basePayload,
                        promo_name: tier.promo_name,
                        promo_plu: tier.promo_plu || null,
                        min_qty_kg: tier.min_qty_kg,
                        promo_total_price: tier.promo_total_price,
                        promo_price_mode: tier.promo_price_mode,
                        promo_unit_price: tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG
                            ? tier.promo_total_price
                            : (tier.min_qty_kg > 0 ? toNumber(tier.promo_total_price / tier.min_qty_kg, 2) : null),
                    };
                    const targetId = editableTierIds[index];

                    if (targetId) {
                        const updateResult = await saveTableRecord('promotions', 'update', tierPayload, targetId);
                        totalQueuedBroadcast += Number(updateResult?.broadcast?.queued || 0);
                    } else {
                        const insertResult = await saveTableRecord('promotions', 'insert', tierPayload);
                        totalQueuedBroadcast += Number(insertResult?.broadcast?.queued || 0);
                        createdCount += 1;
                    }
                }

                const removedTierIds = editableTierIds.slice(tierPayloads.length);
                for (const staleTierId of removedTierIds) {
                    await saveTableRecord('promotions', 'delete', null, staleTierId);
                }
            } else {
                for (const tier of tierPayloads) {
                    const insertPayload = {
                        ...basePayload,
                        promo_name: tier.promo_name,
                        promo_plu: tier.promo_plu || null,
                        min_qty_kg: tier.min_qty_kg,
                        promo_total_price: tier.promo_total_price,
                        promo_price_mode: tier.promo_price_mode,
                        promo_unit_price: tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG
                            ? tier.promo_total_price
                            : (tier.min_qty_kg > 0 ? toNumber(tier.promo_total_price / tier.min_qty_kg, 2) : null),
                    };
                    const insertResult = await saveTableRecord('promotions', 'insert', insertPayload);
                    totalQueuedBroadcast += Number(insertResult?.broadcast?.queued || 0);
                    createdCount += 1;
                }
            }

            await loadData();
            const queuedBroadcastCount = Number(totalQueuedBroadcast || 0);
            if (keepCreating && !editingId) {
                const baseText = 'Promoción creada exitosamente. Lista para cargar otra.';
                const identityText = createdPromoIdentity || '';
                const broadcastText = queuedBroadcastCount > 0 ? ` WhatsApp: ${queuedBroadcastCount} envíos en cola.` : '';
                setStatus({ type: 'ok', text: `${baseText}${identityText}${broadcastText}` });
                setForm((prev) => ({
                    ...emptyForm,
                    category_id_filter: currentCategoryId || prev.category_id_filter || '',
                    active: true,
                }));
                setExtraPromoTiers([]);
            } else {
                let successText = '';
                if (editingId) {
                    const extraText = createdCount > 0 ? ` Se agregaron ${createdCount} niveles nuevos.` : '';
                    const identityText = createdPromoIdentity || '';
                    successText = `Promoción actualizada con éxito.${extraText}${identityText}`;
                } else {
                    const baseText = createdCount > 1
                        ? `Se crearon ${createdCount} niveles de promoción.`
                        : 'Promoción creada exitosamente.';
                    const identityText = createdPromoIdentity || '';
                    const broadcastText = queuedBroadcastCount > 0 ? ` WhatsApp: ${queuedBroadcastCount} envíos en cola.` : '';
                    successText = `${baseText}${identityText}${broadcastText}`;
                }
                resetForm();
                setStatus({ type: 'ok', text: successText });
            }
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo guardar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    const deletePromotion = async (rows) => {
        try {
            const targetRows = (Array.isArray(rows) ? rows : [rows])
                .filter((row) => Number(row?.id || 0) > 0);
            if (targetRows.length === 0) return;
            const baseRow = targetRows[0];
            const levelText = targetRows.length > 1 ? ` y sus ${targetRows.length} niveles` : '';
            if (!window.confirm(`¿Seguro que deseas eliminar la promoción de ${baseRow.product_name}${levelText}?`)) return;
            setSaving(true);
            setStatus(null);
            for (const row of targetRows) {
                await saveTableRecord('promotions', 'delete', null, row.id);
            }
            await loadData();
            const editedIds = new Set(
                (Array.isArray(editingTierIds) && editingTierIds.length > 0
                    ? editingTierIds
                    : [editingId])
                    .map((idValue) => Number(idValue))
            );
            if (targetRows.some((row) => editedIds.has(Number(row.id)))) {
                resetForm();
            }
            const levelMessage = targetRows.length > 1 ? ` Se borraron ${targetRows.length} niveles.` : '';
            setStatus({ type: 'ok', text: `Promoción eliminada.${levelMessage}` });
        } catch (error) {
            setStatus({ type: 'error', text: error.message || 'No se pudo eliminar la promocion.' });
        } finally {
            setSaving(false);
        }
    };

    const renderPromoCard = (group) => {
        const row = group?.representative;
        const groupRows = tiersByGroupKey.get(group?.key) || (Array.isArray(group?.tiers) ? group.tiers : []);
        const { workingRows: tiers, allRows: rowsForActions } = splitGroupRows(groupRows);
        const currentStockQty = getPromoStockQty(row);
        const hasCurrentStock = currentStockQty > 0;
        return (
            <div key={group?.key || row?.id} className={`promo-card ${row?.active ? 'is-active' : 'is-inactive'}`}>
            <div className="promo-card-header">
                <div className="promo-card-title">
                    <FiTag className="promo-icon"/>
                    <h3>{row?.product_name}</h3>
                </div>
                <div className="promo-card-status">
                    <span className={`status-badge ${row?.active ? 'on' : 'off'}`}>
                        {row?.active ? <><FiCheckCircle/> Activa</> : <><FiXCircle/> Inactiva</>}
                    </span>
                </div>
            </div>
            <div className="promo-card-body">
                <div className="promo-detail-main">
                    <div style={{ display: 'grid', gap: '0.4rem' }}>
                        {tiers.map((tier, index) => (
                            <span key={`${tier?.id || index}`} className="promo-price-tag">
                                {tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG ? (
                                    <>
                                        Desde <strong>{formatKg(tier.min_qty_kg)} kg</strong>, cada kg a <strong>\${formatMoney(tier.promo_total_price)}</strong>
                                    </>
                                ) : (
                                    <>
                                        <strong>{formatKg(tier.min_qty_kg)} kg</strong> por <strong>\${formatMoney(tier.promo_total_price)}</strong> total
                                    </>
                                )}
                                {(tier.promo_name || tier.promo_plu) && (
                                    <span style={{ marginLeft: '0.45rem', fontSize: '0.83rem', opacity: 0.9 }}>
                                        · {String(tier.promo_name || '').trim() || `Promo ${index + 1}`} {tier.promo_plu ? `· PLU ${tier.promo_plu}` : ''}
                                    </span>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
                {tiers.length > 1 && (
                    <div className="promo-detail-item">
                        <FiInfo className="text-muted"/>
                        <span>{tiers.length} niveles configurados para este artículo.</span>
                    </div>
                )}
                <div className="promo-details-grid">
                    <div className="promo-detail-item">
                        <FiMapPin className="text-muted"/>
                        <span>
                            {row?.branch_id != null
                                ? (branchesById.get(Number(row.branch_id))?.name || `Sucursal ${row.branch_id}`)
                                : 'Todas las sucursales'}
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiActivity className="text-muted"/>
                        <span>
                            Usados: {formatKg(row?.used_kg || 0)} kg
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiBox className="text-muted"/>
                        <span>
                            Stock: {row?.stock_mode === PROMO_STOCK_MODES.FIXED
                                ? `Cupo de ${formatKg(row?.stock_cap_kg_limit)} kg`
                                : 'Ilimitado'}
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiActivity className="text-muted"/>
                        <span>
                            Disponibilidad:
                            <span className={`status-badge ${hasCurrentStock ? 'on' : 'off'}`} style={{ marginLeft: '0.4rem' }}>
                                {hasCurrentStock ? 'Con stock' : 'Sin stock'}
                            </span>
                            {hasCurrentStock ? ` (${formatKg(currentStockQty)} kg)` : ''}
                        </span>
                    </div>
                    <div className="promo-detail-item">
                        <FiClock className="text-muted"/>
                        <span>
                            Fin: {endConditionLabel(row?.end_condition)}
                            {row?.end_condition === PROMO_END_CONDITIONS.SOLD_KG && row?.sold_kg_limit
                                ? ` (${formatKg(row?.sold_kg_limit)} kg)`
                                : ''}
                            {row?.end_condition === PROMO_END_CONDITIONS.DATE && row?.end_date
                                ? ` (${new Date(row.end_date).toLocaleString('es-AR')})`
                                : ''}
                        </span>
                    </div>
                </div>
                {row?.notes && (
                    <div className="promo-notes">
                        <FiInfo className="text-muted"/> <span>{row.notes}</span>
                    </div>
                )}
            </div>
            <div className="promo-card-footer">
                <button type="button" className="btn-icon" title="Duplicar" disabled={readOnly || saving} onClick={() => duplicatePromotion(row)}>
                    <FiCopy /> <span className="hidden-mobile">Duplicar</span>
                </button>
                <button type="button" className="btn-icon" title="Editar" disabled={readOnly || saving} onClick={() => startEditRows(rowsForActions)}>
                    <FiEdit2 /> <span className="hidden-mobile">Editar</span>
                </button>
                {row?.active ? (
                    <button type="button" className="btn-icon orange-text" title="Desactivar" disabled={readOnly || saving} onClick={() => togglePromoStatus(rowsForActions)}>
                        <FiXCircle /> <span className="hidden-mobile">Desactivar</span>
                    </button>
                ) : (
                    <button type="button" className="btn-icon green-text" title="Activar" disabled={readOnly || saving} onClick={() => togglePromoStatus(rowsForActions)}>
                        <FiCheckCircle /> <span className="hidden-mobile">Activar</span>
                    </button>
                )}
                <button type="button" className="btn-icon danger-text" title="Eliminar" disabled={readOnly || saving} onClick={() => deletePromotion(rowsForActions)}>
                    <FiTrash2 /> <span className="hidden-mobile">Eliminar</span>
                </button>
            </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="config-promos-loading">
                <div className="spinner"></div> Cargando promociones...
            </div>
        );
    }

    return (
        <div className="config-promos-page animate-fade-in">
            <DirectionalReveal className="config-promos-wrapper" from="bottom" delay={0.05}>
                
                {!isAdmin && (
                    <div className="readonly-alert" style={{ marginBottom: '1rem' }}>
                        <FiInfo /> Solo un administrador puede modificar esta configuración.
                    </div>
                )}

                <div className="layout-grid">
                    {/* Formulario */}
                    <section className="form-section neo-card">
                        <div className="section-header">
                            <h2>{editingId ? <><FiEdit2/> Editar Promoción</> : <><FiPlus/> Nueva Promoción</>}</h2>
                        </div>

                        <div className="form-steps">
                            {/* Paso 1 */}
                            <div className="step-card">
                                <div className="step-badge">1</div>
                                <div className="step-content">
                                    <h3>Producto y Sucursal</h3>
                                    <div className="input-group-row">
                                        <div className="input-field">
                                            <label>Sucursal</label>
                                            <div className="select-wrapper">
                                                <FiMapPin className="input-icon"/>
                                                <select
                                                    value={form.branch_id}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('branch_id', e.target.value)}
                                                >
                                                    <option value="">Todas las sucursales</option>
                                                    {Array.isArray(branches) ? branches.map((branch) => (
                                                        <option key={branch.id} value={branch.id}>
                                                            {branch.name}
                                                        </option>
                                                    )) : null}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="input-field">
                                            <label>Categoría</label>
                                            <select
                                                value={form.category_id_filter}
                                                disabled={readOnly || saving}
                                                onChange={(e) => {
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        category_id_filter: e.target.value,
                                                        product_id: '',
                                                        product_name: '',
                                                        promo_name: '',
                                                        promo_plu: '',
                                                    }));
                                                }}
                                            >
                                                <option value="">Todas</option>
                                                {categoryOptions.map((cat) => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="input-field">
                                            <label>Artículo</label>
                                            <select
                                                value={form.product_id}
                                                disabled={readOnly || saving || !form.category_id_filter}
                                                onChange={(e) => selectProduct(e.target.value)}
                                            >
                                                <option value="">{form.category_id_filter ? 'Seleccionar artículo' : 'Elige categoría primero'}</option>
                                                {filteredProducts.map((p) => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                            {form.product_id ? (
                                                <div style={{ marginTop: '0.45rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                    Precio base sin promo:{' '}
                                                    <strong style={{ color: 'var(--color-text-main)' }}>
                                                        {selectedProductBasePrice > 0
                                                            ? `$${formatMoney(selectedProductBasePrice)} por ${selectedProductUnitLabel}`
                                                            : 'Sin precio configurado'}
                                                    </strong>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Paso 2 */}
                            <div className="step-card">
                                <div className="step-badge">2</div>
                                <div className="step-content">
                                    <h3>Regla de Promoción</h3>
                                    <div className="input-group-row two-cols">
                                        <div className="input-field">
                                            <label>Nombre Promo</label>
                                            <input
                                                type="text"
                                                value={form.promo_name}
                                                disabled={readOnly || saving || !form.product_id}
                                                onChange={(e) => setField('promo_name', e.target.value)}
                                                placeholder={promoSuggestion.suggestedName || 'Articulo_P1'}
                                            />
                                        </div>
                                        <div className="input-field">
                                            <label>PLU Promo (&gt;= 1000)</label>
                                            <input
                                                type="text"
                                                value={form.promo_plu}
                                                disabled={readOnly || saving || !form.product_id}
                                                onChange={(e) => setField('promo_plu', normalizePluCode(e.target.value))}
                                                placeholder={promoSuggestion.suggestedPlu || '1028'}
                                            />
                                        </div>
                                        <div className="input-field">
                                            <label>Kg Mínimo</label>
                                            <input
                                                type="number"
                                                min="0.001" step="0.001"
                                                value={form.min_qty_kg}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('min_qty_kg', e.target.value)}
                                                placeholder="Ej. 2.000"
                                            />
                                            <div className="preset-tags">
                                                {KG_PRESETS.map((preset) => (
                                                    <span key={preset} className="preset-tag" onClick={() => !readOnly && !saving && setField('min_qty_kg', preset)}>
                                                        {preset} kg
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="input-field">
                                            <label>Tipo de precio promo</label>
                                            <select
                                                value={form.promo_price_mode}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('promo_price_mode', e.target.value)}
                                            >
                                                <option value={PROMO_PRICE_MODES.TOTAL_KG}>Precio por total de kg</option>
                                                <option value={PROMO_PRICE_MODES.PER_KG}>Precio por kg</option>
                                            </select>
                                        </div>
                                        <div className="input-field">
                                            <label>{form.promo_price_mode === PROMO_PRICE_MODES.PER_KG ? 'Precio Promo por Kg ($)' : 'Precio Promo Total ($)'}</label>
                                            <input
                                                type="number"
                                                min="0.01" step="0.01"
                                                value={form.promo_total_price}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('promo_total_price', e.target.value)}
                                                placeholder={form.promo_price_mode === PROMO_PRICE_MODES.PER_KG ? 'Ej. 4750 (por kg)' : 'Ej. 9500 (total)'}
                                                className="price-input"
                                            />
                                        </div>
                                        <div className="input-field">
                                            <label>Uso de Stock Promo</label>
                                            <select
                                                value={form.stock_mode}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('stock_mode', e.target.value)}
                                            >
                                                <option value={PROMO_STOCK_MODES.ALL}>Stock ilimitado general</option>
                                                <option value={PROMO_STOCK_MODES.FIXED}>Cupo fijo en Kg</option>
                                            </select>
                                        </div>
                                        {form.stock_mode === PROMO_STOCK_MODES.FIXED && (
                                            <div className="input-field fade-in">
                                                <label>Cupo Promo (Kg)</label>
                                                <input
                                                    type="number"
                                                    min="0.001" step="0.001"
                                                    value={form.stock_cap_kg_limit}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('stock_cap_kg_limit', e.target.value)}
                                                    placeholder="Ej. 100.000"
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.55rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                                Escalas adicionales para el mismo artículo
                                            </label>
                                            <button
                                                type="button"
                                                className="btn-secondary"
                                                disabled={readOnly || saving}
                                                onClick={addExtraTier}
                                                style={{ padding: '0.35rem 0.65rem' }}
                                            >
                                                <FiPlus /> Agregar nivel
                                            </button>
                                        </div>
                                        {extraPromoTiers.length > 0 && (
                                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                                                {extraPromoTiers.map((tier, index) => (
                                                    <div
                                                        key={`tier-${index}`}
                                                        style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: '1fr 1fr 1fr auto',
                                                            gap: '0.5rem',
                                                            alignItems: 'end',
                                                            padding: '0.6rem',
                                                            border: '1px solid rgba(255,255,255,0.08)',
                                                            borderRadius: '10px',
                                                        }}
                                                    >
                                                        <div className="input-field">
                                                            <label>Mínimo kg (nivel {index + 2})</label>
                                                            <input
                                                                type="number"
                                                                min="0.001"
                                                                step="0.001"
                                                                value={tier.min_qty_kg}
                                                                disabled={readOnly || saving}
                                                                onChange={(e) => updateExtraTier(index, { min_qty_kg: e.target.value })}
                                                                placeholder="Ej. 3.000"
                                                            />
                                                        </div>
                                                        <div className="input-field">
                                                            <label>Tipo</label>
                                                            <select
                                                                value={tier.promo_price_mode}
                                                                disabled={readOnly || saving}
                                                                onChange={(e) => updateExtraTier(index, { promo_price_mode: e.target.value })}
                                                            >
                                                                <option value={PROMO_PRICE_MODES.TOTAL_KG}>Total de kg</option>
                                                                <option value={PROMO_PRICE_MODES.PER_KG}>Por kg</option>
                                                            </select>
                                                        </div>
                                                        <div className="input-field">
                                                            <label>{tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG ? 'Precio por kg ($)' : 'Precio total ($)'}</label>
                                                            <input
                                                                type="number"
                                                                min="0.01"
                                                                step="0.01"
                                                                value={tier.promo_total_price}
                                                                disabled={readOnly || saving}
                                                                onChange={(e) => updateExtraTier(index, { promo_total_price: e.target.value })}
                                                                placeholder={tier.promo_price_mode === PROMO_PRICE_MODES.PER_KG ? 'Ej. 4300' : 'Ej. 12000'}
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn-icon danger-text"
                                                            title="Eliminar nivel"
                                                            disabled={readOnly || saving}
                                                            onClick={() => removeExtraTier(index)}
                                                            style={{ height: '38px' }}
                                                        >
                                                            <FiTrash2 />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {tierCodesPreviewText && (
                                            <div
                                                style={{
                                                    padding: '0.55rem 0.7rem',
                                                    border: '1px dashed rgba(255,255,255,0.15)',
                                                    borderRadius: '10px',
                                                    fontSize: '0.78rem',
                                                    color: 'var(--color-text-muted)',
                                                }}
                                            >
                                                <strong style={{ color: 'var(--color-text-main)', marginRight: '0.35rem' }}>
                                                    Códigos que se crearán:
                                                </strong>
                                                <span>{tierCodeSummary}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Paso 3 */}
                            <div className="step-card">
                                <div className="step-badge">3</div>
                                <div className="step-content">
                                    <h3>Finalización y Extras</h3>
                                    <div className="input-group-row two-cols">
                                        <div className="input-field">
                                            <label>Condición de Cierre</label>
                                            <select
                                                value={form.end_condition}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('end_condition', e.target.value)}
                                            >
                                                <option value={PROMO_END_CONDITIONS.NONE}>Vigente siempre</option>
                                                <option value={PROMO_END_CONDITIONS.STOCK}>Al agotar stock fijo promo</option>
                                                <option value={PROMO_END_CONDITIONS.SOLD_KG}>Al llegar a X Kg vendidos</option>
                                                <option value={PROMO_END_CONDITIONS.DATE}>Día y hora específica</option>
                                            </select>
                                        </div>
                                        {form.end_condition === PROMO_END_CONDITIONS.SOLD_KG && (
                                            <div className="input-field fade-in">
                                                <label>Tope Kg Vendidos</label>
                                                <input
                                                    type="number"
                                                    min="0.001" step="0.001"
                                                    value={form.sold_kg_limit}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('sold_kg_limit', e.target.value)}
                                                    placeholder="Ej. 250.000"
                                                />
                                            </div>
                                        )}
                                        {form.end_condition === PROMO_END_CONDITIONS.DATE && (
                                            <div className="input-field fade-in">
                                                <label>Fecha de Cierre</label>
                                                <input
                                                    type="datetime-local"
                                                    value={form.end_date}
                                                    disabled={readOnly || saving}
                                                    onChange={(e) => setField('end_date', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        <div className="input-field full-width">
                                            <label>Notas internas (opcional)</label>
                                            <input
                                                type="text"
                                                value={form.notes}
                                                disabled={readOnly || saving}
                                                onChange={(e) => setField('notes', e.target.value)}
                                                placeholder="Revisar stock en freezer..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Vista Previa y Botones */}
                        <div className="form-footer">
                            <div className="preview-box">
                                {previewLine}
                            </div>
                            
                            <div className="toggle-active">
                                <label className="modern-switch">
                                    <input 
                                        type="checkbox" 
                                        checked={Boolean(form.active)}
                                        disabled={readOnly || saving}
                                        onChange={(e) => setField('active', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                                <span className="switch-label">Promoción Activa al Guardar</span>
                            </div>

                            <div className="action-buttons">
                                <button type="button" className="btn-primary" disabled={readOnly || saving} onClick={() => savePromotion()}>
                                    <FiSave /> {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
                                </button>
                                {!editingId && (
                                    <button
                                        type="button"
                                        className="btn-success"
                                        disabled={readOnly || saving}
                                        onClick={() => savePromotion({ keepCreating: true })}
                                    >
                                        <FiPlus /> Guardar y Crear Otra
                                    </button>
                                )}
                                {editingId && (
                                    <button type="button" className="btn-secondary" disabled={readOnly || saving} onClick={resetForm}>
                                        <FiX /> Cancelar
                                    </button>
                                )}
                            </div>

                            {status && (
                                <div className={`status-message ${status.type}`}>
                                    {status.type === 'ok' ? <FiCheckCircle /> : <FiInfo />}
                                    {status.text}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Tabla / Lista de Promociones */}
                    <section className="list-section neo-card">
                        <div className="list-header-bar">
                            <h2><FiBox/> Promociones Registradas</h2>
                            <div className="filter-box">
                                <FiMapPin className="filter-icon" />
                                <select
                                    value={listBranchFilter}
                                    disabled={loading}
                                    onChange={(e) => setListBranchFilter(e.target.value)}
                                >
                                    <option value="">Todas las suc.</option>
                                    {Array.isArray(branches) ? branches.map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </option>
                                    )) : null}
                                </select>
                            </div>
                        </div>
                        <div className="promo-search-row">
                            <FiSearch className="filter-icon" />
                            <input
                                type="text"
                                value={listSearch}
                                disabled={loading}
                                onChange={(e) => setListSearch(e.target.value)}
                                placeholder="Buscar promo por producto, nombre o PLU"
                            />
                        </div>

                        {promotionGroups.length === 0 ? (
                            <div className="empty-state">
                                <FiBox className="empty-icon" />
                                <p>{listBranchFilter ? 'No hay promociones para esta sucursal.' : 'No se han creado promociones todavía.'}</p>
                            </div>
                        ) : (
                            <div className="promos-container">
                                
                                {activeGroups.length > 0 && (
                                    <div className="promo-group">
                                        <div className="group-title green-glow">
                                            <h3><FiCheckCircle/> Activas</h3>
                                            <span className="count-badge">{activeGroups.length}</span>
                                        </div>
                                        <div className="promo-grid">
                                            {activeGroups.map(renderPromoCard)}
                                        </div>
                                    </div>
                                )}

                                {inactiveGroups.length > 0 && (
                                    <div className="promo-group">
                                        <div className="group-title gray-glow">
                                            <h3><FiXCircle/> Inactivas / Finalizadas</h3>
                                            <span className="count-badge">{inactiveGroups.length}</span>
                                        </div>
                                        <div className="promo-grid">
                                            {inactiveGroups.map(renderPromoCard)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </DirectionalReveal>
        </div>
    );
};

export default ConfiguracionPromociones;
