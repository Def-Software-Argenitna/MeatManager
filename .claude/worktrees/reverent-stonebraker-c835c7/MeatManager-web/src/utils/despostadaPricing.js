const roundMetric = (value, decimals = 3) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number(numeric.toFixed(decimals));
};

const normalizeKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const DEFAULT_DESPOSTADA_MARGIN = 30;

const CUT_PROFILES = {
    vaca: {
        lomo: { valueIndex: 1.8, bucket: 'premium', isCleanMeat: true },
        bife_ancho: { valueIndex: 1.6, bucket: 'premium', isCleanMeat: true },
        bife_costilla: { valueIndex: 1.6, bucket: 'premium', isCleanMeat: true },
        matambre: { valueIndex: 1.5, bucket: 'premium', isCleanMeat: true },
        peceto: { valueIndex: 1.45, bucket: 'premium', isCleanMeat: true },
        entrana: { valueIndex: 1.35, bucket: 'premium', isCleanMeat: true },
        vacio: { valueIndex: 1.3, bucket: 'estandar', isCleanMeat: true },
        colita: { valueIndex: 1.3, bucket: 'estandar', isCleanMeat: true },
        cuadril: { valueIndex: 1.2, bucket: 'estandar', isCleanMeat: true },
        asado: { valueIndex: 1.15, bucket: 'estandar', isCleanMeat: true },
        bola_lomo: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        tapa_nalga: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
        paleta: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        cuadrada: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        tapa_asado: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        azotillo: { valueIndex: 0.9, bucket: 'economico', isCleanMeat: true },
        roast_beef: { valueIndex: 0.9, bucket: 'economico', isCleanMeat: true },
        palomita: { valueIndex: 0.9, bucket: 'economico', isCleanMeat: true },
        osobuco_ant: { valueIndex: 0.7, bucket: 'economico', isCleanMeat: true },
        osobuco_post: { valueIndex: 0.7, bucket: 'economico', isCleanMeat: true },
    },
    cerdo: {
        solomillo: { valueIndex: 1.8, bucket: 'premium', isCleanMeat: true },
        bondiola: { valueIndex: 1.5, bucket: 'premium', isCleanMeat: true },
        matambrito: { valueIndex: 1.45, bucket: 'premium', isCleanMeat: true },
        carre: { valueIndex: 1.25, bucket: 'estandar', isCleanMeat: true },
        panceta: { valueIndex: 1.2, bucket: 'estandar', isCleanMeat: true },
        pechito: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        cuadril: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        nalga: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        cuadrada: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        peceto: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
        bola_lomo: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
        paleta: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        codillo_ant: { valueIndex: 0.65, bucket: 'economico', isCleanMeat: true },
        manitos: { valueIndex: 0.45, bucket: 'subproducto', isCleanMeat: false },
        patitas: { valueIndex: 0.45, bucket: 'subproducto', isCleanMeat: false },
        cabeza: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
        tocino: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
    },
    pollo: {
        pechuga: { valueIndex: 1.4, bucket: 'premium', isCleanMeat: true },
        muslo: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        contramuslo: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
        pecho: { valueIndex: 0.95, bucket: 'estandar', isCleanMeat: true },
        alita: { valueIndex: 0.9, bucket: 'economico', isCleanMeat: true },
        rabadilla: { valueIndex: 0.4, bucket: 'subproducto', isCleanMeat: false },
        cabeza: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
        cuello: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
        espinazo: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
    },
    pescado: {
        filet: { valueIndex: 1.5, bucket: 'premium', isCleanMeat: true },
        lomo: { valueIndex: 1.35, bucket: 'premium', isCleanMeat: true },
        panza: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
        cola: { valueIndex: 0.8, bucket: 'economico', isCleanMeat: true },
        cabeza: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
        espinazo: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
        agallas: { valueIndex: 0.1, bucket: 'subproducto', isCleanMeat: false },
        piel: { valueIndex: 0.1, bucket: 'subproducto', isCleanMeat: false },
        aletas_sup: { valueIndex: 0.15, bucket: 'subproducto', isCleanMeat: false },
        aletas_inf: { valueIndex: 0.15, bucket: 'subproducto', isCleanMeat: false },
    },
};

const CATEGORY_FALLBACKS = {
    centro: { valueIndex: 1.1, bucket: 'estandar', isCleanMeat: true },
    delantero: { valueIndex: 0.95, bucket: 'estandar', isCleanMeat: true },
    trasero: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
    paleta: { valueIndex: 1.0, bucket: 'estandar', isCleanMeat: true },
    jamon: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
    pechuga: { valueIndex: 1.2, bucket: 'estandar', isCleanMeat: true },
    ala: { valueIndex: 0.9, bucket: 'economico', isCleanMeat: true },
    pierna: { valueIndex: 1.05, bucket: 'estandar', isCleanMeat: true },
    cuello: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
    cabeza: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
    grasa: { valueIndex: 0.2, bucket: 'subproducto', isCleanMeat: false },
    cola: { valueIndex: 0.8, bucket: 'economico', isCleanMeat: true },
    aletas: { valueIndex: 0.15, bucket: 'subproducto', isCleanMeat: false },
    extremidad: { valueIndex: 0.45, bucket: 'subproducto', isCleanMeat: false },
    otro: { valueIndex: 0.15, bucket: 'subproducto', isCleanMeat: false },
};

