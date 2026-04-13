export const COVERAGE_SETTINGS_KEY = 'branch_transfer_coverage_rules';

export const DEFAULT_COVERAGE_RULES = {
    default: { low: 0.25, medium: 0.75 },
    categories: {},
};

export const normalizeCoverageKey = (value) => String(value || '').trim().toLowerCase();

const clampRatio = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(parsed, 1));
};

export const normalizeCoverageRules = (rawValue) => {
    try {
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        const safeDefaultLow = clampRatio(parsed?.default?.low, DEFAULT_COVERAGE_RULES.default.low);
        const safeDefaultMedium = clampRatio(parsed?.default?.medium, DEFAULT_COVERAGE_RULES.default.medium);
        const orderedDefault = safeDefaultLow < safeDefaultMedium
            ? { low: safeDefaultLow, medium: safeDefaultMedium }
            : DEFAULT_COVERAGE_RULES.default;

        const categories = {};
        if (parsed?.categories && typeof parsed.categories === 'object') {
            Object.entries(parsed.categories).forEach(([key, value]) => {
                const normalizedKey = normalizeCoverageKey(key);
                if (!normalizedKey) return;
                const low = clampRatio(value?.low, orderedDefault.low);
                const medium = clampRatio(value?.medium, orderedDefault.medium);
                if (low < medium) categories[normalizedKey] = { low, medium };
            });
        }

        return { default: orderedDefault, categories };
    } catch {
        return { ...DEFAULT_COVERAGE_RULES };
    }
};

export const resolveCoverageThresholds = (rules, category) => {
    const fallback = rules?.default || DEFAULT_COVERAGE_RULES.default;
    const categoryRule = rules?.categories?.[normalizeCoverageKey(category)];
    return {
        low: categoryRule?.low ?? fallback.low,
        medium: categoryRule?.medium ?? fallback.medium,
    };
};
