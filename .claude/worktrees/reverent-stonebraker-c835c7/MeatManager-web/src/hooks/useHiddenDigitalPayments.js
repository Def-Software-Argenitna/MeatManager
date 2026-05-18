import React from 'react';

export const HIDDEN_DIGITAL_PAYMENT_FILTER_EVENT = 'mm-hidden-digital-payment-filter-change';
export const HIDDEN_DIGITAL_PAYMENT_FILTER_KEY = 'mm_hidden_digital_payment_filter_mode';

export const getHiddenDigitalPaymentFilterMode = () => {
    try {
        const stored = sessionStorage.getItem(HIDDEN_DIGITAL_PAYMENT_FILTER_KEY);
        return stored === 'digital' ? 'digital' : 'all';
    } catch {
        return 'all';
    }
};

export const setHiddenDigitalPaymentFilterMode = (mode) => {
    const nextMode = mode === 'digital' ? 'digital' : 'all';

    try {
        sessionStorage.setItem(HIDDEN_DIGITAL_PAYMENT_FILTER_KEY, nextMode);
    } catch {
        // Ignore storage errors and continue with in-memory event propagation.
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(HIDDEN_DIGITAL_PAYMENT_FILTER_EVENT, {
            detail: { mode: nextMode },
        }));
    }

    return nextMode;
};

export const isDigitalPaymentMethodLike = (value) => {
    const rawName = typeof value === 'string' ? value : value?.name || value?.method_name || value?.method || '';
    const rawType = typeof value === 'string' ? '' : value?.type || value?.method_type || '';
    const name = String(rawName || '').trim().toLowerCase();
    const type = String(rawType || '').trim().toLowerCase();

    return (
        type === 'card'
        || type === 'wallet'
        || type === 'transfer'
        || name.includes('mercado pago')
        || name.includes('cuenta dni')
        || name.includes('postnet')
        || name.includes('posnet')
        || name.includes('transferencia')
    );
};

export const parsePaymentBreakdownSafe = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

export const saleUsesOnlyDigitalPayments = (sale) => {
    const parts = parsePaymentBreakdownSafe(sale?.payment_breakdown);
    if (parts.length > 0) {
        const chargedParts = parts.filter((part) => Number(part?.amount_charged ?? part?.amount ?? 0) > 0);
        return chargedParts.length > 0 && chargedParts.every((part) => isDigitalPaymentMethodLike(part));
    }

    return isDigitalPaymentMethodLike({
        name: sale?.payment_method,
        type: sale?.payment_method_type,
    });
};

export const useHiddenDigitalPaymentFilter = () => {
    const [mode, setMode] = React.useState(() => getHiddenDigitalPaymentFilterMode());

    React.useEffect(() => {
        const syncMode = (event) => {
            const nextMode = event?.detail?.mode || getHiddenDigitalPaymentFilterMode();
            setMode(nextMode === 'digital' ? 'digital' : 'all');
        };

        window.addEventListener(HIDDEN_DIGITAL_PAYMENT_FILTER_EVENT, syncMode);
        return () => window.removeEventListener(HIDDEN_DIGITAL_PAYMENT_FILTER_EVENT, syncMode);
    }, []);

    const setFilterMode = React.useCallback((nextMode) => {
        setMode(setHiddenDigitalPaymentFilterMode(nextMode));
    }, []);

    return {
        hiddenDigitalPaymentFilterMode: mode,
        hiddenDigitalPaymentsOnly: mode === 'digital',
        setHiddenDigitalPaymentFilterMode: setFilterMode,
    };
};

export const useHiddenDigitalPaymentShortcuts = () => {
    React.useEffect(() => {
        const handleShortcuts = (event) => {
            if (!(event.ctrlKey && event.altKey)) return;

            const key = String(event.key || '').toLowerCase();
            if (key === 'd') {
                event.preventDefault();
                setHiddenDigitalPaymentFilterMode('digital');
            }
            if (key === 't') {
                event.preventDefault();
                setHiddenDigitalPaymentFilterMode('all');
            }
        };

        window.addEventListener('keydown', handleShortcuts);
        return () => window.removeEventListener('keydown', handleShortcuts);
    }, []);
};