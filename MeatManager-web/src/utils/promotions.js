const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const normalizeProductNameKey = (value) => (
    String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
);

const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

export const isKgUnit = (unit) => normalizeKey(unit) === 'kg';

export const PROMO_END_CONDITIONS = {
    NONE: 'none',
    STOCK: 'stock',
    SOLD_KG: 'sold_kg',
    DATE: 'date',
};

export const PROMO_STOCK_MODES = {
    ALL: 'all_stock',
    FIXED: 'fixed_kg',
};

export const normalizePromotion = (row) => {
    const minQtyKg = round3(row?.min_qty_kg);
    const promoTotalPrice = round2(row?.promo_total_price);
    const usedKg = round3(row?.used_kg);
    const soldKgLimit = round3(row?.sold_kg_limit);
    const stockCapKg = round3(row?.stock_cap_kg_limit);
    const endCondition = normalizeKey(row?.end_condition) || PROMO_END_CONDITIONS.NONE;
    const stockMode = normalizeKey(row?.stock_mode) || PROMO_STOCK_MODES.ALL;

    return {
        ...row,
        id: row?.id != null ? Number(row.id) : null,
        branch_id: row?.branch_id != null ? Number(row.branch_id) : null,
        product_id: row?.product_id != null ? Number(row.product_id) : null,
        product_name: String(row?.product_name || '').trim(),
        min_qty_kg: minQtyKg,
        promo_total_price: promoTotalPrice,
        active: row?.active === true || Number(row?.active) === 1,
        used_kg: usedKg,
        sold_kg_limit: soldKgLimit > 0 ? soldKgLimit : null,
        stock_cap_kg_limit: stockCapKg > 0 ? stockCapKg : null,
        end_condition: Object.values(PROMO_END_CONDITIONS).includes(endCondition)
            ? endCondition
            : PROMO_END_CONDITIONS.NONE,
        stock_mode: Object.values(PROMO_STOCK_MODES).includes(stockMode)
            ? stockMode
            : PROMO_STOCK_MODES.ALL,
        end_date: row?.end_date ? new Date(row.end_date).toISOString() : null,
    };
};

export const normalizePromotions = (rows = [], { currentBranchId = null } = {}) => (
    (Array.isArray(rows) ? rows : [])
        .map(normalizePromotion)
    .filter((promo) => !currentBranchId || promo.branch_id == null || Number(promo.branch_id) === Number(currentBranchId))
        .filter((promo) => promo.active && promo.min_qty_kg > 0 && promo.promo_total_price > 0)
);

export const findPromotionCandidates = ({ item, promotions }) => {
    const productId = item?.productId != null ? Number(item.productId) : null;
    const productName = normalizeProductNameKey(item?.name);

    return promotions.filter((promo) => {
        const promoById = promo.product_id != null && productId != null && Number(promo.product_id) === productId;
        const promoByName = normalizeProductNameKey(promo.product_name) === productName;
        return promoById || promoByName;
    });
};

const getRemainingKgByStockMode = ({ promo, currentStockQty }) => {
    if (promo.stock_mode === PROMO_STOCK_MODES.FIXED) {
        const limit = Number(promo.stock_cap_kg_limit) || 0;
        const used = Number(promo.used_kg) || 0;
        return round3(Math.max(0, limit - used));
    }
    const stockQty = Number(currentStockQty) || 0;
    return round3(Math.max(0, stockQty));
};

export const isPromotionAvailable = ({ promo, currentStockQty, now = new Date() }) => {
    if (!promo?.active) return false;

    if (promo.end_condition === PROMO_END_CONDITIONS.DATE) {
        const endDate = parseDate(promo.end_date);
        if (endDate && now > endDate) return false;
    }

    if (promo.end_condition === PROMO_END_CONDITIONS.SOLD_KG) {
        const limit = Number(promo.sold_kg_limit) || 0;
        const used = Number(promo.used_kg) || 0;
        if (limit > 0 && used >= limit) return false;
    }

    if (promo.end_condition === PROMO_END_CONDITIONS.STOCK) {
        const remainingByStock = getRemainingKgByStockMode({ promo, currentStockQty });
        if (remainingByStock <= 0) return false;
    }

    return true;
};

