export const normalizeProductKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

export const buildProductId = (name, category) => `${normalizeProductKey(name)}-${normalizeProductKey(category)}`;

export const findBestMatchingPriceRecord = (prices, itemName, itemType) => {
    const normalizedName = normalizeProductKey(itemName);
    const normalizedType = normalizeProductKey(itemType);
    const canonicalProductId = `${normalizedName}-${normalizedType}`;
    const list = Array.isArray(prices) ? prices : [];

    const rankMatch = (price) => {
        const rawProductId = String(price?.product_id || '').trim().toLowerCase();
        if (rawProductId === canonicalProductId) return 3;
        if (rawProductId === normalizedName) return 2;
        if (rawProductId.startsWith(`${normalizedName}-`)) return 1;
        return 0;
    };

    const getRecencyScore = (price) => {
        const updatedAtTs = price?.updated_at ? new Date(price.updated_at).getTime() : 0;
        if (Number.isFinite(updatedAtTs) && updatedAtTs > 0) return updatedAtTs;
        const numericId = Number(price?.id);
        return Number.isFinite(numericId) ? numericId : 0;
    };

    return list.reduce((best, current) => {
        const currentRank = rankMatch(current);
        if (currentRank === 0) return best;
        if (!best) return current;

        const bestRank = rankMatch(best);
        if (currentRank > bestRank) return current;
        if (currentRank < bestRank) return best;

        return getRecencyScore(current) >= getRecencyScore(best) ? current : best;
    }, null);
};
