const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
const runtimeRootDir = String(process.env.BRIDGE_APP_DATA_DIR || '').trim()
    ? path.resolve(String(process.env.BRIDGE_APP_DATA_DIR || '').trim())
    : rootDir;
const envFile = path.join(rootDir, '.env');
const overridesFile = process.env.BRIDGE_OVERRIDES_FILE
    ? path.resolve(process.env.BRIDGE_OVERRIDES_FILE)
    : path.join(runtimeRootDir, 'data', 'config-overrides.json');
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
} else {
    dotenv.config();
}

let overrides = {};
if (fs.existsSync(overridesFile)) {
    try {
        overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
    } catch {
        overrides = {};
    }
}

const boolEnv = (name, fallback = false) => {
    const overrideValue = overrides[name];
    const value = String(overrideValue ?? process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
};

const intEnv = (name, fallback) => {
    const raw = Number.parseInt(overrides[name] ?? process.env[name] ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
};

const strEnv = (name, fallback = '') => {
    const value = String(overrides[name] ?? process.env[name] ?? '').trim();
    return value || fallback;
};

const config = {
    rootDir,
    runtimeRootDir,
    dataDir: path.join(runtimeRootDir, 'data'),
    logsDir: path.join(runtimeRootDir, 'logs'),
    envFile,
    overridesFile,
    stateFile: path.resolve(runtimeRootDir, strEnv('STATE_FILE', './data/state.json')),
    logFile: path.resolve(runtimeRootDir, strEnv('LOG_FILE', './logs/bridge.log')),
    resetStateOnStart: boolEnv('RESET_STATE_ON_START', true),
    deviceId: strEnv('BRIDGE_DEVICE_ID', 'CUORA-LOCAL-01'),
    bridgeName: strEnv('BRIDGE_NAME', 'Cuora Direct Bridge'),
    siteName: strEnv('BRIDGE_SITE_NAME', ''),
    clientId: intEnv('BRIDGE_CLIENT_ID', intEnv('MYSQL_TENANT_ID', 1)),
    tenantId: intEnv('BRIDGE_CLIENT_ID', intEnv('MYSQL_TENANT_ID', 1)),
    branchId: intEnv('BRIDGE_BRANCH_ID', intEnv('MYSQL_BRANCH_ID', 1)),
    scale: {
        port: strEnv('SCALE_PORT', 'COM3'),
        baudRate: intEnv('SCALE_BAUD_RATE', 115200),
        address: intEnv('SCALE_ADDRESS', 20),
        frameGapMs: intEnv('SCALE_FRAME_GAP_MS', 20),
        responseTimeoutMs: intEnv('SCALE_RESPONSE_TIMEOUT_MS', 5000),
        interCommandDelayMs: intEnv('SCALE_INTER_COMMAND_DELAY_MS', 30),
        retryAfterCloseOnNoData: boolEnv('SCALE_RETRY_AFTER_CLOSE_ON_NODATA', true),
        sectionDefaultId: intEnv('SCALE_SECTION_DEFAULT_ID', 2),
        sectionDefaultName: strEnv('SCALE_SECTION_DEFAULT_NAME', 'CARNICERIA'),
        legacyPriceMultiplier: intEnv('SCALE_LEGACY_PRICE_MULTIPLIER', 100),
        priceFormat6dMultiplier: intEnv('SCALE_PRICE_FORMAT_6D_MULTIPLIER', 1),
        barcodeConfig: {
            enabled: boolEnv('SCALE_BARCODE_CONFIG_ENABLED', true),
            saleByWeightFormat: strEnv('SCALE_BARCODE_WEIGHT_FORMAT', '20PPPPIIIIII'),
            saleByUnitFormat: strEnv('SCALE_BARCODE_UNIT_FORMAT', '21PPPPIIIIII'),
            saleTotalFormat: strEnv('SCALE_BARCODE_TOTAL_FORMAT', '22AAIIIIIIII'),
        },
    },
    mysql: {
        host: strEnv('MYSQL_HOST', '127.0.0.1'),
        port: intEnv('MYSQL_PORT', 3306),
        user: strEnv('MYSQL_USER', 'root'),
        password: strEnv('MYSQL_PASSWORD', ''),
        database: strEnv('MYSQL_DATABASE', 'meatmanager'),
        ssl: boolEnv('MYSQL_SSL', false),
    },
    syncIntervalMs: intEnv('SYNC_INTERVAL_MS', 15000),
    salesPulseEnabled: boolEnv('SALES_PULSE_ENABLED', true),
    salesPulseIntervalMs: intEnv('SALES_PULSE_INTERVAL_MS', 2000),
    productSyncIntervalMs: intEnv('PRODUCT_SYNC_INTERVAL_MS', 30000),
    syncStepTimeoutMs: intEnv('SYNC_STEP_TIMEOUT_MS', 180000),
    salesLookbackDays: intEnv('SALES_LOOKBACK_DAYS', 3),
    salesResyncSkewMinutes: intEnv('SALES_RESYNC_SKEW_MINUTES', 2),
    closeSalesAfterPull: boolEnv('SCALE_CLOSE_SALES_AFTER_PULL', false),
    productLookbackHours: intEnv('PRODUCT_LOOKBACK_HOURS', 168),
    httpPort: intEnv('HTTP_PORT', 4045),
    logLevel: strEnv('LOG_LEVEL', 'info').toLowerCase(),
    watchMode: process.argv.includes('--watch'),
    once: process.argv.includes('--once'),
};

module.exports = config;
