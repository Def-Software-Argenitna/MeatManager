const fs = require('fs');
const path = require('path');

const defaultState = () => ({
    lastProductSyncAt: null,
    lastTicketSyncAt: null,
    lastSalesBackfillAt: null,
    lastRunAt: null,
    lastRunStatus: 'idle',
    lastRunMessage: null,
    lastError: null,
    barcodeConfigFingerprint: null,
    priceFormatFingerprint: null,
    vendorConfigFingerprint: null,
    ticketFingerprints: {},
    productFingerprints: {},
});

function loadState(stateFile) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    if (!fs.existsSync(stateFile)) {
        return defaultState();
    }

    try {
        const payload = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return {
            ...defaultState(),
            ...payload,
            ticketFingerprints: payload.ticketFingerprints || {},
            productFingerprints: payload.productFingerprints || {},
        };
    } catch {
        return defaultState();
    }
}

function resetState(stateFile) {
    const state = defaultState();
    saveState(stateFile, state);
    return state;
}

function saveState(stateFile, state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = {
    defaultState,
    loadState,
    resetState,
    saveState,
};