const bucketLabel = (bucket) => {
    if (bucket === 'premium') return 'Premium';
    if (bucket === 'estandar') return 'Estandar';
    if (bucket === 'economico') return 'Economico';
    return 'Subproducto';
};

export const getCutPricingProfile = (species, cut = {}) => {
    const normalizedSpecies = normalizeKey(species);
    const cutId = normalizeKey(cut.id);
    const cutName = normalizeKey(cut.name);
    const cutCategory = normalizeKey(cut.category);

    const profile = CUT_PROFILES[normalizedSpecies]?.[cutId]
        || CUT_PROFILES[normalizedSpecies]?.[cutName]
        || CATEGORY_FALLBACKS[cutCategory]
        || { valueIndex: 1, bucket: 'estandar', isCleanMeat: true };

    return {
        valueIndex: roundMetric(profile.valueIndex, 3),
        bucket: profile.bucket,
        bucketLabel: bucketLabel(profile.bucket),
        isCleanMeat: profile.isCleanMeat !== false,
    };
};

export const buildDespostadaPricingSummary = ({
    species,
    cuts = [],
    totalInputWeight = 0,
    originCostPerKg = 0,
    marginPercentage = DEFAULT_DESPOSTADA_MARGIN,
}) => {
    const totalCost = roundMetric((Number(totalInputWeight) || 0) * (Number(originCostPerKg) || 0), 2);
    const grouped = new Map();

    (cuts || []).forEach((cut) => {
        const profile = getCutPricingProfile(species, cut);
        const key = cut.cutId || normalizeKey(cut.cutName);

        if (!grouped.has(key)) {
            grouped.set(key, {
                cutId: cut.cutId || key,
                cutName: cut.cutName || 'Sin nombre',
                cutCategory: cut.cutCategory || 'sin_categoria',
                weight: 0,
                count: 0,
                valueIndex: profile.valueIndex,
                bucket: profile.bucket,
                bucketLabel: profile.bucketLabel,
                isCleanMeat: profile.isCleanMeat,
            });
        }

        const entry = grouped.get(key);
        entry.weight += Number(cut.weight) || 0;
        entry.count += 1;
    });

    const rows = Array.from(grouped.values())
        .map((entry) => ({
            ...entry,
            weight: roundMetric(entry.weight),
        }))
        .sort((left, right) => right.weight - left.weight);

    const cleanOutputWeight = roundMetric(rows.reduce((acc, row) => (
        acc + (row.isCleanMeat ? Number(row.weight) || 0 : 0)
    ), 0));
    const processedWeight = roundMetric(rows.reduce((acc, row) => acc + (Number(row.weight) || 0), 0));
    const cleanAverageCostPerKg = cleanOutputWeight > 0 ? roundMetric(totalCost / cleanOutputWeight, 2) : 0;

    const rawAllocatedCost = roundMetric(rows.reduce((acc, row) => {
        const provisionalCost = (Number(row.weight) || 0) * cleanAverageCostPerKg * (Number(row.valueIndex) || 0);
        return acc + provisionalCost;
    }, 0), 2);

    const normalizationFactor = rawAllocatedCost > 0 ? roundMetric(totalCost / rawAllocatedCost, 6) : 1;
    const weightedOutputUnits = roundMetric(rows.reduce((acc, row) => (
        acc + ((Number(row.weight) || 0) * (Number(row.valueIndex) || 0))
    ), 0));
    const normalizedBaseCostPerKg = weightedOutputUnits > 0 ? roundMetric(totalCost / weightedOutputUnits, 2) : 0;

    const pricingRows = rows.map((row) => {
        const provisionalCostPerKg = cleanAverageCostPerKg * (Number(row.valueIndex) || 0);
        const specificCostPerKg = roundMetric(provisionalCostPerKg * normalizationFactor, 2);
        const suggestedPricePerKg = roundMetric(specificCostPerKg * (1 + ((Number(marginPercentage) || 0) / 100)), 2);
        const allocatedCostTotal = roundMetric((Number(row.weight) || 0) * specificCostPerKg, 2);

        return {
            ...row,
            specificCostPerKg,
            suggestedPricePerKg,
            allocatedCostTotal,
        };
    });

    const allocatedCostTotal = roundMetric(pricingRows.reduce((acc, row) => acc + (Number(row.allocatedCostTotal) || 0), 0), 2);

    return {
        totalCost,
        processedWeight,
        cleanOutputWeight,
        cleanAverageCostPerKg,
        weightedOutputUnits,
        normalizedBaseCostPerKg,
        normalizationFactor,
        marginPercentage: roundMetric(marginPercentage, 2),
        allocatedCostTotal,
        validationDifference: roundMetric(totalCost - allocatedCostTotal, 2),
        rows: pricingRows,
    };
};