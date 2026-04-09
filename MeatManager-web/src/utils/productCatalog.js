import { fetchTable, saveTableRecord } from './apiClient';

export const normalizeProductName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normalizeProductKey = (value) => normalizeProductName(value).replace(/\s+/g, '_');
export const buildProductCanonicalKey = (name) => normalizeProductKey(name);
export const buildLegacyPriceProductId = (name, category) => `${normalizeProductKey(name)}-${normalizeProductKey(category || 'general')}`;

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toTimestamp = (value) => {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
};

const sortByRecency = (left, right) => {
    const tsDiff = toTimestamp(right?.updated_at) - toTimestamp(left?.updated_at);
    if (tsDiff !== 0) return tsDiff;
    return toNumber(right?.id) - toNumber(left?.id);
};

export const findProductByIdentity = (products, { id, name, plu }) => {
    const list = Array.isArray(products) ? products : [];
    if (id != null) {
        const byId = list.find((item) => Number(item?.id) === Number(id));
        if (byId) return byId;
    }

    const normalizedKey = buildProductCanonicalKey(name);
    const normalizedPlu = String(plu || '').trim();
    return [...list]
        .sort(sortByRecency)
        .find((item) => {
            const itemKey = String(item?.canonical_key || '').trim().toLowerCase();
            const itemPlu = String(item?.plu || '').trim();
            return (
                (normalizedKey && itemKey === normalizedKey) ||
                (normalizedPlu && itemPlu && itemPlu === normalizedPlu)
            );
        }) || null;
};

export const findLegacyPriceRecord = (prices, name, category) => {
    const list = Array.isArray(prices) ? [...prices].sort(sortByRecency) : [];
    const canonicalProductId = buildLegacyPriceProductId(name, category);
    const normalizedName = normalizeProductKey(name);

    return list.find((price) => String(price?.product_id || '').trim().toLowerCase() === canonicalProductId)
        || list.find((price) => String(price?.product_id || '').trim().toLowerCase() === normalizedName)
        || list.find((price) => String(price?.product_id || '').trim().toLowerCase().startsWith(`${normalizedName}-`))
        || null;
};

export const getLegacyPriceCandidates = (prices, name, category) => {
    const list = Array.isArray(prices) ? [...prices].sort(sortByRecency) : [];
    const canonicalProductId = buildLegacyPriceProductId(name, category);
    const normalizedName = normalizeProductKey(name);

    return list.filter((price) => {
        const priceProductId = String(price?.product_id || '').trim().toLowerCase();
        return (
            priceProductId === canonicalProductId
            || priceProductId === normalizedName
            || priceProductId.startsWith(`${normalizedName}-`)
        );
    });
};

export const getProductCurrentPrice = (product, legacyPriceRecord = null) => {
    const productPrice = toNumber(product?.current_price);
    if (productPrice > 0) return productPrice;
    return toNumber(legacyPriceRecord?.price);
};

export const fetchProductsSafe = async () => {
    try {
        const rows = await fetchTable('products', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' });
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn('[PRODUCTS] products table not available yet:', error?.message || error);
        return [];
    }
};

export const promptPriceConflictResolution = ({ name, existingPrice, incomingPrice, source }) => {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
        return incomingPrice;
    }

    const useIncoming = window.confirm(
        `Conflicto de precio para "${name}".\n\n` +
        `Precio actual: $${toNumber(existingPrice).toLocaleString('es-AR')}\n` +
        `Precio entrante (${source || 'nuevo ingreso'}): $${toNumber(incomingPrice).toLocaleString('es-AR')}\n\n` +
        'Aceptar = usar precio entrante\nCancelar = conservar precio actual'
    );

    return useIncoming ? incomingPrice : existingPrice;
};

