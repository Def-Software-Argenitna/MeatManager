const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { defaultTotalBarcodeFormat } = require('./helpers');

const rootDir = path.resolve(__dirname, '..');
const runtimeRootDir = String(process.env.BRIDGE_APP_DATA_DIR || '').trim()
    ? path.resolve(String(process.env.BRIDGE_APP_DATA_DIR || '').trim())
    : rootDir;
const envFile = path.join(rootDir, '.env');
const overridesFile = process.env.BRIDGE_OVERRIDES_FILE
    ? path.resolve(process.env.BRIDGE_OVERRIDES_FILE)
    : path.join(runtimeRootDir, 'data', 'config-overrides.json');
const installationFile = process.env.BRIDGE_INSTALLATION_FILE
    ? path.resolve(process.env.BRIDGE_INSTALLATION_FILE)
    : path.join(runtimeRootDir, 'data', 'installation.json');

if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
} else {
    dotenv.config();
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        let raw = fs.readFileSync(filePath, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

const overrides = readJsonFile(overridesFile);
const installation = readJsonFile(installationFile);

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

// Identidad y credenciales del bridge — preferir installation.json (lo
// escribe el wizard de onboarding), caer a env vars para entornos sin
// instalador (dev/CI/once-off).
const apiBaseUrl = String(installation.apiBaseUrl || strEnv('BRIDGE_API_BASE_URL', strEnv('API_BASE_URL', ''))).trim().replace(/\/+$/, '');
const deviceToken = String(installation.deviceToken || strEnv('BRIDGE_DEVICE_TOKEN', '')).trim();
const installationDeviceId = String(installation.deviceId || '').trim();
const installationTenantId = Number(installation.tenantId);
const installationClientId = Number(installation.clientId);
const installationBranchId = Number(installation.branchId);

// La direccion de balanza define el default del barcode de total (ver
// defaultTotalBarcodeFormat). Se calcula aca arriba para reusarla tanto en
// `scale.address` como en el default de `saleTotalFormat`.
const scaleAddress = intEnv('SCALE_ADDRESS', 20);

const config = {
    rootDir,
    runtimeRootDir,
    dataDir: path.join(runtimeRootDir, 'data'),
    logsDir: path.join(runtimeRootDir, 'logs'),
    envFile,
    overridesFile,
    installationFile,
    stateFile: path.resolve(runtimeRootDir, strEnv('STATE_FILE', './data/state.json')),
    logFile: path.resolve(runtimeRootDir, strEnv('LOG_FILE', './logs/bridge.log')),
    // Preservamos el state.json entre reinicios: ahi vive `firstScaleResetDoneAt`
    // y los fingerprints por producto. Si se borra en cada arranque, el bridge
    // cree que la balanza esta virgen y reintenta el reset completo de 8000 PLUs
    // + reescritura total del catalogo, ocupando el puerto serie por minutos y
    // bloqueando la lectura de ventas. El reset masivo solo debe correr cuando
    // el usuario lo pide explicitamente via el boton "Resetear balanza".
    resetStateOnStart: boolEnv('RESET_STATE_ON_START', false),
    apiBaseUrl,
    deviceToken,
    deviceId: installationDeviceId || strEnv('BRIDGE_DEVICE_ID', 'CUORA-LOCAL-01'),
    scaleId: strEnv('BRIDGE_SCALE_ID', '1'),
    bridgeName: strEnv('BRIDGE_NAME', 'Cuora Direct Bridge'),
    siteName: String(installation.branchName || strEnv('BRIDGE_SITE_NAME', '')),
    clientName: String(installation.clientName || ''),
    clientId: Number.isFinite(installationClientId) ? installationClientId : intEnv('BRIDGE_CLIENT_ID', 1),
    tenantId: Number.isFinite(installationTenantId) ? installationTenantId : intEnv('BRIDGE_CLIENT_ID', 1),
    branchId: Number.isFinite(installationBranchId) ? installationBranchId : intEnv('BRIDGE_BRANCH_ID', 1),
    scale: {
        port: strEnv('SCALE_PORT', 'COM3'),
        baudRate: intEnv('SCALE_BAUD_RATE', 115200),
        address: scaleAddress,
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
            saleTotalFormat: strEnv('SCALE_BARCODE_TOTAL_FORMAT', defaultTotalBarcodeFormat(scaleAddress)),
        },
    },
    syncIntervalMs: intEnv('SYNC_INTERVAL_MS', 15000),
    autoGeneralSyncEnabled: boolEnv('AUTO_GENERAL_SYNC_ENABLED', false),
    salesPulseEnabled: boolEnv('SALES_PULSE_ENABLED', true),
    // Gap entre pulsos de ventas. El tiempo real de deteccion ~= lectura fn72
    // (1-2s con memoria llena) + este gap + POST al API; el cajero escanea el
    // ticket ~2s despues de cerrar la venta, asi que el gap debe ser chico.
    salesPulseIntervalMs: intEnv('SALES_PULSE_INTERVAL_MS', 500),
    heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 10000),
    productSyncIntervalMs: intEnv('PRODUCT_SYNC_INTERVAL_MS', 10000),
    syncStepTimeoutMs: intEnv('SYNC_STEP_TIMEOUT_MS', 180000),
    salesLookbackDays: intEnv('SALES_LOOKBACK_DAYS', 3),
    salesResyncSkewMinutes: intEnv('SALES_RESYNC_SKEW_MINUTES', 2),
    closeSalesAfterPull: boolEnv('SCALE_CLOSE_SALES_AFTER_PULL', false),
    productLookbackHours: intEnv('PRODUCT_LOOKBACK_HOURS', 168),
    // Port 4045 es "lockd" en la lista de bad-ports del Fetch spec — undici lo
    // rechaza, asi que fetch(http://127.0.0.1:4045/...) falla con "bad port".
    // Default a 4046 que no esta restringido.
    httpPort: intEnv('HTTP_PORT', 4046),
    logLevel: strEnv('LOG_LEVEL', 'info').toLowerCase(),
    watchMode: process.argv.includes('--watch'),
    once: process.argv.includes('--once'),
    isOnboarded: Boolean(apiBaseUrl && deviceToken),
};

module.exports = config;
