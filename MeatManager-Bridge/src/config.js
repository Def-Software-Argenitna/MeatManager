const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');
const overridesFile = path.join(rootDir, 'data', 'config-overrides.json');
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
    dataDir: path.join(rootDir, 'data'),
    logsDir: path.join(rootDir, 'logs'),
    envFile,
    overridesFile,
    stateFile: path.resolve(rootDir, strEnv('STATE_FILE', './data/state.json')),
    logFile: path.resolve(rootDir, strEnv('LOG_FILE', './logs/bridge.log')),
    resetStateOnStart: boolEnv('RESET_STATE_ON_START', true),
    normalizeFirebirdOnStart: boolEnv('FIREBIRD_NORMALIZE_ON_START', false),
    deviceId: strEnv('BRIDGE_DEVICE_ID', 'QENDRA-LOCAL-01'),
    bridgeName: strEnv('BRIDGE_NAME', 'Qendra Bridge'),
    siteName: strEnv('BRIDGE_SITE_NAME', ''),
    clientId: intEnv('BRIDGE_CLIENT_ID', intEnv('MYSQL_TENANT_ID', 1)),
    tenantId: intEnv('BRIDGE_CLIENT_ID', intEnv('MYSQL_TENANT_ID', 1)),
    branchId: intEnv('BRIDGE_BRANCH_ID', intEnv('MYSQL_BRANCH_ID', 1)),
    firebird: {
        dbFile: strEnv('FIREBIRD_DB_FILE', 'C:\\Qendra\\qendra.fdb'),
        productTarget: strEnv('FIREBIRD_PRODUCT_TARGET', 'live').toLowerCase(),
        importDirectWrite: boolEnv('FIREBIRD_IMPORT_DIRECT_WRITE', true),
        importDbFile: strEnv('FIREBIRD_IMPORT_DB_FILE', 'C:\\Qendra\\bridge_import.fdb'),
        importWorkDbFile: strEnv('FIREBIRD_IMPORT_WORK_DB_FILE', 'C:\\Qendra\\bridge_import_work.fdb'),
        templateDbFile: strEnv('FIREBIRD_TEMPLATE_DB_FILE', 'C:\\Qendra\\qendra_vacia.fdb'),
        host: strEnv('FIREBIRD_HOST', '127.0.0.1'),
        port: intEnv('FIREBIRD_PORT', 3050),
        user: strEnv('FIREBIRD_USER', 'SYSDBA'),
        password: strEnv('FIREBIRD_PASSWORD', 'masterkey'),
        defaultSectionId: intEnv('FIREBIRD_DEFAULT_SECTION_ID', 1),
        pythonPath: strEnv('FIREBIRD_HELPER_PYTHON', path.join(rootDir, 'tools', 'python32', 'runtime', 'python.exe')),
    },
    mysql: {
        host: strEnv('MYSQL_HOST', '127.0.0.1'),
        port: intEnv('MYSQL_PORT', 3306),
        user: strEnv('MYSQL_USER', 'root'),
        password: strEnv('MYSQL_PASSWORD', ''),
        database: strEnv('MYSQL_DATABASE', 'meatmanager'),
        ssl: boolEnv('MYSQL_SSL', false),
    },
    clientsDb: {
        host: strEnv('CLIENTS_DB_HOST', strEnv('MYSQL_HOST', '127.0.0.1')),
        port: intEnv('CLIENTS_DB_PORT', intEnv('MYSQL_PORT', 3306)),
        user: strEnv('CLIENTS_DB_USER', strEnv('MYSQL_USER', 'root')),
        password: strEnv('CLIENTS_DB_PASS', strEnv('MYSQL_PASSWORD', '')),
        database: strEnv('CLIENTS_DB_NAME', 'GestionClientes'),
        ssl: boolEnv('MYSQL_SSL', false),
    },
    syncIntervalMs: intEnv('SYNC_INTERVAL_MS', 15000),
    syncStepTimeoutMs: intEnv('SYNC_STEP_TIMEOUT_MS', 180000),
    ticketLookbackDays: intEnv('TICKET_LOOKBACK_DAYS', 30),
    productLookbackHours: intEnv('PRODUCT_LOOKBACK_HOURS', 168),
    productSinceLookbackSeconds: intEnv('PRODUCT_SINCE_LOOKBACK_SECONDS', 120),
    productRecoveryLookbackHours: intEnv('PRODUCT_RECOVERY_LOOKBACK_HOURS', 24),
    productRecoveryLimit: intEnv('PRODUCT_RECOVERY_LIMIT', 250),
    productRecoveryRepublishLimit: intEnv('PRODUCT_RECOVERY_REPUBLISH_LIMIT', 20),
    productRecoveryRepublishIntervalMs: intEnv('PRODUCT_RECOVERY_REPUBLISH_INTERVAL_MS', 60000),
    httpPort: intEnv('HTTP_PORT', 4045),
    logLevel: strEnv('LOG_LEVEL', 'info').toLowerCase(),
    watchMode: process.argv.includes('--watch'),
    once: process.argv.includes('--once'),
};

module.exports = config;