export const upsertLegacyPriceMirror = async ({ prices, name, category, price, plu, productId = null }) => {
    const sortedPrices = Array.isArray(prices) ? [...prices].sort(sortByRecency) : [];
    const legacyByProductRef = productId != null
        ? sortedPrices.find((item) => Number(item?.product_ref_id) === Number(productId))
        : null;
    const legacyRecord = legacyByProductRef || findLegacyPriceRecord(sortedPrices, name, category);
    const payload = {
        product_id: buildLegacyPriceProductId(name, category),
        product_ref_id: productId,
        price: toNumber(price),
        plu: String(plu || '').trim() || null,
        updated_at: new Date().toISOString(),
    };

    if (legacyRecord?.id) {
        await saveTableRecord('prices', 'update', payload, legacyRecord.id);
        return { ...legacyRecord, ...payload };
    }

    try {
        const result = await saveTableRecord('prices', 'insert', payload);
        return { id: result?.insertId, ...payload };
    } catch (error) {
        // Defensa extra para entornos donde ya existe la fila por product_ref_id.
        const message = String(error?.message || '');
        const isDuplicate = message.toLowerCase().includes('duplicate entry');
        if (!isDuplicate || productId == null) throw error;

        const refreshedRows = await fetchTable('prices', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' });
        const existingByRef = (Array.isArray(refreshedRows) ? refreshedRows : [])
            .find((item) => Number(item?.product_ref_id) === Number(productId));

        if (!existingByRef?.id) throw error;

        await saveTableRecord('prices', 'update', payload, existingByRef.id);
        return { ...existingByRef, ...payload };
    }
};

export const ensureUnifiedProduct = async ({
    products,
    prices,
    name,
    category,
    unit,
    price,
    plu,
    source,
    categoryId = null,
    preferredProductId = null,
    resolveConflict = promptPriceConflictResolution,
}) => {
    const trimmedName = String(name || '').trim();
    const trimmedCategory = String(category || 'general').trim() || 'general';
    const trimmedUnit = String(unit || 'kg').trim() || 'kg';
    const incomingPrice = toNumber(price);
    const trimmedPlu = String(plu || '').trim();
    const canonicalKey = buildProductCanonicalKey(trimmedName);

    let existingProduct = findProductByIdentity(products, {
        id: preferredProductId,
        name: trimmedName,
        plu: trimmedPlu,
    });

    const legacyPriceRecord = findLegacyPriceRecord(prices, trimmedName, trimmedCategory);
    const currentKnownPrice = getProductCurrentPrice(existingProduct, legacyPriceRecord);
    let resolvedPrice = incomingPrice > 0 ? incomingPrice : currentKnownPrice;

    if (incomingPrice > 0 && currentKnownPrice > 0 && Math.abs(incomingPrice - currentKnownPrice) > 0.009) {
        resolvedPrice = resolveConflict({
            name: trimmedName,
            existingPrice: currentKnownPrice,
            incomingPrice,
            source,
        });
    }

    const parsedCategoryId = Number(categoryId);
    const resolvedCategoryId = Number.isFinite(parsedCategoryId) && parsedCategoryId > 0
        ? parsedCategoryId
        : (existingProduct?.category_id ?? null);

    const payload = {
        canonical_key: canonicalKey,
        name: trimmedName,
        category_id: resolvedCategoryId,
        category: existingProduct?.category || trimmedCategory,
        unit: existingProduct?.unit || trimmedUnit,
        current_price: resolvedPrice > 0 ? resolvedPrice : null,
        plu: trimmedPlu || existingProduct?.plu || null,
        source: source || existingProduct?.source || 'manual',
        updated_at: new Date().toISOString(),
    };

    let productRecord = existingProduct;
    if (existingProduct?.id) {
        await saveTableRecord('products', 'update', payload, existingProduct.id);
        productRecord = { ...existingProduct, ...payload };
    } else {
        const result = await saveTableRecord('products', 'insert', payload);
        productRecord = { id: result?.insertId, ...payload };
    }

    await upsertLegacyPriceMirror({
        prices,
        name: trimmedName,
        category: productRecord.category,
        price: productRecord.current_price,
        plu: productRecord.plu,
        productId: productRecord.id,
    });

    return productRecord;
};

export const syncLegacyProductsToCatalog = async ({ products, stockRows, prices }) => {
    const productList = Array.isArray(products) ? products : [];
    const stockList = Array.isArray(stockRows) ? stockRows : [];
    const seen = new Set(productList.map((item) => buildProductCanonicalKey(item?.name)));

    const grouped = new Map();
    stockList.forEach((item) => {
        const trimmedName = String(item?.name || '').trim();
        if (!trimmedName) return;
        const canonicalKey = buildProductCanonicalKey(trimmedName);
        if (!grouped.has(canonicalKey)) {
            grouped.set(canonicalKey, {
                name: trimmedName,
                category: item?.type || 'general',
                unit: item?.unit || 'kg',
            });
        }
    });

    for (const [canonicalKey, entry] of grouped.entries()) {
        if (seen.has(canonicalKey)) continue;
        const candidates = getLegacyPriceCandidates(prices, entry.name, entry.category);
        const priceRecord = candidates[0] || null;
        const distinctPrices = [...new Set(
            candidates
                .map((candidate) => toNumber(candidate?.price))
                .filter((value) => value > 0)
        )];
        let resolvedPrice = distinctPrices[0] || 0;
        for (const candidatePrice of distinctPrices.slice(1)) {
            resolvedPrice = promptPriceConflictResolution({
                name: entry.name,
                existingPrice: resolvedPrice,
                incomingPrice: candidatePrice,
                source: 'historial legado',
            });
        }
        await ensureUnifiedProduct({
            products: productList,
            prices,
            name: entry.name,
            category: entry.category,
            unit: entry.unit,
            price: resolvedPrice || candidates[0]?.price,
            plu: priceRecord?.plu,
            source: 'legacy_backfill',
            resolveConflict: ({ incomingPrice, existingPrice }) => incomingPrice || existingPrice,
        });
        seen.add(canonicalKey);
    }
};

export const reconcileLegacyProductConflicts = async ({
    products,
    prices,
    resolveConflict = promptPriceConflictResolution,
}) => {
    const productList = Array.isArray(products) ? products : [];
    const priceList = Array.isArray(prices) ? prices : [];

    for (const product of productList) {
        if (!product?.id || String(product?.source || '') !== 'legacy_backfill') continue;

        const candidates = getLegacyPriceCandidates(priceList, product.name, product.category);
        const distinctPrices = [...new Set(
            candidates
                .map((candidate) => toNumber(candidate?.price))
                .filter((value) => value > 0)
        )];

        if (distinctPrices.length <= 1) continue;

        let resolvedPrice = toNumber(product.current_price) || distinctPrices[0];
        for (const candidatePrice of distinctPrices) {
            if (Math.abs(candidatePrice - resolvedPrice) <= 0.009) continue;
            resolvedPrice = resolveConflict({
                name: product.name,
                existingPrice: resolvedPrice,
                incomingPrice: candidatePrice,
                source: 'historial legado',
            });
        }

        await saveTableRecord('products', 'update', {
            current_price: resolvedPrice,
            source: 'legacy_resolved',
            updated_at: new Date().toISOString(),
        }, product.id);

        await upsertLegacyPriceMirror({
            prices: priceList,
            name: product.name,
            category: product.category,
            price: resolvedPrice,
            plu: product.plu,
            productId: product.id,
        });
    }
};
