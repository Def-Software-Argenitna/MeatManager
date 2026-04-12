const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
} else {
    dotenv.config();
}

const boolEnv = (name, fallback = false) => {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
};

const intEnv = (name, fallback) => {
    const raw = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(raw) ? raw : fallback;
};

const strEnv = (name, fallback = '') => {
    const value = String(process.env[name] ?? '').trim();
    return value || fallback;
};

const config = {
    rootDir,
    dataDir: path.join(rootDir, 'data'),
    logsDir: path.join(rootDir, 'logs'),
    stateFile: path.resolve(rootDir, strEnv('STATE_FILE', './data/state.json')),
    logFile: path.resolve(rootDir, strEnv('LOG_FILE', './logs/bridge.log')),
    deviceId: strEnv('BRIDGE_DEVICE_ID', 'QENDRA-LOCAL-01'),
    bridgeName: strEnv('BRIDGE_NAME', 'Qendra Bridge'),
    siteName: strEnv('BRIDGE_SITE_NAME', ''),
    tenantId: intEnv('MYSQL_TENANT_ID', 1),
    branchId: intEnv('MYSQL_BRANCH_ID', 1),
    firebird: {
        dbFile: strEnv('FIREBIRD_DB_FILE', 'C:\\Qendra\\qendra.fdb'),
        host: strEnv('FIREBIRD_HOST', '127.0.0.1'),
        port: intEnv('FIREBIRD_PORT', 3050),
        user: strEnv('FIREBIRD_USER', 'SYSDBA'),
        password: strEnv('FIREBIRD_PASSWORD', 'masterkey'),
        defaultSectionId: intEnv('FIREBIRD_DEFAULT_SECTION_ID', 1),
    },
    mysql: {
        host: strEnv('MYSQL_HOST', '127.0.0.1'),
        port: intEnv('MYSQL_PORT', 3306),
        user: strEnv('MYSQL_USER', 'root'),
        password: strEnv('MYSQL_PASSWORD', ''),
        database: strEnv('MYSQL_DATABASE', 'meatmanager_operational'),
        ssl: boolEnv('MYSQL_SSL', false),
    },
    syncIntervalMs: intEnv('SYNC_INTERVAL_MS', 15000),
    ticketLookbackDays: intEnv('TICKET_LOOKBACK_DAYS', 30),
    productLookbackHours: intEnv('PRODUCT_LOOKBACK_HOURS', 168),
    httpPort: intEnv('HTTP_PORT', 4045),
    logLevel: strEnv('LOG_LEVEL', 'info').toLowerCase(),
    watchMode: process.argv.includes('--watch'),
    once: process.argv.includes('--once'),
};

module.exports = config;
