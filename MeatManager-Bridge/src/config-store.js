const fs = require('fs');
const path = require('path');

const EDITABLE_KEYS = [
    'BRIDGE_DEVICE_ID',
    'BRIDGE_NAME',
    'BRIDGE_SITE_NAME',
    'MYSQL_TENANT_ID',
    'MYSQL_BRANCH_ID',
    'FIREBIRD_DB_FILE',
    'FIREBIRD_HOST',
    'FIREBIRD_PORT',
    'FIREBIRD_USER',
    'FIREBIRD_PASSWORD',
    'FIREBIRD_DEFAULT_SECTION_ID',
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_SSL',
    'SYNC_INTERVAL_MS',
    'TICKET_LOOKBACK_DAYS',
    'PRODUCT_LOOKBACK_HOURS',
    'HTTP_PORT',
    'LOG_LEVEL',
];

function loadOverrides(overridesFile) {
    if (!fs.existsSync(overridesFile)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
    } catch {
        return {};
    }
}

function saveOverrides(overridesFile, payload) {
    fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
    fs.writeFileSync(overridesFile, JSON.stringify(payload, null, 2), 'utf8');
}

function pickEditable(payload = {}) {
    const output = {};
    for (const key of EDITABLE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            output[key] = payload[key];
        }
    }
    return output;
}

function buildEditableConfigView(config) {
    return {
        BRIDGE_DEVICE_ID: config.deviceId,
        BRIDGE_NAME: config.bridgeName,
        BRIDGE_SITE_NAME: config.siteName,
        MYSQL_TENANT_ID: config.tenantId,
        MYSQL_BRANCH_ID: config.branchId,
        FIREBIRD_DB_FILE: config.firebird.dbFile,
        FIREBIRD_HOST: config.firebird.host,
        FIREBIRD_PORT: config.firebird.port,
        FIREBIRD_USER: config.firebird.user,
        FIREBIRD_PASSWORD: config.firebird.password,
        FIREBIRD_DEFAULT_SECTION_ID: config.firebird.defaultSectionId,
        MYSQL_HOST: config.mysql.host,
        MYSQL_PORT: config.mysql.port,
        MYSQL_USER: config.mysql.user,
        MYSQL_PASSWORD: config.mysql.password,
        MYSQL_DATABASE: config.mysql.database,
        MYSQL_SSL: config.mysql.ssl,
        SYNC_INTERVAL_MS: config.syncIntervalMs,
        TICKET_LOOKBACK_DAYS: config.ticketLookbackDays,
        PRODUCT_LOOKBACK_HOURS: config.productLookbackHours,
        HTTP_PORT: config.httpPort,
        LOG_LEVEL: config.logLevel,
    };
}

module.exports = {
    EDITABLE_KEYS,
    loadOverrides,
    saveOverrides,
    pickEditable,
    buildEditableConfigView,
};