const getPromotionRemainingEligibleKg = ({ promo, currentStockQty }) => {
    const remainingByStockMode = getRemainingKgByStockMode({ promo, currentStockQty });
    let remainingByCondition = Number.POSITIVE_INFINITY;

    if (promo.end_condition === PROMO_END_CONDITIONS.SOLD_KG) {
        const limit = Number(promo.sold_kg_limit) || 0;
        const used = Number(promo.used_kg) || 0;
        if (limit > 0) {
            remainingByCondition = Math.max(0, limit - used);
        }
    }

    if (promo.end_condition === PROMO_END_CONDITIONS.STOCK) {
        remainingByCondition = Math.min(remainingByCondition, remainingByStockMode);
    }

    // El tope por stock_mode aplica siempre, aunque la condición de fin sea otra.
    const remaining = Math.min(remainingByStockMode, remainingByCondition);
    if (!Number.isFinite(remaining)) return Number.POSITIVE_INFINITY;
    return round3(Math.max(0, remaining));
};

export const resolveCartLinePricing = ({ item, promotions, stockQtyByItem, now = new Date() }) => {
    const quantity = Number(item?.quantity) || 0;
    const unitPrice = Number(item?.price) || 0;
    const baseSubtotal = round2(unitPrice * quantity);

    if (!isKgUnit(item?.unit) || quantity <= 0 || unitPrice <= 0) {
        return {
            quantity,
            unitPrice,
            subtotal: baseSubtotal,
            baseSubtotal,
            discount: 0,
            promo: null,
        };
    }

    const itemKeyById = item?.productId != null ? `product:${Number(item.productId)}` : null;
    const itemKeyByName = `name:${normalizeProductNameKey(item?.name)}`;
    const currentStockQty = Number(
        (itemKeyById && stockQtyByItem?.get(itemKeyById))
        ?? stockQtyByItem?.get(itemKeyByName)
        ?? 0
    ) || 0;

    const candidates = findPromotionCandidates({ item, promotions })
        .filter((promo) => isPromotionAvailable({ promo, currentStockQty, now }));

    if (!candidates.length) {
        return {
            quantity,
            unitPrice,
            subtotal: baseSubtotal,
            baseSubtotal,
            discount: 0,
            promo: null,
        };
    }

    let best = null;

    candidates.forEach((promo) => {
        const minQty = Number(promo.min_qty_kg) || 0;
        const promoPrice = Number(promo.promo_total_price) || 0;
        if (minQty <= 0 || promoPrice <= 0) return;

        const remainingEligibleKg = getPromotionRemainingEligibleKg({ promo, currentStockQty });
        const eligibleQty = Number.isFinite(remainingEligibleKg)
            ? Math.min(quantity, remainingEligibleKg)
            : quantity;

        const bundles = Math.floor(eligibleQty / minQty);
        if (bundles <= 0) return;

        const coveredQty = round3(bundles * minQty);
        const remainingQty = round3(Math.max(0, quantity - coveredQty));
        const subtotal = round2((bundles * promoPrice) + (remainingQty * unitPrice));
        const discount = round2(baseSubtotal - subtotal);

        if (discount <= 0) return;
        if (!best || discount > best.discount) {
            best = {
                subtotal,
                discount,
                promo,
                bundles,
                coveredQty,
                remainingQty,
                eligibleQty,
            };
        }
    });

    if (!best) {
        return {
            quantity,
            unitPrice,
            subtotal: baseSubtotal,
            baseSubtotal,
            discount: 0,
            promo: null,
        };
    }

    return {
        quantity,
        unitPrice,
        subtotal: best.subtotal,
        baseSubtotal,
        discount: best.discount,
        promo: {
            id: best.promo.id,
            min_qty_kg: best.promo.min_qty_kg,
            promo_total_price: best.promo.promo_total_price,
            bundles: best.bundles,
            covered_qty: best.coveredQty,
            remaining_qty: best.remainingQty,
            eligible_qty: best.eligibleQty,
            end_condition: best.promo.end_condition,
            stock_mode: best.promo.stock_mode,
        },
    };
};

export const buildCartPricing = ({ cart, promotions, stockQtyByItem, now = new Date() }) => {
    const lineMap = new Map();
    let subtotal = 0;
    let totalDiscount = 0;

    (Array.isArray(cart) ? cart : []).forEach((item) => {
        const line = resolveCartLinePricing({ item, promotions, stockQtyByItem, now });
        lineMap.set(item.id, line);
        subtotal = round2(subtotal + line.subtotal);
        totalDiscount = round2(totalDiscount + line.discount);
    });

    return {
        lineMap,
        subtotal,
        totalDiscount,
    };
};
