const roundMetric = (value, decimals = 3) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number(numeric.toFixed(decimals));
};

export const buildDespostadaLogPayload = ({
    type,
    supplier,
    initialWeight,
    yieldPercentage,
    cuts = [],
    selectedLot,
    costPerKg = 0,
    pricingSummary = null
}) => {
    const normalizedCuts = (cuts || []).map((cut) => ({
        cutId: cut.cutId,
        cutName: cut.cutName,
        cutNumber: cut.cutNumber ?? null,
        cutCategory: cut.cutCategory || 'sin_categoria',
        weight: roundMetric(cut.weight),
        timestamp: cut.timestamp instanceof Date ? cut.timestamp.toISOString() : new Date(cut.timestamp).toISOString()
    }));

    const processedWeight = roundMetric(
        normalizedCuts.reduce((acc, cut) => acc + (Number(cut.weight) || 0), 0)
    );
    const totalWeight = roundMetric(initialWeight);
    const safeYield = Number(yieldPercentage) || 0;
    const mermaWeight = roundMetric(Math.max(totalWeight - processedWeight, 0));
    const mermaPercentage = totalWeight > 0 ? roundMetric((mermaWeight / totalWeight) * 100, 1) : 0;

    const categoryTotals = Object.values(
        normalizedCuts.reduce((acc, cut) => {
            const key = cut.cutCategory || 'sin_categoria';
            if (!acc[key]) {
                acc[key] = { category: key, weight: 0, count: 0 };
            }
            acc[key].weight += Number(cut.weight) || 0;
            acc[key].count += 1;
            return acc;
        }, {})
    ).map((entry) => ({
        ...entry,
        weight: roundMetric(entry.weight)
    }));

    const estimatedTotalCost = roundMetric(totalWeight * (Number(costPerKg) || 0));
    const estimatedCostPerOutputKg = processedWeight > 0
        ? roundMetric(estimatedTotalCost / processedWeight)
        : 0;
    const normalizedPricingRows = Array.isArray(pricingSummary?.rows)
        ? pricingSummary.rows.map((row) => ({
            cutId: row.cutId,
            cutName: row.cutName,
            cutCategory: row.cutCategory,
            bucket: row.bucket,
            bucketLabel: row.bucketLabel,
            isCleanMeat: row.isCleanMeat,
            count: row.count,
            weight: roundMetric(row.weight),
            valueIndex: roundMetric(row.valueIndex),
            specificCostPerKg: roundMetric(row.specificCostPerKg, 2),
            suggestedPricePerKg: roundMetric(row.suggestedPricePerKg, 2),
            allocatedCostTotal: roundMetric(row.allocatedCostTotal, 2),
        }))
        : [];

    return {
        type,
        date: new Date(),
        supplier: supplier || selectedLot?.supplier || '',
        total_weight: totalWeight,
        processed_weight: processedWeight,
        yield_percentage: roundMetric(safeYield, 1),
        merma_weight: mermaWeight,
        merma_percentage: mermaPercentage,
        lot_id: selectedLot?.id ?? null,
        purchase_id: selectedLot?.purchase_id ?? null,
        lot_snapshot: selectedLot ? {
            id: selectedLot.id ?? null,
            purchase_id: selectedLot.purchase_id ?? null,
            supplier: selectedLot.supplier || '',
            date: selectedLot.date || null,
            species: selectedLot.species || type,
            weight: roundMetric(selectedLot.weight),
            status: selectedLot.status || 'despostado'
        } : null,
        cuts_count: normalizedCuts.length,
        cuts: normalizedCuts,
        category_totals: categoryTotals,
        cost_per_kg: roundMetric(costPerKg),
        estimated_total_cost: estimatedTotalCost,
        estimated_cost_per_output_kg: estimatedCostPerOutputKg,
        clean_output_weight: roundMetric(pricingSummary?.cleanOutputWeight),
        weighted_output_units: roundMetric(pricingSummary?.weightedOutputUnits),
        clean_average_cost_per_kg: roundMetric(pricingSummary?.cleanAverageCostPerKg, 2),
        normalized_base_cost_per_kg: roundMetric(pricingSummary?.normalizedBaseCostPerKg, 2),
        pricing_margin_percentage: roundMetric(pricingSummary?.marginPercentage, 2),
        pricing_normalization_factor: roundMetric(pricingSummary?.normalizationFactor, 6),
        pricing_allocated_total: roundMetric(pricingSummary?.allocatedCostTotal, 2),
        pricing_validation_difference: roundMetric(pricingSummary?.validationDifference, 2),
        pricing_summary: normalizedPricingRows,
        synced: 0
    };
};
