// MeatManager API - Provisioning Multi-Tenant
// Genera y gestiona una BD MySQL por cada empresa (identificada por CUIT)

const fs = require('fs');
const path = require('path');
const envFilePath = process.env.DOTENV_CONFIG_PATH
    ? path.resolve(__dirname, process.env.DOTENV_CONFIG_PATH)
    : path.join(__dirname, '.env');
require('dotenv').config({ path: envFilePath });
const gdcBackendEnvPath = path.resolve(__dirname, '..', 'Gestionclientes', '.deploy', 'backend.env');
const hasLocalSmtpConfig =
    Boolean(process.env.SMTP_HOST) &&
    Boolean(process.env.SMTP_PORT);

if (!hasLocalSmtpConfig && fs.existsSync(gdcBackendEnvPath)) {
    require('dotenv').config({ path: gdcBackendEnvPath, override: false });
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createClient } = require('redis');
const { isAdminOnlySettingKey } = require('./config/security-policy');

// ── Firebase Admin init ────────────────────────────────────────────────────
const serviceAccountPath = path.join(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT || 'firebase-service-account.json');
const localDevAuthBypass = String(process.env.ALLOW_LOCAL_UNVERIFIED_AUTH || 'true').trim().toLowerCase() !== 'false';
let firebaseAdminAvailable = false;

if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseAdminAvailable = true;
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseAdminAvailable = true;
} else {
    console.warn(`[AUTH] Firebase Admin deshabilitado: no existe ${serviceAccountPath}.`);
    if (localDevAuthBypass) {
        console.warn('[AUTH] Se habilita fallback local por decodificacion de token sin verificar firma. Solo usar en desarrollo local.');
    }
}

// ── Express setup ──────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true,
}));
app.use(express.json());

function isLocalRequest(req) {
    const host = String(req.headers.host || '').toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').toLowerCase();
    return host.includes('127.0.0.1')
        || host.includes('localhost')
        || forwardedHost.includes('127.0.0.1')
        || forwardedHost.includes('localhost');
}

function decodeFirebaseJwtWithoutVerification(token) {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') {
        throw new Error('Token inválido o expirado');
    }
    return {
        ...decoded,
        uid: decoded.uid || decoded.user_id || decoded.sub || null,
        email: decoded.email || null,
    };
}

const readHeavyPaths = [
    '/api/health',
    '/api/firebase-users/me',
];

const shouldSkipGeneralRateLimit = (req) => {
    const method = String(req.method || 'GET').toUpperCase();
    const requestPath = String(req.path || req.originalUrl || '');

    if (method === 'GET' && requestPath.startsWith('/api/table/')) {
        return true;
    }

    if (method === 'GET' && requestPath.startsWith('/api/settings/')) {
        return true;
    }

    if (method === 'GET' && readHeavyPaths.includes(requestPath)) {
        return true;
    }

    return false;
};

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipGeneralRateLimit,
});

app.use(generalLimiter);

// ── MySQL pool de provisioning (usuario con permisos CREATE DATABASE) ───────
const provisionPool = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit: 5,
});

const clientsControlPool = mysql.createPool({
    host: process.env.CLIENTS_DB_HOST || process.env.DB_HOST,
    port: parseInt(process.env.CLIENTS_DB_PORT || process.env.DB_PORT, 10) || 3306,
    user: process.env.CLIENTS_DB_USER || process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.CLIENTS_DB_PASS || process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit: 5,
});

const CLIENTS_DB_NAME = process.env.CLIENTS_DB_NAME || 'GestionClientes';
const CLIENTS_TABLE = process.env.CLIENTS_TABLE || 'clients';
const CLIENT_BRANCHES_TABLE = process.env.CLIENT_BRANCHES_TABLE || 'branches';
const CLIENT_USERS_TABLE = process.env.CLIENT_USERS_TABLE || 'client_users';
const CLIENT_LICENSES_TABLE = process.env.CLIENT_LICENSES_TABLE || 'client_licenses';
const CLIENT_USER_PERMISSIONS_TABLE = process.env.CLIENT_USER_PERMISSIONS_TABLE || 'client_user_permissions';
const LICENSES_TABLE = process.env.LICENSES_TABLE || 'licenses';
const INTERNAL_ADMINS_TABLE = process.env.INTERNAL_ADMINS_TABLE || 'internal_admins';
const BRIDGE_DEVICES_TABLE = process.env.BRIDGE_DEVICES_TABLE || 'bridge_devices';
// Monitor de estado del bridge
const BRIDGE_ONLINE_THRESHOLD_MS = Math.max(10000, Number.parseInt(process.env.BRIDGE_ONLINE_THRESHOLD_MS || '30000', 10) || 30000);
const BRIDGE_UPDATE_OWNER = process.env.BRIDGE_UPDATE_OWNER || 'Def-Software-Argenitna';
const BRIDGE_UPDATE_REPO = process.env.BRIDGE_UPDATE_REPO || 'MeatManager';
const BRIDGE_LATEST_VERSION_TTL_MS = 10 * 60 * 1000;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
const BRIDGE_SESSION_TOKEN_EXPIRES_IN = process.env.BRIDGE_SESSION_TOKEN_EXPIRES_IN || '10m';
const BRIDGE_DEVICE_TOKEN_BYTES = Math.max(16, Number.parseInt(process.env.BRIDGE_DEVICE_TOKEN_BYTES || '32', 10) || 32);
const MEATMANAGER_DB_NAME = process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || MEATMANAGER_DB_NAME;
const SCALE_BRIDGE_DIRECT_BASE_URL = String(process.env.SCALE_BRIDGE_DIRECT_BASE_URL || 'http://127.0.0.1:4046')
    .trim()
    .replace(/\/+$/, '');
const SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS || '6500', 10) || 6500);
const SCALE_BRIDGE_PULL_LOOKBACK_MINUTES = Math.max(1, Number.parseInt(process.env.SCALE_BRIDGE_PULL_LOOKBACK_MINUTES || '45', 10) || 45);
const SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY = 'scale_bridge_product_sync_seq';
const SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY = 'scale_bridge_clear_sales_seq';
const DEFAULT_OPERATIONAL_TENANT_ID = Number(process.env.DEFAULT_OPERATIONAL_TENANT_ID || 1);
const TENANT_COLUMN = 'tenant_id';
const STRICT_BRANCH_SCOPING = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.STRICT_BRANCH_SCOPING || '').trim().toLowerCase()
);
const REDIS_TRACKING_TTL_SECONDS = Number(process.env.REDIS_TRACKING_TTL_SECONDS || 90);
const CASH_WITHDRAWAL_CODE_TTL_MINUTES = Number(process.env.CASH_WITHDRAWAL_CODE_TTL_MINUTES || 10);
const INTERNAL_ADMIN_JWT_SECRET = process.env.JWT_SECRET || process.env.INTERNAL_ADMIN_JWT_SECRET || 'change-this-in-production-super-secret-key';
const INTERNAL_ADMIN_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const ERROR_LOG_RETENTION_DAYS = 30;
const SCALE_LATENCY_LOG_DIR = process.env.SCALE_LATENCY_LOG_DIR || path.join(__dirname, 'logs');
const SCALE_LATENCY_LOG_FILE = process.env.SCALE_LATENCY_LOG_FILE || path.join(SCALE_LATENCY_LOG_DIR, 'scale-ticket-latency.log');
const SKIP_SCHEMA_BOOT = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.SKIP_SCHEMA_BOOT || '').trim().toLowerCase()
);
const BOOTSTRAP_DATA_REPAIRS_ENABLED = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.BOOTSTRAP_DATA_REPAIRS_ENABLED || '').trim().toLowerCase()
);
const BOOTSTRAP_BRANCH_INFERENCE_ENABLED = BOOTSTRAP_DATA_REPAIRS_ENABLED || ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.BOOTSTRAP_BRANCH_INFERENCE_ENABLED || '').trim().toLowerCase()
);
const smtpSecure = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.SMTP_SECURE || '').trim().toLowerCase()
);

let smtpTransport = null;
let lastErrorLogPruneAt = 0;

function toIsoSafe(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function diffMs(fromValue, toValue = Date.now()) {
    if (!fromValue) return null;
    const from = fromValue instanceof Date ? fromValue.getTime() : new Date(fromValue).getTime();
    const to = toValue instanceof Date ? toValue.getTime() : Number(toValue);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return Math.max(0, Math.round(to - from));
}

function appendScaleLatencyLog(event, payload = {}) {
    const entry = {
        ts: new Date().toISOString(),
        event,
        ...payload,
    };

    fs.promises.mkdir(SCALE_LATENCY_LOG_DIR, { recursive: true })
        .then(() => fs.promises.appendFile(SCALE_LATENCY_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8'))
        .catch((error) => {
            console.warn('[SCALE LATENCY LOG] No se pudo escribir el log:', error?.message || error);
        });
}

function shouldQueueScaleProductSync(table, operation, record = {}) {
    const normalizedTable = String(table || '').trim();
    const normalizedOperation = String(operation || '').trim().toLowerCase();
    if (!['insert', 'update', 'delete', 'upsert'].includes(normalizedOperation)) return false;

    if (['products', 'prices', 'product_prices', 'branch_product_prices', 'promotions', 'scale_users'].includes(normalizedTable)) {
        return true;
    }

    if (normalizedTable === 'settings') {
        const key = String(record?.key || '').trim();
        // precio_formato no usa el prefijo scale_ pero define como se escriben
        // los PLUs en la balanza (4d2d vs 6d) y fuerza re-escritura del catalogo.
        return key.startsWith('scale_') || key === 'precio_formato';
    }

    return false;
}

async function queueScaleProductSync(pool, tenantId, reason) {
    const seq = Date.now();
    await pool.query(
        'INSERT INTO settings (`tenant_id`, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [tenantId, SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY, String(seq)]
    );
    return { seq, reason };
}

async function queueScaleClearSales(pool, tenantId) {
    const seq = Date.now();
    await pool.query(
        'INSERT INTO settings (`tenant_id`, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [tenantId, SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY, String(seq)]
    );
    return { seq };
}

// Resuelve quién está ejecutando la acción (apertura/cierre/movimiento de caja)
// a partir del usuario autenticado en el server — no se confía en el front.
function resolveCajaCreator(accessContext, req) {
    const u = (accessContext && accessContext.user) || {};
    const idNum = Number(u.id);
    const email = u.email || (req && req.firebaseUser && req.firebaseUser.email) || null;
    const fullName = [u.name, u.lastname].filter(Boolean).join(' ').trim();
    return {
        created_by_user_id: Number.isFinite(idNum) && idNum > 0 ? idNum : null,
        created_by_username: fullName || email || null,
        created_by_email: email,
    };
}

// Solo los administradores (o dueño/superadmin) pueden VER quién hizo cada
// acción de caja. Para el resto, los campos created_by_* se omiten de la respuesta.
function isAdminAccessContext(accessContext) {
    const u = (accessContext && accessContext.user) || {};
    return Boolean(u.role === 'admin' || u.isGlobalSuperAdmin || u.isOwnerFallback);
}

const CAJA_CREATOR_COLUMNS = ['created_by_user_id', 'created_by_username', 'created_by_email'];

function stripCajaCreatorFields(rows) {
    if (!Array.isArray(rows)) return rows;
    for (const row of rows) {
        if (row && typeof row === 'object') {
            for (const col of CAJA_CREATOR_COLUMNS) delete row[col];
        }
    }
    return rows;
}

async function queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record, id }) {
    if (!shouldQueueScaleProductSync(table, operation, record)) return null;

    try {
        return await queueScaleProductSync(pool, tenantId, `${table}:${operation}:${id || record?.id || ''}`);
    } catch (error) {
        console.warn('[BRIDGE COMMAND] No se pudo encolar sync de productos:', error?.message || error);
        return null;
    }
}

// ── Monitor de estado del bridge ───────────────────────────────────────────
// Columnas en bridge_devices (DB de control) para guardar lo que reporta el
// agente en cada heartbeat. Idempotente; corre al arrancar.
async function ensureBridgeDeviceMonitorColumns() {
    const conn = await clientsControlPool.getConnection();
    try {
        const cols = [
            ['app_version', 'VARCHAR(20) NULL'],
            ['last_run_status', 'VARCHAR(16) NULL'],
            ['last_ticket_sync_at', 'DATETIME NULL'],
            ['scale_reachable', 'TINYINT(1) NULL'],
            ['last_error', 'VARCHAR(255) NULL'],
            ['recent_e3_count', 'INT NULL'],
            ['agent_reported_at', 'DATETIME NULL'],
        ];
        for (const [name, def] of cols) {
            if (!(await hasColumn(conn, CLIENTS_DB_NAME, BRIDGE_DEVICES_TABLE, name))) {
                await conn.query(
                    `ALTER TABLE \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\` ADD COLUMN \`${name}\` ${def}`
                );
            }
        }
    } finally {
        conn.release();
    }
}

async function cleanupStrayInterBranchEntries() {
    // One-time: una versión previa creó entradas inter-sucursal para TODOS los
    // tenants multi-sucursal. Esto elimina las creadas en tenants que NO son el
    // de Pilar/Fatima (no fueron solicitadas). Guard por flag global.
    const ccConn = await clientsControlPool.getConnection();
    let allBranchRows;
    try {
        const [rows] = await ccConn.query(
            `SELECT id, clientId, name FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             ORDER BY clientId ASC, id ASC`
        );
        allBranchRows = rows;
    } finally {
        ccConn.release();
    }

    const branchesByClient = {};
    for (const row of allBranchRows) {
        if (!branchesByClient[row.clientId]) branchesByClient[row.clientId] = [];
        branchesByClient[row.clientId].push(String(row.name || '').trim() || `Sucursal ${row.id}`);
    }

    const pool = getTenantPool(OPERATIONAL_DB_NAME);

    for (const [clientIdStr, branchNames] of Object.entries(branchesByClient)) {
        if (branchNames.length < 2) continue;
        const hasPilar = branchNames.some((n) => n.toLowerCase().includes('pilar'));
        const hasFatima = branchNames.some((n) => n.toLowerCase().includes('fatima'));
        if (hasPilar && hasFatima) continue; // ese tenant SÍ debe tenerlas

        const tenantId = Number(clientIdStr);
        const conn = await pool.getConnection();
        try {
            const flagKey = `stray_interbranch_cleaned_tenant_${tenantId}`;
            const done = await getTenantFlag(conn, tenantId, flagKey);
            if (done === '1') { continue; }

            // Proveedores: marcador cuit='INTERNO' que sólo usa la función inter-sucursal
            const [delSup] = await conn.query(
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.suppliers
                 WHERE tenant_id = ? AND cuit = 'INTERNO' AND name IN (?)`,
                [tenantId, branchNames]
            );
            if (delSup.affectedRows > 0) {
                console.log(`[BOOT] Stray inter-sucursal: ${delSup.affectedRows} proveedores eliminados (tenant ${tenantId})`);
            }

            // Clientes: sólo los que coinciden con nombre de sucursal, sin ventas y saldo 0
            const [delCli] = await conn.query(
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.clients
                 WHERE tenant_id = ? AND name IN (?)
                   AND COALESCE(balance, 0) = 0
                   AND id NOT IN (
                       SELECT client_id FROM \`${OPERATIONAL_DB_NAME}\`.ventas
                       WHERE tenant_id = ? AND client_id IS NOT NULL
                   )`,
                [tenantId, branchNames, tenantId]
            );
            if (delCli.affectedRows > 0) {
                console.log(`[BOOT] Stray inter-sucursal: ${delCli.affectedRows} clientes eliminados (tenant ${tenantId})`);
            }

            await setTenantFlag(conn, tenantId, flagKey, '1');
        } catch (e) {
            console.error(`[BOOT] Stray inter-sucursal cleanup tenant ${tenantId} FALLÓ:`, e?.message || e);
        } finally {
            conn.release();
        }
    }
}

async function ensureInterBranchEntries() {
    // Para el tenant de Pilar/Fatima, inserta proveedor + cliente inter-sucursal
    // en cada sucursal apuntando a la otra. Idempotente (verifica por nombre antes de insertar).
    const ccConn = await clientsControlPool.getConnection();
    let allBranchRows;
    try {
        const [rows] = await ccConn.query(
            `SELECT id, clientId, name FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             ORDER BY clientId ASC, id ASC`
        );
        allBranchRows = rows;
    } finally {
        ccConn.release();
    }

    const branchesByClient = {};
    for (const row of allBranchRows) {
        if (!branchesByClient[row.clientId]) branchesByClient[row.clientId] = [];
        branchesByClient[row.clientId].push({
            id: Number(row.id),
            name: String(row.name || '').trim() || `Sucursal ${row.id}`,
        });
    }

    const pool = getTenantPool(OPERATIONAL_DB_NAME);

    for (const [clientIdStr, branches] of Object.entries(branchesByClient)) {
        if (branches.length < 2) continue;
        // Solo aplica al cliente que tiene Pilar Y Fatima (lo solicitado).
        // No tocar otros clientes multi-sucursal en producción.
        const hasPilar = branches.some((b) => b.name.toLowerCase().includes('pilar'));
        const hasFatima = branches.some((b) => b.name.toLowerCase().includes('fatima'));
        if (!hasPilar || !hasFatima) continue;
        const tenantId = Number(clientIdStr);
        const conn = await pool.getConnection();
        try {
            for (const branch of branches) {
                for (const otherBranch of branches) {
                    if (branch.id === otherBranch.id) continue;
                    const entryName = otherBranch.name;

                    const [existingSupplier] = await conn.query(
                        `SELECT id FROM \`${OPERATIONAL_DB_NAME}\`.suppliers
                         WHERE tenant_id = ? AND branch_id = ? AND name = ?`,
                        [tenantId, branch.id, entryName]
                    );
                    if (existingSupplier.length === 0) {
                        await conn.query(
                            `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.suppliers
                             (tenant_id, branch_id, name, cuit, iva_condition, synced, created_at)
                             VALUES (?, ?, ?, 'INTERNO', 'RESPONSABLE_INSCRIPTO', 0, NOW())`,
                            [tenantId, branch.id, entryName]
                        );
                        console.log(`[BOOT] Proveedor inter-sucursal: "${entryName}" → sucursal ${branch.id} (tenant ${tenantId})`);
                    }

                    const [existingClient] = await conn.query(
                        `SELECT id FROM \`${OPERATIONAL_DB_NAME}\`.clients
                         WHERE tenant_id = ? AND branch_id = ? AND name = ?`,
                        [tenantId, branch.id, entryName]
                    );
                    if (existingClient.length === 0) {
                        await conn.query(
                            `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.clients
                             (tenant_id, branch_id, name, has_current_account, synced, created_at)
                             VALUES (?, ?, ?, 1, 0, NOW())`,
                            [tenantId, branch.id, entryName]
                        );
                        console.log(`[BOOT] Cliente inter-sucursal: "${entryName}" → sucursal ${branch.id} (tenant ${tenantId})`);
                    }
                }
            }
        } finally {
            conn.release();
        }
    }
}

async function getTenantFlag(conn, tenantId, key) {
    const [rows] = await conn.query(
        `SELECT value FROM \`${OPERATIONAL_DB_NAME}\`.settings
         WHERE tenant_id = ? AND branch_id = 0 AND \`key\` = ? LIMIT 1`,
        [tenantId, key]
    );
    return rows.length ? String(rows[0].value) : null;
}

async function setTenantFlag(conn, tenantId, key, value) {
    await conn.query(
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.settings (tenant_id, branch_id, \`key\`, value)
         VALUES (?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [tenantId, key, String(value)]
    );
}

async function cleanupFatimaTestData() {
    // Limpieza one-shot de todos los datos de prueba en sucursales "Fatima".
    // GUARD: corre UNA sola vez por tenant (flag en settings). Después de la
    // limpieza inicial NO vuelve a borrar — protege los datos reales que el
    // usuario cargue en Fatima de futuros deploys/reinicios.
    // Respeta el orden de FKs: ventas_items → ventas → caja → compras_items → compras → stock → products → clients.
    const ccConn = await clientsControlPool.getConnection();
    let fatimaBranches;
    try {
        const [rows] = await ccConn.query(
            `SELECT id, clientId, name FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             WHERE LOWER(name) LIKE '%fatima%'`
        );
        fatimaBranches = rows;
    } finally {
        ccConn.release();
    }

    if (!fatimaBranches || fatimaBranches.length === 0) return;

    const pool = getTenantPool(OPERATIONAL_DB_NAME);

    for (const branch of fatimaBranches) {
        const tenantId = Number(branch.clientId);
        const branchId = Number(branch.id);

        const conn = await pool.getConnection();
        try {
            const flagKey = `fatima_initial_cleanup_done_branch_${branchId}`;
            const done = await getTenantFlag(conn, tenantId, flagKey);
            if (done === '1') {
                console.log(`[BOOT] Fatima cleanup: branch ${branchId} ya limpiado antes, se omite (protege datos reales)`);
                continue;
            }
            console.log(`[BOOT] Fatima cleanup: iniciando para branch ${branchId} tenant ${tenantId}`);

            // Helper resiliente: un error en un paso no aborta los demás
            const safeStep = async (label, sql, params) => {
                try {
                    const [r] = await conn.query(sql, params);
                    if (r.affectedRows > 0) {
                        console.log(`[BOOT] Fatima cleanup: ${r.affectedRows} ${label}`);
                    }
                } catch (e) {
                    console.error(`[BOOT] Fatima cleanup paso "${label}" FALLÓ:`, e?.message || e);
                }
            };

            // 1. ventas_items + ventas
            const [fatVentas] = await conn.query(
                `SELECT id FROM \`${OPERATIONAL_DB_NAME}\`.ventas WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]
            );
            if (fatVentas.length > 0) {
                const ventaIds = fatVentas.map((r) => r.id);
                await safeStep('ventas_items eliminados',
                    `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.ventas_items WHERE tenant_id = ? AND venta_id IN (?)`,
                    [tenantId, ventaIds]);
            }
            await safeStep('ventas eliminadas',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.ventas WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            // 2. Movimientos de caja
            await safeStep('movimientos de caja eliminados',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.caja_movimientos WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            // 3. compras_items (FK por purchase_id) + compras
            const [fatCompras] = await conn.query(
                `SELECT id FROM \`${OPERATIONAL_DB_NAME}\`.compras WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]
            );
            if (fatCompras.length > 0) {
                const compraIds = fatCompras.map((r) => r.id);
                await safeStep('compras_items eliminados',
                    `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.compras_items WHERE tenant_id = ? AND purchase_id IN (?)`,
                    [tenantId, compraIds]);
            }
            await safeStep('compras eliminadas',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.compras WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            // 4. Stock
            await safeStep('entradas de stock eliminadas',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.stock WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            // 5. Productos
            await safeStep('productos eliminados',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.products WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            // 6. Clientes
            await safeStep('clientes eliminados',
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.clients WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, branchId]);

            await setTenantFlag(conn, tenantId, flagKey, '1');
            console.log(`[BOOT] Fatima (branch ${branchId}): limpieza completa OK (flag seteado, no se repite)`);
        } catch (err) {
            console.error(`[BOOT] Fatima cleanup ERROR en branch ${branchId}:`, err?.message || err);
            throw err;
        } finally {
            conn.release();
        }
    }
}

async function seedFatimaProductsFromPilar() {
    // Clona productos de Pilar → Fatima sin precio, por única vez.
    // Idempotente: si Fatima ya tiene productos, no hace nada.
    const ccConn = await clientsControlPool.getConnection();
    let pilarBranch, fatimaBranch;
    try {
        const [rows] = await ccConn.query(
            `SELECT id, clientId, name FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             WHERE LOWER(name) LIKE '%pilar%' OR LOWER(name) LIKE '%fatima%'`
        );
        pilarBranch = rows.find((r) => String(r.name).toLowerCase().includes('pilar'));
        fatimaBranch = rows.find((r) => String(r.name).toLowerCase().includes('fatima'));
    } finally {
        ccConn.release();
    }

    if (!pilarBranch || !fatimaBranch) {
        console.warn('[BOOT] seedFatimaProducts: no se encontraron sucursales Pilar/Fatima');
        return;
    }
    if (Number(pilarBranch.clientId) !== Number(fatimaBranch.clientId)) {
        console.warn('[BOOT] seedFatimaProducts: Pilar y Fatima no son del mismo tenant');
        return;
    }

    const tenantId = Number(pilarBranch.clientId);
    const pilarId = Number(pilarBranch.id);
    const fatimaId = Number(fatimaBranch.id);

    const pool = getTenantPool(OPERATIONAL_DB_NAME);
    const conn = await pool.getConnection();
    try {
        // GUARD v2: corre una sola vez. Hace wipe COMPLETO del catálogo de Fatima
        // (productos de prueba + clones viejos + datos transaccionales que cuelgan
        // de productos) y re-clona limpio desde Pilar a precio 0.
        const flagKey = 'fatima_catalog_reinit_v2';
        const done = await getTenantFlag(conn, tenantId, flagKey);
        if (done === '1') {
            console.log('[BOOT] seedFatimaProducts: reinit v2 ya ejecutado, se omite (protege datos reales)');
            return;
        }

        // Tablas operativas de Fatima (branch_id) a limpiar antes de re-clonar.
        // NO se tocan clients/suppliers/scale_users (preservan inter-sucursal y config).
        const wipeTables = [
            'ventas_items', 'ventas', 'caja_movimientos', 'compras_items', 'compras',
            'stock', 'prices', 'product_prices', 'branch_product_prices',
            'promotions', 'menu_digital', 'supplier_item_tax_profiles', 'products',
        ];

        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const t of wipeTables) {
                try {
                    const [r] = await conn.query(
                        `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.\`${t}\` WHERE tenant_id = ? AND branch_id = ?`,
                        [tenantId, fatimaId]
                    );
                    if (r.affectedRows > 0) {
                        console.log(`[BOOT] seedFatimaProducts wipe: ${r.affectedRows} filas de ${t} (branch ${fatimaId})`);
                    }
                } catch (e) {
                    console.warn(`[BOOT] seedFatimaProducts wipe ${t} falló:`, e?.message || e);
                }
            }
        } finally {
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }

        // Clonar productos ACTIVOS de Pilar → Fatima a precio 0.
        const [pilarProducts] = await conn.query(
            `SELECT name, category_id, category, unit, plu, active, source
             FROM \`${OPERATIONAL_DB_NAME}\`.products
             WHERE tenant_id = ? AND branch_id = ? AND deleted_at IS NULL
             ORDER BY id ASC`,
            [tenantId, pilarId]
        );

        if (pilarProducts.length === 0) {
            console.log('[BOOT] seedFatimaProducts: Pilar no tiene productos para clonar');
            await setTenantFlag(conn, tenantId, flagKey, '1');
            return;
        }

        let cloned = 0;
        for (let i = 0; i < pilarProducts.length; i++) {
            const p = pilarProducts[i];
            const canonicalKey = `br${fatimaId}-clone-${i}`;
            try {
                const [r] = await conn.query(
                    `INSERT IGNORE INTO \`${OPERATIONAL_DB_NAME}\`.products
                     (tenant_id, branch_id, canonical_key, name, category_id, category, unit,
                      current_price, plu, active, source, synced, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, NOW())`,
                    [tenantId, fatimaId, canonicalKey, p.name, p.category_id, p.category,
                     p.unit, p.plu, p.active, p.source]
                );
                if (r.affectedRows > 0) cloned += 1;
            } catch (e) {
                console.warn(`[BOOT] seedFatimaProducts clone "${p.name}" falló:`, e?.message || e);
            }
        }

        await setTenantFlag(conn, tenantId, flagKey, '1');
        console.log(`[BOOT] seedFatimaProducts: ${cloned}/${pilarProducts.length} productos clonados Pilar → Fatima (precio 0). Reinit v2 OK.`);
    } finally {
        conn.release();
    }
}

async function seedFatimaPurchaseItemsFromPilar() {
    // La página "Artículos" muestra purchase_items (no products). Clona los
    // purchase_items de Pilar → Fatima a precio 0, por única vez (flag v3).
    const ccConn = await clientsControlPool.getConnection();
    let pilarBranch, fatimaBranch;
    try {
        const [rows] = await ccConn.query(
            `SELECT id, clientId, name FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             WHERE LOWER(name) LIKE '%pilar%' OR LOWER(name) LIKE '%fatima%'`
        );
        pilarBranch = rows.find((r) => String(r.name).toLowerCase().includes('pilar'));
        fatimaBranch = rows.find((r) => String(r.name).toLowerCase().includes('fatima'));
    } finally {
        ccConn.release();
    }

    if (!pilarBranch || !fatimaBranch) return;
    if (Number(pilarBranch.clientId) !== Number(fatimaBranch.clientId)) return;

    const tenantId = Number(pilarBranch.clientId);
    const pilarId = Number(pilarBranch.id);
    const fatimaId = Number(fatimaBranch.id);

    const pool = getTenantPool(OPERATIONAL_DB_NAME);
    const conn = await pool.getConnection();
    try {
        const flagKey = 'fatima_purchase_items_reinit_v3';
        const done = await getTenantFlag(conn, tenantId, flagKey);
        if (done === '1') {
            console.log('[BOOT] seedFatimaPurchaseItems: v3 ya ejecutado, se omite');
            return;
        }

        // Wipe de purchase_items de prueba de Fatima
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            const [del] = await conn.query(
                `DELETE FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items WHERE tenant_id = ? AND branch_id = ?`,
                [tenantId, fatimaId]
            );
            if (del.affectedRows > 0) {
                console.log(`[BOOT] seedFatimaPurchaseItems wipe: ${del.affectedRows} purchase_items (branch ${fatimaId})`);
            }
        } finally {
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }

        const [pilarItems] = await conn.query(
            `SELECT name, category_id, unit, type, is_preelaborable, species, \`usage\`, plu
             FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items
             WHERE tenant_id = ? AND branch_id = ?
             ORDER BY id ASC`,
            [tenantId, pilarId]
        );

        if (pilarItems.length === 0) {
            console.log('[BOOT] seedFatimaPurchaseItems: Pilar no tiene purchase_items para clonar');
            await setTenantFlag(conn, tenantId, flagKey, '1');
            return;
        }

        let cloned = 0;
        for (const it of pilarItems) {
            try {
                const [r] = await conn.query(
                    `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.purchase_items
                     (tenant_id, branch_id, name, product_id, category_id, last_price, unit, type,
                      is_preelaborable, species, \`usage\`, plu, synced)
                     VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?, 0)`,
                    [tenantId, fatimaId, it.name, it.category_id, it.unit, it.type,
                     it.is_preelaborable, it.species, it.usage, it.plu]
                );
                if (r.affectedRows > 0) cloned += 1;
            } catch (e) {
                console.warn(`[BOOT] seedFatimaPurchaseItems clone "${it.name}" falló:`, e?.message || e);
            }
        }

        await setTenantFlag(conn, tenantId, flagKey, '1');
        console.log(`[BOOT] seedFatimaPurchaseItems: ${cloned}/${pilarItems.length} artículos clonados Pilar → Fatima (precio 0). Reinit v3 OK.`);
    } finally {
        conn.release();
    }
}

// Compara versiones tipo "0.4.19". Devuelve 1 si a>b, -1 si a<b, 0 igual.
function compareSemver(a, b) {
    const pa = String(a || '').replace(/^[^\d]*/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
    const pb = String(b || '').replace(/^[^\d]*/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i += 1) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
}

let _latestBridgeVersionCache = { version: null, at: 0 };
// Consulta la ultima release del bridge en GitHub (tag `bridge-vX.Y.Z`).
// Cachea 10 min. Devuelve null si no se pudo verificar (no rompe el endpoint).
async function getLatestBridgeVersion() {
    const now = Date.now();
    if (_latestBridgeVersionCache.version && (now - _latestBridgeVersionCache.at) < BRIDGE_LATEST_VERSION_TTL_MS) {
        return _latestBridgeVersionCache.version;
    }
    try {
        const url = `https://api.github.com/repos/${BRIDGE_UPDATE_OWNER}/${BRIDGE_UPDATE_REPO}/releases`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let resp;
        try {
            resp = await fetch(url, {
                headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'MeatManager-API' },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!resp.ok) return _latestBridgeVersionCache.version;
        const releases = await resp.json();
        // Tomamos el mayor tag `bridge-vX.Y.Z` (no pre-release, no draft).
        const versions = (Array.isArray(releases) ? releases : [])
            .filter((r) => r && !r.draft && !r.prerelease && /^bridge-v\d+\.\d+\.\d+$/.test(String(r.tag_name || '')))
            .map((r) => String(r.tag_name).replace(/^bridge-v/, ''));
        if (!versions.length) return _latestBridgeVersionCache.version;
        const latest = versions.sort((a, b) => compareSemver(b, a))[0];
        _latestBridgeVersionCache = { version: latest, at: now };
        return latest;
    } catch {
        return _latestBridgeVersionCache.version;
    }
}

// Calcula el estado de salud de un bridge a partir de su fila en bridge_devices.
// `lastSeenAt` (siempre actualizado) decide vivacidad; los campos `agent_*`
// (pueden faltar en bridges viejos) dan el detalle.
function computeBridgeHealth(device, latestVersion, now = Date.now()) {
    const lastSeenMs = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : null;
    const isActive = String(device.status || '').toUpperCase() === 'ACTIVE';
    const version = device.app_version || null;
    const reasons = [];

    if (!lastSeenMs) {
        return {
            online: false,
            status: isActive ? 'unknown' : 'down',
            version, isUpToDate: null, scaleReachable: null,
            lastTicketSyncAt: device.last_ticket_sync_at ? new Date(device.last_ticket_sync_at).toISOString() : null,
            lastSeenAt: null,
            reasons: isActive ? ['nunca reporto'] : ['dispositivo inactivo'],
        };
    }

    const online = (now - lastSeenMs) < BRIDGE_ONLINE_THRESHOLD_MS;
    let isUpToDate = null;
    if (latestVersion && version) {
        isUpToDate = compareSemver(version, latestVersion) >= 0;
    } else if (latestVersion && !version) {
        isUpToDate = false; // version desconocida => tratamos como desactualizado
    }

    if (!online) {
        return {
            online: false, status: 'down', version, isUpToDate,
            scaleReachable: device.scale_reachable == null ? null : Boolean(device.scale_reachable),
            lastTicketSyncAt: device.last_ticket_sync_at ? new Date(device.last_ticket_sync_at).toISOString() : null,
            lastSeenAt: new Date(lastSeenMs).toISOString(),
            reasons: ['sin conexion'],
        };
    }

    const scaleReachable = device.scale_reachable == null ? null : Boolean(device.scale_reachable);
    if (scaleReachable === false) reasons.push('balanza no responde');
    if (isUpToDate === false) reasons.push(version ? 'desactualizado' : 'version desconocida');
    if (Number(device.recent_e3_count || 0) > 0) reasons.push('saturacion de la balanza');
    if (String(device.last_run_status || '') === 'error') reasons.push('error en ultima sincronizacion');

    return {
        online: true,
        status: reasons.length ? 'warn' : 'ok',
        version, isUpToDate, scaleReachable,
        lastTicketSyncAt: device.last_ticket_sync_at ? new Date(device.last_ticket_sync_at).toISOString() : null,
        lastSeenAt: new Date(lastSeenMs).toISOString(),
        recentE3Count: Number(device.recent_e3_count || 0),
        lastError: device.last_error || null,
        lastRunStatus: device.last_run_status || null,
        reasons,
    };
}

const redisTlsEnabled = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.REDIS_TLS || '').trim().toLowerCase()
);
const redisTlsRejectUnauthorized = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || '').trim().toLowerCase()
);

const redisClient = createClient({
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASS || undefined,
    database: Number(process.env.REDIS_DB || 0),
    socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        tls: redisTlsEnabled,
        rejectUnauthorized: redisTlsRejectUnauthorized,
    },
});

redisClient.on('error', (error) => {
    console.error('[REDIS ERROR]', error.message);
});

async function connectRedisSafely(timeoutMs = 5000) {
    if (!process.env.REDIS_HOST) {
        console.warn('[REDIS] REDIS_HOST no configurado. Tracking de delivery deshabilitado.');
        return false;
    }

    let timeoutHandle = null;
    try {
        await Promise.race([
            redisClient.connect(),
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
        console.log(`[REDIS] Conectado a ${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`);
        return true;
    } catch (error) {
        try {
            redisClient.destroy();
        } catch (_) {
            // ignore best-effort cleanup
        }
        console.warn(`[REDIS] No se pudo conectar. Tracking de delivery deshabilitado. ${error?.message || error}`);
        return false;
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

function getSmtpFromAddress() {
    return process.env.SMTP_FROM || 'no-reply@def-software.com.ar';
}

function hasSmtpConfig() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

function getSmtpTransport() {
    if (!hasSmtpConfig()) return null;
    if (smtpTransport) return smtpTransport;
    smtpTransport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: smtpSecure,
        auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS || '',
            }
            : undefined,
    });
    return smtpTransport;
}

function generateNumericCode(length = 6) {
    const min = 10 ** (length - 1);
    const max = (10 ** length) - 1;
    return String(Math.floor(min + (Math.random() * (max - min + 1))));
}

function hashSensitiveCode(code) {
    return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function maskEmailAddress(email) {
    const normalized = String(email || '').trim();
    if (!normalized.includes('@')) return normalized;
    const [name, domain] = normalized.split('@');
    if (!name) return `***@${domain}`;
    if (name.length <= 2) return `${name[0] || '*'}***@${domain}`;
    return `${name.slice(0, 2)}***@${domain}`;
}

function signInternalAdminToken(adminPayload) {
    return jwt.sign(
        {
            kind: 'internal_admin',
            admin: adminPayload,
        },
        INTERNAL_ADMIN_JWT_SECRET,
        { expiresIn: INTERNAL_ADMIN_JWT_EXPIRES_IN }
    );
}

function verifyInternalAdminToken(token) {
    const payload = jwt.verify(token, INTERNAL_ADMIN_JWT_SECRET);
    if (payload?.kind !== 'internal_admin' || !payload?.admin?.id) {
        throw new Error('Invalid internal admin token');
    }
    return payload.admin;
}

// ── Bridge auth helpers ────────────────────────────────────────────────────
async function firebaseSignInWithPassword(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const cleanPassword = String(password || '');
    if (!normalizedEmail || !cleanPassword) {
        const error = new Error('Email y contraseña son requeridos');
        error.statusCode = 400;
        throw error;
    }

    if (!FIREBASE_WEB_API_KEY) {
        if (localDevAuthBypass) {
            return { uid: `dev-${normalizedEmail}`, email: normalizedEmail, devBypass: true };
        }
        const error = new Error('Firebase Web API Key no configurada en el servidor');
        error.statusCode = 503;
        throw error;
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`;
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail, password: cleanPassword, returnSecureToken: true }),
        });
    } catch (networkError) {
        const error = new Error('No se pudo contactar a Firebase para validar credenciales');
        error.statusCode = 502;
        error.cause = networkError;
        throw error;
    }

    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const firebaseCode = String(body?.error?.message || '').trim();
        const knownAuthErrors = new Set([
            'EMAIL_NOT_FOUND',
            'INVALID_PASSWORD',
            'INVALID_LOGIN_CREDENTIALS',
            'USER_DISABLED',
            'INVALID_EMAIL',
            'MISSING_PASSWORD',
        ]);
        const message = knownAuthErrors.has(firebaseCode) || firebaseCode.startsWith('TOO_MANY_ATTEMPTS')
            ? 'Email o contraseña inválidos'
            : 'No se pudo validar el usuario contra Firebase';
        const error = new Error(message);
        error.statusCode = knownAuthErrors.has(firebaseCode) ? 401 : 502;
        error.firebaseCode = firebaseCode;
        throw error;
    }

    const uid = body?.localId || null;
    if (!uid) {
        const error = new Error('Respuesta de Firebase sin localId');
        error.statusCode = 502;
        throw error;
    }
    return { uid, email: body?.email || normalizedEmail, idToken: body?.idToken || null };
}

function signBridgeSessionToken(payload) {
    return jwt.sign(
        { kind: 'bridge_session', ...payload },
        INTERNAL_ADMIN_JWT_SECRET,
        { expiresIn: BRIDGE_SESSION_TOKEN_EXPIRES_IN }
    );
}

function verifyBridgeSessionToken(token) {
    const payload = jwt.verify(token, INTERNAL_ADMIN_JWT_SECRET);
    if (payload?.kind !== 'bridge_session' || !payload?.uid || !payload?.clientId) {
        throw new Error('Invalid bridge session token');
    }
    return payload;
}

function generateBridgeDeviceToken() {
    return crypto.randomBytes(BRIDGE_DEVICE_TOKEN_BYTES).toString('hex');
}

function hashBridgeDeviceToken(token) {
    return crypto
        .createHmac('sha256', INTERNAL_ADMIN_JWT_SECRET)
        .update(String(token || ''))
        .digest('hex');
}

function generateBridgeDeviceId() {
    return `bridge-${crypto.randomBytes(8).toString('hex')}`;
}

async function findBridgeDeviceByToken(token) {
    const tokenString = String(token || '').trim();
    if (!tokenString) return null;
    const hash = hashBridgeDeviceToken(tokenString);

    const runQuery = async () => clientsControlPool.query(
        `SELECT id, tenantId, clientId, branchId, deviceId, hostname, status, lastSeenAt
         FROM \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
         WHERE deviceTokenHash = ?
         LIMIT 1`,
        [hash]
    );

    let rows;
    try {
        [rows] = await runQuery();
    } catch (error) {
        // Self-heal: si la tabla no existe (puede pasar si el deploy se
        // restauro desde un backup viejo, o si ensureClientsControlStore no
        // alcanzo a correr en este host), la creamos al vuelo y reintentamos.
        const code = error?.code || '';
        const message = String(error?.message || '');
        const noTable = code === 'ER_NO_SUCH_TABLE' || /Table .* doesn'?t exist/i.test(message);
        if (!noTable) throw error;
        console.warn('[BRIDGE AUTH] bridge_devices ausente, recreando schema y reintentando');
        await ensureClientsControlStore();
        [rows] = await runQuery();
    }

    const row = rows?.[0] || null;
    if (!row) return null;
    if (String(row.status || '').toUpperCase() !== 'ACTIVE') return null;
    return row;
}

async function sendCashWithdrawalAuthorizationEmail({
    recipientEmail,
    code,
    amount,
    paymentMethod,
    description,
    requestedBy,
    businessName,
    expiresAt,
}) {
    const transport = getSmtpTransport();
    if (!transport) {
        throw new Error('SMTP no configurado en la API');
    }

    const formattedAmount = Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const subject = `Codigo de autorizacion para retiro de socios - ${businessName || 'MeatManager'}`;
    const text = [
        `Se solicito un retiro de socios en caja.`,
        '',
        `Empresa: ${businessName || 'MeatManager'}`,
        `Solicitado por: ${requestedBy || 'Usuario web'}`,
        `Monto: $${formattedAmount}`,
        `Medio: ${paymentMethod || 'Efectivo'}`,
        `Concepto: ${description || 'Sin detalle'}`,
        `Codigo: ${code}`,
        `Vence: ${new Date(expiresAt).toLocaleString('es-AR')}`,
        '',
        'Si no reconoces esta solicitud, ignora este mensaje.',
    ].join('\n');

    const html = `
        <div style="font-family:Arial,sans-serif;background:#0f1117;color:#f5f5f5;padding:24px;">
            <div style="max-width:640px;margin:0 auto;background:#171922;border:1px solid #2a2f3a;border-radius:16px;padding:24px;">
                <h2 style="margin:0 0 12px;color:#f97316;">Autorizacion de retiro societario</h2>
                <p style="margin:0 0 16px;color:#cbd5e1;">Se solicito un retiro de socios desde caja.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:6px 0;color:#94a3b8;">Empresa</td><td style="padding:6px 0;text-align:right;">${businessName || 'MeatManager'}</td></tr>
                    <tr><td style="padding:6px 0;color:#94a3b8;">Solicitado por</td><td style="padding:6px 0;text-align:right;">${requestedBy || 'Usuario web'}</td></tr>
                    <tr><td style="padding:6px 0;color:#94a3b8;">Monto</td><td style="padding:6px 0;text-align:right;">$${formattedAmount}</td></tr>
                    <tr><td style="padding:6px 0;color:#94a3b8;">Medio</td><td style="padding:6px 0;text-align:right;">${paymentMethod || 'Efectivo'}</td></tr>
                    <tr><td style="padding:6px 0;color:#94a3b8;">Concepto</td><td style="padding:6px 0;text-align:right;">${description || 'Sin detalle'}</td></tr>
                    <tr><td style="padding:6px 0;color:#94a3b8;">Vence</td><td style="padding:6px 0;text-align:right;">${new Date(expiresAt).toLocaleString('es-AR')}</td></tr>
                </table>
                <div style="text-align:center;margin:24px 0;">
                    <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:#f97316;color:#111827;font-size:30px;font-weight:800;letter-spacing:8px;">
                        ${code}
                    </div>
                </div>
                <p style="margin:0;color:#94a3b8;font-size:13px;">Si no reconoces esta solicitud, ignora este mensaje.</p>
            </div>
        </div>
    `;

    await transport.sendMail({
        from: getSmtpFromAddress(),
        to: recipientEmail,
        subject,
        text,
        html,
    });
}

function getRedisDriverLocationKey(tenantId, firebaseUid) {
    return `mm:delivery:location:${tenantId}:${firebaseUid}`;
}

function getRedisDriversSortedSetKey(tenantId) {
    return `mm:delivery:drivers:${tenantId}`;
}

async function storeDriverLocationPresence({
    tenantId,
    firebaseUid,
    payload,
    ttlSeconds = REDIS_TRACKING_TTL_SECONDS,
}) {
    const now = Date.now();
    const locationKey = getRedisDriverLocationKey(tenantId, firebaseUid);
    const driversKey = getRedisDriversSortedSetKey(tenantId);

    const normalizedPayload = {
        ...payload,
        tenantId,
        firebaseUid,
        lastSeenAt: new Date(now).toISOString(),
    };

    const multi = redisClient.multi();
    multi.set(locationKey, JSON.stringify(normalizedPayload), { EX: ttlSeconds });
    multi.zAdd(driversKey, [{ score: now, value: firebaseUid }]);
    multi.expire(driversKey, Math.max(ttlSeconds * 4, ttlSeconds + 30));
    await multi.exec();

    return normalizedPayload;
}

async function getActiveDriverLocations(tenantId, ttlSeconds = REDIS_TRACKING_TTL_SECONDS) {
    const now = Date.now();
    const cutoff = now - ttlSeconds * 1000;
    const driversKey = getRedisDriversSortedSetKey(tenantId);

    await redisClient.zRemRangeByScore(driversKey, 0, cutoff);
    const firebaseUids = await redisClient.zRange(driversKey, 0, -1);
    if (!firebaseUids.length) return [];

    const values = await Promise.all(
        firebaseUids.map((firebaseUid) =>
            redisClient.get(getRedisDriverLocationKey(tenantId, firebaseUid))
        )
    );

    return values
        .map((value) => {
            if (!value) return null;
            try {
                return JSON.parse(value);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((left, right) => {
            const leftTs = new Date(left.lastSeenAt || 0).getTime();
            const rightTs = new Date(right.lastSeenAt || 0).getTime();
            return rightTs - leftTs;
        });
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isActiveStatus(value, fallback = true) {
    if (value == null) return fallback;
    if (typeof value === 'string') {
        return ['active', 'grace', 'enabled', 'pending'].includes(value.toLowerCase());
    }
    return Number(value) !== 0;
}

function parseFeatureFlags(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') {
            return parseFeatureFlags(parsed);
        }
        return parsed;
    } catch {
        return {};
    }
}

function parseBooleanLike(value) {
    if (value == null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized);
}

function normalizeLicenseToken(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeLicenseKey(value) {
    return normalizeLicenseToken(value).replace(/[^a-z0-9]/g, '');
}

function isSuperLicenseMatch(license) {
    const candidates = [
        normalizeLicenseKey(license?.internalCode),
        normalizeLicenseKey(license?.commercialName),
        normalizeLicenseKey(license?.category),
    ].filter(Boolean);

    return candidates.some((token) => (
        token === 'su'
        || token === 'superuser'
        || token.includes('superuser')
    ));
}

function licenseAppliesToWebapp(license) {
    const code = normalizeLicenseToken(license?.internalCode);
    const category = normalizeLicenseToken(license?.category);

    if (parseBooleanLike(license?.appliesToWebapp)) {
        return true;
    }

    if (category.includes('webapp')) {
        return true;
    }

    if (['base_mm', 'man_webpage', 'superuser', 'su'].includes(code)) {
        return true;
    }

    if (isSuperLicenseMatch(license)) {
        return true;
    }

    return false;
}

const TENANT_SCOPED_TABLES = new Set([
    'settings', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'products', 'purchase_items',
    'stock', 'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'cash_closures', 'delivery_tracking_events', 'prices', 'product_prices', 'branch_product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'app_logs', 'promotions', 'scale_users',
]);

const TENANT_ID_TABLES = [
    'settings', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'products', 'purchase_items',
    'stock', 'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'cash_closures', 'delivery_tracking_events', 'prices', 'product_prices', 'branch_product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'app_logs', 'promotions', 'scale_users',
];

const DELIVERY_STATUS_MAP = {
    pending: 'pending',
    ready: 'assigned',
    assigned: 'assigned',
    on_route: 'on_route',
    in_route: 'on_route',
    en_reparto: 'on_route',
    arrived: 'arrived',
    delivered: 'delivered',
    failed: 'failed',
    cancelled: 'cancelled',
};

const ACTIVE_DELIVERY_STATUSES = ['assigned', 'on_route', 'arrived'];

function computeEan13CheckDigit(base12) {
    const digits = String(base12 || '').replace(/\D/g, '').slice(0, 12).padEnd(12, '0');
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
        const digit = Number.parseInt(digits[i], 10) || 0;
        sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
}

function buildScaleBarcodeCandidates(rawBarcode) {
    const raw = String(rawBarcode || '').trim();
    const digits = raw.replace(/\D/g, '');
    const candidates = new Set();

    if (raw) candidates.add(raw);
    if (digits) candidates.add(digits);

    if (digits.length >= 13) {
        candidates.add(digits.slice(0, 13));
        candidates.add(digits.slice(0, 12));
    }

    if (digits.length === 12) {
        candidates.add(`${digits}${computeEan13CheckDigit(digits)}`);
    }

    return Array.from(candidates).filter(Boolean);
}

function normalizeDeliveryStatus(value) {
    return DELIVERY_STATUS_MAP[String(value || '').trim().toLowerCase()] || 'pending';
}

function parseLicenseTokens(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(parseLicenseTokens);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            return parseLicenseTokens(JSON.parse(trimmed));
        } catch {
            return trimmed.includes(',') ? trimmed.split(',').flatMap(parseLicenseTokens) : [trimmed];
        }
    }
    if (typeof value === 'object') {
        return Object.entries(value)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([key]) => key);
    }
    return [];
}

const LOGISTICS_LICENSE_HINTS = [
    'logistica',
    'logistics',
    'delivery',
    'deliveries',
    'envios',
    'shipping',
    'entrega',
    'entregas',
    'reparto',
    'repartos',
];

function licenseHasLogisticsCapability(license) {
    const tokens = [
        normalizeLicenseToken(license?.internalCode),
        normalizeLicenseToken(license?.commercialName),
        normalizeLicenseToken(license?.category),
        ...parseLicenseTokens(license?.featureFlags).map(normalizeLicenseToken),
    ].filter(Boolean);

    return tokens.some((token) => (
        LOGISTICS_LICENSE_HINTS.some((hint) => token === hint || token.includes(hint))
    ));
}

function isBaseWebappLicense(license) {
    return (
        Number(license?.isMandatory) === 1
        || normalizeLicenseToken(license?.internalCode) === 'base_mm'
        || normalizeLicenseToken(license?.category) === 'base_webapp'
    );
}

function tenantHasPurchasedBaseWebappLicense(licenses = []) {
    return licenses.some((license) => isBaseWebappLicense(license) && licenseAppliesToWebapp(license));
}

function tenantHasPurchasedLogisticsLicense(licenses = []) {
    return licenses.some((license) => licenseHasLogisticsCapability(license));
}

function hasSuperLicense(licenses = []) {
    return licenses.some((license) => isSuperLicenseMatch(license));
}

function licenseHasAdminCapability(license) {
    const tokens = [
        normalizeLicenseKey(license?.internalCode),
        normalizeLicenseKey(license?.commercialName),
        normalizeLicenseKey(license?.category),
        ...parseLicenseTokens(license?.featureFlags).map(normalizeLicenseKey),
    ].filter(Boolean);

    return tokens.some((token) => (
        token === 'superuser'
        || token === 'su'
        || token.includes('superuser')
        || token === 'adminpanel'
        || token === 'mobileadmin'
    ));
}

function hasAdminPanelAccess(accessContext) {
    if (!accessContext?.user) return false;
    if (accessContext.user.isGlobalSuperAdmin) return true;
    if (accessContext.user.role === 'admin') return true;

    const licenses = [
        ...(Array.isArray(accessContext.effectiveLicenses) ? accessContext.effectiveLicenses : []),
        ...(Array.isArray(accessContext.deliveryLicenses) ? accessContext.deliveryLicenses : []),
    ];

    return licenses.some((license) => (
        licenseHasAdminCapability(license)
        && (
            accessContext.user.isOwnerFallback
            || String(license.assignedUserId || '') === String(accessContext.user.id)
        )
    ));
}

function canWriteProtectedSettings(accessContext) {
    if (!accessContext?.user) return false;
    if (accessContext.user.isGlobalSuperAdmin) return true;
    if (accessContext.user.role === 'admin') return true;
    if (accessContext.user.isOwnerFallback) return true;
    return false;
}

async function resolveTargetSettingKey({ pool, tenantId, operation, record, id }) {
    const normalizedOperation = String(operation || '').trim().toLowerCase();
    const directKey = String(record?.key || '').trim().toLowerCase();
    if (directKey) return directKey;

    if (!['update', 'delete'].includes(normalizedOperation)) return '';

    const numId = Number(id);
    if (!Number.isFinite(numId) || numId <= 0) return '';

    const [rows] = await pool.query(
        'SELECT `key` FROM settings WHERE tenant_id = ? AND id = ? LIMIT 1',
        [tenantId, numId]
    );
    return String(rows?.[0]?.key || '').trim().toLowerCase();
}

function hasLogisticsAccess(accessContext) {
    if (!accessContext?.user) return false;
    if (accessContext.user.isGlobalSuperAdmin) return true;
    if (!accessContext.client?.tenantHasDeliveryLicense) return false;
    if (accessContext.user.role === 'admin') return true;
    if (hasSuperLicense(accessContext.effectiveLicenses || [])) return true;

    return (accessContext.deliveryLicenses || []).some((license) => licenseHasLogisticsCapability(license));
}

function assertLogisticsAccess(accessContext) {
    if (!hasLogisticsAccess(accessContext)) {
        const error = new Error('El usuario no tiene acceso al módulo Logística');
        error.statusCode = 403;
        throw error;
    }
}

function safeJsonParse(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function getAccessDisplayName(user = {}) {
    const fullName = [user.name, user.lastname]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
    return fullName || user.email || 'Repartidor';
}

function buildDriverIdentity(accessContext) {
    const displayName = getAccessDisplayName(accessContext?.user);
    return {
        userId: accessContext?.user?.id ?? null,
        firebaseUid: accessContext?.user?.firebaseUid || null,
        email: normalizeEmail(accessContext?.user?.email || ''),
        name: displayName,
        role: accessContext?.user?.role || 'employee',
    };
}

function normalizePaymentStatus(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) return null;
    if (['paid', 'pagado', 'pago_confirmado'].includes(token)) return 'paid';
    if (['pending_driver_collection', 'collect_on_delivery', 'cobrar_al_entregar', 'pendiente_cobro'].includes(token)) {
        return 'pending_driver_collection';
    }
    if (['not_required', 'sin_cobro', 'no_requiere_cobro'].includes(token)) return 'not_required';
    return token;
}

function mapDeliveryOrder(row) {
    const status = normalizeDeliveryStatus(row.status);
    const amountDue = row.amount_due == null ? null : Number(row.amount_due);
    return {
        id: row.id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone || null,
        items: safeJsonParse(row.items, []),
        total: row.total == null ? 0 : Number(row.total),
        status,
        rawStatus: row.status,
        deliveryDate: row.delivery_date,
        deliveryType: row.delivery_type,
        address: row.address,
        latitude: row.latitude == null ? null : Number(row.latitude),
        longitude: row.longitude == null ? null : Number(row.longitude),
        source: row.source,
        createdAt: row.created_at,
        assignedAt: row.assigned_at,
        statusUpdatedAt: row.status_updated_at,
        paymentMethod: row.payment_method || null,
        paymentStatus: normalizePaymentStatus(row.payment_status),
        paid: row.paid === 1 || row.paid === true,
        amountDue,
        driver: {
            name: row.repartidor || null,
            firebaseUid: row.assigned_driver_uid || null,
            email: row.assigned_driver_email || null,
        },
    };
}

function orderBelongsToDriver(row, driverIdentity) {
    const orderUid = String(row.assigned_driver_uid || '').trim();
    const orderEmail = normalizeEmail(row.assigned_driver_email || '');
    const orderName = String(row.repartidor || '').trim().toLowerCase();
    const driverUid = String(driverIdentity?.firebaseUid || '').trim();
    const driverEmail = normalizeEmail(driverIdentity?.email || '');
    const driverName = String(driverIdentity?.name || '').trim().toLowerCase();

    return (
        (orderUid && driverUid && orderUid === driverUid)
        || (orderEmail && driverEmail && orderEmail === driverEmail)
        || (orderName && driverName && orderName === driverName)
    );
}

const TABLES_WITH_NUMERIC_ID = [
    'payment_methods', 'categories', 'product_categories', 'suppliers', 'products', 'purchase_items', 'stock',
    'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'prices', 'product_prices', 'branch_product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'app_logs', 'promotions', 'scale_users',
];
const BRANCH_SCOPED_TABLES = new Set([
    'ventas', 'ventas_items', 'compras', 'compras_items', 'caja_movimientos', 'pedidos', 'cash_closures',
    'stock', 'promotions', 'products', 'purchase_items', 'animal_lots', 'despostada_logs',
    'clients', 'suppliers', 'menu_digital', 'supplier_item_tax_profiles',
    'prices', 'product_prices', 'branch_product_prices', 'branch_stock_snapshots', 'scale_users',
]);
const STRICT_BRANCH_SCOPED_TABLES = new Set([
    'ventas', 'ventas_items', 'compras', 'compras_items', 'caja_movimientos', 'pedidos', 'cash_closures',
    'stock', 'promotions', 'products', 'purchase_items', 'animal_lots', 'despostada_logs',
    'clients', 'suppliers', 'menu_digital', 'supplier_item_tax_profiles',
    'prices', 'product_prices', 'branch_product_prices', 'branch_stock_snapshots', 'scale_users',
]);

function isTenantScopedTable(table) {
    return TENANT_SCOPED_TABLES.has(String(table || '').trim());
}

async function hasColumn(conn, dbName, tableName, columnName) {
    const [rows] = await conn.query(
        `SELECT 1
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
         LIMIT 1`,
        [dbName, tableName, columnName]
    );
    return rows.length > 0;
}

async function ensureColumn(conn, tableName, columnName, definitionSql) {
    if (await hasColumn(conn, OPERATIONAL_DB_NAME, tableName, columnName)) return;
    try {
        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
             ADD COLUMN ${definitionSql}`
        );
    } catch (error) {
        const fallbackDefinition = String(definitionSql || '')
            .replace(/\s+AFTER\s+`[^`]+`\s*$/i, '')
            .trim();

        const canRetryWithoutAfter =
            error?.code === 'ER_BAD_FIELD_ERROR'
            && fallbackDefinition
            && fallbackDefinition !== String(definitionSql || '').trim();

        if (!canRetryWithoutAfter) {
            throw error;
        }

        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
             ADD COLUMN ${fallbackDefinition}`
        );
    }
}

async function getColumnType(conn, dbName, tableName, columnName) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
         LIMIT 1`,
        [dbName, tableName, columnName]
    );
    return String(rows?.[0]?.COLUMN_TYPE || '').toLowerCase();
}

async function ensureColumnType(conn, tableName, columnName, definitionSql, expectedSnippets = []) {
    if (!(await hasColumn(conn, OPERATIONAL_DB_NAME, tableName, columnName))) return;
    const currentType = await getColumnType(conn, OPERATIONAL_DB_NAME, tableName, columnName);
    const matches = expectedSnippets.every((snippet) => currentType.includes(String(snippet).toLowerCase()));
    if (matches) return;
    await conn.query(
        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
         MODIFY COLUMN ${definitionSql}`
    );
    tableDescCache.delete(`${OPERATIONAL_DB_NAME}.${tableName}`);
    tableColCache.delete(`${OPERATIONAL_DB_NAME}.${tableName}`);
}

async function getPrimaryKeyColumns(conn, dbName, tableName) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
         ORDER BY ORDINAL_POSITION ASC`,
        [dbName, tableName]
    );
    return rows.map((row) => row.COLUMN_NAME);
}

async function hasIndex(conn, dbName, tableName, indexName) {
    const [rows] = await conn.query(
        `SELECT 1
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
         LIMIT 1`,
        [dbName, tableName, indexName]
    );
    return rows.length > 0;
}

async function dropIndexIfExists(conn, tableName, indexName) {
    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, tableName, indexName))) return;
    await conn.query(
        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
         DROP INDEX \`${indexName}\``
    );
}

async function hasForeignKey(conn, dbName, tableName, constraintName) {
    const [rows] = await conn.query(
        `SELECT 1
         FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
         LIMIT 1`,
        [dbName, tableName, constraintName]
    );
    return rows.length > 0;
}

async function hasTable(conn, dbName, tableName) {
    const [rows] = await conn.query(
        `SELECT 1
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         LIMIT 1`,
        [dbName, tableName]
    );
    return rows.length > 0;
}

async function ensureTenantIdColumn(conn, tableName) {
    if (await hasColumn(conn, OPERATIONAL_DB_NAME, tableName, TENANT_COLUMN)) {
        return;
    }

    const afterClause = tableName === 'settings' ? 'AFTER `key`' : 'AFTER `id`';
    await conn.query(
        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
         ADD COLUMN \`${TENANT_COLUMN}\` BIGINT NULL ${afterClause}`
    );
}

async function backfillTenantId(conn, tableName) {
    if (!(await hasColumn(conn, OPERATIONAL_DB_NAME, tableName, TENANT_COLUMN))) return;
    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
         SET \`${TENANT_COLUMN}\` = ?
         WHERE \`${TENANT_COLUMN}\` IS NULL`,
        [DEFAULT_OPERATIONAL_TENANT_ID]
    );
}

async function ensureTableTenantIndexes(conn, tableName) {
    const idxTenant = `idx_${tableName}_tenant`;
    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, tableName, idxTenant))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
                 ADD INDEX \`${idxTenant}\` (\`${TENANT_COLUMN}\`)`
            );
        } catch (error) {
            if (error?.code !== 'ER_DUP_KEYNAME') {
                throw error;
            }
        }
    }

    const uniqueTenantId = `uniq_${tableName}_tenant_id`;
    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, tableName, uniqueTenantId))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
                 ADD UNIQUE KEY \`${uniqueTenantId}\` (\`${TENANT_COLUMN}\`, \`id\`)`
            );
        } catch (error) {
            if (error?.code !== 'ER_DUP_KEYNAME') {
                throw error;
            }
        }
    }
}

async function ensureIndex(conn, tableName, indexName, columnsSql) {
    if (await hasIndex(conn, OPERATIONAL_DB_NAME, tableName, indexName)) {
        return;
    }

    try {
        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
             ADD INDEX \`${indexName}\` (${columnsSql})`
        );
    } catch (error) {
        if (error?.code !== 'ER_DUP_KEYNAME') {
            throw error;
        }
    }
}

async function ensureCompositePrimaryKey(conn, tableName) {
    const primaryColumns = await getPrimaryKeyColumns(conn, OPERATIONAL_DB_NAME, tableName);
    if (primaryColumns.length === 2 && primaryColumns[0] === 'id' && primaryColumns[1] === TENANT_COLUMN) {
        await ensureTableTenantIndexes(conn, tableName);
        return;
    }

    if (primaryColumns.length > 0) {
        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
             DROP PRIMARY KEY,
             ADD PRIMARY KEY (\`id\`, \`${TENANT_COLUMN}\`)`
        );
    } else {
        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
             ADD PRIMARY KEY (\`id\`, \`${TENANT_COLUMN}\`)`
        );
    }
    await ensureTableTenantIndexes(conn, tableName);
}

async function ensureSettingsPrimaryKey(conn) {
    const primaryColumns = await getPrimaryKeyColumns(conn, OPERATIONAL_DB_NAME, 'settings');
    // Acepta tanto el formato viejo (tenant_id, key) como el nuevo (tenant_id, branch_id, key)
    const isOldFormat = primaryColumns.length === 2 && primaryColumns[0] === TENANT_COLUMN && primaryColumns[1] === 'key';
    const isNewFormat = primaryColumns.length === 3 && primaryColumns[0] === TENANT_COLUMN && primaryColumns[1] === 'branch_id' && primaryColumns[2] === 'key';
    if (!isOldFormat && !isNewFormat) {
        if (primaryColumns.length > 0) {
            await conn.query(`ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings DROP PRIMARY KEY`);
        }
        await conn.query(
            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings
             ADD PRIMARY KEY (\`${TENANT_COLUMN}\`, \`key\`)`
        );
    }

    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'settings', 'idx_settings_key'))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings
                 ADD INDEX idx_settings_key (\`key\`)`
            );
        } catch (error) {
            if (error?.code !== 'ER_DUP_KEYNAME') {
                throw error;
            }
        }
    }
}

async function ensureSettingsBranchId(conn) {
    if (await hasColumn(conn, OPERATIONAL_DB_NAME, 'settings', 'branch_id')) return;
    // 0 = tenant-level (compartido), > 0 = exclusivo de esa sucursal
    await conn.query(
        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings
         ADD COLUMN branch_id INT NOT NULL DEFAULT 0 AFTER \`${TENANT_COLUMN}\``
    );
    await conn.query(`ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings DROP PRIMARY KEY`);
    await conn.query(
        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.settings
         ADD PRIMARY KEY (\`${TENANT_COLUMN}\`, \`branch_id\`, \`key\`)`
    );
}

async function ensureProductCatalogIntegrity(conn) {
    const canonicalNameSql = (expr) => `LOWER(REPLACE(TRIM(COALESCE(${expr}, '')), ' ', '_'))`;
    const cleanTextSql = (expr) => `NULLIF(TRIM(COALESCE(${expr}, '')), '')`;
    const nonGenericScaleTicketSql = (expr) => `LOWER(TRIM(COALESCE(${expr}, ''))) NOT LIKE 'ticket%balanza%offline%'`;
    const cleanCategoryKeySql = (expr) => `NULLIF(LOWER(REPLACE(TRIM(COALESCE(${expr}, '')), ' ', '_')), '')`;
    const legacyPriceNameSql = `TRIM(REPLACE(SUBSTRING_INDEX(COALESCE(pr.product_id, ''), '-', 1), '_', ' '))`;
    const legacyPriceCategorySql = `NULLIF(TRIM(REPLACE(SUBSTRING(COALESCE(pr.product_id, ''), LENGTH(SUBSTRING_INDEX(COALESCE(pr.product_id, ''), '-', 1)) + 2), '_', ' ')), '')`;
    const canonicalPriceProductIdSql = `CONCAT(p.canonical_key, '-', COALESCE(NULLIF(LOWER(REPLACE(TRIM(COALESCE(p.category, '')), ' ', '_')), ''), 'general'))`;

    const insertStatements = [
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, branch_id, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            s.\`${TENANT_COLUMN}\`,
            s.branch_id,
            ${canonicalNameSql('s.name')} AS canonical_key,
            TRIM(s.name) AS name,
            MAX(${cleanTextSql('s.type')}) AS category,
            MAX(${cleanTextSql('s.unit')}) AS unit,
            MAX(CASE WHEN COALESCE(s.price, 0) > 0 THEN s.price ELSE 0 END) AS current_price,
            NULL AS plu,
            'stock_backfill' AS source,
            NOW(),
            COALESCE(MAX(s.updated_at), NOW())
         FROM \`${OPERATIONAL_DB_NAME}\`.stock s
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = s.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> s.branch_id
         AND p.canonical_key = ${canonicalNameSql('s.name')}
         WHERE ${cleanTextSql('s.name')} IS NOT NULL
           AND ${nonGenericScaleTicketSql('s.name')}
           AND p.id IS NULL
         GROUP BY s.\`${TENANT_COLUMN}\`, s.branch_id, ${canonicalNameSql('s.name')}, TRIM(s.name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, branch_id, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            pi.\`${TENANT_COLUMN}\`,
            pi.branch_id,
            ${canonicalNameSql('pi.name')} AS canonical_key,
            TRIM(pi.name) AS name,
            MAX(COALESCE(${cleanTextSql('pi.type')}, ${cleanTextSql('pi.species')})) AS category,
            MAX(${cleanTextSql('pi.unit')}) AS unit,
            MAX(CASE WHEN COALESCE(pi.last_price, 0) > 0 THEN pi.last_price ELSE 0 END) AS current_price,
            MAX(${cleanTextSql('pi.plu')}) AS plu,
            'purchase_catalog_backfill' AS source,
            NOW(),
            NOW()
         FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = pi.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> pi.branch_id
          AND p.canonical_key = ${canonicalNameSql('pi.name')}
         WHERE ${cleanTextSql('pi.name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY pi.\`${TENANT_COLUMN}\`, pi.branch_id, ${canonicalNameSql('pi.name')}, TRIM(pi.name)`,
         `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
             (\`${TENANT_COLUMN}\`, branch_id, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
          SELECT
             vi.\`${TENANT_COLUMN}\`,
             vi.branch_id,
             ${canonicalNameSql('vi.product_name')} AS canonical_key,
             TRIM(vi.product_name) AS name,
             NULL AS category,
             NULL AS unit,
             MAX(CASE WHEN COALESCE(vi.price, 0) > 0 THEN vi.price ELSE 0 END) AS current_price,
             NULL AS plu,
             'ventas_backfill' AS source,
             NOW(),
             NOW()
          FROM \`${OPERATIONAL_DB_NAME}\`.ventas_items vi
          LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
            ON p.\`${TENANT_COLUMN}\` = vi.\`${TENANT_COLUMN}\`
           AND p.branch_id <=> vi.branch_id
           AND p.canonical_key = ${canonicalNameSql('vi.product_name')}
          WHERE vi.branch_id IS NOT NULL
            AND ${cleanTextSql('vi.product_name')} IS NOT NULL
            AND ${nonGenericScaleTicketSql('vi.product_name')}
            AND p.id IS NULL
          GROUP BY vi.\`${TENANT_COLUMN}\`, vi.branch_id, ${canonicalNameSql('vi.product_name')}, TRIM(vi.product_name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            ci.\`${TENANT_COLUMN}\`,
            ${canonicalNameSql('ci.product_name')} AS canonical_key,
            TRIM(ci.product_name) AS name,
            NULL AS category,
            NULL AS unit,
            MAX(CASE WHEN COALESCE(ci.unit_price, 0) > 0 THEN ci.unit_price ELSE 0 END) AS current_price,
            NULL AS plu,
            'compras_backfill' AS source,
            NOW(),
            NOW()
         FROM \`${OPERATIONAL_DB_NAME}\`.compras_items ci
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = ci.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('ci.product_name')}
         WHERE ${cleanTextSql('ci.product_name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY ci.\`${TENANT_COLUMN}\`, ${canonicalNameSql('ci.product_name')}, TRIM(ci.product_name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            md.\`${TENANT_COLUMN}\`,
            ${canonicalNameSql('md.product_name')} AS canonical_key,
            TRIM(md.product_name) AS name,
            MAX(${cleanTextSql('md.category')}) AS category,
            NULL AS unit,
            MAX(CASE WHEN COALESCE(md.price, 0) > 0 THEN md.price ELSE 0 END) AS current_price,
            NULL AS plu,
            'menu_backfill' AS source,
            NOW(),
            NOW()
         FROM \`${OPERATIONAL_DB_NAME}\`.menu_digital md
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = md.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('md.product_name')}
         WHERE ${cleanTextSql('md.product_name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY md.\`${TENANT_COLUMN}\`, ${canonicalNameSql('md.product_name')}, TRIM(md.product_name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            pr.\`${TENANT_COLUMN}\`,
            ${canonicalNameSql(legacyPriceNameSql)} AS canonical_key,
            ${legacyPriceNameSql} AS name,
            MAX(${legacyPriceCategorySql}) AS category,
            NULL AS unit,
            MAX(CASE WHEN COALESCE(pr.price, 0) > 0 THEN pr.price ELSE 0 END) AS current_price,
            MAX(${cleanTextSql('pr.plu')}) AS plu,
            'prices_backfill' AS source,
            NOW(),
            COALESCE(MAX(pr.updated_at), NOW())
         FROM \`${OPERATIONAL_DB_NAME}\`.prices pr
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = pr.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql(legacyPriceNameSql)}
         WHERE ${cleanTextSql(legacyPriceNameSql)} IS NOT NULL
           AND p.id IS NULL
         GROUP BY pr.\`${TENANT_COLUMN}\`, ${canonicalNameSql(legacyPriceNameSql)}, ${legacyPriceNameSql}`,
    ];

    for (const sql of insertStatements) {
        await conn.query(sql);
    }

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products
         SET active = 0,
             deleted_at = COALESCE(deleted_at, NOW()),
             archived_plu = COALESCE(archived_plu, plu),
             plu = NULL,
             source = 'scale_ticket_fallback_archived',
             updated_at = NOW()
         WHERE NOT (${nonGenericScaleTicketSql('name')})
           AND deleted_at IS NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
         JOIN (
            SELECT
                s.\`${TENANT_COLUMN}\` AS tenant_id,
                s.branch_id,
                ${canonicalNameSql('s.name')} AS canonical_key,
                MAX(${cleanTextSql('s.type')}) AS category,
                MAX(${cleanTextSql('s.unit')}) AS unit,
                MAX(CASE WHEN COALESCE(s.price, 0) > 0 THEN s.price ELSE 0 END) AS current_price
            FROM \`${OPERATIONAL_DB_NAME}\`.stock s
            WHERE ${cleanTextSql('s.name')} IS NOT NULL
              AND ${nonGenericScaleTicketSql('s.name')}
            GROUP BY s.\`${TENANT_COLUMN}\`, s.branch_id, ${canonicalNameSql('s.name')}
         ) src
           ON src.tenant_id = p.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> src.branch_id
          AND src.canonical_key = p.canonical_key
         SET
            p.category = COALESCE(NULLIF(p.category, ''), src.category),
            p.unit = COALESCE(NULLIF(p.unit, ''), src.unit),
            p.current_price = CASE
                WHEN COALESCE(p.current_price, 0) > 0 THEN p.current_price
                WHEN COALESCE(src.current_price, 0) > 0 THEN src.current_price
                ELSE p.current_price
            END`
    );

    // Best-effort: si dos productos resolvieran al mismo plu dentro de una sucursal,
    // este UPDATE viola uniq_products_tenant_branch_plu. No debe tumbar el boot.
    try {
        await conn.query(
            `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
             JOIN (
                SELECT
                    pi.\`${TENANT_COLUMN}\` AS tenant_id,
                    pi.branch_id,
                    ${canonicalNameSql('pi.name')} AS canonical_key,
                    MAX(COALESCE(${cleanTextSql('pi.type')}, ${cleanTextSql('pi.species')})) AS category,
                    MAX(${cleanTextSql('pi.unit')}) AS unit,
                    MAX(${cleanTextSql('pi.plu')}) AS plu,
                    MAX(CASE WHEN COALESCE(pi.last_price, 0) > 0 THEN pi.last_price ELSE 0 END) AS current_price
                FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
                WHERE ${cleanTextSql('pi.name')} IS NOT NULL
                GROUP BY pi.\`${TENANT_COLUMN}\`, pi.branch_id, ${canonicalNameSql('pi.name')}
             ) src
               ON src.tenant_id = p.\`${TENANT_COLUMN}\`
              AND p.branch_id <=> src.branch_id
              AND src.canonical_key = p.canonical_key
             SET
                p.category = COALESCE(NULLIF(p.category, ''), src.category),
                p.unit = COALESCE(NULLIF(p.unit, ''), src.unit),
                p.plu = COALESCE(NULLIF(p.plu, ''), src.plu),
                p.current_price = CASE
                    WHEN COALESCE(p.current_price, 0) > 0 THEN p.current_price
                    WHEN COALESCE(src.current_price, 0) > 0 THEN src.current_price
                    ELSE p.current_price
                END`
        );
    } catch (e) {
        console.warn('[DB] catalog repair (purchase_items→products) omitido:', e?.message || e);
    }

    try {
        await conn.query(
            `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
             JOIN (
                SELECT
                    pr.\`${TENANT_COLUMN}\` AS tenant_id,
                    ${canonicalNameSql(legacyPriceNameSql)} AS canonical_key,
                    MAX(${legacyPriceCategorySql}) AS category,
                    MAX(${cleanTextSql('pr.plu')}) AS plu,
                    MAX(CASE WHEN COALESCE(pr.price, 0) > 0 THEN pr.price ELSE 0 END) AS current_price
                FROM \`${OPERATIONAL_DB_NAME}\`.prices pr
                WHERE ${cleanTextSql(legacyPriceNameSql)} IS NOT NULL
                GROUP BY pr.\`${TENANT_COLUMN}\`, ${canonicalNameSql(legacyPriceNameSql)}
             ) src
               ON src.tenant_id = p.\`${TENANT_COLUMN}\`
              AND src.canonical_key = p.canonical_key
             SET
                p.category = COALESCE(NULLIF(p.category, ''), src.category),
                p.plu = COALESCE(NULLIF(p.plu, ''), src.plu),
                p.current_price = CASE
                    WHEN COALESCE(p.current_price, 0) > 0 THEN p.current_price
                    WHEN COALESCE(src.current_price, 0) > 0 THEN src.current_price
                    ELSE p.current_price
                END`
        );
    } catch (e) {
        console.warn('[DB] catalog repair (prices→products) omitido:', e?.message || e);
    }

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.stock s
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = s.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> s.branch_id
          AND p.canonical_key = ${canonicalNameSql('s.name')}
         SET s.product_id = p.id
         WHERE s.product_id IS NULL
           AND ${cleanTextSql('s.name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = pi.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> pi.branch_id
          AND p.canonical_key = ${canonicalNameSql('pi.name')}
         SET pi.product_id = p.id
         WHERE pi.product_id IS NULL
           AND ${cleanTextSql('pi.name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.ventas_items vi
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = vi.\`${TENANT_COLUMN}\`
          AND p.branch_id <=> vi.branch_id
          AND p.canonical_key = ${canonicalNameSql('vi.product_name')}
         SET vi.product_id = p.id
         WHERE vi.product_id IS NULL
           AND ${cleanTextSql('vi.product_name')} IS NOT NULL
           AND ${nonGenericScaleTicketSql('vi.product_name')}`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.compras_items ci
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = ci.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('ci.product_name')}
         SET ci.product_id = p.id
         WHERE ci.product_id IS NULL
           AND ${cleanTextSql('ci.product_name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.menu_digital md
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = md.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('md.product_name')}
         SET md.product_id = p.id
         WHERE md.product_id IS NULL
           AND ${cleanTextSql('md.product_name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE IGNORE \`${OPERATIONAL_DB_NAME}\`.prices pr
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = pr.\`${TENANT_COLUMN}\`
          AND (
                (pr.product_ref_id IS NOT NULL AND pr.product_ref_id = p.id)
                OR p.canonical_key = ${canonicalNameSql(legacyPriceNameSql)}
                OR (NULLIF(TRIM(COALESCE(pr.plu, '')), '') IS NOT NULL AND NULLIF(TRIM(COALESCE(pr.plu, '')), '') = NULLIF(TRIM(COALESCE(p.plu, '')), ''))
             )
         SET
            pr.product_ref_id = p.id,
            pr.product_id = ${canonicalPriceProductIdSql},
            pr.price = CASE WHEN COALESCE(p.current_price, 0) > 0 THEN p.current_price ELSE pr.price END,
            pr.plu = COALESCE(NULLIF(p.plu, ''), pr.plu),
            pr.updated_at = COALESCE(pr.updated_at, NOW())
         WHERE ${cleanTextSql('p.name')} IS NOT NULL`
    );

    await conn.query(
        `INSERT IGNORE INTO \`${OPERATIONAL_DB_NAME}\`.prices
            (\`${TENANT_COLUMN}\`, product_ref_id, product_id, price, plu, updated_at)
         SELECT
            p.\`${TENANT_COLUMN}\`,
            p.id,
            ${canonicalPriceProductIdSql},
            p.current_price,
            p.plu,
            NOW()
         FROM \`${OPERATIONAL_DB_NAME}\`.products p
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.prices pr
           ON pr.\`${TENANT_COLUMN}\` = p.\`${TENANT_COLUMN}\`
          AND pr.product_ref_id = p.id
         WHERE pr.id IS NULL`
    );

    await conn.query(
        `DELETE legacy
         FROM \`${OPERATIONAL_DB_NAME}\`.prices legacy
         JOIN \`${OPERATIONAL_DB_NAME}\`.prices newest
           ON newest.\`${TENANT_COLUMN}\` = legacy.\`${TENANT_COLUMN}\`
          AND newest.product_ref_id = legacy.product_ref_id
          AND newest.id > legacy.id
         WHERE legacy.product_ref_id IS NOT NULL`
    );

    // ── Dual-write: sincronizar product_prices con el estado canónico ────────
    // Inserta una nueva entrada en product_prices por cada producto cuyo
    // current_price difiere del último registro registrado en product_prices.
    // Esto construye el historial progresivamente sin tocar filas antiguas.
    await conn.query(
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.product_prices
            (\`${TENANT_COLUMN}\`, branch_id, product_id, price, plu, source, effective_at, created_at)
         SELECT
            p.\`${TENANT_COLUMN}\`,
            p.branch_id,
            p.id,
            COALESCE(p.current_price, 0),
            NULLIF(TRIM(COALESCE(p.plu, '')), ''),
            'reconcile',
            NOW(),
            NOW()
         FROM \`${OPERATIONAL_DB_NAME}\`.products p
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.product_prices latest
           ON latest.id = (
               SELECT id FROM \`${OPERATIONAL_DB_NAME}\`.product_prices pp2
               WHERE pp2.\`${TENANT_COLUMN}\` = p.\`${TENANT_COLUMN}\`
                 AND pp2.product_id = p.id
               ORDER BY pp2.effective_at DESC, pp2.id DESC
               LIMIT 1
           )
         WHERE COALESCE(p.current_price, 0) > 0
           AND p.branch_id IS NOT NULL
           AND (latest.product_id IS NULL
                OR ABS(COALESCE(latest.price, 0) - COALESCE(p.current_price, 0)) > 0.009)`
    );

    const productRefTables = [
        ['stock', 'product_id'],
        ['purchase_items', 'product_id'],
        ['ventas_items', 'product_id'],
        ['compras_items', 'product_id'],
        ['menu_digital', 'product_id'],
        ['prices', 'product_ref_id'],
    ];

    for (const [tableName, columnName] of productRefTables) {
        await conn.query(
            `UPDATE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\` child
             LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.products p
               ON p.\`${TENANT_COLUMN}\` = child.\`${TENANT_COLUMN}\`
              AND p.id = child.\`${columnName}\`
             SET child.\`${columnName}\` = NULL
             WHERE child.\`${columnName}\` IS NOT NULL
               AND p.id IS NULL`
        );
    }
}

async function ensureProductCategoriesIntegrity(conn) {
    const codeExpr = (expr) => `LOWER(TRIM(BOTH '_' FROM REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${expr}, ''), ' ', '_'), '-', '_'), '/', '_'), '__', '_')))`;
    const textExpr = (expr) => `NULLIF(TRIM(COALESCE(${expr}, '')), '')`;

    await conn.query(
        `CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.product_categories (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            code        VARCHAR(100) NOT NULL,
            name        VARCHAR(120) NOT NULL,
            active      TINYINT(1) DEFAULT 1,
            synced      TINYINT(1) DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_categories_tenant_id (\`${TENANT_COLUMN}\`, id),
            UNIQUE KEY uniq_product_categories_tenant_code (\`${TENANT_COLUMN}\`, code),
            INDEX idx_product_categories_tenant (\`${TENANT_COLUMN}\`)
        )`
    );

    await conn.query(
        `INSERT IGNORE INTO \`${OPERATIONAL_DB_NAME}\`.product_categories
            (\`${TENANT_COLUMN}\`, code, name, active, synced, created_at, updated_at)
         SELECT
            dedup.tenant_id,
            dedup.code,
            dedup.name,
            1,
            0,
            NOW(),
            NOW()
         FROM (
            SELECT
                src.tenant_id,
                src.code,
                MAX(src.name) AS name
            FROM (
                SELECT p.\`${TENANT_COLUMN}\` AS tenant_id, ${codeExpr('p.category')} AS code, ${textExpr('p.category')} AS name
                FROM \`${OPERATIONAL_DB_NAME}\`.products p
                WHERE ${textExpr('p.category')} IS NOT NULL
                UNION ALL
                SELECT s.\`${TENANT_COLUMN}\` AS tenant_id, ${codeExpr('s.type')} AS code, ${textExpr('s.type')} AS name
                FROM \`${OPERATIONAL_DB_NAME}\`.stock s
                WHERE ${textExpr('s.type')} IS NOT NULL
                UNION ALL
                SELECT pi.\`${TENANT_COLUMN}\` AS tenant_id, ${codeExpr('pi.type')} AS code, ${textExpr('pi.type')} AS name
                FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
                WHERE ${textExpr('pi.type')} IS NOT NULL
                UNION ALL
                SELECT pi.\`${TENANT_COLUMN}\` AS tenant_id, ${codeExpr('pi.species')} AS code, ${textExpr('pi.species')} AS name
                FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
                WHERE ${textExpr('pi.species')} IS NOT NULL
            ) src
            WHERE src.code IS NOT NULL
              AND src.code <> ''
              AND src.name IS NOT NULL
            GROUP BY src.tenant_id, src.code
         ) dedup
         LEFT JOIN \`${OPERATIONAL_DB_NAME}\`.product_categories pc
           ON pc.\`${TENANT_COLUMN}\` = dedup.tenant_id
          AND pc.code = dedup.code
         WHERE pc.id IS NULL`
    );

    const [tenantRows] = await conn.query(
        `SELECT DISTINCT \`${TENANT_COLUMN}\` AS tenant_id
         FROM (
            SELECT \`${TENANT_COLUMN}\` FROM \`${OPERATIONAL_DB_NAME}\`.products
            UNION ALL
            SELECT \`${TENANT_COLUMN}\` FROM \`${OPERATIONAL_DB_NAME}\`.stock
            UNION ALL
            SELECT \`${TENANT_COLUMN}\` FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items
         ) t`
    );
    const defaultCategories = [
        ['vaca', 'Vaca'],
        ['cerdo', 'Cerdo'],
        ['pollo', 'Pollo'],
        ['pescado', 'Pescado'],
        ['pre_elaborados', 'Pre-elaborados'],
        ['almacen', 'Almacen'],
        ['limpieza', 'Limpieza'],
        ['bebidas', 'Bebidas'],
        ['insumo', 'Insumo General'],
        ['otros', 'Otros'],
    ];
    for (const row of tenantRows) {
        const tenantId = Number(row?.tenant_id);
        if (!Number.isFinite(tenantId) || tenantId <= 0) continue;
        for (const [code, name] of defaultCategories) {
            await conn.query(
                `INSERT IGNORE INTO \`${OPERATIONAL_DB_NAME}\`.product_categories
                    (\`${TENANT_COLUMN}\`, code, name, active, synced, created_at, updated_at)
                 VALUES (?, ?, ?, 1, 0, NOW(), NOW())`,
                [tenantId, code, name]
            );
        }
    }

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
         JOIN \`${OPERATIONAL_DB_NAME}\`.product_categories pc
           ON pc.\`${TENANT_COLUMN}\` = p.\`${TENANT_COLUMN}\`
          AND pc.code = ${codeExpr('p.category')}
         SET p.category_id = pc.id
         WHERE p.category_id IS NULL
           AND ${textExpr('p.category')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
         JOIN \`${OPERATIONAL_DB_NAME}\`.product_categories pc
           ON pc.\`${TENANT_COLUMN}\` = p.\`${TENANT_COLUMN}\`
          AND pc.id = p.category_id
         SET p.category = pc.code`
    );
}

async function ensureTenantScopedForeignKeys(conn) {
    const fkDefinitions = [
        {
            table: 'categories',
            constraint: 'categories_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.categories
                ADD CONSTRAINT categories_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, parent_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.categories (\`${TENANT_COLUMN}\`, id)
                ON DELETE SET NULL`,
            indexName: 'idx_categories_tenant_parent',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.categories
                ADD INDEX idx_categories_tenant_parent (\`${TENANT_COLUMN}\`, parent_id)`,
        },
        {
            table: 'purchase_items',
            constraint: 'purchase_items_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.purchase_items
                ADD CONSTRAINT purchase_items_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, category_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.categories (\`${TENANT_COLUMN}\`, id)
                ON DELETE SET NULL`,
            indexName: 'idx_purchase_items_tenant_category',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.purchase_items
                ADD INDEX idx_purchase_items_tenant_category (\`${TENANT_COLUMN}\`, category_id)`,
        },
        {
            table: 'ventas',
            constraint: 'ventas_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas
                ADD CONSTRAINT ventas_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, client_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.clients (\`${TENANT_COLUMN}\`, id)
                ON DELETE SET NULL`,
            indexName: 'idx_ventas_tenant_client',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas
                ADD INDEX idx_ventas_tenant_client (\`${TENANT_COLUMN}\`, client_id)`,
        },
        {
            table: 'ventas_items',
            constraint: 'ventas_items_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas_items
                ADD CONSTRAINT ventas_items_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, venta_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.ventas (\`${TENANT_COLUMN}\`, id)
                ON DELETE CASCADE`,
            indexName: 'idx_ventas_items_tenant_venta',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas_items
                ADD INDEX idx_ventas_items_tenant_venta (\`${TENANT_COLUMN}\`, venta_id)`,
        },
        {
            table: 'compras_items',
            constraint: 'compras_items_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.compras_items
                ADD CONSTRAINT compras_items_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, purchase_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.compras (\`${TENANT_COLUMN}\`, id)
                ON DELETE CASCADE`,
            indexName: 'idx_compras_items_tenant_purchase',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.compras_items
                ADD INDEX idx_compras_items_tenant_purchase (\`${TENANT_COLUMN}\`, purchase_id)`,
        },
        {
            table: 'user_permissions',
            constraint: 'user_permissions_ibfk_1',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.user_permissions
                ADD CONSTRAINT user_permissions_ibfk_1
                FOREIGN KEY (\`${TENANT_COLUMN}\`, user_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.users (\`${TENANT_COLUMN}\`, id)
                ON DELETE CASCADE`,
            indexName: 'idx_user_permissions_tenant_user',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.user_permissions
                ADD INDEX idx_user_permissions_tenant_user (\`${TENANT_COLUMN}\`, user_id)`,
        },
        {
            table: 'purchase_items',
            constraint: 'purchase_items_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.purchase_items
                ADD CONSTRAINT purchase_items_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_purchase_items_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.purchase_items
                ADD INDEX idx_purchase_items_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
        {
            table: 'products',
            constraint: 'products_category_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                ADD CONSTRAINT products_category_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, category_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.product_categories (\`${TENANT_COLUMN}\`, id)
                ON DELETE SET NULL`,
            indexName: 'idx_products_tenant_category',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                ADD INDEX idx_products_tenant_category (\`${TENANT_COLUMN}\`, category_id)`,
        },
        {
            table: 'stock',
            constraint: 'stock_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.stock
                ADD CONSTRAINT stock_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_stock_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.stock
                ADD INDEX idx_stock_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
        {
            table: 'ventas_items',
            constraint: 'ventas_items_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas_items
                ADD CONSTRAINT ventas_items_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_ventas_items_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.ventas_items
                ADD INDEX idx_ventas_items_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
        {
            table: 'compras_items',
            constraint: 'compras_items_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.compras_items
                ADD CONSTRAINT compras_items_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_compras_items_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.compras_items
                ADD INDEX idx_compras_items_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
        {
            table: 'menu_digital',
            constraint: 'menu_digital_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.menu_digital
                ADD CONSTRAINT menu_digital_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_menu_digital_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.menu_digital
                ADD INDEX idx_menu_digital_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
        {
            table: 'prices',
            constraint: 'prices_product_ref_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.prices
                ADD CONSTRAINT prices_product_ref_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_ref_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'uniq_prices_tenant_product_ref',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.prices
                ADD UNIQUE KEY uniq_prices_tenant_product_ref (\`${TENANT_COLUMN}\`, product_ref_id)`,
        },
        {
            table: 'product_prices',
            constraint: 'product_prices_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.product_prices
                ADD CONSTRAINT product_prices_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE RESTRICT`,
            indexName: 'idx_pp_tenant_product_eff',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.product_prices
                ADD INDEX idx_pp_tenant_product_eff (\`${TENANT_COLUMN}\`, product_id, effective_at)`,
        },
        {
            table: 'promotions',
            constraint: 'promotions_product_fk',
            addSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.promotions
                ADD CONSTRAINT promotions_product_fk
                FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES \`${OPERATIONAL_DB_NAME}\`.products (\`${TENANT_COLUMN}\`, id)
                ON DELETE CASCADE`,
            indexName: 'idx_promotions_tenant_product',
            indexSql: `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.promotions
                ADD INDEX idx_promotions_tenant_product (\`${TENANT_COLUMN}\`, product_id)`,
        },
    ];

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products
         SET plu = NULL
         WHERE plu IS NOT NULL
           AND TRIM(CAST(plu AS CHAR)) = ''`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products
         SET archived_plu = COALESCE(archived_plu, plu),
             plu = NULL
         WHERE COALESCE(active, 1) = 0
           AND plu IS NOT NULL`
    );

    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'products', 'uniq_products_tenant_branch_plu'))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                 ADD UNIQUE KEY uniq_products_tenant_branch_plu (\`${TENANT_COLUMN}\`, branch_id, plu)`
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                console.warn('[DB] No se pudo crear uniq_products_tenant_branch_plu porque existen PLU duplicados por sucursal. Limpialos y reiniciá la API.');
            } else if (error?.code !== 'ER_DUP_KEYNAME') {
                throw error;
            }
        }
    }

    for (const definition of fkDefinitions) {
        if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, definition.table, definition.indexName))) {
            try {
                await conn.query(definition.indexSql);
            } catch (error) {
                if (error?.code !== 'ER_DUP_KEYNAME') {
                    throw error;
                }
            }
        }
        if (!(await hasForeignKey(conn, OPERATIONAL_DB_NAME, definition.table, definition.constraint))) {
            try {
                await conn.query(definition.addSql);
            } catch (error) {
                if (!['ER_CANT_CREATE_TABLE', 'ER_DUP_KEYNAME', 'ER_CANNOT_ADD_FOREIGN'].includes(error?.code)) {
                    throw error;
                }
            }
        }
    }

    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'promotions', 'uniq_promotions_tenant_promo_plu'))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.promotions
                 ADD UNIQUE KEY uniq_promotions_tenant_promo_plu (\`${TENANT_COLUMN}\`, promo_plu)`
            );
        } catch (error) {
            if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY', 'ER_CANT_CREATE_TABLE'].includes(error?.code)) {
                throw error;
            }
        }
    }
}

function parseJsonMaybe(value) {
    if (!value) return null;
    if (Array.isArray(value) || typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch {
        return null;
    }
}

function currentAccountAmountFromStoredSale(row) {
    const breakdown = parseJsonMaybe(row?.payment_breakdown);
    if (Array.isArray(breakdown) && breakdown.length > 0) {
        return breakdown.reduce((sum, part) => {
            const methodName = String(part?.method_name || part?.name || '').trim().toLowerCase();
            const methodType = String(part?.method_type || part?.type || '').trim().toLowerCase();
            if (methodType !== 'cuenta_corriente' && methodName !== 'cuenta corriente') return sum;
            return sum + (Number(part?.amount_charged ?? part?.amount ?? part?.total) || 0);
        }, 0);
    }

    return String(row?.payment_method || '').trim().toLowerCase() === 'cuenta corriente'
        ? (Number(row?.total) || 0)
        : 0;
}

async function reconcileClientCurrentAccountBalances(conn) {
    const [clientRows] = await conn.query(
        `SELECT \`${TENANT_COLUMN}\`, id, balance
         FROM \`${OPERATIONAL_DB_NAME}\`.clients
         WHERE COALESCE(has_current_account, 1) = 1
           AND COALESCE(has_initial_balance, 0) = 0`
    );
    if (!clientRows.length) return;

    const balances = new Map(clientRows.map((client) => [
        `${client[TENANT_COLUMN]}:${client.id}`,
        {
            tenantId: client[TENANT_COLUMN],
            clientId: client.id,
            storedBalance: Number(client.balance || 0),
            calculatedBalance: 0,
        },
    ]));

    const [saleRows] = await conn.query(
        `SELECT \`${TENANT_COLUMN}\`, id, clientId, total, payment_method, payment_breakdown
         FROM \`${OPERATIONAL_DB_NAME}\`.ventas
         WHERE clientId IS NOT NULL`
    );
    for (const sale of saleRows) {
        const key = `${sale[TENANT_COLUMN]}:${sale.clientId}`;
        const bucket = balances.get(key);
        if (!bucket) continue;
        bucket.calculatedBalance -= currentAccountAmountFromStoredSale(sale);
    }

    const [paymentRows] = await conn.query(
        `SELECT \`${TENANT_COLUMN}\`, client_id, amount
         FROM \`${OPERATIONAL_DB_NAME}\`.caja_movimientos
         WHERE client_id IS NOT NULL
           AND (
                money_flow_kind = 'customer_payment'
                OR (
                    type = 'ingreso'
                    AND category = 'Cobro Pendientes'
                )
           )`
    );
    for (const payment of paymentRows) {
        const key = `${payment[TENANT_COLUMN]}:${payment.client_id}`;
        const bucket = balances.get(key);
        if (!bucket) continue;
        bucket.calculatedBalance += Number(payment.amount || 0);
    }

    let updatedCount = 0;
    for (const entry of balances.values()) {
        const nextBalance = Math.round(entry.calculatedBalance * 100) / 100;
        if (Math.abs(nextBalance - entry.storedBalance) <= 0.009) continue;
        await conn.query(
            `UPDATE \`${OPERATIONAL_DB_NAME}\`.clients
             SET balance = ?,
                 last_updated = NOW()
             WHERE \`${TENANT_COLUMN}\` = ?
               AND id = ?
               AND COALESCE(has_initial_balance, 0) = 0`,
            [nextBalance, entry.tenantId, entry.clientId]
        );
        updatedCount += 1;
    }

    if (updatedCount > 0) {
        console.warn(`[DB] Reconciliados ${updatedCount} saldos de cuenta corriente sin saldo inicial manual.`);
    }
}

async function ensureOperationalTenantIsolation() {
    const adminConn = await provisionPool.getConnection();
    try {
        await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_PROVISION_USER,
            password: process.env.DB_PROVISION_PASS,
            database: OPERATIONAL_DB_NAME,
        });
        try {
            for (const sql of getSchemaTables()) {
                await conn.query(sql);
            }

            await ensureColumn(conn, 'purchase_items', 'default_iva_rate', '`default_iva_rate` DECIMAL(5,2) NULL DEFAULT 10.50 AFTER `usage`');
            await ensureColumn(conn, 'purchase_items', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'purchase_items', 'product_id', '`product_id` INT NULL AFTER `name`');
            await ensureColumn(conn, 'purchase_items', 'use_for_despostada', '`use_for_despostada` TINYINT(1) NOT NULL DEFAULT 0 AFTER `type`');
            await ensureColumn(conn, 'purchase_items', 'is_preelaborable', '`is_preelaborable` TINYINT(1) NULL DEFAULT 0 AFTER `type`');
            await ensureColumn(conn, 'products', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'products', 'category_id', '`category_id` INT NULL AFTER `name`');
            await ensureColumn(conn, 'products', 'use_for_despostada', '`use_for_despostada` TINYINT(1) NOT NULL DEFAULT 0 AFTER `unit`');
            await ensureColumn(conn, 'products', 'despostada_species', '`despostada_species` VARCHAR(30) NULL AFTER `use_for_despostada`');
            await ensureColumn(conn, 'products', 'active', '`active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `plu`');
            await ensureColumn(conn, 'products', 'deleted_at', '`deleted_at` DATETIME NULL AFTER `active`');
            await ensureColumn(conn, 'products', 'archived_plu', '`archived_plu` VARCHAR(20) NULL AFTER `deleted_at`');
            await dropIndexIfExists(conn, 'products', 'uniq_products_tenant_canonical');
            await dropIndexIfExists(conn, 'products', 'uniq_products_tenant_plu');
            await ensureIndex(conn, 'products', 'idx_products_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureIndex(conn, 'purchase_items', 'idx_purchase_items_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'products', 'uniq_products_tenant_branch_canonical'))) {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                     ADD UNIQUE KEY uniq_products_tenant_branch_canonical (\`${TENANT_COLUMN}\`, branch_id, canonical_key)`
                );
            }
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'products', 'uniq_products_tenant_branch_plu'))) {
                try {
                    await conn.query(
                        `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                         ADD UNIQUE KEY uniq_products_tenant_branch_plu (\`${TENANT_COLUMN}\`, branch_id, plu)`
                    );
                } catch (error) {
                    if (error?.code === 'ER_DUP_ENTRY') {
                        console.warn('[DB] No se pudo crear uniq_products_tenant_branch_plu porque existen PLU duplicados por sucursal.');
                    } else if (error?.code !== 'ER_DUP_KEYNAME') {
                        throw error;
                    }
                }
            }
            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.branch_product_prices (
                    id              INT AUTO_INCREMENT PRIMARY KEY,
                    \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
                    branch_id       INT NOT NULL,
                    product_id      INT NOT NULL,
                    price           DECIMAL(12,2) NOT NULL DEFAULT 0,
                    plu             VARCHAR(20),
                    source          VARCHAR(50),
                    effective_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_branch_product_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
                    UNIQUE KEY uniq_branch_product_price (\`${TENANT_COLUMN}\`, branch_id, product_id),
                    INDEX idx_bpp_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
                    INDEX idx_bpp_tenant_product (\`${TENANT_COLUMN}\`, product_id)
                )
            `);
            await ensureColumn(conn, 'stock', 'product_id', '`product_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'stock', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'animal_lots', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'animal_lots', 'idx_animal_lots_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'clients', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'clients', 'idx_clients_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'suppliers', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'suppliers', 'idx_suppliers_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'ventas_items', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'ventas_items', 'idx_ventas_items_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'compras', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'compras', 'idx_compras_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'compras_items', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'compras_items', 'idx_compras_items_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'despostada_logs', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'despostada_logs', 'idx_despostada_logs_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'menu_digital', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'menu_digital', 'idx_menu_digital_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await ensureColumn(conn, 'supplier_item_tax_profiles', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'supplier_item_tax_profiles', 'idx_sitp_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await dropIndexIfExists(conn, 'supplier_item_tax_profiles', 'uniq_sitp_tenant_supplier_product');
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'supplier_item_tax_profiles', 'uniq_sitp_tenant_branch_supplier_product'))) {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.supplier_item_tax_profiles
                     ADD UNIQUE KEY uniq_sitp_tenant_branch_supplier_product (\`${TENANT_COLUMN}\`, branch_id, supplier_name(100), product_name(100))`
                );
            }
            await ensureColumn(conn, 'stock', 'usage', '`usage` VARCHAR(50) NULL AFTER `type`');
            await ensureColumn(conn, 'stock', 'barcode', '`barcode` VARCHAR(64) NULL AFTER `reference`');
            await ensureColumn(conn, 'stock', 'presentation', '`presentation` VARCHAR(50) NULL AFTER `barcode`');
            await ensureColumn(conn, 'compras', 'payment_method', '`payment_method` VARCHAR(100) NULL AFTER `total`');
            await ensureColumn(conn, 'compras', 'is_account', '`is_account` TINYINT(1) NULL DEFAULT 0 AFTER `payment_method`');
            await ensureColumn(conn, 'compras', 'items_detail', '`items_detail` JSON NULL AFTER `is_account`');
            await ensureColumn(conn, 'ventas_items', 'product_id', '`product_id` INT NULL AFTER `venta_id`');
            await ensureColumn(conn, 'compras_items', 'product_id', '`product_id` INT NULL AFTER `purchase_id`');
            await ensureColumn(conn, 'menu_digital', 'product_id', '`product_id` INT NULL AFTER `tenant_id`');
            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.scale_users (
                    id              INT AUTO_INCREMENT PRIMARY KEY,
                    \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
                    branch_id       INT NULL,
                    slot_no         TINYINT UNSIGNED NOT NULL,
                    display_name    VARCHAR(100) NOT NULL,
                    active          TINYINT(1) DEFAULT 1,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_scale_users_tenant_branch_slot (\`${TENANT_COLUMN}\`, branch_id, slot_no),
                    UNIQUE KEY uniq_scale_users_tenant_id (\`${TENANT_COLUMN}\`, id),
                    INDEX idx_scale_users_tenant (\`${TENANT_COLUMN}\`),
                    INDEX idx_scale_users_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
                )
            `);
            await ensureColumn(conn, 'scale_users', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureIndex(conn, 'scale_users', 'idx_scale_users_tenant_branch', `\`${TENANT_COLUMN}\`, branch_id`);
            await dropIndexIfExists(conn, 'scale_users', 'uniq_scale_users_tenant_slot');
            await dropIndexIfExists(conn, 'scale_users', 'ux_scale_users_tenant_slot');
            try {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_users
                     ADD UNIQUE KEY uniq_scale_users_tenant_branch_slot (\`${TENANT_COLUMN}\`, branch_id, slot_no)`
                );
            } catch (error) {
                if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error?.code)) throw error;
            }

            // ── Bridge sync state tables (antes creadas por el propio bridge) ──
            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.scale_bridge_product_map (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    device_id VARCHAR(64) NOT NULL,
                    tenant_id BIGINT NOT NULL,
                    product_id BIGINT NOT NULL,
                    plu_code VARCHAR(16) NOT NULL,
                    fingerprint VARCHAR(128) NOT NULL,
                    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY ux_scale_product_map (device_id, tenant_id, product_id),
                    KEY ix_scale_product_plu (device_id, plu_code)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.scale_bridge_sales_item (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    device_id VARCHAR(64) NOT NULL,
                    tenant_id BIGINT NOT NULL,
                    branch_id BIGINT NULL,
                    ticket_id VARCHAR(32) NOT NULL,
                    ticket_barcode VARCHAR(64) NULL,
                    printed_ticket_barcode VARCHAR(32) NULL,
                    line_no INT NOT NULL,
                    sale_at DATETIME NOT NULL,
                    vendor_code VARCHAR(8) NOT NULL,
                    vendor_name VARCHAR(100) NULL,
                    plu_code VARCHAR(16) NOT NULL,
                    sector_code VARCHAR(8) NOT NULL,
                    units INT NOT NULL DEFAULT 0,
                    grams INT NOT NULL DEFAULT 0,
                    drained_grams INT NOT NULL DEFAULT 0,
                    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    ticket_total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    ticket_item_count INT NOT NULL DEFAULT 0,
                    item_quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
                    item_quantity_unit VARCHAR(8) NOT NULL DEFAULT 'un',
                    raw_payload JSON NULL,
                    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY ux_scale_sale_line_at (device_id, ticket_id, line_no, sale_at),
                    KEY ix_scale_sale_date (device_id, sale_at),
                    KEY ix_scale_sale_tenant (tenant_id, branch_id, sale_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.scale_bridge_ticket_map (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    device_id VARCHAR(64) NOT NULL,
                    tenant_id BIGINT NOT NULL,
                    branch_id BIGINT NULL,
                    scale_address INT NULL,
                    ticket_id VARCHAR(32) NOT NULL,
                    ticket_barcode VARCHAR(64) NOT NULL,
                    printed_ticket_barcode VARCHAR(32) NULL,
                    vendor_code VARCHAR(16) NULL,
                    vendor_name VARCHAR(100) NULL,
                    sale_at DATETIME NOT NULL,
                    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    item_count INT NOT NULL DEFAULT 0,
                    ticket_status VARCHAR(16) NOT NULL DEFAULT 'open',
                    charged_sale_id BIGINT NULL,
                    charged_at DATETIME NULL,
                    voided_sale_id BIGINT NULL,
                    voided_at DATETIME NULL,
                    fingerprint VARCHAR(128) NOT NULL,
                    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY ux_scale_ticket_device_at (device_id, ticket_id, sale_at),
                    UNIQUE KEY ux_scale_ticket_barcode (ticket_barcode),
                    KEY ix_scale_ticket_addr (tenant_id, scale_address, sale_at),
                    KEY ix_scale_ticket_tenant_date (tenant_id, branch_id, sale_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Identidad de tickets de balanza: la numeracion de tickets se REINICIA
            // cuando la balanza hace cierre de ventas (fn32) — observado en prod
            // (el 09/06 la numeracion volvio a 000000001 tras el cierre nocturno).
            // Con UNIQUE(device, ticket) sin instante, el upsert de un ticket
            // re-numerado PISA al anterior (incluidos ya cobrados). Y con el cierre
            // tras cada lectura la numeracion se reinicia varias veces por dia, asi
            // que la identidad correcta es (device, ticket, sale_at). Agregamos la
            // clave nueva ANTES de soltar la vieja para no dejar ventana sin unicidad.
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'scale_bridge_ticket_map', 'ux_scale_ticket_device_at'))) {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_bridge_ticket_map
                     ADD UNIQUE KEY ux_scale_ticket_device_at (device_id, ticket_id, sale_at)`
                );
            }
            await dropIndexIfExists(conn, 'scale_bridge_ticket_map', 'ux_scale_ticket_device');
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'ux_scale_sale_line_at'))) {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_bridge_sales_item
                     ADD UNIQUE KEY ux_scale_sale_line_at (device_id, ticket_id, line_no, sale_at)`
                );
            }
            await dropIndexIfExists(conn, 'scale_bridge_sales_item', 'ux_scale_sale_line');

            // Registro PERMANENTE de tickets de balanza (append-only). A diferencia
            // de scale_bridge_ticket_map / scale_bridge_sales_item (tablas OPERATIVAS
            // que cambian de estado y que _clean_bridge_tables.js borra por completo),
            // esta tabla es el archivo historico que alimenta la solapa "Detalle de
            // Ventas": se escribe una vez cuando llega el ticket y NO se borra nunca.
            // Guarda el ticket CONGELADO (cabecera + renglones con nombre de producto
            // ya resuelto) para poder reimprimirlo identico aunque despues cambie el
            // catalogo o se vacie la balanza. Es lo que permite activar el vaciado de
            // la balanza (fn32) sin perder el reporte del dia.
            await conn.query(`
                CREATE TABLE IF NOT EXISTS \`${OPERATIONAL_DB_NAME}\`.scale_sales_log (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    tenant_id BIGINT NOT NULL,
                    branch_id BIGINT NULL,
                    device_id VARCHAR(64) NOT NULL,
                    scale_address INT NULL,
                    ticket_id VARCHAR(32) NOT NULL,
                    ticket_barcode VARCHAR(64) NOT NULL,
                    printed_ticket_barcode VARCHAR(32) NULL,
                    vendor_code VARCHAR(16) NULL,
                    vendor_name VARCHAR(100) NULL,
                    sale_at DATETIME NOT NULL,
                    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    item_count INT NOT NULL DEFAULT 0,
                    lines_json JSON NOT NULL,
                    header_json JSON NULL,
                    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY ux_sales_log_ticket (device_id, ticket_id, sale_at),
                    KEY ix_sales_log_barcode (tenant_id, ticket_barcode),
                    KEY ix_sales_log_branch_date (tenant_id, branch_id, sale_at),
                    KEY ix_sales_log_printed (tenant_id, printed_ticket_barcode)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // La tabla DEBE compartir collation con las tablas operativas
            // (scale_bridge_ticket_map usa utf8mb4_unicode_ci) para poder JOINear por
            // ticket_barcode sin "Illegal mix of collations". Si una version anterior
            // la creo con la collation por defecto del server (general_ci), la
            // normalizamos una unica vez (tabla chica, datos ASCII → ALTER instantaneo).
            const [salesLogCollRows] = await conn.query(
                `SELECT collation_name AS coll FROM information_schema.columns
                 WHERE table_schema = ? AND table_name = 'scale_sales_log' AND column_name = 'ticket_barcode'`,
                [OPERATIONAL_DB_NAME]
            );
            const salesLogColl = salesLogCollRows?.[0]?.coll || '';
            if (salesLogColl && salesLogColl !== 'utf8mb4_unicode_ci') {
                await conn.query(
                    `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_sales_log
                     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
                );
            }

            // La identidad del ticket en el archivo debe ser la FISICA
            // (device_id, ticket_id, sale_at) — la misma que usa la tabla operativa —
            // NO el ticket_barcode. El barcode incluye el fingerprint del contenido, asi
            // que un ticket leido en dos etapas (parcial y luego completo) generaba DOS
            // filas = doble conteo en el reporte. Migramos: colapsamos duplicados
            // (conservando el mas completo) y cambiamos la unique key a la identidad
            // fisica, para quedar 1:1 con la operativa. Corre una sola vez.
            if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'scale_sales_log', 'ux_sales_log_ticket'))) {
                await conn.query(`
                    DELETE s1 FROM \`${OPERATIONAL_DB_NAME}\`.scale_sales_log s1
                    JOIN \`${OPERATIONAL_DB_NAME}\`.scale_sales_log s2
                      ON s1.device_id = s2.device_id
                     AND s1.ticket_id = s2.ticket_id
                     AND s1.sale_at   = s2.sale_at
                     AND (s1.item_count < s2.item_count
                          OR (s1.item_count = s2.item_count AND s1.id < s2.id))
                `);
                await conn.query(`
                    ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_sales_log
                    ADD UNIQUE KEY ux_sales_log_ticket (device_id, ticket_id, sale_at)
                `);
                if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'scale_sales_log', 'ix_sales_log_barcode'))) {
                    await conn.query(`
                        ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.scale_sales_log
                        ADD KEY ix_sales_log_barcode (tenant_id, ticket_barcode)
                    `);
                }
                await dropIndexIfExists(conn, 'scale_sales_log', 'ux_sales_log_barcode');
            }

            await ensureColumn(conn, 'prices', 'product_ref_id', '`product_ref_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'prices', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'product_prices', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'branch_stock_snapshots', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'despostada_logs', 'processed_weight', '`processed_weight` DECIMAL(12,3) NULL AFTER `total_weight`');
            await ensureColumn(conn, 'despostada_logs', 'merma_weight', '`merma_weight` DECIMAL(12,3) NULL AFTER `yield_percentage`');
            await ensureColumn(conn, 'despostada_logs', 'merma_percentage', '`merma_percentage` DECIMAL(5,2) NULL AFTER `merma_weight`');
            await ensureColumn(conn, 'despostada_logs', 'purchase_id', '`purchase_id` INT NULL AFTER `lot_id`');
            await ensureColumn(conn, 'despostada_logs', 'lot_snapshot', '`lot_snapshot` JSON NULL AFTER `purchase_id`');
            await ensureColumn(conn, 'despostada_logs', 'cuts_count', '`cuts_count` INT NULL AFTER `lot_snapshot`');
            await ensureColumn(conn, 'despostada_logs', 'cuts', '`cuts` JSON NULL AFTER `cuts_count`');
            await ensureColumn(conn, 'despostada_logs', 'category_totals', '`category_totals` JSON NULL AFTER `cuts`');
            await ensureColumn(conn, 'despostada_logs', 'cost_per_kg', '`cost_per_kg` DECIMAL(12,2) NULL AFTER `category_totals`');
            await ensureColumn(conn, 'despostada_logs', 'estimated_total_cost', '`estimated_total_cost` DECIMAL(12,2) NULL AFTER `cost_per_kg`');
            await ensureColumn(conn, 'despostada_logs', 'estimated_cost_per_output_kg', '`estimated_cost_per_output_kg` DECIMAL(12,2) NULL AFTER `estimated_total_cost`');
            await ensureColumn(conn, 'despostada_logs', 'clean_output_weight', '`clean_output_weight` DECIMAL(12,3) NULL AFTER `estimated_cost_per_output_kg`');
            await ensureColumn(conn, 'despostada_logs', 'weighted_output_units', '`weighted_output_units` DECIMAL(12,3) NULL AFTER `clean_output_weight`');
            await ensureColumn(conn, 'despostada_logs', 'clean_average_cost_per_kg', '`clean_average_cost_per_kg` DECIMAL(12,2) NULL AFTER `weighted_output_units`');
            await ensureColumn(conn, 'despostada_logs', 'normalized_base_cost_per_kg', '`normalized_base_cost_per_kg` DECIMAL(12,2) NULL AFTER `clean_average_cost_per_kg`');
            await ensureColumn(conn, 'despostada_logs', 'pricing_margin_percentage', '`pricing_margin_percentage` DECIMAL(6,2) NULL AFTER `normalized_base_cost_per_kg`');
            await ensureColumn(conn, 'despostada_logs', 'pricing_normalization_factor', '`pricing_normalization_factor` DECIMAL(12,6) NULL AFTER `pricing_margin_percentage`');
            await ensureColumn(conn, 'despostada_logs', 'pricing_allocated_total', '`pricing_allocated_total` DECIMAL(12,2) NULL AFTER `pricing_normalization_factor`');
            await ensureColumn(conn, 'despostada_logs', 'pricing_validation_difference', '`pricing_validation_difference` DECIMAL(12,2) NULL AFTER `pricing_allocated_total`');
            await ensureColumn(conn, 'despostada_logs', 'pricing_summary', '`pricing_summary` JSON NULL AFTER `pricing_validation_difference`');
            await ensureColumn(conn, 'compras_items', 'iva_rate', '`iva_rate` DECIMAL(5,2) NULL DEFAULT 0 AFTER `subtotal`');
            await ensureColumn(conn, 'compras_items', 'iva_amount', '`iva_amount` DECIMAL(12,2) NULL DEFAULT 0 AFTER `iva_rate`');
            await ensureColumn(conn, 'compras_items', 'net_subtotal', '`net_subtotal` DECIMAL(12,2) NULL DEFAULT 0 AFTER `iva_amount`');
            await ensureColumn(conn, 'caja_movimientos', 'payment_method', '`payment_method` VARCHAR(100) NULL AFTER `description`');
            await ensureColumn(conn, 'caja_movimientos', 'payment_method_id', '`payment_method_id` INT NULL AFTER `payment_method`');
            await ensureColumn(conn, 'caja_movimientos', 'cash_account', '`cash_account` VARCHAR(30) NOT NULL DEFAULT \'principal\' AFTER `payment_method_id`');
            await ensureColumn(conn, 'caja_movimientos', 'transfer_group_id', '`transfer_group_id` VARCHAR(64) NULL AFTER `cash_account`');
            await ensureColumn(conn, 'caja_movimientos', 'client_id', '`client_id` INT NULL AFTER `date`');
            await ensureColumn(conn, 'caja_movimientos', 'supplier', '`supplier` VARCHAR(150) NULL AFTER `description`');
            await ensureColumn(conn, 'caja_movimientos', 'payment_method_type', '`payment_method_type` VARCHAR(50) NULL AFTER `payment_method`');
            await ensureColumn(conn, 'caja_movimientos', 'receipt_number', '`receipt_number` INT NULL AFTER `authorized_recipient_email`');
            await ensureColumn(conn, 'caja_movimientos', 'receipt_code', '`receipt_code` VARCHAR(32) NULL AFTER `receipt_number`');
            await ensureColumn(conn, 'caja_movimientos', 'purchase_id', '`purchase_id` INT NULL AFTER `authorization_verified`');
            await ensureColumn(conn, 'caja_movimientos', 'sale_id', '`sale_id` INT NULL AFTER `purchase_id`');
            await ensureColumn(conn, 'caja_movimientos', 'money_flow_kind', '`money_flow_kind` VARCHAR(50) NULL AFTER `sale_id`');
            await ensureColumn(conn, 'caja_movimientos', 'origin_table', '`origin_table` VARCHAR(64) NULL AFTER `money_flow_kind`');
            await ensureColumn(conn, 'caja_movimientos', 'origin_id', '`origin_id` BIGINT NULL AFTER `origin_table`');
            await ensureColumn(conn, 'caja_movimientos', 'origin_group_id', '`origin_group_id` VARCHAR(64) NULL AFTER `origin_id`');
            await ensureColumn(conn, 'caja_movimientos', 'created_by_user_id', '`created_by_user_id` BIGINT NULL AFTER `origin_group_id`');
            await ensureColumn(conn, 'caja_movimientos', 'created_by_username', '`created_by_username` VARCHAR(150) NULL AFTER `created_by_user_id`');
            await ensureColumn(conn, 'caja_movimientos', 'created_by_email', '`created_by_email` VARCHAR(150) NULL AFTER `created_by_username`');
            await ensureColumn(conn, 'clients', 'client_type', '`client_type` VARCHAR(20) NULL DEFAULT \'person\'');
            await ensureColumn(conn, 'clients', 'company_name', '`company_name` VARCHAR(191) NULL');
            await ensureColumn(conn, 'clients', 'contact_first_name', '`contact_first_name` VARCHAR(120) NULL');
            await ensureColumn(conn, 'clients', 'contact_last_name', '`contact_last_name` VARCHAR(120) NULL');
            await ensureColumn(conn, 'clients', 'dni_cuit', '`dni_cuit` VARCHAR(32) NULL');
            await ensureColumn(conn, 'clients', 'employee_discount_enabled', '`employee_discount_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `has_current_account`');
            await ensureColumn(conn, 'clients', 'employee_discount_pct', '`employee_discount_pct` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `employee_discount_enabled`');
            await ensureColumn(conn, 'clients', 'latitude', '`latitude` DECIMAL(10,7) NULL');
            await ensureColumn(conn, 'clients', 'longitude', '`longitude` DECIMAL(10,7) NULL');
            await ensureColumn(conn, 'clients', 'geocoded_at', '`geocoded_at` DATETIME NULL');
            await ensureColumn(conn, 'pedidos', 'latitude', '`latitude` DECIMAL(10,7) NULL');
            await ensureColumn(conn, 'pedidos', 'longitude', '`longitude` DECIMAL(10,7) NULL');
            await ensureColumn(conn, 'pedidos', 'geocoded_at', '`geocoded_at` DATETIME NULL');
            await ensureColumn(conn, 'pedidos', 'assigned_driver_uid', '`assigned_driver_uid` VARCHAR(191) NULL');
            await ensureColumn(conn, 'pedidos', 'assigned_driver_email', '`assigned_driver_email` VARCHAR(150) NULL');
            await ensureColumn(conn, 'pedidos', 'assigned_at', '`assigned_at` DATETIME NULL');
            await ensureColumn(conn, 'pedidos', 'status_updated_at', '`status_updated_at` DATETIME NULL');
            await ensureColumn(conn, 'pedidos', 'customer_phone', '`customer_phone` VARCHAR(50) NULL');
            await ensureColumn(conn, 'pedidos', 'payment_method', '`payment_method` VARCHAR(100) NULL');
            await ensureColumn(conn, 'pedidos', 'payment_status', '`payment_status` VARCHAR(100) NULL');
            await ensureColumn(conn, 'pedidos', 'paid', '`paid` TINYINT(1) NOT NULL DEFAULT 0');
            await ensureColumn(conn, 'pedidos', 'amount_due', '`amount_due` DECIMAL(12,2) NULL');
            await ensureColumn(conn, 'ventas', 'branch_id', '`branch_id` INT NULL AFTER `clientId`');
            await ensureColumn(conn, 'ventas', 'subtotal', '`subtotal` DECIMAL(12,2) NULL AFTER `total`');
            await ensureColumn(conn, 'ventas', 'adjustment', '`adjustment` DECIMAL(12,2) NULL DEFAULT 0 AFTER `subtotal`');
            await ensureColumn(conn, 'ventas', 'discount_client_id', '`discount_client_id` INT NULL AFTER `clientId`');
            await ensureColumn(conn, 'ventas', 'client_discount_pct', '`client_discount_pct` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `discount_client_id`');
            await ensureColumn(conn, 'ventas', 'client_discount_amount', '`client_discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `client_discount_pct`');
            await ensureColumn(conn, 'ventas_items', 'promo_id', '`promo_id` INT NULL AFTER `subtotal`');
            await ensureColumn(conn, 'ventas_items', 'promo_kg_applied', '`promo_kg_applied` DECIMAL(12,3) NULL AFTER `promo_id`');
            await ensureColumn(conn, 'ventas_items', 'promo_payload', '`promo_payload` JSON NULL AFTER `promo_kg_applied`');
            await ensureColumn(conn, 'promotions', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'promotions', 'promo_name', '`promo_name` VARCHAR(191) NULL AFTER `product_name`');
            await ensureColumn(conn, 'promotions', 'promo_plu', '`promo_plu` VARCHAR(32) NULL AFTER `promo_name`');
            await ensureColumn(conn, 'promotions', 'promo_unit_price', '`promo_unit_price` DECIMAL(12,2) NULL AFTER `promo_total_price`');
            await ensureColumn(conn, 'promotions', 'promo_price_mode', '`promo_price_mode` VARCHAR(20) NOT NULL DEFAULT \'total_kg\' AFTER `promo_total_price`');
            await ensureColumn(conn, 'promotions', 'stock_mode', '`stock_mode` VARCHAR(20) NOT NULL DEFAULT \'all_stock\' AFTER `promo_total_price`');
            await ensureColumn(conn, 'promotions', 'stock_cap_kg_limit', '`stock_cap_kg_limit` DECIMAL(12,3) NULL AFTER `stock_mode`');
            await ensureColumn(conn, 'promotions', 'end_condition', '`end_condition` VARCHAR(20) NOT NULL DEFAULT \'none\' AFTER `stock_cap_kg_limit`');
            await ensureColumn(conn, 'promotions', 'sold_kg_limit', '`sold_kg_limit` DECIMAL(12,3) NULL AFTER `end_condition`');
            await ensureColumn(conn, 'promotions', 'end_date', '`end_date` DATETIME NULL AFTER `sold_kg_limit`');
            await ensureColumn(conn, 'promotions', 'used_kg', '`used_kg` DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `end_date`');
            await ensureColumn(conn, 'branch_transfers', 'document_type', '`document_type` VARCHAR(30) NOT NULL DEFAULT \'remito\' AFTER `status`');
            await ensureColumn(conn, 'branch_transfers', 'document_code', '`document_code` VARCHAR(40) NULL AFTER `remito_code`');
            await ensureColumn(conn, 'caja_movimientos', 'branch_id', '`branch_id` INT NULL AFTER `client_id`');
            await ensureColumn(conn, 'pedidos', 'branch_id', '`branch_id` INT NULL AFTER `customer_id`');
            await ensureColumn(conn, 'cash_closures', 'branch_id', '`branch_id` INT NULL AFTER `closure_date`');
            await ensureColumn(conn, 'cash_closures', 'cash_account', "`cash_account` VARCHAR(20) NOT NULL DEFAULT 'principal' AFTER `branch_id`");
            await ensureColumn(conn, 'cash_closures', 'created_by_user_id', '`created_by_user_id` BIGINT NULL');
            await ensureColumn(conn, 'cash_closures', 'created_by_username', '`created_by_username` VARCHAR(150) NULL');
            await ensureColumn(conn, 'cash_closures', 'created_by_email', '`created_by_email` VARCHAR(150) NULL');
            await ensureColumn(conn, 'caja_movimientos', 'authorization_id', '`authorization_id` BIGINT NULL');
            await ensureColumn(conn, 'caja_movimientos', 'authorization_verified', '`authorization_verified` TINYINT(1) NOT NULL DEFAULT 0');
            await ensureColumn(conn, 'caja_movimientos', 'authorized_recipient_email', '`authorized_recipient_email` VARCHAR(150) NULL');
            await ensureColumnType(conn, 'prices', 'product_id', '`product_id` VARCHAR(191) NULL', ['varchar']);
            await ensureIndex(
                conn,
                'caja_movimientos',
                'idx_caja_summary',
                '`tenant_id`, `branch_id`, `cash_account`, `payment_method`, `date`'
            );
            await ensureIndex(conn, 'prices', 'idx_prices_tenant_branch', '`tenant_id`, `branch_id`');
            await ensureIndex(conn, 'product_prices', 'idx_pp_tenant_branch', '`tenant_id`, `branch_id`');
            await ensureIndex(conn, 'branch_stock_snapshots', 'idx_bss_tenant_branch', '`tenant_id`, `branch_id`');

            if (BOOTSTRAP_BRANCH_INFERENCE_ENABLED) {
                await conn.query(
                    `UPDATE prices pr
                     JOIN products p
                       ON p.tenant_id = pr.tenant_id
                      AND p.id = pr.product_ref_id
                     SET pr.branch_id = p.branch_id
                     WHERE pr.branch_id IS NULL
                       AND p.branch_id IS NOT NULL`
                );
                await conn.query(
                    `UPDATE product_prices pp
                     JOIN products p
                       ON p.tenant_id = pp.tenant_id
                      AND p.id = pp.product_id
                     SET pp.branch_id = p.branch_id
                     WHERE pp.branch_id IS NULL
                       AND p.branch_id IS NOT NULL`
                );

                await conn.query(
                    `UPDATE ventas
                     SET branch_id = CAST(SUBSTRING_INDEX(receipt_code, '-', 1) AS UNSIGNED)
                     WHERE branch_id IS NULL
                       AND receipt_code REGEXP '^[0-9]{4}-'`
                );
                await conn.query(
                    `UPDATE caja_movimientos
                     SET branch_id = CAST(SUBSTRING_INDEX(receipt_code, '-', 1) AS UNSIGNED)
                     WHERE branch_id IS NULL
                       AND receipt_code REGEXP '^[0-9]{4}-'`
                );
                await conn.query(
                    `UPDATE ventas_items vi
                     JOIN ventas v
                       ON v.\`${TENANT_COLUMN}\` = vi.\`${TENANT_COLUMN}\`
                      AND v.id = vi.venta_id
                     SET vi.branch_id = v.branch_id
                     WHERE vi.branch_id IS NULL
                       AND v.branch_id IS NOT NULL`
                );
                await conn.query(
                    `UPDATE compras_items ci
                     JOIN compras c
                       ON c.\`${TENANT_COLUMN}\` = ci.\`${TENANT_COLUMN}\`
                      AND c.id = ci.purchase_id
                     SET ci.branch_id = c.branch_id
                     WHERE ci.branch_id IS NULL
                       AND c.branch_id IS NOT NULL`
                );
                await conn.query(
                    `UPDATE despostada_logs dl
                     JOIN animal_lots al
                       ON al.\`${TENANT_COLUMN}\` = dl.\`${TENANT_COLUMN}\`
                      AND al.id = dl.lot_id
                     SET dl.branch_id = al.branch_id
                     WHERE dl.branch_id IS NULL
                       AND al.branch_id IS NOT NULL`
                );
                await conn.query(
                    `UPDATE clients c
                     JOIN (
                        SELECT \`${TENANT_COLUMN}\`, client_id, MIN(branch_id) AS branch_id, COUNT(DISTINCT branch_id) AS branch_count
                        FROM ventas
                        WHERE client_id IS NOT NULL AND branch_id IS NOT NULL
                        GROUP BY \`${TENANT_COLUMN}\`, client_id
                     ) src
                       ON src.\`${TENANT_COLUMN}\` = c.\`${TENANT_COLUMN}\`
                      AND src.client_id = c.id
                     SET c.branch_id = src.branch_id
                     WHERE c.branch_id IS NULL
                       AND src.branch_count = 1`
                );
                await conn.query(
                    `UPDATE suppliers s
                     JOIN (
                        SELECT \`${TENANT_COLUMN}\`, LOWER(TRIM(supplier)) AS supplier_key, MIN(branch_id) AS branch_id, COUNT(DISTINCT branch_id) AS branch_count
                        FROM compras
                        WHERE supplier IS NOT NULL AND TRIM(supplier) <> '' AND branch_id IS NOT NULL
                        GROUP BY \`${TENANT_COLUMN}\`, LOWER(TRIM(supplier))
                     ) src
                       ON src.\`${TENANT_COLUMN}\` = s.\`${TENANT_COLUMN}\`
                      AND src.supplier_key = LOWER(TRIM(s.name))
                     SET s.branch_id = src.branch_id
                     WHERE s.branch_id IS NULL
                       AND src.branch_count = 1`
                );
            } else {
                console.warn('[DB] Inferencia automatica de sucursal desactivada (BOOTSTRAP_BRANCH_INFERENCE_ENABLED=false).');
            }

            if (BOOTSTRAP_DATA_REPAIRS_ENABLED) {
                // Normalize prices.product_id: lowercase + spaces to underscores (one-time migration)
                await conn.query(
                    `UPDATE prices SET product_id = LOWER(REPLACE(product_id, ' ', '_'))
                     WHERE product_id REGEXP '[A-Z ]'`
                );

                await conn.query(
                    `UPDATE branch_transfers
                     SET document_type = 'remito'
                     WHERE document_type IS NULL OR TRIM(document_type) = ''`
                );
                await conn.query(
                    `UPDATE branch_transfers
                     SET document_code = CONCAT('R-', remito_code)
                     WHERE (document_code IS NULL OR TRIM(document_code) = '')
                       AND remito_code IS NOT NULL
                       AND TRIM(remito_code) <> ''`
                );
            } else {
                console.warn('[DB] Reparaciones automaticas de datos desactivadas (BOOTSTRAP_DATA_REPAIRS_ENABLED=false). Solo se aplica esquema.');
            }

            for (const tableName of TENANT_ID_TABLES) {
                await ensureTenantIdColumn(conn, tableName);
            }

            if (BOOTSTRAP_DATA_REPAIRS_ENABLED) {
                for (const tableName of TENANT_ID_TABLES) {
                    await backfillTenantId(conn, tableName);
                }
            }

            const fksToDrop = [
                ['categories', 'categories_ibfk_1'],
                ['purchase_items', 'purchase_items_ibfk_1'],
                ['ventas', 'ventas_ibfk_1'],
                ['ventas_items', 'ventas_items_ibfk_1'],
                ['compras_items', 'compras_items_ibfk_1'],
                ['user_permissions', 'user_permissions_ibfk_1'],
            ];

            for (const [tableName, constraintName] of fksToDrop) {
                if (await hasForeignKey(conn, OPERATIONAL_DB_NAME, tableName, constraintName)) {
                    try {
                        await conn.query(
                            `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.\`${tableName}\`
                             DROP FOREIGN KEY \`${constraintName}\``
                        );
                    } catch (error) {
                        if (error?.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
                            throw error;
                        }
                    }
                }
            }

            await ensureSettingsPrimaryKey(conn);
            await ensureSettingsBranchId(conn);
            for (const tableName of TABLES_WITH_NUMERIC_ID) {
                await ensureCompositePrimaryKey(conn, tableName);
            }

            if (BOOTSTRAP_DATA_REPAIRS_ENABLED) {
                await ensureProductCategoriesIntegrity(conn);
                await ensureProductCatalogIntegrity(conn);
                await reconcileClientCurrentAccountBalances(conn);
            }
            await ensureTenantScopedForeignKeys(conn);
        } finally {
            await conn.end();
        }
    } finally {
        adminConn.release();
    }
}

const ERROR_LOG_SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'authorization', 'cookie', 'secret'];

function redactErrorLogMetadata(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactErrorLogMetadata(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        ERROR_LOG_SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))
            ? '[redacted]'
            : redactErrorLogMetadata(item),
    ]));
}

function serializeErrorLogMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    try {
        return JSON.stringify(redactErrorLogMetadata(metadata)).slice(0, 20000);
    } catch {
        return null;
    }
}

async function pruneOldAppErrorLogs(conn, force = false) {
    const now = Date.now();
    if (!force && now - lastErrorLogPruneAt < 60 * 60 * 1000) {
        return;
    }
    lastErrorLogPruneAt = now;
    await conn.query(
        `DELETE FROM \`${CLIENTS_DB_NAME}\`.app_error_logs
         WHERE created_at < DATE_SUB(NOW(), INTERVAL ${ERROR_LOG_RETENTION_DAYS} DAY)`
    );
}

function getErrorLogSnapshot(accessContext) {
    return {
        clientId: accessContext?.client?.id || null,
        clientBusinessName: accessContext?.client?.businessName || null,
        clientTaxId: accessContext?.client?.taxId || null,
        clientBillingEmail: accessContext?.client?.billingEmail || null,
        userId: Number.isFinite(Number(accessContext?.user?.id)) ? Number(accessContext.user.id) : null,
        userEmail: accessContext?.user?.email || null,
        branchId: accessContext?.user?.branchId == null ? null : Number(accessContext.user.branchId),
        branchName: accessContext?.user?.branchName || null,
    };
}

async function createAppErrorLog({ req, accessContext, source = 'backend', message, stack = null, statusCode = null, metadata = null }) {
    const conn = await clientsControlPool.getConnection();
    try {
        const snapshot = getErrorLogSnapshot(accessContext);
        await conn.query(
            `INSERT INTO \`${CLIENTS_DB_NAME}\`.app_error_logs
             (source, level, client_id, client_business_name, client_tax_id, client_billing_email,
              user_id, user_email, branch_id, branch_name, method, path, status_code, message,
              stack, metadata, user_agent, ip_address)
             VALUES (?, 'error', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                source,
                snapshot.clientId,
                snapshot.clientBusinessName,
                snapshot.clientTaxId,
                snapshot.clientBillingEmail,
                snapshot.userId,
                snapshot.userEmail,
                snapshot.branchId,
                snapshot.branchName,
                req?.method || null,
                String(req?.body?.path || req?.originalUrl || req?.url || '').slice(0, 500) || null,
                statusCode == null ? null : Number(statusCode),
                String(message || 'Error desconocido').slice(0, 4000),
                stack ? String(stack).slice(0, 20000) : null,
                serializeErrorLogMetadata(metadata),
                String(req?.headers?.['user-agent'] || '').slice(0, 500) || null,
                String(req?.ip || '').slice(0, 45) || null,
            ]
        );
        await pruneOldAppErrorLogs(conn);
    } finally {
        conn.release();
    }
}

async function ensureClientsControlStore() {
    const conn = await clientsControlPool.getConnection();
    try {
        await conn.query(`
            CREATE DATABASE IF NOT EXISTS \`${CLIENTS_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${CLIENTS_DB_NAME}\`.auth_sync_queue (
                id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                entityType      VARCHAR(50) NOT NULL,
                entityId        BIGINT NOT NULL,
                action          VARCHAR(50) NOT NULL,
                payload         JSON NULL,
                status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                attempts        INT NOT NULL DEFAULT 0,
                lastError       TEXT NULL,
                createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_auth_sync_status (status, createdAt),
                INDEX idx_auth_sync_entity (entityType, entityId)
            )
        `);
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` (
                id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                userId          BIGINT NOT NULL,
                path            VARCHAR(255) NOT NULL,
                createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_client_user_permission (userId, path),
                INDEX idx_client_user_permissions_user (userId)
            )
        `);
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${CLIENTS_DB_NAME}\`.app_error_logs (
                id BIGINT NOT NULL AUTO_INCREMENT,
                source VARCHAR(30) NOT NULL DEFAULT 'backend',
                level VARCHAR(20) NOT NULL DEFAULT 'error',
                client_id INT NULL,
                client_business_name VARCHAR(255) NULL,
                client_tax_id VARCHAR(50) NULL,
                client_billing_email VARCHAR(150) NULL,
                user_id INT NULL,
                user_email VARCHAR(150) NULL,
                branch_id INT NULL,
                branch_name VARCHAR(150) NULL,
                method VARCHAR(10) NULL,
                path VARCHAR(500) NULL,
                status_code INT NULL,
                message TEXT NOT NULL,
                stack MEDIUMTEXT NULL,
                metadata JSON NULL,
                user_agent VARCHAR(500) NULL,
                ip_address VARCHAR(45) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_app_error_logs_client_created (client_id, created_at),
                KEY idx_app_error_logs_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pruneOldAppErrorLogs(conn, true);
        if (!(await hasColumn(conn, CLIENTS_DB_NAME, CLIENTS_TABLE, 'cashAuthorizationEmail'))) {
            await conn.query(`
                ALTER TABLE \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\`
                ADD COLUMN cashAuthorizationEmail VARCHAR(150) NULL AFTER billingEmail
            `);
        }
        await conn.query(`
            CREATE TABLE IF NOT EXISTS \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\` (
                id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
                tenantId            BIGINT NOT NULL,
                clientId            BIGINT NOT NULL,
                branchId            BIGINT NOT NULL,
                deviceId            VARCHAR(64) NOT NULL,
                deviceTokenHash     VARCHAR(128) NOT NULL,
                hostname            VARCHAR(255) NULL,
                status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                lastSeenAt          DATETIME NULL,
                createdAt           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updatedAt           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_bridge_devices_deviceId (deviceId),
                INDEX idx_bridge_devices_tenant_branch (tenantId, branchId),
                INDEX idx_bridge_devices_client (clientId),
                INDEX idx_bridge_devices_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } finally {
        conn.release();
    }
}

async function getUserPermissions(conn, userId) {
    if (!userId) return [];
    const [rows] = await conn.query(
        `SELECT path FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` WHERE userId = ? ORDER BY path ASC`,
        [userId]
    );
    return rows
        .map((row) => String(row.path || '').trim())
        .filter(Boolean);
}

function normalizeClientLicenseIds(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(
        new Set(
            value
                .map((licenseId) => Number(licenseId))
                .filter((licenseId) => Number.isInteger(licenseId) && licenseId > 0)
        )
    );
}

async function getClientLicensePool(conn, clientId) {
    const [licenseRows] = await conn.query(
        `SELECT
            cl.id AS clientLicenseId,
            cl.clientId,
            cl.licenseId,
            cl.branchId,
            cl.userId,
            cl.status AS assignmentStatus,
            l.commercialName,
            l.internalCode,
            l.category,
            l.billingScope,
            l.isMandatory,
            l.featureFlags,
            l.status AS licenseStatus,
            l.appliesToWebapp,
            b.name AS branchName,
            u.name AS userName,
            u.lastname AS userLastname,
            u.email AS userEmail
         FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
         INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
            ON l.id = cl.licenseId
         LEFT JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\` b
            ON b.id = cl.branchId
         LEFT JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` u
            ON u.id = cl.userId
         WHERE cl.clientId = ?
           AND cl.status = 'ACTIVE'
           AND l.status = 'ACTIVE'
         ORDER BY cl.id ASC`,
        [clientId]
    );

    return licenseRows.map((license) => ({
        id: Number(license.clientLicenseId),
        clientId: Number(license.clientId),
        licenseId: Number(license.licenseId),
        userId: license.userId == null ? null : Number(license.userId),
        branchId: license.branchId == null ? null : Number(license.branchId),
        status: license.assignmentStatus,
        user: license.userId == null ? null : {
            id: Number(license.userId),
            name: license.userName || '',
            lastname: license.userLastname || '',
            email: license.userEmail || '',
        },
        branch: license.branchId == null ? null : {
            id: Number(license.branchId),
            name: license.branchName || '',
        },
        license: {
            id: Number(license.licenseId),
            commercialName: license.commercialName,
            internalCode: license.internalCode,
            category: license.category,
            billingScope: license.billingScope,
            appliesToWebapp: licenseAppliesToWebapp(license),
            featureFlags: parseFeatureFlags(license.featureFlags),
            hasLogisticsCapability: licenseHasLogisticsCapability(license),
        },
    }));
}

async function getAssignablePerUserLicenseRows(conn, clientId, userId, clientLicenseIds = []) {
    const normalizedIds = normalizeClientLicenseIds(clientLicenseIds);
    if (normalizedIds.length === 0) return [];

    const placeholders = normalizedIds.map(() => '?').join(', ');
    const [rows] = await conn.query(
        `SELECT
            cl.id AS clientLicenseId,
            cl.clientId,
            cl.userId,
            cl.status AS assignmentStatus,
            l.id AS licenseId,
            l.commercialName,
            l.internalCode,
            l.category,
            l.billingScope,
            l.featureFlags,
            l.status AS licenseStatus
         FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
         INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
            ON l.id = cl.licenseId
         WHERE cl.clientId = ?
           AND cl.id IN (${placeholders})`,
        [clientId, ...normalizedIds]
    );

    if (rows.length !== normalizedIds.length) {
        const error = new Error('Una o más licencias seleccionadas no pertenecen al cliente');
        error.statusCode = 400;
        throw error;
    }

    for (const license of rows) {
        if (!isActiveStatus(license.assignmentStatus, false) || !isActiveStatus(license.licenseStatus, false)) {
            const error = new Error(`La licencia "${license.commercialName}" no está activa`);
            error.statusCode = 400;
            throw error;
        }
        if (String(license.billingScope || '').trim() !== 'per_user') {
            const error = new Error(`La licencia "${license.commercialName}" no puede asignarse por usuario`);
            error.statusCode = 400;
            throw error;
        }
        if (license.userId != null && String(license.userId) !== String(userId)) {
            const error = new Error(`La licencia "${license.commercialName}" ya está asignada a otro usuario`);
            error.statusCode = 400;
            throw error;
        }
    }

    return rows;
}

async function syncClientUserPerUserLicenses(conn, { clientId, userId, clientLicenseIds = [] }) {
    const normalizedIds = normalizeClientLicenseIds(clientLicenseIds);
    const assignableRows = await getAssignablePerUserLicenseRows(conn, clientId, userId, normalizedIds);

    await conn.beginTransaction();
    try {
        if (normalizedIds.length > 0) {
            const releasePlaceholders = normalizedIds.map(() => '?').join(', ');
            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
                 INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                    ON l.id = cl.licenseId
                 SET cl.userId = NULL,
                     cl.branchId = NULL
                 WHERE cl.clientId = ?
                   AND cl.userId = ?
                   AND l.billingScope = 'per_user'
                   AND cl.id NOT IN (${releasePlaceholders})`,
                [clientId, userId, ...normalizedIds]
            );
        } else {
            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
                 INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                    ON l.id = cl.licenseId
                 SET cl.userId = NULL,
                     cl.branchId = NULL
                 WHERE cl.clientId = ?
                   AND cl.userId = ?
                   AND l.billingScope = 'per_user'`,
                [clientId, userId]
            );
        }

        if (assignableRows.length > 0) {
            const assignPlaceholders = assignableRows.map(() => '?').join(', ');
            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\`
                 SET userId = ?, branchId = NULL
                 WHERE clientId = ?
                   AND id IN (${assignPlaceholders})`,
                [userId, clientId, ...assignableRows.map((license) => Number(license.clientLicenseId))]
            );
        }

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    }

    return assignableRows.map((license) => ({
        clientLicenseId: Number(license.clientLicenseId),
        licenseId: Number(license.licenseId),
        commercialName: license.commercialName,
        internalCode: license.internalCode,
        category: license.category,
        billingScope: license.billingScope,
        hasLogisticsCapability: licenseHasLogisticsCapability(license),
    }));
}

async function enqueueAuthSync(conn, entityId, action, payload = null) {
    await conn.query(
        `INSERT INTO \`${CLIENTS_DB_NAME}\`.auth_sync_queue (entityType, entityId, action, payload) VALUES ('client_user', ?, ?, ?)`,
        [entityId, action, payload ? JSON.stringify(payload) : null]
    );
}

async function getClientAccessContext({ uid, email }) {
    const normalizedEmail = normalizeEmail(email);
    const conn = await clientsControlPool.getConnection();
    try {
        const internalAdmin = arguments[0]?._internalAdmin || null;
        const supportClientId = Number(arguments[0]?._supportClientId || 0);

        if (internalAdmin) {
            if (!Number.isFinite(supportClientId) || supportClientId <= 0) {
                const error = new Error('Seleccioná un tenant para operar como SuperAdmin');
                error.statusCode = 400;
                throw error;
            }

            const [clientRows] = await conn.query(
                `SELECT
                    c.id AS clientId,
                    c.businessName,
                    c.taxId,
                    c.billingEmail,
                    c.cashAuthorizationEmail,
                    c.status AS clientStatus
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                 WHERE c.id = ?
                 LIMIT 1`,
                [supportClientId]
            );

            const client = clientRows[0] || null;
            if (!client) {
                const error = new Error('Tenant no encontrado');
                error.statusCode = 404;
                throw error;
            }

            const [licenseRows] = await conn.query(
                `SELECT
                    cl.id AS clientLicenseId,
                    cl.clientId,
                    cl.licenseId,
                    cl.branchId,
                    cl.userId,
                    cl.status AS assignmentStatus,
                    l.commercialName,
                    l.internalCode,
                    l.category,
                    l.billingScope,
                    l.isMandatory,
                    l.featureFlags,
                    l.status AS licenseStatus,
                    l.appliesToWebapp
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
                 INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                    ON l.id = cl.licenseId
                 WHERE cl.clientId = ?
                   AND cl.status = 'ACTIVE'
                   AND l.status = 'ACTIVE'`,
                [client.id]
            );

            const mapResolvedLicense = (license) => ({
                clientLicenseId: license.clientLicenseId,
                licenseId: license.licenseId,
                commercialName: license.commercialName,
                internalCode: license.internalCode,
                category: license.category,
                billingScope: license.billingScope,
                assignedUserId: license.userId ?? null,
                assignedBranchId: license.branchId ?? null,
                appliesToWebapp: licenseAppliesToWebapp(license),
                featureFlags: parseFeatureFlags(license.featureFlags),
            });

            const effectiveLicenses = licenseRows
                .filter((license) => licenseAppliesToWebapp(license))
                .map(mapResolvedLicense)
                .filter((license, index, arr) => (
                    arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
                ));

            const deliveryLicenses = licenseRows
                .filter((license) => licenseHasLogisticsCapability(license))
                .map(mapResolvedLicense)
                .filter((license, index, arr) => (
                    arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
                ));

            return {
                user: {
                    id: `support-${internalAdmin.id}`,
                    clientId: client.clientId,
                    branchId: null,
                    firebaseUid: null,
                    name: internalAdmin.name || 'DEF',
                    lastname: internalAdmin.lastname || 'SuperAdmin',
                    email: internalAdmin.email,
                    role: 'admin',
                    userStatus: 'ACTIVE',
                    isSynced: 1,
                    lastLogin: null,
                    businessName: client.businessName,
                    taxId: client.taxId,
                    billingEmail: client.billingEmail,
                    cashAuthorizationEmail: client.cashAuthorizationEmail,
                    clientStatus: client.clientStatus,
                    isGlobalSuperAdmin: true,
                    supportAdminId: internalAdmin.id,
                },
                client: {
                    id: client.clientId,
                    businessName: client.businessName,
                    taxId: client.taxId,
                    cashAuthorizationEmail: client.cashAuthorizationEmail,
                    billingEmail: client.billingEmail,
                    status: client.clientStatus,
                    tenantHasBaseLicense: tenantHasPurchasedBaseWebappLicense(licenseRows),
                    tenantHasDeliveryLicense: tenantHasPurchasedLogisticsLicense(licenseRows),
                },
                effectiveLicenses,
                deliveryLicenses,
            };
        }

        const [rows] = await conn.query(
            `SELECT
                cu.id,
                cu.clientId,
                cu.branchId,
                cu.firebaseUid,
                cu.name,
                cu.lastname,
                cu.email,
                cu.role,
                cu.status AS userStatus,
                cu.isSynced,
                cu.lastLogin,
                c.businessName,
                c.taxId,
                c.billingEmail,
                c.cashAuthorizationEmail,
                c.status AS clientStatus,
                b.id AS branchRecordId,
                b.name AS branchName,
                b.internalCode AS branchInternalCode,
                b.address AS branchAddress,
                b.status AS branchStatus
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` cu
             INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                ON c.id = cu.clientId
             LEFT JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\` b
                ON b.id = cu.branchId
               AND b.clientId = cu.clientId
             WHERE (cu.firebaseUid = ? OR LOWER(cu.email) = ?)
             ORDER BY CASE WHEN cu.firebaseUid = ? THEN 0 ELSE 1 END, cu.id ASC
             LIMIT 1`,
            [uid || null, normalizedEmail, uid || null]
        );

        let user = rows[0] || null;

        // Si el usuario encontrado tiene el mismo email que el billingEmail del cliente
        // (es decir, es el dueño), lo tratamos como admin aunque esté en client_users
        // con otro rol. Esto evita que dueños creados como operadores pierdan acceso.
        if (user && normalizedEmail && normalizeEmail(user.billingEmail) === normalizedEmail) {
            user.isOwnerFallback = true;
            user.role = 'admin';
            user.name = user.businessName || user.name || normalizedEmail;
            user.lastname = '';
            user.branchId = null;
            user.branchRecordId = null;
        }

        if (!user) {
            let ownerClient = null;

            if (normalizedEmail) {
                const [ownerRows] = await conn.query(
                    `SELECT
                        c.id AS clientId,
                        c.businessName,
                        c.taxId,
                        c.billingEmail,
                        c.cashAuthorizationEmail,
                        c.status AS clientStatus
                     FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                     WHERE LOWER(c.billingEmail) = ?
                     LIMIT 1`,
                    [normalizedEmail]
                );
                ownerClient = ownerRows[0] || null;
            }

            if (!ownerClient && uid) {
                const ownerDoc = await admin.firestore().collection('clientes').doc(uid).get();
                const ownerData = ownerDoc.exists ? ownerDoc.data() || {} : {};
                const ownerTaxId = String(ownerData.cuit || '').trim();
                const ownerBusinessName = String(ownerData.empresa || '').trim();

                if (ownerTaxId) {
                    const [ownerRowsByTaxId] = await conn.query(
                        `SELECT
                            c.id AS clientId,
                            c.businessName,
                            c.taxId,
                            c.billingEmail,
                            c.cashAuthorizationEmail,
                            c.status AS clientStatus
                         FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                         WHERE c.taxId = ?
                         LIMIT 1`,
                        [ownerTaxId]
                    );
                    ownerClient = ownerRowsByTaxId[0] || null;
                }

                if (!ownerClient && ownerBusinessName) {
                    const [ownerRowsByName] = await conn.query(
                        `SELECT
                            c.id AS clientId,
                            c.businessName,
                            c.taxId,
                            c.billingEmail,
                            c.cashAuthorizationEmail,
                            c.status AS clientStatus
                         FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                         WHERE LOWER(c.businessName) = LOWER(?)
                         LIMIT 1`,
                        [ownerBusinessName]
                    );
                    ownerClient = ownerRowsByName[0] || null;
                }
            }

            if (ownerClient) {
                user = {
                    id: `owner-${ownerClient.clientId}`,
                    clientId: ownerClient.clientId,
                    branchId: null,
                    firebaseUid: uid || null,
                    name: ownerClient.businessName || normalizedEmail,
                    lastname: '',
                    email: normalizedEmail,
                    role: 'admin',
                    userStatus: 'ACTIVE',
                    isSynced: 1,
                    lastLogin: null,
                    businessName: ownerClient.businessName,
                    taxId: ownerClient.taxId,
                    billingEmail: ownerClient.billingEmail,
                    cashAuthorizationEmail: ownerClient.cashAuthorizationEmail,
                    clientStatus: ownerClient.clientStatus,
                    isOwnerFallback: true,
                };
            }
        }

        if (!user) return null;
        user.perms = user.isOwnerFallback ? [] : await getUserPermissions(conn, user.id);

        const [licenseRows] = await conn.query(
            `SELECT
                cl.id AS clientLicenseId,
                cl.clientId,
                cl.licenseId,
                cl.branchId,
                cl.userId,
                cl.status AS assignmentStatus,
                l.commercialName,
                l.internalCode,
                l.category,
                l.billingScope,
                l.isMandatory,
                l.featureFlags,
                l.status AS licenseStatus,
                l.appliesToWebapp
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
             INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                ON l.id = cl.licenseId
             WHERE cl.clientId = ?
               AND cl.status = 'ACTIVE'
               AND l.status = 'ACTIVE'`,
            [user.clientId]
        );

        const tenantHasBaseLicense = tenantHasPurchasedBaseWebappLicense(licenseRows);
        const tenantHasDeliveryLicense = tenantHasPurchasedLogisticsLicense(licenseRows);

        const licenseMatchesScope = (license) => {
            if (user.isOwnerFallback) {
                return true;
            }

            if (user.role === 'admin') {
                return true;
            }

            const billingScope = String(license.billingScope || '').trim();
            const matchesUser = billingScope === 'per_user'
                ? String(license.userId || '') === String(user.id)
                : (license.userId == null || String(license.userId) === String(user.id));
            const matchesBranch = billingScope === 'per_branch'
                ? (license.branchId == null || String(license.branchId) === String(user.branchId))
                : true;

            const isMandatoryBase = isBaseWebappLicense(license);

            return (matchesUser && matchesBranch) || isMandatoryBase;
        };

        const mapResolvedLicense = (license) => ({
            clientLicenseId: license.clientLicenseId,
            licenseId: license.licenseId,
            commercialName: license.commercialName,
            internalCode: license.internalCode,
            category: license.category,
            billingScope: license.billingScope,
            assignedUserId: license.userId ?? null,
            assignedBranchId: license.branchId ?? null,
            appliesToWebapp: licenseAppliesToWebapp(license),
            featureFlags: parseFeatureFlags(license.featureFlags),
        });

        const effectiveLicenses = licenseRows
            .filter((license) => {
                if (!licenseAppliesToWebapp(license)) return false;
                return licenseMatchesScope(license);
            })
            .map(mapResolvedLicense)
            .filter((license, index, arr) => (
                arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
            ));

        const deliveryLicenses = licenseRows
            .filter((license) => licenseHasLogisticsCapability(license) && licenseMatchesScope(license))
            .map(mapResolvedLicense)
            .filter((license, index, arr) => (
                arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
            ));

        return {
            user,
            client: {
                id: user.clientId,
                businessName: user.businessName,
                taxId: user.taxId,
                cashAuthorizationEmail: user.cashAuthorizationEmail,
                billingEmail: user.billingEmail,
                status: user.clientStatus,
                tenantHasBaseLicense,
                tenantHasDeliveryLicense,
            },
            effectiveLicenses,
            deliveryLicenses,
        };
    } finally {
        conn.release();
    }
}

function assertClientAccess(accessContext, options = {}) {
    if (!accessContext?.user) {
        const error = new Error('Usuario no encontrado en GestionClientes');
        error.statusCode = 404;
        throw error;
    }
    if (accessContext.user?.isGlobalSuperAdmin) {
        return;
    }
    if (!isActiveStatus(accessContext.client?.status, false)) {
        const error = new Error(`Cliente sin acceso (${accessContext.client?.status || 'SIN ESTADO'})`);
        error.statusCode = 403;
        throw error;
    }
    if (!isActiveStatus(accessContext.user?.userStatus, false)) {
        const error = new Error('Usuario inactivo');
        error.statusCode = 403;
        throw error;
    }
    // TEMPORARY: disabled strict base license check to allow login without assigned base license
    // if (!accessContext.client?.tenantHasBaseLicense) {
    //     const error = new Error('El tenant no tiene una licencia base de MeatManager activa');
    //     error.statusCode = 403;
    //     throw error;
    // }
    if (!accessContext.client?.taxId) {
        const error = new Error('El cliente no tiene CUIT configurado');
        error.statusCode = 403;
        throw error;
    }
}

function buildAccessResponse(accessContext) {
    const fullName = [accessContext.user?.name, accessContext.user?.lastname]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');

    return {
        id: accessContext.user.id,
        uid: accessContext.user.firebaseUid,
        email: accessContext.user.email,
        username: fullName || accessContext.user.email || 'Usuario',
        role: accessContext.user.role === 'admin' ? 'admin' : 'employee',
        isOwnerFallback: Boolean(accessContext.user.isOwnerFallback),
        isGlobalSuperAdmin: Boolean(accessContext.user.isGlobalSuperAdmin),
        active: isActiveStatus(accessContext.user.userStatus, false) ? 1 : 0,
        perms: Array.isArray(accessContext.user.perms) ? accessContext.user.perms : [],
        clientId: accessContext.client.id,
        clientStatus: accessContext.client.status,
        businessName: accessContext.client.businessName,
        branch: accessContext.user?.branchRecordId ? {
            id: accessContext.user.branchRecordId,
            name: accessContext.user.branchName || '',
            internalCode: accessContext.user.branchInternalCode || '',
            address: accessContext.user.branchAddress || '',
            status: accessContext.user.branchStatus || '',
        } : null,
        tenantHasBaseLicense: Boolean(accessContext.client.tenantHasBaseLicense),
        tenantHasDeliveryLicense: Boolean(accessContext.client.tenantHasDeliveryLicense),
        licenses: accessContext.effectiveLicenses,
    };
}

function buildScopedLicensesForUser(user, licenseRows = []) {
    const licenseMatchesScope = (license) => {
        if (user?.isOwnerFallback) {
            return true;
        }

        const billingScope = String(license.billingScope || '').trim();
        const matchesUser = billingScope === 'per_user'
            ? String(license.userId || '') === String(user?.id || '')
            : (license.userId == null || String(license.userId) === String(user?.id || ''));
        const matchesBranch = billingScope === 'per_branch'
            ? (license.branchId == null || String(license.branchId) === String(user?.branchId || ''))
            : true;

        return (matchesUser && matchesBranch) || isBaseWebappLicense(license);
    };

    const mapResolvedLicense = (license) => ({
        clientLicenseId: Number(license.clientLicenseId),
        licenseId: Number(license.licenseId),
        commercialName: license.commercialName,
        internalCode: license.internalCode,
        category: license.category,
        billingScope: license.billingScope,
        assignedUserId: license.userId ?? null,
        assignedBranchId: license.branchId ?? null,
        appliesToWebapp: licenseAppliesToWebapp(license),
        featureFlags: parseFeatureFlags(license.featureFlags),
        hasLogisticsCapability: licenseHasLogisticsCapability(license),
    });

    const dedupeByClientLicenseId = (license, index, arr) => (
        arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
    );

    const effectiveLicenses = licenseRows
        .filter((license) => licenseAppliesToWebapp(license) && licenseMatchesScope(license))
        .map(mapResolvedLicense)
        .filter(dedupeByClientLicenseId);

    const deliveryLicenses = licenseRows
        .filter((license) => licenseHasLogisticsCapability(license) && licenseMatchesScope(license))
        .map(mapResolvedLicense)
        .filter(dedupeByClientLicenseId);

    const assignedLicenses = licenseRows
        .filter((license) => String(license.userId || '') === String(user?.id || ''))
        .map(mapResolvedLicense)
        .filter(dedupeByClientLicenseId);

    return {
        effectiveLicenses,
        deliveryLicenses,
        assignedLicenses,
    };
}

async function listEligibleLogisticsDrivers(clientId) {
    const conn = await clientsControlPool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT
                cu.id,
                cu.clientId,
                cu.branchId,
                cu.firebaseUid,
                cu.name,
                cu.lastname,
                cu.email,
                cu.role,
                cu.status,
                b.name AS branchName,
                cl.id AS clientLicenseId,
                cl.licenseId,
                cl.branchId AS licenseBranchId,
                cl.userId,
                l.commercialName,
                l.internalCode,
                l.category,
                l.featureFlags
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` cu
             LEFT JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\` b
                ON b.id = cu.branchId
               AND b.clientId = cu.clientId
             INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
                ON cl.clientId = cu.clientId
               AND cl.userId = cu.id
               AND cl.status = 'ACTIVE'
             INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                ON l.id = cl.licenseId
               AND l.status = 'ACTIVE'
             WHERE cu.clientId = ?
               AND cu.status = 'ACTIVE'
             ORDER BY cu.name ASC, cu.lastname ASC, cu.id ASC`,
            [clientId]
        );

        const driversById = new Map();
        for (const row of rows) {
            if (!licenseHasLogisticsCapability(row)) continue;

            const existing = driversById.get(String(row.id)) || {
                id: row.id,
                clientId: row.clientId,
                branchId: row.branchId,
                branchName: row.branchName || '',
                firebaseUid: row.firebaseUid || null,
                email: normalizeEmail(row.email || ''),
                role: row.role === 'admin' ? 'admin' : 'employee',
                name: [row.name, row.lastname].map((value) => String(value || '').trim()).filter(Boolean).join(' ') || row.email || 'Repartidor',
                firstName: row.name || '',
                lastName: row.lastname || '',
                licenses: [],
            };

            existing.licenses.push({
                clientLicenseId: row.clientLicenseId,
                licenseId: row.licenseId,
                commercialName: row.commercialName,
                internalCode: row.internalCode,
                category: row.category,
                featureFlags: parseFeatureFlags(row.featureFlags),
            });
            driversById.set(String(row.id), existing);
        }

        return Array.from(driversById.values());
    } finally {
        conn.release();
    }
}

async function listClientBranches(clientId) {
    const conn = await clientsControlPool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT
                id,
                clientId,
                name,
                internalCode,
                address,
                isBillable,
                status
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             WHERE clientId = ?
               AND status = 'ACTIVE'
             ORDER BY id ASC`,
            [clientId]
        );

        return rows.map((row) => ({
            id: row.id,
            clientId: row.clientId,
            name: String(row.name || '').trim() || `Sucursal ${row.id}`,
            internalCode: row.internalCode || null,
            address: row.address || null,
            isBillable: row.isBillable === 1 || row.isBillable === true,
            status: row.status || 'ACTIVE',
        }));
    } finally {
        conn.release();
    }
}

async function listAllClientBranches(clientId) {
    const conn = await clientsControlPool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT id, clientId, name, internalCode, address, isBillable, status
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
             WHERE clientId = ?
             ORDER BY id ASC`,
            [clientId]
        );
        return rows.map((row) => ({
            id: row.id,
            clientId: row.clientId,
            name: String(row.name || '').trim() || `Sucursal ${row.id}`,
            internalCode: row.internalCode || null,
            address: row.address || null,
            isBillable: row.isBillable === 1 || row.isBillable === true,
            status: row.status || 'ACTIVE',
        }));
    } finally {
        conn.release();
    }
}

function hasMultipleActiveBranches(branches = []) {
    if (!Array.isArray(branches)) return false;
    return branches.filter((branch) => {
        const branchId = Number(branch?.id);
        return Number.isFinite(branchId) && branchId > 0;
    }).length > 1;
}

function buildBranchScopeClause({ column = 'branch_id', branchId, allowLegacyNullFallback = false } = {}) {
    const resolvedBranchId = Number(branchId);
    if (!Number.isFinite(resolvedBranchId) || resolvedBranchId <= 0) {
        return { sql: '', params: [] };
    }

    if (allowLegacyNullFallback) {
        return {
            sql: `(${column} = ? OR ${column} IS NULL)`,
            params: [resolvedBranchId],
        };
    }

    return {
        sql: `${column} = ?`,
        params: [resolvedBranchId],
    };
}

function warnBranchScopeFallback(event, payload = {}) {
    console.warn(`[BRANCH SCOPE] ${event}`, {
        strict: STRICT_BRANCH_SCOPING,
        ...payload,
    });
}

function getRequestedActiveBranchId(req) {
    const rawValue = req?.headers?.['x-mm-active-branch-id'] ?? req?.query?.activeBranchId ?? req?.body?.activeBranchId;
    const branchId = Number(rawValue);
    return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
}

async function resolveRequestedActiveBranch(accessContext, req) {
    const requestedBranchId = getRequestedActiveBranchId(req);
    if (!requestedBranchId || !accessContext?.client?.id) return null;

    const isAdmin = accessContext?.user?.role === 'admin' || Boolean(accessContext?.user?.isGlobalSuperAdmin);
    const userBranchId = Number(accessContext?.user?.branchRecordId ?? accessContext?.user?.branchId);
    if (Number.isFinite(userBranchId) && userBranchId > 0) {
        if (Number(userBranchId) === Number(requestedBranchId)) {
            return {
                id: userBranchId,
                name: accessContext?.user?.branchName || '',
                internalCode: accessContext?.user?.branchInternalCode || null,
                address: accessContext?.user?.branchAddress || null,
                status: accessContext?.user?.branchStatus || 'ACTIVE',
            };
        }
        // Usuarios no-admin solo pueden ver su sucursal asignada
        if (!isAdmin) return null;
        // Admins pueden cambiar de sucursal aunque tengan una asignada → buscar en lista
    }

    if (!isAdmin) return null;

    // Usa listAllClientBranches para incluir sucursales inactivas (ej: Fatima en setup)
    const branches = await listAllClientBranches(accessContext.client.id);
    return branches.find((branch) => Number(branch.id) === Number(requestedBranchId)) || null;
}

async function getTenantBranchCode(pool, tenantId) {
    const [rows] = await pool.query(
        'SELECT value FROM settings WHERE `tenant_id` = ? AND `key` = ? LIMIT 1',
        [tenantId, 'branch_code']
    );
    return normalizeBranchCodeValue(rows[0]?.value || null);
}

async function resolveClientBranchId(clientId, { branchId, branchCode, receiptCode } = {}) {
    const explicitBranchId = Number(branchId);
    if (Number.isFinite(explicitBranchId) && explicitBranchId > 0) {
        return explicitBranchId;
    }

    const candidateCode = normalizeBranchCodeValue(branchCode) || extractBranchCodeFromReceipt(receiptCode);
    if (!candidateCode) return null;

    const branches = await listClientBranches(clientId);
    const matchedBranch = branches.find((branch) => (
        Number(branch.id) === candidateCode
        || normalizeBranchCodeValue(branch.internalCode) === candidateCode
    ));

    return matchedBranch ? Number(matchedBranch.id) : null;
}

async function resolveOperationalBranchId({ pool, tenantId, accessContext, record }) {
    if (!accessContext?.client?.id) return null;

    // Si el usuario está atado a una sucursal, ese alcance manda sobre cualquier payload.
    const userBranchId = Number(accessContext?.user?.branchRecordId ?? accessContext?.user?.branchId);
    if (Number.isFinite(userBranchId) && userBranchId > 0) {
        return userBranchId;
    }

    const activeBranchId = Number(accessContext?.activeBranch?.id);
    if (Number.isFinite(activeBranchId) && activeBranchId > 0) {
        return activeBranchId;
    }

    const explicitBranchId = Number(record?.branch_id ?? record?.branchId ?? record?.activeBranchId);
    if (Number.isFinite(explicitBranchId) && explicitBranchId > 0) {
        return explicitBranchId;
    }

    const branchCodeFromRecord =
        record?.branch_code
        ?? record?.branchCode
        ?? extractBranchCodeFromReceipt(record?.receipt_code);

    const currentBranchCode =
        normalizeBranchCodeValue(branchCodeFromRecord)
        || await getTenantBranchCode(pool, tenantId);

    const resolvedByCode = await resolveClientBranchId(accessContext.client.id, {
        branchCode: currentBranchCode,
        receiptCode: record?.receipt_code,
    });
    if (Number.isFinite(resolvedByCode) && resolvedByCode > 0) {
        return resolvedByCode;
    }

    // Fallback seguro: tenant con una sola sucursal activa.
    const activeBranches = await listClientBranches(accessContext.client.id);
    if (activeBranches.length === 1) {
        const singleBranchId = Number(activeBranches[0]?.id);
        if (Number.isFinite(singleBranchId) && singleBranchId > 0) {
            return singleBranchId;
        }
    }

    // Último recurso: si el cliente tiene UNA sola sucursal en total (aunque
    // esté inactiva o todavía en setup), usarla. Evita bloquear el alta de
    // proveedores/clientes cuando la sucursal única no figura como ACTIVE.
    const allBranches = await listAllClientBranches(accessContext.client.id);
    if (allBranches.length === 1) {
        const onlyBranchId = Number(allBranches[0]?.id);
        if (Number.isFinite(onlyBranchId) && onlyBranchId > 0) {
            return onlyBranchId;
        }
    }

    return null;
}

async function assertAssignableUserBranch({ clientId, role, branchId }) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (normalizedRole !== 'employee') {
        return;
    }

    const clientBranches = await listClientBranches(clientId);
    const normalizedBranchId = Number(branchId);
    const hasAssignedBranch = Number.isFinite(normalizedBranchId) && normalizedBranchId > 0;

    if (clientBranches.length > 1 && !hasAssignedBranch) {
        const error = new Error('Este cliente tiene varias sucursales. Asignale una sucursal al usuario antes de guardar.');
        error.statusCode = 400;
        error.code = 'BRANCH_REQUIRED';
        throw error;
    }

    if (hasAssignedBranch && !clientBranches.some((branch) => Number(branch.id) === normalizedBranchId)) {
        const error = new Error('La sucursal elegida no pertenece a este cliente.');
        error.statusCode = 400;
        error.code = 'INVALID_BRANCH';
        throw error;
    }
}

function tenantWhereClause(table, tenantId, prefix = '') {
    if (!isTenantScopedTable(table)) {
        return { sql: '1 = 1', params: [] };
    }
    const scopedColumn = prefix ? `${prefix}.\`${TENANT_COLUMN}\`` : `\`${TENANT_COLUMN}\``;
    return {
        sql: `${scopedColumn} = ?`,
        params: [tenantId],
    };
}

async function syncClientUserToFirebase({ action, userId, email, password, username, active, firebaseUid }) {
    if (action === 'DISABLE') {
        if (firebaseUid) {
            await admin.auth().updateUser(firebaseUid, { disabled: true });
        }
        return { uid: firebaseUid || null };
    }

    if (action === 'DELETE') {
        if (firebaseUid) {
            await admin.auth().updateUser(firebaseUid, { disabled: true });
        }
        return { uid: firebaseUid || null };
    }

    if (action === 'CREATE') {
        const createdUser = await admin.auth().createUser({
            email: normalizeEmail(email),
            password: String(password),
            displayName: String(username || '').trim() || normalizeEmail(email),
            disabled: Number(active) !== 1,
        });
        return { uid: createdUser.uid };
    }

    const update = {
        email: normalizeEmail(email),
        displayName: String(username || '').trim() || normalizeEmail(email),
        disabled: Number(active) !== 1,
    };
    if (password) {
        update.password = String(password);
    }
    if (firebaseUid) {
        await admin.auth().updateUser(firebaseUid, update);
        return { uid: firebaseUid };
    }

    const createdUser = await admin.auth().createUser({
        ...update,
        password: String(password || Math.random().toString(36).slice(2) + 'Mm#2026'),
    });
    return { uid: createdUser.uid };
}

async function runClientUserSync(job) {
    const conn = await clientsControlPool.getConnection();
    try {
        const payload = job.payload && typeof job.payload === 'string'
            ? JSON.parse(job.payload)
            : (job.payload || {});

        const [userRows] = await conn.query(
            `SELECT * FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE id = ? LIMIT 1`,
            [job.entityId]
        );
        const user = userRows[0];
        if (!user) {
            throw new Error('Usuario de sincronización no encontrado');
        }

        const fullName = [payload.username || user.name, user.lastname]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' ');

        const result = await syncClientUserToFirebase({
            action: payload.action || job.action,
            userId: user.id,
            email: payload.email || user.email,
            password: payload.password,
            username: fullName,
            active: payload.active ?? (user.status === 'ACTIVE' ? 1 : 0),
            firebaseUid: user.firebaseUid,
        });

        const nextUid = result.uid || user.firebaseUid || null;
        const nextStatus = payload.active === 0 || payload.action === 'DISABLE' || payload.action === 'DELETE'
            ? 'INACTIVE'
            : user.status;

        await conn.query(
            `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
             SET firebaseUid = ?, isSynced = 1, status = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [nextUid, nextStatus, user.id]
        );
        await conn.query(
            `UPDATE \`${CLIENTS_DB_NAME}\`.auth_sync_queue
             SET status = 'DONE', attempts = attempts + 1, lastError = NULL
             WHERE id = ?`,
            [job.id]
        );

        return { uid: nextUid };
    } catch (error) {
        await conn.query(
            `UPDATE \`${CLIENTS_DB_NAME}\`.auth_sync_queue
             SET status = 'ERROR', attempts = attempts + 1, lastError = ?
             WHERE id = ?`,
            [String(error.message || error), job.id]
        );
        throw error;
    } finally {
        conn.release();
    }
}

// ── Middleware: verifica Firebase ID Token ─────────────────────────────────
async function resolveInternalAdminFromToken(token) {
    try {
        const payload = verifyInternalAdminToken(token);
        const conn = await clientsControlPool.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT id, email, username, name, lastname, role, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${INTERNAL_ADMINS_TABLE}\`
                 WHERE id = ?
                 LIMIT 1`,
                [payload.id]
            );
            const internalAdmin = rows[0] || null;
            if (!internalAdmin || !isActiveStatus(internalAdmin.status, false)) {
                return null;
            }
            return internalAdmin;
        } finally {
            conn.release();
        }
    } catch {
        return null;
    }
}

async function verifyFirebaseToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    try {
        const token = auth.split('Bearer ')[1];
        const internalAdmin = await resolveInternalAdminFromToken(token);
        if (internalAdmin) {
            const rawTargetClientId = req.headers['x-mm-target-client-id']
                || req.query?.clientId
                || req.body?.clientId;
            const supportClientId = Number(rawTargetClientId || 0);

            req.internalAdmin = internalAdmin;
            req.firebaseUser = {
                uid: `internal-admin-${internalAdmin.id}`,
                email: internalAdmin.email,
                _internalAdmin: internalAdmin,
                _supportClientId: Number.isFinite(supportClientId) && supportClientId > 0 ? supportClientId : null,
            };
            return next();
        }

        if (firebaseAdminAvailable) {
            const decoded = await admin.auth().verifyIdToken(token);
            req.firebaseUser = decoded;
            return next();
        }

        if (localDevAuthBypass && isLocalRequest(req)) {
            const decoded = decodeFirebaseJwtWithoutVerification(token);
            if (!decoded.uid) {
                return res.status(401).json({ error: 'Token inválido o expirado' });
            }
            const rawTargetClientId = req.headers['x-mm-target-client-id']
                || req.query?.clientId
                || req.body?.clientId;
            const supportClientId = Number(rawTargetClientId || 0);
            req.firebaseUser = {
                ...decoded,
                _supportClientId: Number.isFinite(supportClientId) && supportClientId > 0 ? supportClientId : null,
            };
            return next();
        }

        return res.status(503).json({ error: 'Firebase Admin no configurado en este entorno local' });
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

async function verifyInternalAdminSession(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }

    const token = auth.split('Bearer ')[1];
    const internalAdmin = await resolveInternalAdminFromToken(token);
    if (!internalAdmin) {
        return res.status(401).json({ error: 'Sesión interna inválida o expirada' });
    }

    req.internalAdmin = internalAdmin;
    return next();
}

async function verifyFirebaseTokenWithClient(req, res, next) {
    try {
        await new Promise((resolve, reject) => {
            verifyFirebaseToken(req, res, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        req.clientAccess = await getTenantClientData(req.firebaseUser);
        return next();
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        return res.status(statusCode).json({ error: error?.message || 'No se pudo validar el usuario' });
    }
}

async function verifyBridgeDeviceToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de bridge requerido' });
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
        const device = await findBridgeDeviceByToken(token);
        if (!device) {
            return res.status(401).json({ error: 'Token de bridge inválido' });
        }
        req.bridge = {
            id: Number(device.id),
            tenantId: Number(device.tenantId),
            clientId: Number(device.clientId),
            branchId: Number(device.branchId),
            deviceId: String(device.deviceId),
            hostname: device.hostname || null,
        };
        clientsControlPool
            .query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
                 SET lastSeenAt = NOW()
                 WHERE id = ?`,
                [device.id]
            )
            .catch((error) => {
                console.warn('[BRIDGE AUTH] No se pudo actualizar lastSeenAt:', error?.message || error);
            });
        return next();
    } catch (error) {
        console.error('[BRIDGE AUTH ERROR]', error?.code || '', error?.message || error, error?.stack || '');
        const code = error?.code || error?.errno || null;
        return res.status(500).json({
            error: 'Error al validar token de bridge',
            detail: error?.message || String(error),
            code,
        });
    }
}

// ── Helper: nombre de BD seguro desde CUIT ────────────────────────────────
function dbNameFromCuit(cuit) {
    // Solo dígitos, prefijo mm_ para evitar conflictos
    const sanitized = String(cuit).replace(/\D/g, '');
    if (sanitized.length < 10) throw new Error('CUIT inválido');
    return `mm_${sanitized}`;
}

async function ensureTenantDatabase({ clientId, cuit, empresa }) {
    const conn = await provisionPool.getConnection();

    try {
        const dbName = OPERATIONAL_DB_NAME;
        const [rows] = await conn.query(
            `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
            [dbName]
        );

        const isNew = rows.length === 0;

        if (isNew) {
            await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            console.log(`[PROVISION] Nueva BD creada: ${dbName} para CUIT ${cuit} (${empresa})`);
        }

        const tenantConn = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_PROVISION_USER,
            password: process.env.DB_PROVISION_PASS,
            database: dbName,
        });
        try {
            for (const sql of getSchemaTables()) {
                await tenantConn.query(sql);
            }
            const [tbls] = await tenantConn.query('SHOW TABLES');
            console.log(`[PROVISION] BD ${dbName} — ${tbls.length} tablas listas`);
        } finally {
            await tenantConn.end();
        }

        if (!isNew) {
            console.log(`[PROVISION] BD existente: ${dbName} — acceso OK`);
        }
        return { dbName, isNew };
    } finally {
        conn.release();
    }
}

// ── SQL: array de sentencias para crear todas las tablas ─────────────────
function getSchemaTables() {
    return [
        `CREATE TABLE IF NOT EXISTS settings (
            \`key\`      VARCHAR(100) NOT NULL,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            value       TEXT,
            PRIMARY KEY (\`${TENANT_COLUMN}\`, \`key\`),
            INDEX idx_settings_key (\`key\`)
        )`,
        `CREATE TABLE IF NOT EXISTS payment_methods (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            name        VARCHAR(100) NOT NULL,
            type        VARCHAR(50),
            percentage  DECIMAL(5,2) DEFAULT 0,
            enabled     TINYINT(1) DEFAULT 1,
            UNIQUE KEY uniq_payment_methods_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_payment_methods_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS categories (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            name        VARCHAR(100) NOT NULL,
            parent_id   INT,
            synced      TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_categories_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_categories_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_categories_tenant_parent (\`${TENANT_COLUMN}\`, parent_id),
            CONSTRAINT categories_ibfk_1 FOREIGN KEY (\`${TENANT_COLUMN}\`, parent_id) REFERENCES categories(\`${TENANT_COLUMN}\`, id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS product_categories (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            code        VARCHAR(100) NOT NULL,
            name        VARCHAR(120) NOT NULL,
            active      TINYINT(1) DEFAULT 1,
            synced      TINYINT(1) DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_categories_tenant_id (\`${TENANT_COLUMN}\`, id),
            UNIQUE KEY uniq_product_categories_tenant_code (\`${TENANT_COLUMN}\`, code),
            INDEX idx_product_categories_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS suppliers (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            name            VARCHAR(150),
            cuit            VARCHAR(20),
            iva_condition   VARCHAR(50),
            phone           VARCHAR(50),
            street          VARCHAR(150),
            number          VARCHAR(20),
            floor_dept      VARCHAR(50),
            neighborhood    VARCHAR(100),
            city            VARCHAR(100),
            province        VARCHAR(100),
            zip_code        VARCHAR(20),
            email           VARCHAR(150),
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_suppliers_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_suppliers_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_suppliers_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS products (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            canonical_key   VARCHAR(191) NOT NULL,
            name            VARCHAR(150) NOT NULL,
            category_id     INT,
            category        VARCHAR(100),
            unit            VARCHAR(20),
            current_price   DECIMAL(12,2) DEFAULT 0,
            plu             VARCHAR(20),
            active          TINYINT(1) NOT NULL DEFAULT 1,
            deleted_at      DATETIME NULL,
            archived_plu    VARCHAR(20) NULL,
            source          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_products_tenant_id (\`${TENANT_COLUMN}\`, id),
            UNIQUE KEY uniq_products_tenant_branch_canonical (\`${TENANT_COLUMN}\`, branch_id, canonical_key),
            UNIQUE KEY uniq_products_tenant_branch_plu (\`${TENANT_COLUMN}\`, branch_id, plu),
            INDEX idx_products_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_products_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_products_tenant_category (\`${TENANT_COLUMN}\`, category_id)
        )`,
        `CREATE TABLE IF NOT EXISTS purchase_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            name            VARCHAR(150) NOT NULL,
            product_id      INT,
            category_id     INT,
            last_price      DECIMAL(12,2) DEFAULT 0,
            unit            VARCHAR(20),
            type            VARCHAR(50),
            is_preelaborable TINYINT(1) DEFAULT 0,
            species         VARCHAR(50),
            \`usage\`       VARCHAR(50),
            plu             VARCHAR(20),
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_purchase_items_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_purchase_items_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_purchase_items_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_purchase_items_tenant_category (\`${TENANT_COLUMN}\`, category_id),
            CONSTRAINT purchase_items_ibfk_1 FOREIGN KEY (\`${TENANT_COLUMN}\`, category_id) REFERENCES categories(\`${TENANT_COLUMN}\`, id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS stock (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            product_id      INT,
            name            VARCHAR(150) NOT NULL,
            type            VARCHAR(50),
            \`usage\`         VARCHAR(50),
            quantity        DECIMAL(12,3) DEFAULT 0,
            unit            VARCHAR(20),
            price           DECIMAL(12,2) DEFAULT 0,
            category_id     INT,
            reference       VARCHAR(100),
            barcode         VARCHAR(64),
            presentation    VARCHAR(50),
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_stock_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_stock_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS clients (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            name            VARCHAR(150) NOT NULL,
            first_name      VARCHAR(100),
            last_name       VARCHAR(100),
            phone           VARCHAR(50),
            email           VARCHAR(150),
            email1          VARCHAR(150),
            email2          VARCHAR(150),
            address         VARCHAR(255),
            street          VARCHAR(150),
            street_number   VARCHAR(20),
            zip_code        VARCHAR(20),
            city            VARCHAR(100),
            latitude        DECIMAL(10,7),
            longitude       DECIMAL(10,7),
            geocoded_at     DATETIME,
            cuit            VARCHAR(20),
            balance         DECIMAL(12,2) DEFAULT 0,
            has_current_account TINYINT(1) DEFAULT 1,
            employee_discount_enabled TINYINT(1) NOT NULL DEFAULT 0,
            employee_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
            has_initial_balance TINYINT(1) DEFAULT 0,
            last_updated    DATETIME,
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_clients_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_clients_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_clients_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS ventas (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            date                DATETIME NOT NULL,
            total               DECIMAL(12,2) NOT NULL,
            payment_method      VARCHAR(100),
            payment_method_id   INT,
            client_id           INT,
            clientId            INT,
            discount_client_id  INT,
            client_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
            client_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
            branch_id           INT,
            payment_breakdown   JSON,
            receipt_number      INT,
            receipt_code        VARCHAR(32),
            qendra_ticket_id    VARCHAR(100),
            source              VARCHAR(50),
            synced              TINYINT(1) DEFAULT 0,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_ventas_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_ventas_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_ventas_tenant_client (\`${TENANT_COLUMN}\`, client_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, client_id) REFERENCES clients(\`${TENANT_COLUMN}\`, id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ventas_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            venta_id        INT NOT NULL,
            product_id      INT,
            product_name    VARCHAR(150),
            quantity        DECIMAL(12,3),
            price           DECIMAL(12,2),
            subtotal        DECIMAL(12,2),
            promo_id        INT NULL,
            promo_kg_applied DECIMAL(12,3) NULL,
            promo_payload   JSON NULL,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_ventas_items_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_ventas_items_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_ventas_items_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_ventas_items_tenant_venta (\`${TENANT_COLUMN}\`, venta_id),
            INDEX idx_ventas_items_tenant_promo (\`${TENANT_COLUMN}\`, promo_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, venta_id) REFERENCES ventas(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS compras (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            date            DATETIME NOT NULL,
            supplier        VARCHAR(150),
            supplier_id     INT,
            invoice_num     VARCHAR(50),
            total           DECIMAL(12,2),
            payment_method  VARCHAR(100),
            is_account      TINYINT(1) DEFAULT 0,
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_compras_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_compras_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_compras_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS compras_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            purchase_id     INT NOT NULL,
            product_id      INT,
            product_name    VARCHAR(150),
            quantity        DECIMAL(12,3),
            weight          DECIMAL(12,3),
            unit_price      DECIMAL(12,2),
            subtotal        DECIMAL(12,2),
            destination     VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_compras_items_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_compras_items_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_compras_items_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_compras_items_tenant_purchase (\`${TENANT_COLUMN}\`, purchase_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, purchase_id) REFERENCES compras(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS supplier_item_tax_profiles (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            supplier_name   VARCHAR(150) NOT NULL,
            product_name    VARCHAR(150) NOT NULL,
            last_iva_rate   DECIMAL(5,2) DEFAULT 10.5,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_sitp_tenant_branch_supplier_product (\`${TENANT_COLUMN}\`, branch_id, supplier_name(100), product_name(100)),
            INDEX idx_sitp_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_sitp_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS animal_lots (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            purchase_id     INT,
            supplier        VARCHAR(150),
            date            DATETIME,
            species         VARCHAR(50),
            weight          DECIMAL(12,3),
            status          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_animal_lots_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_animal_lots_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_animal_lots_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS despostada_logs (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id           INT,
            type                VARCHAR(50),
            date                DATETIME,
            supplier            VARCHAR(150),
            total_weight        DECIMAL(12,3),
            yield_percentage    DECIMAL(5,2),
            lot_id              INT,
            synced              TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_despostada_logs_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_despostada_logs_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_despostada_logs_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS pedidos (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            customer_id     INT,
            branch_id       INT,
            customer_name   VARCHAR(150),
            items           JSON,
            total           DECIMAL(12,2),
            status          VARCHAR(50),
            delivery_date   DATETIME,
            delivery_type   VARCHAR(50),
            address         VARCHAR(255),
            customer_phone  VARCHAR(50),
            latitude        DECIMAL(10,7),
            longitude       DECIMAL(10,7),
            geocoded_at     DATETIME,
            payment_method  VARCHAR(100),
            payment_status  VARCHAR(100),
            paid            TINYINT(1) DEFAULT 0,
            amount_due      DECIMAL(12,2),
            repartidor      VARCHAR(100),
            assigned_driver_uid VARCHAR(191),
            assigned_driver_email VARCHAR(150),
            assigned_at     DATETIME,
            status_updated_at DATETIME,
            source          VARCHAR(50),
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            sync_cloud      TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_pedidos_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_pedidos_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS repartidores (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            name            VARCHAR(150),
            vehicle         VARCHAR(100),
            plate           VARCHAR(20),
            phone           VARCHAR(50),
            vtv_expiry      DATE,
            license_expiry  DATE,
            insurance_expiry DATE,
            status          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_repartidores_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_repartidores_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS menu_digital (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT,
            product_id      INT,
            product_name    VARCHAR(150),
            price           DECIMAL(12,2),
            category        VARCHAR(100),
            is_offer        TINYINT(1) DEFAULT 0,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_menu_digital_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_menu_digital_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_menu_digital_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS promotions (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id           INT NULL,
            product_id          INT NULL,
            product_name        VARCHAR(150) NOT NULL,
            promo_name          VARCHAR(191) NULL,
            promo_plu           VARCHAR(32) NULL,
            min_qty_kg          DECIMAL(12,3) NOT NULL,
            promo_total_price   DECIMAL(12,2) NOT NULL,
            promo_unit_price    DECIMAL(12,2) NULL,
            promo_price_mode    VARCHAR(20) NOT NULL DEFAULT 'total_kg',
            stock_mode          VARCHAR(20) NOT NULL DEFAULT 'all_stock',
            stock_cap_kg_limit  DECIMAL(12,3) NULL,
            end_condition       VARCHAR(20) NOT NULL DEFAULT 'none',
            sold_kg_limit       DECIMAL(12,3) NULL,
            end_date            DATETIME NULL,
            used_kg             DECIMAL(12,3) NOT NULL DEFAULT 0,
            active              TINYINT(1) NOT NULL DEFAULT 1,
            notes               VARCHAR(255),
            created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_promotions_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_promotions_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_promotions_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_promotions_tenant_product (\`${TENANT_COLUMN}\`, product_id),
            INDEX idx_promotions_tenant_name (\`${TENANT_COLUMN}\`, product_name),
            UNIQUE KEY uniq_promotions_tenant_promo_plu (\`${TENANT_COLUMN}\`, promo_plu),
            CONSTRAINT promotions_product_fk FOREIGN KEY (\`${TENANT_COLUMN}\`, product_id)
                REFERENCES products(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS branch_transfers (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            from_branch_id  INT NOT NULL,
            to_branch_id    INT NOT NULL,
            status          VARCHAR(20) NOT NULL DEFAULT 'pending',
            document_type   VARCHAR(30) NOT NULL DEFAULT 'remito',
            remito_number   INT,
            remito_code     VARCHAR(32),
            document_code   VARCHAR(40),
            note            TEXT,
            created_by_user_id BIGINT,
            created_by_username VARCHAR(150),
            received_by_user_id BIGINT,
            received_by_username VARCHAR(150),
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            received_at     DATETIME NULL,
            cancelled_at    DATETIME NULL,
            cancelled_by_user_id BIGINT,
            cancelled_by_username VARCHAR(150),
            UNIQUE KEY uniq_branch_transfers_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_branch_transfers_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_branch_transfers_status (\`${TENANT_COLUMN}\`, status),
            INDEX idx_branch_transfers_from (\`${TENANT_COLUMN}\`, from_branch_id),
            INDEX idx_branch_transfers_to (\`${TENANT_COLUMN}\`, to_branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS branch_transfer_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            transfer_id     INT NOT NULL,
            product_id      INT,
            product_name    VARCHAR(150),
            quantity        DECIMAL(12,3) DEFAULT 0,
            unit            VARCHAR(20),
            UNIQUE KEY uniq_branch_transfer_items_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_branch_transfer_items_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_branch_transfer_items_transfer (\`${TENANT_COLUMN}\`, transfer_id),
            INDEX idx_branch_transfer_items_product (\`${TENANT_COLUMN}\`, product_id),
            CONSTRAINT branch_transfer_items_fk FOREIGN KEY (\`${TENANT_COLUMN}\`, transfer_id)
                REFERENCES branch_transfers(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS caja_movimientos (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            type            VARCHAR(50),
            amount          DECIMAL(12,2),
            category        VARCHAR(100),
            description     VARCHAR(255),
            supplier        VARCHAR(150),
            date            DATETIME,
            client_id       INT,
            branch_id       INT,
            payment_method  VARCHAR(100),
            payment_method_id INT,
            cash_account    VARCHAR(30) NOT NULL DEFAULT 'principal',
            transfer_group_id VARCHAR(64) NULL,
            authorization_id BIGINT,
            authorization_verified TINYINT(1) DEFAULT 0,
            authorized_recipient_email VARCHAR(150),
            receipt_number  INT,
            receipt_code    VARCHAR(32),
            purchase_id     INT,
            sale_id         INT,
            money_flow_kind VARCHAR(50) NULL,
            origin_table    VARCHAR(64) NULL,
            origin_id       BIGINT NULL,
            origin_group_id VARCHAR(64) NULL,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_caja_movimientos_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_caja_movimientos_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_caja_movimientos_cash_account (\`${TENANT_COLUMN}\`, cash_account),
            INDEX idx_caja_movimientos_transfer (\`${TENANT_COLUMN}\`, transfer_group_id)
        )`,
        `CREATE TABLE IF NOT EXISTS delivery_tracking_events (
            id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            order_id            INT NULL,
            event_type          VARCHAR(50) NOT NULL,
            status              VARCHAR(50) NULL,
            driver_name         VARCHAR(150) NULL,
            driver_uid          VARCHAR(191) NULL,
            driver_email        VARCHAR(150) NULL,
            latitude            DECIMAL(10,7) NULL,
            longitude           DECIMAL(10,7) NULL,
            accuracy            DECIMAL(10,2) NULL,
            speed               DECIMAL(10,2) NULL,
            heading             DECIMAL(10,2) NULL,
            payload_json        JSON NULL,
            actor_user_id       BIGINT NULL,
            actor_firebase_uid  VARCHAR(191) NULL,
            actor_email         VARCHAR(150) NULL,
            created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_delivery_tracking_events_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_delivery_tracking_events_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_delivery_tracking_events_order (\`${TENANT_COLUMN}\`, order_id, created_at),
            INDEX idx_delivery_tracking_events_driver (\`${TENANT_COLUMN}\`, driver_uid, created_at)
        )`,
        `CREATE TABLE IF NOT EXISTS delivery_driver_last_locations (
            id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            driver_uid          VARCHAR(191) NOT NULL,
            driver_name         VARCHAR(150) NULL,
            driver_email        VARCHAR(150) NULL,
            latitude            DECIMAL(10,7) NOT NULL,
            longitude           DECIMAL(10,7) NOT NULL,
            accuracy            DECIMAL(10,2) NULL,
            speed               DECIMAL(10,2) NULL,
            heading             DECIMAL(10,2) NULL,
            order_id            INT NULL,
            status              VARCHAR(50) NULL,
            payload_json        JSON NULL,
            created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_delivery_driver_last_locations_driver (\`${TENANT_COLUMN}\`, driver_uid),
            INDEX idx_delivery_driver_last_locations_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_delivery_driver_last_locations_status (\`${TENANT_COLUMN}\`, status)
        )`,
        `CREATE TABLE IF NOT EXISTS cash_withdrawal_authorizations (
            id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            authorization_type  VARCHAR(50) NOT NULL,
            requested_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
            payment_method      VARCHAR(100),
            category            VARCHAR(100),
            description         VARCHAR(255),
            recipient_email     VARCHAR(150),
            requested_by_user_id BIGINT,
            requested_by_email  VARCHAR(150),
            code_hash           CHAR(64) NOT NULL,
            status              VARCHAR(20) NOT NULL DEFAULT 'pending',
            expires_at          DATETIME NOT NULL,
            used_at             DATETIME NULL,
            created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_cash_withdrawal_authorizations_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_cash_withdrawal_authorizations_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_cash_withdrawal_authorizations_status (\`${TENANT_COLUMN}\`, status, expires_at)
        )`,
        `CREATE TABLE IF NOT EXISTS deleted_sales_history (
            id                      INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            sale_id                 INT,
            receipt_number          INT,
            receipt_code            VARCHAR(32),
            sale_date               DATETIME,
            deleted_at              DATETIME,
            deleted_by_user_id      INT,
            deleted_by_username     VARCHAR(100),
            payment_method          VARCHAR(100),
            clientId                INT,
            total                   DECIMAL(12,2),
            source                  VARCHAR(50),
            authorization_verified  TINYINT(1) DEFAULT 0,
            sale_snapshot           LONGTEXT,
            items_snapshot          LONGTEXT,
            UNIQUE KEY uniq_deleted_sales_history_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_deleted_sales_history_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS branch_stock_snapshots (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_code     VARCHAR(20),
            branch_name     VARCHAR(150),
            snapshot_at     DATETIME,
            imported_at     DATETIME,
            UNIQUE KEY uniq_branch_stock_snapshots_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_branch_stock_snapshots_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS cash_closures (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            closure_date    DATE,
            branch_id       INT,
            closed_at       DATETIME,
            theoretical_cash DECIMAL(12,2),
            counted_cash    DECIMAL(12,2),
            difference      DECIMAL(12,2),
            total_sales     DECIMAL(12,2),
            total_incomes   DECIMAL(12,2),
            total_expenses  DECIMAL(12,2),
            notes           TEXT,
            report_path     VARCHAR(255),
            snapshot        LONGTEXT,
            UNIQUE KEY uniq_cash_closures_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_cash_closures_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_cash_closures_date (\`${TENANT_COLUMN}\`, closure_date),
            INDEX idx_cash_closures_branch (\`${TENANT_COLUMN}\`, branch_id, closure_date)
        )`,
        `CREATE TABLE IF NOT EXISTS prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT NULL,
            product_ref_id  INT,
            product_id      VARCHAR(191),
            price           DECIMAL(12,2),
            plu             VARCHAR(20),
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_prices_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_prices_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        // Tabla canónica de historial de precios (reemplaza a prices a mediano plazo).
        // Cada fila es un evento de precio: no se actualiza, se inserta una nueva.
        // El precio vigente de un producto es el último por (tenant_id, product_id, effective_at DESC).
        `CREATE TABLE IF NOT EXISTS product_prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT NULL,
            product_id      INT NOT NULL,
            price           DECIMAL(12,2) NOT NULL DEFAULT 0,
            plu             VARCHAR(20),
            source          VARCHAR(50),
            effective_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_pp_tenant_product_eff (\`${TENANT_COLUMN}\`, product_id, effective_at),
            INDEX idx_pp_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_pp_tenant_plu (\`${TENANT_COLUMN}\`, plu)
        )`,
        `CREATE TABLE IF NOT EXISTS branch_product_prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT NOT NULL,
            product_id      INT NOT NULL,
            price           DECIMAL(12,2) NOT NULL DEFAULT 0,
            plu             VARCHAR(20),
            source          VARCHAR(50),
            effective_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_branch_product_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
            UNIQUE KEY uniq_branch_product_price (\`${TENANT_COLUMN}\`, branch_id, product_id),
            INDEX idx_bpp_tenant_branch (\`${TENANT_COLUMN}\`, branch_id),
            INDEX idx_bpp_tenant_product (\`${TENANT_COLUMN}\`, product_id)
        )`,
        `CREATE TABLE IF NOT EXISTS users (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            username        VARCHAR(100) NOT NULL,
            pin             VARCHAR(20),
            role            ENUM('admin','employee') DEFAULT 'employee',
            active          TINYINT(1) DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_users_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_users_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS scale_users (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            branch_id       INT NULL,
            slot_no         TINYINT UNSIGNED NOT NULL,
            display_name    VARCHAR(100) NOT NULL,
            active          TINYINT(1) DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_scale_users_tenant_branch_slot (\`${TENANT_COLUMN}\`, branch_id, slot_no),
            UNIQUE KEY uniq_scale_users_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_scale_users_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_scale_users_tenant_branch (\`${TENANT_COLUMN}\`, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS user_permissions (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            user_id         INT NOT NULL,
            path            VARCHAR(200) NOT NULL,
            UNIQUE KEY uniq_user_permissions_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_user_permissions_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_user_permissions_tenant_user (\`${TENANT_COLUMN}\`, user_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, user_id) REFERENCES users(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS app_logs (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            level           VARCHAR(20),
            message         TEXT,
            details         TEXT,
            timestamp       DATETIME,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_app_logs_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_app_logs_tenant (\`${TENANT_COLUMN}\`)
        )`,
    ];
}

// ── RUTA: POST /provision y /api/provision ─────────────────────────────────
// Verifica el token de Firebase, obtiene el CUIT del usuario en Firestore,
// crea la BD si no existe, devuelve la config de conexión.
async function handleProvision(req, res) {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        const isRequesterAdmin = accessContext.user.role === 'admin' && !accessContext.user.isGlobalSuperAdmin;

        const ownerData = await getTenantClientData(req.firebaseUser);
        const { cuit, empresa, clientId } = ownerData;
        if (!cuit) {
            return res.status(403).json({ error: 'CUIT no configurado para este usuario' });
        }

        const { dbName, isNew } = await ensureTenantDatabase({ clientId, cuit, empresa });

        res.json({
            ok: true,
            dbName,
            empresa,
            cuit,
            isNew,
            connection: {
                host: process.env.DB_HOST,
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER,
            }
        });
    } catch (err) {
        console.error('[PROVISION ERROR]', err);
        res.status(500).json({ error: 'Error interno de provisioning' });
    }
}

app.post('/provision', verifyFirebaseToken, handleProvision);
app.post('/api/provision', verifyFirebaseToken, handleProvision);

app.post('/api/error-logs', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });

        const source = req.body?.source === 'mobile' ? 'mobile' : 'frontend';
        const message = String(req.body?.message || '').trim();
        if (!message) {
            return res.status(400).json({ error: 'message es obligatorio' });
        }

        await createAppErrorLog({
            req,
            accessContext,
            source,
            message,
            stack: req.body?.stack || null,
            statusCode: req.body?.statusCode == null ? null : Number(req.body.statusCode),
            metadata: req.body?.metadata || null,
        });

        return res.status(201).json({ ok: true });
    } catch (err) {
        console.error('[ERROR LOG WRITE ERROR]', err?.message || err);
        return res.status(err?.statusCode || 500).json({ error: err?.message || 'No se pudo guardar el log de error' });
    }
});

// ── Tenant cache & lazy pools ──────────────────────────────────────────────
const tenantInfoCache = new Map();   // uid  → { value, expiresAt }
const tenantPools     = new Map();   // dbName → Pool
const tableColCache   = new Map();   // "dbName.table" → [colNames]
const tableDescCache  = new Map();   // "dbName.table" → Map(colName, sqlType)

async function getTenantInfo(authUser, options = {}) {
    const uid = typeof authUser === 'string' ? authUser : authUser?.uid;
    const email = typeof authUser === 'string' ? '' : authUser?.email;
    tenantInfoCache.delete(uid);

    const accessContext = await getClientAccessContext({
        uid,
        email,
        _internalAdmin: authUser?._internalAdmin || null,
        _supportClientId: authUser?._supportClientId || null,
    });
    if (accessContext) {
        assertClientAccess(accessContext, options);
        const resolvedTenantId = Number(accessContext.client.id);
        if (!Number.isFinite(resolvedTenantId) || resolvedTenantId <= 0) {
            console.error('[getTenantInfo] client.id inválido:', accessContext.client.id, '— usando DEFAULT_OPERATIONAL_TENANT_ID');
        }
        const info = {
            dbName: OPERATIONAL_DB_NAME,
            cuit: accessContext.client.taxId,
            empresa: accessContext.client.businessName,
            clientId: accessContext.client.id,
            tenantId: resolvedTenantId,
            licenses: accessContext.effectiveLicenses,
        };
        tenantInfoCache.set(uid, { value: info, expiresAt: 0 });
        return info;
    }

    const firestoreDb = admin.firestore();
    const userDoc = await firestoreDb.collection('clientes').doc(uid).get();
    if (!userDoc.exists) throw new Error('Usuario no registrado como cliente');
    const { cuit, empresa } = userDoc.data();
    const info = {
        dbName: OPERATIONAL_DB_NAME,
        cuit,
        empresa,
        tenantId: DEFAULT_OPERATIONAL_TENANT_ID,
    };
    tenantInfoCache.set(uid, { value: info, expiresAt: 0 });
    return info;
}

async function getTenantClientData(authUser) {
    const uid = typeof authUser === 'string' ? authUser : authUser?.uid;
    const email = typeof authUser === 'string' ? '' : authUser?.email;
    const accessContext = await getClientAccessContext({
        uid,
        email,
        _internalAdmin: authUser?._internalAdmin || null,
        _supportClientId: authUser?._supportClientId || null,
    });
    if (accessContext) {
        assertClientAccess(accessContext);
        return {
            id: accessContext.user.id,
            email: accessContext.user.email,
            cuit: accessContext.client.taxId,
            empresa: accessContext.client.businessName,
            activo: true,
            clientId: accessContext.client.id,
            role: accessContext.user.role,
            firebaseUid: accessContext.user.firebaseUid,
            licenses: accessContext.effectiveLicenses,
            isGlobalSuperAdmin: Boolean(accessContext.user.isGlobalSuperAdmin),
        };
    }

    const firestoreDb = admin.firestore();
    const userDoc = await firestoreDb.collection('clientes').doc(uid).get();
    if (!userDoc.exists) throw new Error('Usuario no registrado como cliente');
    return { id: userDoc.id, ...userDoc.data() };
}

function requiresLogisticsLicense({ role, perms = [] }) {
    if (String(role || '').trim().toLowerCase() !== 'employee') return false;
    return Array.isArray(perms) && perms.some((pathValue) => String(pathValue || '').trim() === '/logistica');
}

function assertDeliveryLicenseSelection({ role, perms = [], assignedLicenses = [] }) {
    if (!requiresLogisticsLicense({ role, perms })) return;
    const hasAssignedDeliveryLicense = assignedLicenses.some((license) => licenseHasLogisticsCapability(license));
    if (!hasAssignedDeliveryLicense) {
        const error = new Error('Para habilitar Logística, el usuario debe tener una licencia de entregas asignada');
        error.statusCode = 400;
        throw error;
    }
}

function getTenantPool(dbName) {
    if (tenantPools.has(dbName)) return tenantPools.get(dbName);
    const pool = mysql.createPool({
        host:             process.env.DB_HOST,
        port:             parseInt(process.env.DB_PORT) || 3306,
        user:             process.env.DB_PROVISION_USER,
        password:         process.env.DB_PROVISION_PASS,
        database:         dbName,
        waitForConnections: true,
        connectionLimit:  10,
    });
    tenantPools.set(dbName, pool);
    return pool;
}

async function createDeliveryTrackingEvent(pool, tenantId, payload = {}) {
    const actorUserId = Number(payload.actorUserId);
    await pool.query(
        `INSERT INTO delivery_tracking_events
            (\`${TENANT_COLUMN}\`, order_id, event_type, status, driver_name, driver_uid, driver_email, latitude, longitude, accuracy, speed, heading, payload_json, actor_user_id, actor_firebase_uid, actor_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId,
            payload.orderId ?? null,
            payload.eventType || 'update',
            payload.status || null,
            payload.driverName || null,
            payload.driverUid || null,
            payload.driverEmail || null,
            payload.latitude ?? null,
            payload.longitude ?? null,
            payload.accuracy ?? null,
            payload.speed ?? null,
            payload.heading ?? null,
            payload.payloadJson ? JSON.stringify(payload.payloadJson) : null,
            Number.isFinite(actorUserId) ? actorUserId : null,
            payload.actorFirebaseUid || null,
            payload.actorEmail || null,
        ]
    );
}

async function upsertDriverLastLocation(pool, tenantId, payload = {}) {
    await pool.query(
        `INSERT INTO delivery_driver_last_locations
            (\`${TENANT_COLUMN}\`, driver_uid, driver_name, driver_email, latitude, longitude, accuracy, speed, heading, order_id, status, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            driver_name = VALUES(driver_name),
            driver_email = VALUES(driver_email),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            accuracy = VALUES(accuracy),
            speed = VALUES(speed),
            heading = VALUES(heading),
            order_id = VALUES(order_id),
            status = VALUES(status),
            payload_json = VALUES(payload_json),
            updated_at = CURRENT_TIMESTAMP`,
        [
            tenantId,
            payload.driverUid,
            payload.driverName || null,
            payload.driverEmail || null,
            payload.latitude,
            payload.longitude,
            payload.accuracy ?? null,
            payload.speed ?? null,
            payload.heading ?? null,
            payload.orderId ?? null,
            payload.status || null,
            payload.payloadJson ? JSON.stringify(payload.payloadJson) : null,
        ]
    );
}

async function fetchDeliveryOrderById(pool, tenantId, orderId) {
    const [rows] = await pool.query(
        `SELECT *
           FROM pedidos
          WHERE \`${TENANT_COLUMN}\` = ?
            AND id = ?
            AND delivery_type = 'delivery'
          LIMIT 1`,
        [tenantId, orderId]
    );
    return rows[0] || null;
}

async function listDeliveryOrders(pool, tenantId, filters = {}) {
    const where = ['`tenant_id` = ?', 'delivery_type = ?'];
    const params = [tenantId, 'delivery'];

    if (filters.status) {
        const statuses = []
            .concat(filters.status)
            .map((value) => normalizeDeliveryStatus(value))
            .filter(Boolean);
        if (statuses.length) {
            where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
            params.push(...statuses);
        }
    }

    if (filters.driverIdentity) {
        const driverIdentity = filters.driverIdentity;
        const clauses = [];
        if (driverIdentity.firebaseUid) {
            clauses.push('assigned_driver_uid = ?');
            params.push(driverIdentity.firebaseUid);
        }
        if (driverIdentity.email) {
            clauses.push('LOWER(assigned_driver_email) = ?');
            params.push(driverIdentity.email);
        }
        if (driverIdentity.name) {
            clauses.push('LOWER(repartidor) = ?');
            params.push(driverIdentity.name.toLowerCase());
        }
        if (clauses.length) {
            where.push(`(${clauses.join(' OR ')})`);
        }
    }

    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(Math.max(Number(filters.limit), 1), 200) : 100;
    const [rows] = await pool.query(
        `SELECT *
           FROM pedidos
          WHERE ${where.join(' AND ')}
          ORDER BY COALESCE(delivery_date, created_at) DESC, id DESC
          LIMIT ?`,
        [...params, limit]
    );
    return rows.map(mapDeliveryOrder);
}

async function assignDeliveryOrder(pool, tenantId, orderId, driverIdentity, nextStatus = 'assigned') {
    const normalizedStatus = normalizeDeliveryStatus(nextStatus);
    await pool.query(
        `UPDATE pedidos
            SET repartidor = ?,
                assigned_driver_uid = ?,
                assigned_driver_email = ?,
                assigned_at = CURRENT_TIMESTAMP,
                status = ?,
                status_updated_at = CURRENT_TIMESTAMP
          WHERE \`${TENANT_COLUMN}\` = ?
            AND id = ?
            AND delivery_type = 'delivery'`,
        [
            driverIdentity.name || null,
            driverIdentity.firebaseUid || null,
            driverIdentity.email || null,
            normalizedStatus,
            tenantId,
            orderId,
        ]
    );
}

async function updateDeliveryOrderStatus(pool, tenantId, orderId, status, driverIdentity = null) {
    const normalizedStatus = normalizeDeliveryStatus(status);
    const order = await fetchDeliveryOrderById(pool, tenantId, orderId);
    if (!order) {
        const error = new Error('Pedido de delivery no encontrado');
        error.statusCode = 404;
        throw error;
    }

    if (driverIdentity && driverIdentity.role !== 'admin' && !orderBelongsToDriver(order, driverIdentity)) {
        const error = new Error('El pedido no está asignado a este repartidor');
        error.statusCode = 403;
        throw error;
    }

    const nextDriverName = order.repartidor || driverIdentity?.name || null;
    const nextDriverUid = order.assigned_driver_uid || driverIdentity?.firebaseUid || null;
    const nextDriverEmail = order.assigned_driver_email || driverIdentity?.email || null;
    const nextPaymentMethod = driverIdentity?.paymentMethodOverride !== undefined
        ? driverIdentity.paymentMethodOverride
        : order.payment_method || null;
    const nextPaymentStatus = driverIdentity?.paymentStatusOverride !== undefined
        ? driverIdentity.paymentStatusOverride
        : normalizePaymentStatus(order.payment_status);
    const nextPaid = driverIdentity?.paidOverride !== undefined
        ? (driverIdentity.paidOverride ? 1 : 0)
        : (order.paid ? 1 : 0);
    const nextAmountDue = driverIdentity?.amountDueOverride !== undefined
        ? driverIdentity.amountDueOverride
        : order.amount_due;

    await pool.query(
        `UPDATE pedidos
            SET status = ?,
                repartidor = ?,
                assigned_driver_uid = ?,
                assigned_driver_email = ?,
                payment_method = ?,
                payment_status = ?,
                paid = ?,
                amount_due = ?,
                status_updated_at = CURRENT_TIMESTAMP
          WHERE \`${TENANT_COLUMN}\` = ?
            AND id = ?`,
        [
            normalizedStatus,
            nextDriverName,
            nextDriverUid,
            nextDriverEmail,
            nextPaymentMethod,
            nextPaymentStatus,
            nextPaid,
            nextAmountDue,
            tenantId,
            orderId,
        ]
    );

    return fetchDeliveryOrderById(pool, tenantId, orderId);
}

async function buildLiveDriversSummary(pool, tenantId, locations) {
    const [rows] = await pool.query(
        `SELECT assigned_driver_uid, assigned_driver_email, repartidor, status, COUNT(*) AS activeOrders
           FROM pedidos
          WHERE \`${TENANT_COLUMN}\` = ?
            AND delivery_type = 'delivery'
            AND status IN (${ACTIVE_DELIVERY_STATUSES.map(() => '?').join(', ')})
          GROUP BY assigned_driver_uid, assigned_driver_email, repartidor, status`,
        [tenantId, ...ACTIVE_DELIVERY_STATUSES]
    );

    return locations.map((location) => {
        const match = rows.find((row) => (
            (row.assigned_driver_uid && row.assigned_driver_uid === location.firebaseUid)
            || (normalizeEmail(row.assigned_driver_email || '') && normalizeEmail(row.assigned_driver_email || '') === normalizeEmail(location.email || ''))
            || (String(row.repartidor || '').trim().toLowerCase() && String(row.repartidor || '').trim().toLowerCase() === String(location.repartidor || '').trim().toLowerCase())
        ));

        return {
            ...location,
            activeOrders: match ? Number(match.activeOrders || 0) : 0,
            activeStatus: match ? normalizeDeliveryStatus(match.status) : null,
        };
    });
}

async function createCashWithdrawalAuthorization({
    tenantInfo,
    accessContext,
    amount,
    paymentMethod,
    category,
    description,
}) {
    const recipientEmail = String(
        accessContext?.client?.cashAuthorizationEmail
        || accessContext?.client?.billingEmail
        || accessContext?.user?.email
        || ''
    ).trim().toLowerCase();

    if (!recipientEmail) {
        const error = new Error('El cliente no tiene email de autorizacion configurado');
        error.statusCode = 400;
        throw error;
    }

    if (!hasSmtpConfig()) {
        const error = new Error('La API no tiene SMTP configurado para enviar autorizaciones');
        error.statusCode = 500;
        throw error;
    }

    const code = generateNumericCode(6);
    const codeHash = hashSensitiveCode(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (CASH_WITHDRAWAL_CODE_TTL_MINUTES * 60 * 1000));
    const pool = getTenantPool(tenantInfo.dbName);

    await pool.query(
        `UPDATE cash_withdrawal_authorizations
            SET status = 'cancelled'
          WHERE \`${TENANT_COLUMN}\` = ?
            AND authorization_type = 'partner_withdrawal'
            AND status = 'pending'
            AND requested_by_user_id = ?`,
        [tenantInfo.tenantId, accessContext.user.id]
    );

    const [result] = await pool.query(
        `INSERT INTO cash_withdrawal_authorizations
            (\`${TENANT_COLUMN}\`, authorization_type, requested_amount, payment_method, category, description, recipient_email, requested_by_user_id, requested_by_email, code_hash, status, expires_at)
         VALUES (?, 'partner_withdrawal', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
            tenantInfo.tenantId,
            Number(amount) || 0,
            paymentMethod || null,
            category || null,
            description || null,
            recipientEmail,
            accessContext.user.id || null,
            accessContext.user.email || null,
            codeHash,
            expiresAt,
        ]
    );

    try {
        await sendCashWithdrawalAuthorizationEmail({
            recipientEmail,
            code,
            amount,
            paymentMethod,
            description,
            requestedBy: [accessContext.user?.name, accessContext.user?.lastname].filter(Boolean).join(' ') || accessContext.user?.email || 'Usuario',
            businessName: accessContext.client?.businessName,
            expiresAt,
        });
    } catch (error) {
        await pool.query(
            `UPDATE cash_withdrawal_authorizations
                SET status = 'cancelled'
              WHERE \`${TENANT_COLUMN}\` = ? AND id = ?`,
            [tenantInfo.tenantId, result.insertId]
        );
        throw error;
    }

    return {
        authorizationId: result.insertId,
        expiresAt: expiresAt.toISOString(),
        recipientEmail,
    };
}

async function verifyCashWithdrawalAuthorization({
    tenantInfo,
    authorizationId,
    code,
    amount,
    paymentMethod,
    category,
}) {
    const pool = getTenantPool(tenantInfo.dbName);
    const [rows] = await pool.query(
        `SELECT *
           FROM cash_withdrawal_authorizations
          WHERE \`${TENANT_COLUMN}\` = ?
            AND id = ?
          LIMIT 1`,
        [tenantInfo.tenantId, authorizationId]
    );

    const record = rows[0];
    if (!record) {
        const error = new Error('No se encontro la autorizacion solicitada');
        error.statusCode = 404;
        throw error;
    }

    if (String(record.status) !== 'pending') {
        const error = new Error('La autorizacion ya no esta disponible');
        error.statusCode = 400;
        throw error;
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
        await pool.query(
            `UPDATE cash_withdrawal_authorizations
                SET status = 'expired'
              WHERE \`${TENANT_COLUMN}\` = ? AND id = ?`,
            [tenantInfo.tenantId, authorizationId]
        );
        const error = new Error('El codigo ya vencio');
        error.statusCode = 400;
        throw error;
    }

    if (hashSensitiveCode(code) !== record.code_hash) {
        const error = new Error('Codigo incorrecto');
        error.statusCode = 400;
        throw error;
    }

    if (Number(record.requested_amount || 0) !== Number(amount || 0)) {
        const error = new Error('El importe cambio despues de solicitar el codigo');
        error.statusCode = 400;
        throw error;
    }

    if (String(record.payment_method || '') !== String(paymentMethod || '')) {
        const error = new Error('El medio de pago cambio despues de solicitar el codigo');
        error.statusCode = 400;
        throw error;
    }

    if (String(record.category || '') !== String(category || '')) {
        const error = new Error('La categoria cambio despues de solicitar el codigo');
        error.statusCode = 400;
        throw error;
    }

    await pool.query(
        `UPDATE cash_withdrawal_authorizations
            SET status = 'used', used_at = NOW()
          WHERE \`${TENANT_COLUMN}\` = ? AND id = ?`,
        [tenantInfo.tenantId, authorizationId]
    );

    return {
        authorizationId: record.id,
        recipientEmail: record.recipient_email,
        usedAt: new Date().toISOString(),
    };
}

async function getTableColumns(pool, dbName, table) {
    const key = `${dbName}.${table}`;
    if (tableColCache.has(key)) return tableColCache.get(key);
    const [rows] = await pool.query('DESCRIBE ??', [table]);
    const cols = rows.map(r => r.Field);
    tableColCache.set(key, cols);
    return cols;
}

async function getTableDescribe(pool, dbName, table) {
    const key = `${dbName}.${table}`;
    if (tableDescCache.has(key)) return tableDescCache.get(key);
    const [rows] = await pool.query('DESCRIBE ??', [table]);
    const desc = new Map(rows.map((row) => [row.Field, String(row.Type || '').toLowerCase()]));
    tableDescCache.set(key, desc);
    return desc;
}

// Tablas permitidas (whitelist contra inyección de nombres de tabla)
const ALLOWED_TABLES = new Set([
    'settings', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'products', 'purchase_items',
    'stock', 'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'cash_closures', 'supplier_item_tax_profiles', 'prices', 'product_prices', 'branch_product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'promotions', 'scale_users',
]);

// Columnas que MySQL gestiona solas y no se deben incluir en INSERT/UPDATE
const AUTO_COLS = new Set(['created_at', 'updated_at']);
const JSONISH_FIELDS = new Set(['items', 'payment_breakdown', 'sale_snapshot', 'items_snapshot', 'snapshot', 'promo_payload', 'lot_snapshot', 'cuts', 'category_totals', 'pricing_summary']);

function deserializeRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        if (value == null) {
            out[key] = value;
            continue;
        }
        if (JSONISH_FIELDS.has(key) && typeof value === 'string') {
            try {
                out[key] = JSON.parse(value);
                continue;
            } catch {
                out[key] = value;
                continue;
            }
        }
        out[key] = value;
    }
    return out;
}

async function applyBranchProductPrices(pool, tenantId, branchId, rows) {
    const resolvedBranchId = Number(branchId);
    if (!Number.isFinite(resolvedBranchId) || resolvedBranchId <= 0 || !Array.isArray(rows) || rows.length === 0) {
        return rows;
    }

    const productIds = rows
        .map((row) => Number(row?.id))
        .filter((id) => Number.isFinite(id) && id > 0);
    if (productIds.length === 0) return rows;

    const placeholders = productIds.map(() => '?').join(', ');
    let priceRows;
    try {
        const [rows] = await pool.query(
            `SELECT product_id, price, plu, source, effective_at, updated_at
             FROM branch_product_prices
             WHERE \`${TENANT_COLUMN}\` = ?
               AND branch_id = ?
               AND product_id IN (${placeholders})`,
            [tenantId, resolvedBranchId, ...productIds]
        );
        priceRows = rows;
    } catch (error) {
        if (!isUnknownBranchColumnError(error)) {
            throw error;
        }
        return rows;
    }
    const byProductId = new Map(priceRows.map((row) => [Number(row.product_id), row]));

    return rows.map((row) => {
        const branchPrice = byProductId.get(Number(row?.id));
        if (!branchPrice) return row;
        return {
            ...row,
            global_price: row.current_price,
            current_price: branchPrice.price,
            branch_price: branchPrice.price,
            branch_price_source: branchPrice.source || null,
            branch_price_effective_at: branchPrice.effective_at || branchPrice.updated_at || null,
        };
    });
}

function isDateLikeColumn(columnType) {
    return columnType.includes('datetime') || columnType.includes('timestamp') || columnType === 'date' || columnType.startsWith('date(');
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatMySqlDateValue(date, columnType) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());

    if (columnType === 'date' || columnType.startsWith('date(')) {
        return `${year}-${month}-${day}`;
    }

    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeColumnValue(value, columnType) {
    if (value == null) return value;

    if (isDateLikeColumn(columnType)) {
        if (value instanceof Date) {
            return formatMySqlDateValue(value, columnType);
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return trimmed;

            if (trimmed.includes('T') || trimmed.endsWith('Z')) {
                const parsed = new Date(trimmed);
                const formatted = formatMySqlDateValue(parsed, columnType);
                if (formatted) return formatted;
            }
        }
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return value;
}

function normalizePluValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) {
        const error = new Error('El PLU debe contener solo numeros');
        error.statusCode = 400;
        throw error;
    }
    const numeric = Number.parseInt(raw, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        const error = new Error('El PLU debe ser un numero mayor a 0');
        error.statusCode = 400;
        throw error;
    }
    return String(numeric);
}

function isUnknownBranchColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === 'ER_BAD_FIELD_ERROR' && message.includes('branch_id');
}

async function findProductByPlu(pool, tenantId, plu, excludeProductId = null, branchId = null) {
    const normalizedPlu = normalizePluValue(plu);
    if (!normalizedPlu) return null;

    const params = [tenantId, normalizedPlu, Number.parseInt(normalizedPlu, 10)];
    let sql = `SELECT id, name, plu
               FROM products
               WHERE tenant_id = ?
                 AND COALESCE(active, 1) = 1
                 AND (
                    plu = ?
                    OR (plu REGEXP '^[0-9]+$' AND CAST(plu AS UNSIGNED) = ?)
                 )`;
    const normalizedBranchId = Number(branchId);
    if (Number.isFinite(normalizedBranchId) && normalizedBranchId > 0) {
        sql += ' AND branch_id = ?';
        params.push(normalizedBranchId);
    }
    if (Number.isFinite(Number(excludeProductId)) && Number(excludeProductId) > 0) {
        sql += ' AND id <> ?';
        params.push(Number(excludeProductId));
    }
    sql += ' ORDER BY id ASC LIMIT 1';

    try {
        const [rows] = await pool.query(sql, params);
        return rows?.[0] || null;
    } catch (error) {
        if (!isUnknownBranchColumnError(error) || !(Number.isFinite(normalizedBranchId) && normalizedBranchId > 0)) {
            throw error;
        }
        const retryParams = [tenantId, normalizedPlu, Number.parseInt(normalizedPlu, 10)];
        let retrySql = `SELECT id, name, plu
                        FROM products
                        WHERE tenant_id = ?
                          AND COALESCE(active, 1) = 1
                          AND (
                             plu = ?
                             OR (plu REGEXP '^[0-9]+$' AND CAST(plu AS UNSIGNED) = ?)
                          )`;
        if (Number.isFinite(Number(excludeProductId)) && Number(excludeProductId) > 0) {
            retrySql += ' AND id <> ?';
            retryParams.push(Number(excludeProductId));
        }
        retrySql += ' ORDER BY id ASC LIMIT 1';
        const [rows] = await pool.query(retrySql, retryParams);
        return rows?.[0] || null;
    }
}

async function findPromotionByPromoPlu(pool, tenantId, plu, branchId = null) {
    const normalizedPlu = normalizePluValue(plu);
    if (!normalizedPlu) return null;

    const params = [tenantId, normalizedPlu, Number.parseInt(normalizedPlu, 10)];
    let sql = `SELECT id, promo_name, product_name, promo_plu
               FROM promotions
               WHERE tenant_id = ?
                 AND COALESCE(active, 1) = 1
                 AND (
                    promo_plu = ?
                    OR (promo_plu REGEXP '^[0-9]+$' AND CAST(promo_plu AS UNSIGNED) = ?)
                 )`;
    const normalizedBranchId = Number(branchId);
    if (Number.isFinite(normalizedBranchId) && normalizedBranchId > 0) {
        // Una promo con branch_id NULL aplica a todas las sucursales, asi que tambien colisiona.
        sql += ' AND (branch_id = ? OR branch_id IS NULL)';
        params.push(normalizedBranchId);
    }
    sql += ' ORDER BY id ASC LIMIT 1';

    try {
        const [rows] = await pool.query(sql, params);
        return rows?.[0] || null;
    } catch (error) {
        // Si la tabla/columna de promos no existe en este tenant, no bloqueamos el alta de productos.
        if (error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR') return null;
        throw error;
    }
}

async function assertUniqueProductPlu(pool, tenantId, plu, excludeProductId = null, branchId = null) {
    const normalizedPlu = normalizePluValue(plu);

    const conflict = await findProductByPlu(pool, tenantId, plu, excludeProductId, branchId);
    if (conflict) {
        const error = new Error(`El PLU ${normalizedPlu} ya esta asignado a "${conflict.name}" (producto ${conflict.id})`);
        error.statusCode = 409;
        throw error;
    }

    // Un PLU de balanza es un slot unico: tampoco puede pisar el promo_plu de una
    // promocion activa, porque eso deja el catalogo con PLUs duplicados y el bridge
    // se niega a sincronizar (deja toda la balanza sin programar).
    const promoConflict = await findPromotionByPromoPlu(pool, tenantId, plu, branchId);
    if (promoConflict) {
        const promoLabel = String(promoConflict.promo_name || promoConflict.product_name || '').trim();
        const error = new Error(`El PLU ${normalizedPlu} ya lo usa la promocion "${promoLabel}" (promo ${promoConflict.id})`);
        error.statusCode = 409;
        throw error;
    }
}

async function resolveProductRecordCategory(pool, tenantId, record) {
    if (!record || typeof record !== 'object') return record;

    const next = { ...record };
    const rawCategoryId = next.category_id;
    const normalizedCategoryId = Number(rawCategoryId);
    const categoryNameInput = String(next.category || '').trim();

    if (Number.isFinite(normalizedCategoryId) && normalizedCategoryId > 0) {
        const category = await findProductCategoryById(pool, tenantId, normalizedCategoryId);
        if (category) {
            next.category_id = category.id;
            next.category = category.code;
            return next;
        }
    }

    if (categoryNameInput) {
        const category = await findOrCreateProductCategory(pool, tenantId, categoryNameInput);
        if (category) {
            next.category_id = category.id;
            next.category = category.code;
        }
        return next;
    }

    if (rawCategoryId == null || rawCategoryId === '') {
        next.category_id = null;
    }

    return next;
}

function normalizeProductCategoryCode(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100);
}

async function findProductCategoryById(pool, tenantId, categoryId) {
    if (!Number.isFinite(Number(categoryId)) || Number(categoryId) <= 0) return null;
    const [rows] = await pool.query(
        `SELECT id, code, name
         FROM product_categories
         WHERE \`${TENANT_COLUMN}\` = ? AND id = ?
         LIMIT 1`,
        [tenantId, Number(categoryId)]
    );
    return rows?.[0] || null;
}

async function findOrCreateProductCategory(pool, tenantId, rawNameOrCode) {
    const trimmed = String(rawNameOrCode || '').trim();
    if (!trimmed) return null;
    const code = normalizeProductCategoryCode(trimmed);
    if (!code) return null;

    const [existingRows] = await pool.query(
        `SELECT id, code, name
         FROM product_categories
         WHERE \`${TENANT_COLUMN}\` = ? AND (code = ? OR LOWER(name) = LOWER(?))
         ORDER BY id ASC
         LIMIT 1`,
        [tenantId, code, trimmed]
    );
    if (existingRows?.length) return existingRows[0];

    const [insertResult] = await pool.query(
        `INSERT INTO product_categories (\`${TENANT_COLUMN}\`, code, name, active)
         VALUES (?, ?, ?, 1)`,
        [tenantId, code, trimmed]
    );
    return {
        id: insertResult.insertId,
        code,
        name: trimmed,
    };
}

function normalizeBranchCodeValue(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractBranchCodeFromReceipt(receiptCode) {
    const match = String(receiptCode || '').trim().match(/^(\d{4})-/);
    return match ? normalizeBranchCodeValue(match[1]) : null;
}

function normalizeWhatsAppPhone(rawValue) {
    const digits = String(rawValue || '').replace(/\D/g, '');
    if (!digits) return null;
    const normalized = digits.startsWith('00') ? digits.slice(2) : digits;
    if (normalized.length < 10 || normalized.length > 15) return null;
    return normalized;
}

function formatPromoBroadcastMessage({ businessName, promo }) {
    const safeBusiness = String(businessName || '').trim();
    const safeProduct = String(promo?.product_name || 'Producto').trim();
    const minKg = Number(promo?.min_qty_kg || 0).toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const promoPrice = Number(promo?.promo_total_price || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const promoPriceMode = String(promo?.promo_price_mode || 'total_kg').trim().toLowerCase();
    const promoText = promoPriceMode === 'per_kg'
        ? `${safeProduct}: desde *${minKg} kg*, cada kg a *$${promoPrice}*`
        : `${safeProduct}: llevando *${minKg} kg* pagás *$${promoPrice}* en total`;
    const header = safeBusiness ? `🥩 *${safeBusiness}*` : '🥩 *Nueva promo*';
    return [
        header,
        '',
        '🔥 *PROMOCIÓN NUEVA*',
        promoText,
        '',
        'Te esperamos en el local.',
    ].join('\n');
}

async function getTenantSettingValue(pool, tenantId, key) {
    const [rows] = await pool.query(
        'SELECT value FROM settings WHERE `tenant_id` = ? AND `key` = ? LIMIT 1',
        [tenantId, key]
    );
    return rows?.[0]?.value ?? null;
}

async function getActivePromotions(pool, tenantId, limit = 25) {
    const [rows] = await pool.query(
        `SELECT id, product_id, product_name, min_qty_kg, promo_total_price, promo_price_mode, active
         FROM promotions
         WHERE \`${TENANT_COLUMN}\` = ? AND active = 1
         ORDER BY id DESC
         LIMIT ?`,
        [tenantId, Number(limit) || 25]
    );
    return Array.isArray(rows) ? rows : [];
}

async function resolveWhatsAppCloudConfig(pool, tenantId) {
    const [tokenSetting, phoneIdSetting, versionSetting] = await Promise.all([
        getTenantSettingValue(pool, tenantId, 'whatsapp_cloud_api_token').catch(() => null),
        getTenantSettingValue(pool, tenantId, 'whatsapp_cloud_phone_number_id').catch(() => null),
        getTenantSettingValue(pool, tenantId, 'whatsapp_cloud_api_version').catch(() => null),
    ]);

    return {
        token: String(tokenSetting || process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim(),
        phoneNumberId: String(phoneIdSetting || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '').trim(),
        apiVersion: String(versionSetting || process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0').trim(),
    };
}

async function sendWhatsAppCloudTextMessage({ to, body, cloudConfig }) {
    const token = String(cloudConfig?.token || '').trim();
    const phoneNumberId = String(cloudConfig?.phoneNumberId || '').trim();
    const apiVersion = String(cloudConfig?.apiVersion || 'v21.0').trim();

    if (!token || !phoneNumberId) {
        throw new Error('WhatsApp Cloud API no configurada (faltan WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_CLOUD_PHONE_NUMBER_ID)');
    }

    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body },
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const providerError = payload?.error?.message || payload?.error?.error_user_msg || response.statusText || 'Unknown provider error';
        throw new Error(providerError);
    }
    return payload;
}

async function enqueuePromotionBroadcast({ pool, tenantId, promo }) {
    try {
        const autoBroadcastSetting = await getTenantSettingValue(pool, tenantId, 'whatsapp_auto_broadcast_promotions');
        const autoBroadcastEnabled = autoBroadcastSetting == null
            ? true
            : ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(String(autoBroadcastSetting).trim().toLowerCase());

        if (!autoBroadcastEnabled) {
            return { queued: 0, enabled: false, reason: 'disabled_by_setting' };
        }

        const cloudConfig = await resolveWhatsAppCloudConfig(pool, tenantId);
        const token = String(cloudConfig.token || '').trim();
        const phoneNumberId = String(cloudConfig.phoneNumberId || '').trim();
        if (!token || !phoneNumberId) {
            return { queued: 0, enabled: false, reason: 'provider_not_configured' };
        }

        const [clientRows] = await pool.query(
            `SELECT id, name, phone, phone1, phone2, phones
             FROM clients
             WHERE \`${TENANT_COLUMN}\` = ?`,
            [tenantId]
        );

        const uniquePhones = new Set();
        for (const row of clientRows || []) {
            const candidates = [];
            candidates.push(row?.phone);
            candidates.push(row?.phone1);
            candidates.push(row?.phone2);
            const phonesBlob = String(row?.phones || '');
            if (phonesBlob) {
                phonesBlob.split(/[\n,;]+/).forEach((value) => candidates.push(value));
            }
            candidates
                .map(normalizeWhatsAppPhone)
                .filter(Boolean)
                .forEach((phone) => uniquePhones.add(phone));
        }

        const recipients = [...uniquePhones];
        if (recipients.length === 0) {
            return { queued: 0, enabled: true, reason: 'no_recipients' };
        }

        const businessName =
            await getTenantSettingValue(pool, tenantId, 'business_name')
            || await getTenantSettingValue(pool, tenantId, 'store_name')
            || await getTenantSettingValue(pool, tenantId, 'store_display_name')
            || await getTenantSettingValue(pool, tenantId, 'local_name')
            || '';

        const message = formatPromoBroadcastMessage({ businessName, promo });

        setImmediate(async () => {
            let sent = 0;
            let failed = 0;
            for (const phone of recipients) {
                try {
                    await sendWhatsAppCloudTextMessage({ to: phone, body: message, cloudConfig });
                    sent += 1;
                } catch (error) {
                    failed += 1;
                    console.warn(`[PROMO WHATSAPP] Error enviando a ${phone}: ${error?.message || error}`);
                }
            }
            console.log(`[PROMO WHATSAPP] tenant=${tenantId} promo=${promo?.id || '-'} sent=${sent} failed=${failed}`);
        });

        return { queued: recipients.length, enabled: true };
    } catch (error) {
        console.warn(`[PROMO WHATSAPP] No se pudo encolar difusión: ${error?.message || error}`);
        return { queued: 0, enabled: false, reason: 'internal_error' };
    }
}

// ── RUTA: POST /api/data ───────────────────────────────────────────────────
// Recibe { table, operation, record, id } y replica la operación en MySQL
// operations: insert | update | delete | upsert
app.post('/api/data', verifyFirebaseToken, async (req, res) => {
    try {
        const { table, operation, record, id } = req.body;

        if (!table || !ALLOWED_TABLES.has(table)) {
            return res.status(400).json({ error: 'Tabla no permitida' });
        }
        if (!operation) {
            return res.status(400).json({ error: 'Operación requerida' });
        }

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        if (!tenantId && tenantId !== 0) {
            console.error('[DATA] tenantId es null/undefined después de getTenantInfo');
            return res.status(500).json({ error: 'No se pudo resolver el tenant del usuario' });
        }
        const pool = getTenantPool(dbName);
        const tableDesc = await getTableDescribe(pool, dbName, table);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        const normalizedRecord = table === 'products'
            ? await resolveProductRecordCategory(pool, tenantId, record)
            : record;
        const normalizedOperation = String(operation || '').trim().toLowerCase();
        if (table === 'settings' && ['insert', 'upsert', 'update', 'delete'].includes(normalizedOperation)) {
            const targetSettingKey = await resolveTargetSettingKey({
                pool,
                tenantId,
                operation: normalizedOperation,
                record: normalizedRecord || record || {},
                id,
            });

            if (targetSettingKey && isAdminOnlySettingKey(targetSettingKey) && !canWriteProtectedSettings(accessContext)) {
                return res.status(403).json({ error: 'Solo un administrador puede modificar esta configuración' });
            }
        }
        if (table === 'promotions' && ['insert', 'upsert', 'update', 'delete'].includes(normalizedOperation)) {
            if (!canWriteProtectedSettings(accessContext)) {
                return res.status(403).json({ error: 'Solo un administrador puede modificar promociones' });
            }
        }

        // Helper: filtra el objeto para que solo tenga columnas válidas en MySQL
        const filterRecord = async (rec, excludeId = false) => {
            const validCols = await getTableColumns(pool, dbName, table);
            const out = {};
            const resolvedBranchId = validCols.includes('branch_id') && BRANCH_SCOPED_TABLES.has(table)
                ? await resolveOperationalBranchId({ pool, tenantId, accessContext, record: rec || {} })
                : null;
            if (validCols.includes('branch_id') && STRICT_BRANCH_SCOPED_TABLES.has(table)) {
                const requestedBranchId = Number(rec?.branch_id ?? rec?.branchId ?? resolvedBranchId);
                if (!Number.isFinite(requestedBranchId) || requestedBranchId <= 0) {
                    const error = new Error(`Debe especificar branch_id para ${table}`);
                    error.statusCode = 400;
                    throw error;
                }
            }
            for (const col of validCols) {
                if (AUTO_COLS.has(col)) continue;
                if (excludeId && col === 'id') continue;
                if (col === TENANT_COLUMN) {
                    out[col] = tenantId;
                    continue;
                }
                if (col === 'branch_id') {
                    const nextBranchId = Number(rec?.branch_id ?? rec?.branchId ?? resolvedBranchId);
                    if (Number.isFinite(nextBranchId) && nextBranchId > 0) {
                        out[col] = nextBranchId;
                    }
                    continue;
                }
                if (rec[col] !== undefined && rec[col] !== null) {
                    out[col] = normalizeColumnValue(rec[col], tableDesc.get(col) || '');
                }
            }
            return out;
        };

        const assertCashMovementBranch = async (filtered, recordId = null) => {
            if (table !== 'caja_movimientos') return;
            const branchId = Number(filtered?.branch_id);
            if (Number.isFinite(branchId) && branchId > 0) return;
            if (!accessContext?.client?.id) return;
            if (recordId) {
                const scope = tenantWhereClause(table, tenantId);
                const [existingRows] = await pool.query(
                    `SELECT branch_id FROM \`${table}\` WHERE id = ? AND ${scope.sql} LIMIT 1`,
                    [recordId, ...scope.params]
                );
                const existingBranchId = Number(existingRows?.[0]?.branch_id);
                if (Number.isFinite(existingBranchId) && existingBranchId > 0) return;
            }

            const activeBranches = await listClientBranches(accessContext.client.id);
            if (activeBranches.length > 1) {
                const error = new Error('Debe especificar branch_id para movimientos de caja');
                error.statusCode = 400;
                throw error;
            }
        };

        if (operation === 'insert') {
            if (!normalizedRecord) return res.status(400).json({ error: 'record requerido' });
            const filtered = await filterRecord(normalizedRecord, false); // incluir id si viene (Dexie lo manda)
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para insertar' });
            }
            // Auditoría de caja: registramos quién hace el movimiento desde el
            // usuario autenticado en el server (no se confía en el front).
            if (table === 'caja_movimientos' || table === 'cash_closures') {
                const creator = resolveCajaCreator(accessContext, req);
                for (const col of CAJA_CREATOR_COLUMNS) {
                    if (tableDesc.has(col) && creator[col] !== null && creator[col] !== undefined) {
                        filtered[col] = creator[col];
                    }
                }
            }
            await assertCashMovementBranch(filtered);
            if (table === 'products') {
                filtered.plu = normalizePluValue(filtered.plu);
                await assertUniqueProductPlu(pool, tenantId, filtered.plu, null, filtered.branch_id);
            }
            try {
                const [result] = await pool.query('INSERT INTO ?? SET ?', [table, filtered]);
                if (table === 'promotions') {
                    const promoToBroadcast = {
                        id: result.insertId,
                        product_name: filtered.product_name || null,
                        min_qty_kg: filtered.min_qty_kg || 0,
                        promo_total_price: filtered.promo_total_price || 0,
                        promo_price_mode: filtered.promo_price_mode || 'total_kg',
                        active: Number(filtered.active ?? 1) === 1,
                    };
                    if (promoToBroadcast.active) {
                        const broadcast = await enqueuePromotionBroadcast({ pool, tenantId, promo: promoToBroadcast });
                        await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: filtered, id: result.insertId });
                        return res.json({ ok: true, insertId: result.insertId, broadcast });
                    }
                }
                await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: filtered, id: result.insertId });
                return res.json({ ok: true, insertId: result.insertId });
            } catch (insertError) {
                if (insertError?.code === 'ER_DUP_ENTRY' && table === 'products' && filtered.canonical_key) {
                    const scope = tenantWhereClause(table, tenantId);
                    const branchClause = Number(filtered.branch_id) > 0 ? ' AND branch_id = ?' : '';
                    const branchParams = Number(filtered.branch_id) > 0 ? [Number(filtered.branch_id)] : [];
                    const [existingRows] = await pool.query(
                        `SELECT id, active FROM \`${table}\` WHERE canonical_key = ? AND ${scope.sql}${branchClause} LIMIT 1`,
                        [filtered.canonical_key, ...scope.params, ...branchParams]
                    );
                    const existing = existingRows?.[0] || null;
                    const existingId = existing?.id;
                    if (existingId) {
                        if (Number(existing.active ?? 1) === 0) {
                            const restorePayload = {
                                ...filtered,
                                active: 1,
                                deleted_at: null,
                                archived_plu: null,
                                updated_at: new Date(),
                            };
                            await pool.query(
                                `UPDATE \`${table}\` SET ? WHERE id = ? AND ${scope.sql}`,
                                [restorePayload, existingId, ...scope.params]
                            );
                            await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: restorePayload, id: existingId });
                            return res.json({ ok: true, insertId: existingId, restored: true });
                        }
                        await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: filtered, id: existingId });
                        return res.json({ ok: true, insertId: existingId, existed: true });
                    }
                }
                throw insertError;
            }
        }

        if (operation === 'update') {
            const numId = parseInt(id, 10);
            if (!numId) return res.status(400).json({ error: 'id numérico requerido para update' });
            const filtered = await filterRecord(normalizedRecord, true); // excluir id del SET
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para actualizar' });
            }
            await assertCashMovementBranch(filtered, numId);
            if (table === 'products' && Object.prototype.hasOwnProperty.call(filtered, 'plu')) {
                filtered.plu = normalizePluValue(filtered.plu);
                await assertUniqueProductPlu(pool, tenantId, filtered.plu, numId, filtered.branch_id);
            }
            const scope = tenantWhereClause(table, tenantId);
            const strictBranchId = Number(filtered.branch_id);
            const strictBranchSql = STRICT_BRANCH_SCOPED_TABLES.has(table) && Number.isFinite(strictBranchId) && strictBranchId > 0
                ? ' AND `branch_id` = ?'
                : '';
            const strictBranchParams = strictBranchSql ? [strictBranchId] : [];
            await pool.query(
                `UPDATE \`${table}\` SET ? WHERE id = ? AND ${scope.sql}${strictBranchSql}`,
                [filtered, numId, ...scope.params, ...strictBranchParams]
            );
            await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: filtered, id: numId });
            return res.json({ ok: true });
        }

        if (operation === 'delete') {
            const numId = parseInt(id, 10);
            if (!numId) return res.status(400).json({ error: 'id numérico requerido para delete' });
            const scope = tenantWhereClause(table, tenantId);
            let strictBranchSql = '';
            let strictBranchParams = [];
            if (STRICT_BRANCH_SCOPED_TABLES.has(table)) {
                const resolvedBranchId = await resolveOperationalBranchId({ pool, tenantId, accessContext, record: {} });
                if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
                    strictBranchSql = ' AND `branch_id` = ?';
                    strictBranchParams = [resolvedBranchId];
                }
            }
            if (table === 'products') {
                const [result] = await pool.query(
                    `UPDATE \`${table}\`
                     SET active = 0,
                         deleted_at = NOW(),
                         archived_plu = COALESCE(archived_plu, plu),
                         plu = NULL,
                         updated_at = NOW()
                     WHERE id = ? AND ${scope.sql}${strictBranchSql}`,
                    [numId, ...scope.params, ...strictBranchParams]
                );
                await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: {}, id: numId });
                return res.json({ ok: true, archived: Number(result?.affectedRows || 0) > 0 });
            }
            await pool.query(`DELETE FROM \`${table}\` WHERE id = ? AND ${scope.sql}${strictBranchSql}`, [numId, ...scope.params, ...strictBranchParams]);
            await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: {}, id: numId });
            return res.json({ ok: true });
        }

        if (operation === 'upsert') {
            // Para settings (PK = key) u otras tablas con ON DUPLICATE KEY UPDATE
            if (!normalizedRecord) return res.status(400).json({ error: 'record requerido' });
            const filtered = await filterRecord(normalizedRecord, false);
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para upsert' });
            }
            const cols    = Object.keys(filtered).map(c => `\`${c}\``).join(', ');
            const vals    = Object.values(filtered);
            const holders = vals.map(() => '?').join(', ');
            const updates = Object.keys(filtered)
                .filter(c => c !== 'key' && c !== 'id' && c !== TENANT_COLUMN)
                .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
                .join(', ');
            await pool.query(
                `INSERT INTO \`${table}\` (${cols}) VALUES (${holders}) ON DUPLICATE KEY UPDATE ${updates}`,
                vals
            );
            await queueScaleProductSyncIfNeeded({ pool, tenantId, table, operation, record: filtered, id });
            return res.json({ ok: true });
        }

        return res.status(400).json({ error: 'Operación inválida' });

    } catch (err) {
        console.error('[DATA ERROR]', err.message);
        res.status(err.statusCode || 500).json({ error: 'Error de datos: ' + err.message });
    }
});

// ── RUTA: GET /api/settings/:key ───────────────────────────────────────────
// Devuelve una setting puntual desde la BD MySQL del tenant autenticado.
const normalizeCashSummaryDate = (value) => {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = raw ? new Date(raw) : new Date();
    if (!Number.isFinite(d.getTime())) {
        const error = new Error('date invalida. Use YYYY-MM-DD');
        error.statusCode = 400;
        throw error;
    }
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const normalizeCashAccountToken = (value) => {
    const token = String(value || '').trim().toLowerCase();
    if (['secundaria', 'secondary', 'caja_secundaria'].includes(token)) return 'secondary';
    return 'principal';
};

const emptyCashSummaryTotals = () => ({
    accumulated: 0,
    opening: 0,
    sales: 0,
    manualIncomes: 0,
    manualExpenses: 0,
    reversals: 0,
    dailyNet: 0,
});

const addCashSummaryTotals = (target, source) => {
    target.accumulated += Number(source.accumulated || 0);
    target.opening += Number(source.opening || 0);
    target.sales += Number(source.sales || 0);
    target.manualIncomes += Number(source.manualIncomes || 0);
    target.manualExpenses += Number(source.manualExpenses || 0);
    target.reversals += Number(source.reversals || 0);
    target.dailyNet += Number(source.dailyNet || 0);
};

const emptyCashAccountBalances = () => ({
    principal: 0,
    secondary: 0,
});

// Redondeo a 2 decimales para montos de caja (evita basura de coma flotante
// en el teorico/contado/diferencia del cierre).
const roundCash2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Efectivo ESPERADO del dia (modelo diario, sin arrastre): apertura + ventas en
// efectivo + ingresos - gastos/retiros - anulaciones, acotado a un solo dia y a
// una sola cuenta de caja, contando SOLO metodos de tipo efectivo. Es la misma
// definicion que usa /api/caja/summary por metodo (suma de daily_net de filas
// cash), por eso el numero que ve el usuario coincide exacto con el que guarda el
// cierre. Incluye las patas de transferencia que caen en efectivo (ingreso/retiro)
// porque afectan realmente lo que hay en el cajon. Excluye cuenta corriente
// (nunca es efectivo fisico).
const fetchCajaDailyCash = async (pool, { tenantId, selectedDate, branchId, cashAccount }) => {
    const start = `${selectedDate} 00:00:00`;
    const end = `${selectedDate} 23:59:59`;
    const account = normalizeCashAccountToken(cashAccount);
    const where = [
        '`tenant_id` = ?',
        '`date` IS NOT NULL',
        '`date` >= ?',
        '`date` <= ?',
        "LOWER(COALESCE(NULLIF(TRIM(payment_method_type), ''), 'cash')) = 'cash'",
        `CASE
            WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
            ELSE 'principal'
        END = ?`,
    ];
    const params = [tenantId, start, end, account];
    if (Number.isFinite(branchId) && branchId > 0) {
        where.push('`branch_id` = ?');
        params.push(branchId);
    }

    const [rows] = await pool.query(
        `SELECT
            SUM(CASE WHEN type = 'apertura' THEN COALESCE(amount, 0) ELSE 0 END) AS opening,
            SUM(CASE WHEN type = 'venta' THEN COALESCE(amount, 0) ELSE 0 END) AS sales,
            SUM(CASE WHEN type = 'ingreso' THEN COALESCE(amount, 0) ELSE 0 END) AS incomes,
            SUM(CASE WHEN type IN ('egreso', 'retiro') THEN COALESCE(amount, 0) ELSE 0 END) AS expenses,
            SUM(CASE WHEN type = 'anulacion_venta' THEN COALESCE(amount, 0) ELSE 0 END) AS reversals
         FROM caja_movimientos
         WHERE ${where.join(' AND ')}`,
        params
    );

    const r = rows[0] || {};
    const opening = Number(r.opening || 0);
    const sales = Number(r.sales || 0);
    const incomes = Number(r.incomes || 0);
    const expenses = Number(r.expenses || 0);
    const reversals = Number(r.reversals || 0);
    const expected = opening + sales + incomes - expenses - reversals;
    return { opening, sales, incomes, expenses, reversals, expected };
};

// Resumen contable de caja: el saldo sale del backend y no de la lista paginada.
app.get('/api/caja/summary', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const selectedDate = normalizeCashSummaryDate(req.query.date);
        const start = `${selectedDate} 00:00:00`;
        const end = `${selectedDate} 23:59:59`;
        const requestedCashAccount = String(req.query.cash_account || '').trim();
        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: {
                    branch_id: req.query.branch_id,
                    branchId: req.query.branchId,
                    receipt_code: req.query.receipt_code,
                },
            })
            : null;

        const where = [
            '`tenant_id` = ?',
            '`date` IS NOT NULL',
            '`date` <= ?',
            `NOT (
                LOWER(COALESCE(payment_method_type, '')) = 'cuenta_corriente'
                OR LOWER(COALESCE(payment_method, '')) = 'cuenta corriente'
            )`,
        ];
        const params = [tenantId, end];

        if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            where.push('`branch_id` = ?');
            params.push(resolvedBranchId);
        }

        if (requestedCashAccount) {
            where.push(`CASE
                WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                ELSE 'principal'
            END = ?`);
            params.push(normalizeCashAccountToken(requestedCashAccount));
        }

        const [rows] = await pool.query(
            `SELECT
                CASE
                    WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                    ELSE 'principal'
                END AS cash_account,
                COALESCE(NULLIF(TRIM(payment_method), ''), 'Efectivo') AS payment_method,
                COALESCE(NULLIF(TRIM(payment_method_type), ''), 'cash') AS payment_method_type,
                SUM(CASE
                    WHEN type IN ('apertura', 'ingreso', 'venta') THEN COALESCE(amount, 0)
                    WHEN type IN ('egreso', 'retiro', 'anulacion_venta') THEN -COALESCE(amount, 0)
                    ELSE COALESCE(amount, 0)
                END) AS accumulated,
                SUM(CASE WHEN date >= ? AND date <= ? AND type = 'apertura' THEN COALESCE(amount, 0) ELSE 0 END) AS opening,
                SUM(CASE WHEN date >= ? AND date <= ? AND type = 'venta' THEN COALESCE(amount, 0) ELSE 0 END) AS sales,
                SUM(CASE WHEN date >= ? AND date <= ? AND type = 'ingreso' THEN COALESCE(amount, 0) ELSE 0 END) AS manual_incomes,
                SUM(CASE WHEN date >= ? AND date <= ? AND type IN ('egreso', 'retiro') THEN COALESCE(amount, 0) ELSE 0 END) AS manual_expenses,
                SUM(CASE WHEN date >= ? AND date <= ? AND type = 'anulacion_venta' THEN COALESCE(amount, 0) ELSE 0 END) AS reversals,
                SUM(CASE
                    WHEN date >= ? AND date <= ? AND type IN ('apertura', 'ingreso', 'venta') THEN COALESCE(amount, 0)
                    WHEN date >= ? AND date <= ? AND type IN ('egreso', 'retiro', 'anulacion_venta') THEN -COALESCE(amount, 0)
                    ELSE 0
                END) AS daily_net
             FROM caja_movimientos
             WHERE ${where.join(' AND ')}
             GROUP BY cash_account, payment_method, payment_method_type
             ORDER BY cash_account ASC, payment_method ASC`,
            [
                start, end,
                start, end,
                start, end,
                start, end,
                start, end,
                start, end,
                start, end,
                ...params,
            ]
        );

        const saleWhere = [
            '`tenant_id` = ?',
            '`date` IS NOT NULL',
            '`date` >= ?',
            '`date` <= ?',
            `(
                \`clientId\` IS NOT NULL
                OR LOWER(TRIM(COALESCE(\`payment_method\`, ''))) = 'cuenta corriente'
                OR COALESCE(\`payment_breakdown\`, '') LIKE '%cuenta_corriente%'
                OR COALESCE(\`payment_breakdown\`, '') LIKE '%cuenta corriente%'
            )`,
        ];
        const saleParams = [tenantId, start, end];
        if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            saleWhere.push('`branch_id` = ?');
            saleParams.push(resolvedBranchId);
        }
        const [currentAccountSaleRows] = await pool.query(
            `SELECT total, payment_method, payment_breakdown
             FROM ventas
             WHERE ${saleWhere.join(' AND ')}`,
            saleParams
        );
        const currentAccountSales = currentAccountSaleRows.reduce(
            (sum, sale) => sum + currentAccountAmountFromStoredSale(sale),
            0
        );

        const byCashAccount = {};
        const groupedRows = new Map();
        rows.forEach((row) => {
            const totals = {
                accumulated: Number(row.accumulated || 0),
                opening: Number(row.opening || 0),
                sales: Number(row.sales || 0),
                manualIncomes: Number(row.manual_incomes || 0),
                manualExpenses: Number(row.manual_expenses || 0),
                reversals: Number(row.reversals || 0),
                dailyNet: Number(row.daily_net || 0),
            };
            const cashAccount = normalizeCashAccountToken(row.cash_account);
            const name = String(row.payment_method || 'Efectivo').trim() || 'Efectivo';
            const type = String(row.payment_method_type || 'cash').trim() || 'cash';
            const key = `${cashAccount}|${name.toLowerCase()}|${type.toLowerCase()}`;
            if (!groupedRows.has(key)) {
                groupedRows.set(key, {
                    cashAccount,
                    name,
                    type,
                    ...emptyCashSummaryTotals(),
                });
            }
            addCashSummaryTotals(groupedRows.get(key), totals);
        });

        const byPaymentMethod = Array.from(groupedRows.values()).map((row) => {
            const totals = {
                accumulated: Number(row.accumulated || 0),
                opening: Number(row.opening || 0),
                sales: Number(row.sales || 0),
                manualIncomes: Number(row.manualIncomes || 0),
                manualExpenses: Number(row.manualExpenses || 0),
                reversals: Number(row.reversals || 0),
                dailyNet: Number(row.dailyNet || 0),
            };
            if (!byCashAccount[row.cashAccount]) byCashAccount[row.cashAccount] = emptyCashSummaryTotals();
            addCashSummaryTotals(byCashAccount[row.cashAccount], totals);
            return {
                cashAccount: row.cashAccount,
                name: row.name,
                type: row.type,
                ...totals,
                today: {
                    opening: totals.opening,
                    sales: totals.sales,
                    manualIncomes: totals.manualIncomes,
                    manualExpenses: totals.manualExpenses,
                    reversals: totals.reversals,
                    net: totals.dailyNet,
                },
            };
        });

        const totals = emptyCashSummaryTotals();
        Object.values(byCashAccount).forEach((cashTotals) => addCashSummaryTotals(totals, cashTotals));

        // Efectivo por cuenta de caja (SOLO metodos cash). expectedToday es el
        // efectivo esperado del dia (modelo diario, sin arrastre) = apertura +
        // ventas efectivo + ingresos - gastos - anulaciones. accumulated es el
        // saldo arrastrado + hoy. Es lo que consume la pantalla de cierre para
        // mostrar y para pre-cargar el modal de conteo; coincide exacto con lo que
        // recalcula POST /api/caja/closure (misma definicion de "cash").
        const cashByAccount = {};
        byPaymentMethod.forEach((method) => {
            if (String(method.type || '').trim().toLowerCase() !== 'cash') return;
            const account = normalizeCashAccountToken(method.cashAccount);
            if (!cashByAccount[account]) {
                cashByAccount[account] = {
                    expectedToday: 0,
                    accumulated: 0,
                    opening: 0,
                    sales: 0,
                    incomes: 0,
                    expenses: 0,
                    reversals: 0,
                };
            }
            const bucket = cashByAccount[account];
            bucket.expectedToday += Number(method.dailyNet || 0);
            bucket.accumulated += Number(method.accumulated || 0);
            bucket.opening += Number(method.opening || 0);
            bucket.sales += Number(method.sales || 0);
            bucket.incomes += Number(method.manualIncomes || 0);
            bucket.expenses += Number(method.manualExpenses || 0);
            bucket.reversals += Number(method.reversals || 0);
        });
        Object.values(cashByAccount).forEach((bucket) => {
            bucket.expectedToday = roundCash2(bucket.expectedToday);
            bucket.accumulated = roundCash2(bucket.accumulated);
            bucket.opening = roundCash2(bucket.opening);
            bucket.sales = roundCash2(bucket.sales);
            bucket.incomes = roundCash2(bucket.incomes);
            bucket.expenses = roundCash2(bucket.expenses);
            bucket.reversals = roundCash2(bucket.reversals);
            bucket.netSales = roundCash2(bucket.sales - bucket.reversals);
        });

        // Cierres YA registrados para el dia seleccionado (uno por cuenta de caja).
        // El frontend usa esto para saber si la caja ya se cerro y mostrar el
        // arqueo (teorico/contado/diferencia) en vez del boton de cerrar.
        const closureWhere = ['`tenant_id` = ?', '`closure_date` = ?'];
        const closureParams = [tenantId, selectedDate];
        if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            closureWhere.push('`branch_id` = ?');
            closureParams.push(resolvedBranchId);
        }
        let closures = [];
        try {
            const [closureRows] = await pool.query(
                `SELECT * FROM cash_closures WHERE ${closureWhere.join(' AND ')} ORDER BY id DESC`,
                closureParams
            );
            closures = isAdminAccessContext(accessContext)
                ? closureRows
                : stripCajaCreatorFields(closureRows);
        } catch (closureErr) {
            console.warn('[CAJA SUMMARY] no se pudieron leer cierres:', closureErr?.message || closureErr);
        }

        return res.json({
            ok: true,
            date: selectedDate,
            branchId: Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 ? resolvedBranchId : null,
            includesLegacyGlobalMovements: Number.isFinite(resolvedBranchId) && resolvedBranchId > 0,
            accumulatedBalance: totals.accumulated,
            currentAccountSales,
            dailyBalance: {
                opening: totals.opening,
                sales: totals.sales,
                manualIncomes: totals.manualIncomes,
                manualExpenses: totals.manualExpenses,
                reversals: totals.reversals,
                net: totals.dailyNet,
            },
            byCashAccount,
            cashByAccount,
            closures,
            byPaymentMethod,
        });
    } catch (err) {
        const statusCode = err?.statusCode || 500;
        console.error('[CAJA SUMMARY ERROR]', err.message);
        res.status(statusCode).json({ error: err.message || 'No se pudo calcular el resumen de caja' });
    }
});

app.get('/api/caja/report-data', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const fromDate = normalizeCashSummaryDate(req.query.from);
        const toDate = normalizeCashSummaryDate(req.query.to);
        const compareFromDate = normalizeCashSummaryDate(req.query.compare_from || req.query.from);
        const requestedCashAccount = String(req.query.cash_account || '').trim();
        const selectedCashAccount = requestedCashAccount ? normalizeCashAccountToken(requestedCashAccount) : null;
        const earliestDate = compareFromDate < fromDate ? compareFromDate : fromDate;
        const periodStart = `${earliestDate} 00:00:00`;
        const currentStart = `${fromDate} 00:00:00`;
        const previousStart = `${compareFromDate} 00:00:00`;
        const rangeEnd = `${toDate} 23:59:59`;

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: {
                    branch_id: req.query.branch_id,
                    branchId: req.query.branchId,
                    receipt_code: req.query.receipt_code,
                },
            })
            : null;

        const activeBranches = accessContext?.client?.id ? await listClientBranches(accessContext.client.id) : [];
        const requiresExplicitBranch = hasMultipleActiveBranches(activeBranches);
        if (requiresExplicitBranch && (!Number.isFinite(resolvedBranchId) || resolvedBranchId <= 0)) {
            if (STRICT_BRANCH_SCOPING) {
                return res.status(400).json({
                    error: 'Debe especificar branch_id para consultar caja',
                    code: 'BRANCH_REQUIRED',
                    activeBranches: activeBranches.map((branch) => ({ id: branch.id, name: branch.name })),
                });
            }
            warnBranchScopeFallback('cash-report-without-branch', {
                tenantId,
                clientId: accessContext?.client?.id ?? null,
                userId: accessContext?.user?.id ?? null,
                path: req.path,
            });
        }

        const where = ['tenant_id = ?'];
        const params = [tenantId];
        const branchScope = buildBranchScopeClause({
            branchId: resolvedBranchId,
            allowLegacyNullFallback: false,
        });
        if (branchScope.sql) {
            where.push(branchScope.sql);
            params.push(...branchScope.params);
        }

        const cashAccountWhere = selectedCashAccount
            ? ` AND CASE
                    WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                    ELSE 'principal'
                END = ?`
            : '';
        const cashAccountParams = selectedCashAccount ? [selectedCashAccount] : [];

        const [[movementRows], [closureRows], [currentInitialRows], [previousInitialRows]] = await Promise.all([
            pool.query(
                `SELECT *
                 FROM caja_movimientos
                 WHERE ${where.join(' AND ')}
                   AND date IS NOT NULL
                   AND date >= ?
                   AND date <= ?${cashAccountWhere}
                 ORDER BY date ASC, id ASC`,
                [...params, periodStart, rangeEnd, ...cashAccountParams]
            ),
            pool.query(
                `SELECT *
                 FROM cash_closures
                 WHERE ${where.join(' AND ')}
                   AND COALESCE(closed_at, closure_date) >= ?
                   AND COALESCE(closed_at, closure_date) <= ?
                 ORDER BY COALESCE(closed_at, closure_date) ASC, id ASC`,
                [...params, periodStart, rangeEnd]
            ),
            pool.query(
                `SELECT
                    CASE
                        WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                        ELSE 'principal'
                    END AS cash_account,
                    SUM(CASE
                        WHEN type IN ('apertura', 'ingreso', 'venta') THEN COALESCE(amount, 0)
                        WHEN type IN ('egreso', 'retiro', 'anulacion_venta') THEN -COALESCE(amount, 0)
                        ELSE COALESCE(amount, 0)
                    END) AS balance
                 FROM caja_movimientos
                 WHERE ${where.join(' AND ')}
                   AND date IS NOT NULL
                   AND date < ?${cashAccountWhere}
                 GROUP BY cash_account`,
                [...params, currentStart, ...cashAccountParams]
            ),
            pool.query(
                `SELECT
                    CASE
                        WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                        ELSE 'principal'
                    END AS cash_account,
                    SUM(CASE
                        WHEN type IN ('apertura', 'ingreso', 'venta') THEN COALESCE(amount, 0)
                        WHEN type IN ('egreso', 'retiro', 'anulacion_venta') THEN -COALESCE(amount, 0)
                        ELSE COALESCE(amount, 0)
                    END) AS balance
                 FROM caja_movimientos
                 WHERE ${where.join(' AND ')}
                   AND date IS NOT NULL
                   AND date < ?${cashAccountWhere}
                 GROUP BY cash_account`,
                [...params, previousStart, ...cashAccountParams]
            ),
        ]);

        const toBalances = (rows) => {
            const balances = emptyCashAccountBalances();
            (rows || []).forEach((row) => {
                const account = normalizeCashAccountToken(row.cash_account);
                balances[account] = Number(row.balance || 0);
            });
            return balances;
        };

        // Quién hizo cada movimiento es info sensible: solo se expone a admins.
        const movementsOut = movementRows || [];
        const closuresOut = closureRows || [];
        if (!isAdminAccessContext(accessContext)) {
            stripCajaCreatorFields(movementsOut);
            stripCajaCreatorFields(closuresOut);
        }

        return res.json({
            ok: true,
            from: fromDate,
            to: toDate,
            compareFrom: compareFromDate,
            branchId: Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 ? resolvedBranchId : null,
            isAdmin: isAdminAccessContext(accessContext),
            movements: movementsOut,
            closures: closuresOut,
            initialBalances: {
                current: toBalances(currentInitialRows || []),
                previous: toBalances(previousInitialRows || []),
            },
        });
    } catch (err) {
        const statusCode = err?.statusCode || 500;
        console.error('[CAJA REPORT DATA ERROR]', err.message);
        res.status(statusCode).json({ error: err.message || 'No se pudo cargar el informe de caja' });
    }
});

app.post('/api/caja/opening', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const tenantPool = getTenantPool(dbName);
        conn = await tenantPool.getConnection();
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const selectedDate = normalizeCashSummaryDate(req.body?.date);
        const selectedCashAccount = normalizeCashAccountToken(req.body?.cashAccount || req.body?.cash_account);
        const openings = Array.isArray(req.body?.openings) ? req.body.openings : [];
        const cleanOpenings = openings
            .map((row) => ({
                amount: Number(row?.amount || 0),
                paymentMethod: String(row?.paymentMethod || row?.payment_method || '').trim(),
                paymentMethodType: String(row?.paymentMethodType || row?.payment_method_type || 'cash').trim() || 'cash',
            }))
            .filter((row) => row.amount > 0 && row.paymentMethod);

        if (!cleanOpenings.length) {
            return res.status(400).json({ error: 'Debe informar al menos una apertura con importe mayor a cero' });
        }

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool: tenantPool,
                tenantId,
                accessContext,
                record: {
                    branch_id: req.body?.branch_id,
                    branchId: req.body?.branchId,
                    activeBranchId: req.body?.activeBranchId,
                },
            })
            : null;

        const activeBranches = accessContext?.client?.id ? await listClientBranches(accessContext.client.id) : [];
        if (activeBranches.length > 1 && (!Number.isFinite(resolvedBranchId) || resolvedBranchId <= 0)) {
            return res.status(400).json({
                error: 'Debe especificar branch_id para iniciar caja',
                code: 'BRANCH_REQUIRED',
                activeBranches: activeBranches.map((branch) => ({ id: branch.id, name: branch.name })),
            });
        }

        const dayStart = `${selectedDate} 00:00:00`;
        const dayEnd = `${selectedDate} 23:59:59`;
        const openingDate = `${selectedDate} 08:00:00`;
        const branchId = Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 ? resolvedBranchId : null;
        const branchDeleteScope = buildBranchScopeClause({
            branchId,
            allowLegacyNullFallback: false,
        });

        await conn.beginTransaction();
        const branchDeleteSql = branchDeleteScope.sql ? `AND ${branchDeleteScope.sql}` : 'AND branch_id IS NULL';
        const branchDeleteParams = branchDeleteScope.params;
        // ¿Ya hubo una apertura HOY en esta sucursal? Si la hay, este POST es una
        // MODIFICACION de montos (no una apertura nueva) → NO hay que volver a
        // limpiar la balanza. Limpiarla de nuevo vaciaba su memoria y dejaba el
        // reporte "Detalle Ventas" del dia en $0. La limpieza solo debe correr en
        // la PRIMERA apertura del dia (y a medianoche, scheduleMidnightScaleClear).
        const [existingOpeningRows] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM caja_movimientos
             WHERE tenant_id = ?
               AND type = 'apertura'
               AND date >= ?
               AND date <= ?
               ${branchDeleteSql}`,
            [tenantId, dayStart, dayEnd, ...branchDeleteParams]
        );
        const hadOpeningToday = Number(existingOpeningRows?.[0]?.cnt || 0) > 0;
        await conn.query(
            `DELETE FROM caja_movimientos
             WHERE tenant_id = ?
               AND type = 'apertura'
               AND cash_account = ?
               AND date >= ?
               AND date <= ?
               ${branchDeleteSql}`,
            [tenantId, selectedCashAccount, dayStart, dayEnd, ...branchDeleteParams]
        );

        const openingCreator = resolveCajaCreator(accessContext, req);
        for (const row of cleanOpenings) {
            await conn.query('INSERT INTO caja_movimientos SET ?', [{
                tenant_id: tenantId,
                branch_id: branchId,
                type: 'apertura',
                amount: row.amount,
                category: 'Apertura de caja',
                money_flow_kind: 'cash_opening',
                origin_table: 'cash_opening',
                origin_group_id: `cash_opening_${selectedDate}_${selectedCashAccount}`,
                description: `Apertura inicial ${row.paymentMethod}`,
                payment_method: row.paymentMethod,
                payment_method_type: row.paymentMethodType,
                cash_account: selectedCashAccount,
                date: openingDate,
                ...openingCreator,
            }]);
        }

        await conn.commit();

        // Solo en la PRIMERA apertura del dia pedimos al bridge que limpie la
        // memoria de ventas de la balanza (captura los tickets pendientes + fn32).
        // Si ya habia una apertura hoy esto fue una modificacion de montos → NO
        // limpiar: vaciar la balanza de nuevo borraba el reporte del dia del local.
        if (!hadOpeningToday) {
            queueScaleClearSales(getOperationalPool(), tenantId).catch((e) =>
                console.warn('[CAJA OPENING] No se pudo encolar limpieza de ventas de balanza:', e?.message || e)
            );
        }

        return res.json({ ok: true, count: cleanOpenings.length, branchId });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('[CAJA OPENING] error', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'No se pudo guardar la apertura de caja',
            code: error.code || null,
        });
    } finally {
        if (conn) conn.release();
    }
});

// Cierre de caja con arqueo (modelo diario): recalcula el efectivo ESPERADO del
// dia de forma autoritativa (nunca confia en el teorico del cliente), lo compara
// contra el efectivo CONTADO fisicamente y guarda el resultado en cash_closures.
// Es idempotente por (dia, sucursal, cuenta de caja): re-cerrar el mismo dia
// reemplaza el cierre anterior en vez de duplicar. NO borra ni resetea
// movimientos: el arqueo es por dia y no destruye nada.
app.post('/api/caja/closure', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const tenantPool = getTenantPool(dbName);
        conn = await tenantPool.getConnection();
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const selectedDate = normalizeCashSummaryDate(req.body?.date);
        const selectedCashAccount = normalizeCashAccountToken(req.body?.cashAccount || req.body?.cash_account);
        const countedCash = Number(req.body?.countedCash ?? req.body?.counted_cash);
        if (!Number.isFinite(countedCash) || countedCash < 0) {
            return res.status(400).json({ error: 'Ingresá el efectivo contado (un número igual o mayor a cero).' });
        }
        const notes = String(req.body?.notes || '').slice(0, 2000);

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool: tenantPool,
                tenantId,
                accessContext,
                record: {
                    branch_id: req.body?.branch_id,
                    branchId: req.body?.branchId,
                    activeBranchId: req.body?.activeBranchId,
                },
            })
            : null;
        const branchId = Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 ? resolvedBranchId : null;

        const activeBranches = accessContext?.client?.id ? await listClientBranches(accessContext.client.id) : [];
        if (activeBranches.length > 1 && !branchId) {
            return res.status(400).json({
                error: 'Debe especificar branch_id para cerrar caja',
                code: 'BRANCH_REQUIRED',
                activeBranches: activeBranches.map((branch) => ({ id: branch.id, name: branch.name })),
            });
        }

        const daily = await fetchCajaDailyCash(tenantPool, {
            tenantId,
            selectedDate,
            branchId,
            cashAccount: selectedCashAccount,
        });

        const theoretical = roundCash2(daily.expected);
        const counted = roundCash2(countedCash);
        const difference = roundCash2(counted - theoretical);
        const totalSales = roundCash2(daily.sales - daily.reversals);
        const totalIncomes = roundCash2(daily.incomes);
        const totalExpenses = roundCash2(daily.expenses);

        // closed_at queda dentro del dia cerrado (no toISOString): si se cierra un
        // dia pasado, igual se agrupa en su fecha. Misma tecnica que los movimientos.
        const stamp = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        const closedAt = `${selectedDate} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;

        const snapshot = JSON.stringify({
            cashAccount: selectedCashAccount,
            opening: roundCash2(daily.opening),
            cashSales: roundCash2(daily.sales),
            incomes: roundCash2(daily.incomes),
            expenses: roundCash2(daily.expenses),
            reversals: roundCash2(daily.reversals),
            expected: theoretical,
            counted,
            difference,
        });

        await conn.beginTransaction();
        const branchScopeSql = branchId ? 'AND branch_id = ?' : 'AND branch_id IS NULL';
        const branchScopeParams = branchId ? [branchId] : [];
        await conn.query(
            `DELETE FROM cash_closures
             WHERE tenant_id = ?
               AND closure_date = ?
               AND cash_account = ?
               ${branchScopeSql}`,
            [tenantId, selectedDate, selectedCashAccount, ...branchScopeParams]
        );

        const creator = resolveCajaCreator(accessContext, req);
        const [insertResult] = await conn.query('INSERT INTO cash_closures SET ?', [{
            tenant_id: tenantId,
            closure_date: selectedDate,
            branch_id: branchId,
            cash_account: selectedCashAccount,
            closed_at: closedAt,
            theoretical_cash: theoretical,
            counted_cash: counted,
            difference,
            total_sales: totalSales,
            total_incomes: totalIncomes,
            total_expenses: totalExpenses,
            notes: notes || null,
            snapshot,
            ...creator,
        }]);
        await conn.commit();

        return res.json({
            ok: true,
            closure: {
                id: insertResult.insertId,
                closure_date: selectedDate,
                cash_account: selectedCashAccount,
                branch_id: branchId,
                closed_at: closedAt,
                theoretical_cash: theoretical,
                counted_cash: counted,
                difference,
                total_sales: totalSales,
                total_incomes: totalIncomes,
                total_expenses: totalExpenses,
            },
        });
    } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('[CAJA CLOSURE] error', error);
        return res.status(error.statusCode || 500).json({
            error: error.message || 'No se pudo registrar el cierre de caja',
            code: error.code || null,
        });
    } finally {
        if (conn) conn.release();
    }
});

// Cuenta corriente de UN cliente puntual: ventas + cobros + items de esas
// ventas, TODO del cliente (sin tope de filas y sin filtrar por sucursal: la
// cuenta corriente es del cliente, no de una caja). Reemplaza el patron viejo
// que bajaba las tablas completas al navegador con /api/table (que corta en 1000
// filas ordenadas de mas viejo a mas nuevo -> faltaban ventas recientes y sus
// detalles). El calculo de saldos sigue en el frontend, anclado al saldo real.
app.get('/api/clientes/:clientId/cuenta-corriente', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) assertClientAccess(accessContext);

        const clientId = Number(req.params.clientId);
        if (!Number.isFinite(clientId) || clientId <= 0) {
            return res.status(400).json({ error: 'clientId inválido' });
        }

        // Ventas del cliente (todas). payment_breakdown se devuelve ya parseado
        // para que el frontend detecte la parte de cuenta corriente.
        const [ventas] = await pool.query(
            `SELECT * FROM ventas
             WHERE tenant_id = ? AND clientId = ?
             ORDER BY date ASC, id ASC`,
            [tenantId, clientId]
        );
        ventas.forEach((venta) => {
            venta.payment_breakdown = parseJsonMaybe(venta.payment_breakdown);
        });

        // Items de esas ventas (para el detalle expandible).
        const saleIds = ventas.map((venta) => venta.id).filter((id) => Number.isFinite(Number(id)));
        let ventasItems = [];
        if (saleIds.length) {
            const placeholders = saleIds.map(() => '?').join(',');
            const [items] = await pool.query(
                `SELECT * FROM ventas_items
                 WHERE tenant_id = ? AND venta_id IN (${placeholders})`,
                [tenantId, ...saleIds]
            );
            ventasItems = items;
        }

        // Cobros del cliente: mismos criterios que la reconciliacion de saldos
        // (money_flow_kind='customer_payment' o ingreso 'Cobro Pendientes'), por
        // client_id -> coincide exacto con lo que alimenta el saldo guardado.
        const [movimientos] = await pool.query(
            `SELECT * FROM caja_movimientos
             WHERE tenant_id = ? AND client_id = ?
               AND (
                    money_flow_kind = 'customer_payment'
                    OR (type = 'ingreso' AND category = 'Cobro Pendientes')
               )
             ORDER BY date ASC, id ASC`,
            [tenantId, clientId]
        );

        return res.json({
            ok: true,
            clientId,
            ventas,
            movimientos,
            ventas_items: ventasItems,
        });
    } catch (err) {
        const statusCode = err?.statusCode || 500;
        console.error('[CTA CTE CLIENTE ERROR]', err.message);
        return res.status(statusCode).json({ error: err.message || 'No se pudo cargar la cuenta corriente del cliente' });
    }
});

app.post('/api/caja/transfer', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                code: 'INVALID_TRANSFER_AMOUNT',
                error: 'Monto de transferencia inválido',
                receivedAmount: req.body?.amount ?? null,
            });
        }

        // Modo de transferencia: 'cashboxes' (efectivo entre cajas, comportamiento original)
        // o 'between_methods' (mover saldo de un medio de pago a otro dentro de la misma caja).
        const mode = String(req.body?.mode || 'cashboxes').trim().toLowerCase();
        const isMethodTransfer = mode === 'between_methods' || mode === 'methods';

        // Campos para transferencia entre cajas (efectivo)
        const fromCashAccount = normalizeCashAccountToken(req.body?.fromCashAccount || req.body?.from_cash_account);
        const toCashAccount = normalizeCashAccountToken(req.body?.toCashAccount || req.body?.to_cash_account);

        // Campos para transferencia entre medios de pago
        const methodCashAccount = normalizeCashAccountToken(req.body?.cashAccount || req.body?.cash_account || 'principal');
        const fromPaymentMethod = String(req.body?.fromPaymentMethod || req.body?.from_payment_method || '').trim();
        const toPaymentMethod = String(req.body?.toPaymentMethod || req.body?.to_payment_method || '').trim();
        const fromPaymentMethodType = String(req.body?.fromPaymentMethodType || req.body?.from_payment_method_type || 'cash').trim() || 'cash';
        const toPaymentMethodType = String(req.body?.toPaymentMethodType || req.body?.to_payment_method_type || 'cash').trim() || 'cash';

        if (isMethodTransfer) {
            if (!fromPaymentMethod || !toPaymentMethod) {
                return res.status(400).json({
                    code: 'INVALID_TRANSFER_METHODS',
                    error: 'Elegí medio de origen y destino para transferir',
                    fromPaymentMethod,
                    toPaymentMethod,
                });
            }
            if (fromPaymentMethod.toLowerCase() === toPaymentMethod.toLowerCase()) {
                return res.status(400).json({
                    code: 'SAME_METHOD_TRANSFER',
                    error: 'Elegí medios de pago diferentes para transferir',
                    fromPaymentMethod,
                    toPaymentMethod,
                });
            }
        } else if (fromCashAccount === toCashAccount) {
            return res.status(400).json({
                code: 'SAME_CASHBOX_TRANSFER',
                error: 'Elegí cajas diferentes para transferir',
                fromCashAccount,
                toCashAccount,
            });
        }

        const paymentMethod = String(req.body?.paymentMethod || req.body?.payment_method || 'Efectivo').trim() || 'Efectivo';
        const paymentMethodType = String(req.body?.paymentMethodType || req.body?.payment_method_type || 'cash').trim() || 'cash';
        const description = String(req.body?.description || '').trim();
        const transferGroupId = String(req.body?.transferGroupId || req.body?.transfer_group_id || `tr_${Date.now()}`).trim();
        const requestedDate = req.body?.date ? new Date(req.body.date) : new Date();
        const transferDate = Number.isFinite(requestedDate.getTime()) ? requestedDate : new Date();

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        // La transferencia entre medios de pago es una operación sensible: solo admin.
        if (isMethodTransfer && accessContext && !isAdminAccessContext(accessContext)) {
            return res.status(403).json({
                code: 'METHOD_TRANSFER_ADMIN_ONLY',
                error: 'Solo un administrador puede transferir fondos entre medios de pago',
            });
        }

        const branchId = accessContext
            ? await resolveOperationalBranchId({ pool, tenantId, accessContext, record: req.body || {} })
            : null;
        const resolvedBranchId = Number(branchId);
        const hasResolvedBranch = Number.isFinite(resolvedBranchId) && resolvedBranchId > 0;
        const activeBranches = accessContext?.client?.id ? await listClientBranches(accessContext.client.id) : [];
        const requiresExplicitBranch = activeBranches.length > 0;
        if (!hasResolvedBranch) {
            if (requiresExplicitBranch) {
                if (STRICT_BRANCH_SCOPING) {
                    return res.status(400).json({
                        code: 'CASHBOX_TRANSFER_BRANCH_REQUIRED',
                        error: 'Seleccioná una sucursal antes de transferir entre cajas',
                        receivedBranchId: req.body?.branchId ?? req.body?.branch_id ?? null,
                        receivedActiveBranchId: req.body?.activeBranchId ?? null,
                        headerActiveBranchId: req.headers?.['x-mm-active-branch-id'] ?? null,
                        userBranchId: accessContext?.user?.branchRecordId ?? accessContext?.user?.branchId ?? null,
                        activeBranchId: accessContext?.activeBranch?.id ?? null,
                        activeBranches: activeBranches.map((branch) => ({ id: branch.id, name: branch.name })),
                        role: accessContext?.user?.role ?? null,
                    });
                }
                warnBranchScopeFallback('cash-transfer-without-branch', {
                    tenantId,
                    clientId: accessContext?.client?.id ?? null,
                    userId: accessContext?.user?.id ?? null,
                    path: req.path,
                });
            }

            console.warn('[CAJA TRANSFER] Operando sin sucursal activa', {
                tenantId,
                clientId: accessContext?.client?.id ?? null,
                branchScope: 'legacy',
                support: Boolean(accessContext?.user?.isGlobalSuperAdmin),
            });
        }

        conn = await pool.getConnection();
        await conn.beginTransaction();

        const branchScope = buildBranchScopeClause({
            branchId: resolvedBranchId,
            allowLegacyNullFallback: false,
        });
        const branchWhereSql = branchScope.sql ? `AND ${branchScope.sql}` : '';
        const branchWhereParams = branchScope.params;
        // El origen a validar depende del modo: efectivo de la caja (entre cajas) o
        // saldo acumulado del medio de pago dentro de la caja (entre medios).
        const balanceCashAccount = isMethodTransfer ? methodCashAccount : fromCashAccount;
        const balanceMethodClause = isMethodTransfer
            ? 'AND payment_method = ?'
            : "AND LOWER(COALESCE(payment_method_type, '')) = 'cash'";
        const balanceMethodParams = isMethodTransfer ? [fromPaymentMethod] : [];
        const [balanceRows] = await conn.query(
            `SELECT SUM(CASE
                WHEN type IN ('apertura', 'ingreso', 'venta') THEN COALESCE(amount, 0)
                WHEN type IN ('egreso', 'retiro', 'anulacion_venta') THEN -COALESCE(amount, 0)
                ELSE COALESCE(amount, 0)
            END) AS balance
             FROM caja_movimientos
             WHERE tenant_id = ?
               AND date IS NOT NULL
               AND date <= ?
               ${branchWhereSql}
               AND CASE
                    WHEN LOWER(COALESCE(cash_account, 'principal')) IN ('secundaria', 'secondary', 'caja_secundaria') THEN 'secondary'
                    ELSE 'principal'
               END = ?
               ${balanceMethodClause}`,
            [tenantId, transferDate, ...branchWhereParams, balanceCashAccount, ...balanceMethodParams]
        );

        const available = Number(balanceRows?.[0]?.balance || 0);
        if (amount > available + 0.0001) {
            const error = new Error(isMethodTransfer
                ? `Saldo insuficiente en ${fromPaymentMethod}. Disponible: $${available.toLocaleString('es-AR')}`
                : `Efectivo insuficiente en caja origen. Disponible: $${available.toLocaleString('es-AR')}`);
            error.statusCode = 409;
            throw error;
        }

        const common = {
            tenant_id: tenantId,
            branch_id: hasResolvedBranch ? resolvedBranchId : null,
            amount,
            transfer_group_id: transferGroupId,
            origin_group_id: transferGroupId,
            origin_table: 'caja_transfer',
            origin_id: null,
            date: transferDate,
            ...resolveCajaCreator(accessContext, req),
        };

        let outResult;
        let inResult;

        if (isMethodTransfer) {
            // Transferencia entre medios de pago: ambas patas en la misma caja,
            // cambia el medio de pago. Netea a cero en la caja y mueve el acumulado por medio.
            [outResult] = await conn.query('INSERT INTO caja_movimientos SET ?', [{
                ...common,
                type: 'retiro',
                money_flow_kind: 'method_transfer_out',
                category: 'Transferencia enviada entre medios',
                description: description || `Transferencia a ${toPaymentMethod}`,
                cash_account: methodCashAccount,
                payment_method: fromPaymentMethod,
                payment_method_type: fromPaymentMethodType,
            }]);

            [inResult] = await conn.query('INSERT INTO caja_movimientos SET ?', [{
                ...common,
                type: 'ingreso',
                money_flow_kind: 'method_transfer_in',
                category: 'Transferencia recibida entre medios',
                description: description || `Transferencia desde ${fromPaymentMethod}`,
                cash_account: methodCashAccount,
                payment_method: toPaymentMethod,
                payment_method_type: toPaymentMethodType,
            }]);
        } else {
            const fromLabel = fromCashAccount === 'secondary' ? 'Caja Secundaria' : 'Caja Principal';
            const toLabel = toCashAccount === 'secondary' ? 'Caja Secundaria' : 'Caja Principal';

            [outResult] = await conn.query('INSERT INTO caja_movimientos SET ?', [{
                ...common,
                payment_method: paymentMethod,
                payment_method_type: paymentMethodType,
                type: 'retiro',
                money_flow_kind: 'cash_transfer_out',
                category: 'Transferencia enviada entre cajas',
                description: description || `Transferencia a ${toLabel}`,
                cash_account: fromCashAccount,
            }]);

            [inResult] = await conn.query('INSERT INTO caja_movimientos SET ?', [{
                ...common,
                payment_method: paymentMethod,
                payment_method_type: paymentMethodType,
                type: 'ingreso',
                money_flow_kind: 'cash_transfer_in',
                category: 'Transferencia recibida entre cajas',
                description: description || `Transferencia desde ${fromLabel}`,
                cash_account: toCashAccount,
            }]);
        }

        await conn.commit();
        return res.json({
            ok: true,
            transferGroupId,
            branchId: hasResolvedBranch ? resolvedBranchId : null,
            fromMovementId: outResult.insertId,
            toMovementId: inResult.insertId,
        });
    } catch (err) {
        if (conn) {
            try { await conn.rollback(); } catch {}
        }
        const statusCode = err?.statusCode || 500;
        console.error('[CAJA TRANSFER ERROR]', err.message);
        return res.status(statusCode).json({ error: err.message || 'No se pudo registrar la transferencia entre cajas' });
    } finally {
        if (conn) conn.release();
    }
});

app.get('/api/settings/:key', verifyFirebaseToken, async (req, res) => {
    try {
        const settingKey = String(req.params.key || '').trim();
        if (!settingKey) {
            return res.status(400).json({ error: 'Key requerida' });
        }

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const activeBranchId = getRequestedActiveBranchId(req);

        let rows;
        if (activeBranchId) {
            // Busca primero el valor específico de la sucursal; si no existe, cae al tenant-level (branch_id=0)
            [rows] = await pool.query(
                'SELECT value FROM settings WHERE `tenant_id` = ? AND `key` = ? AND (branch_id = ? OR branch_id = 0) ORDER BY branch_id DESC LIMIT 1',
                [tenantId, settingKey, activeBranchId]
            );
        } else {
            [rows] = await pool.query(
                'SELECT value FROM settings WHERE `tenant_id` = ? AND `key` = ? AND branch_id = 0 LIMIT 1',
                [tenantId, settingKey]
            );
        }

        if (!rows.length) {
            return res.json({ ok: true, key: settingKey, value: null, found: false });
        }

        return res.json({ ok: true, key: settingKey, value: rows[0].value ?? null, found: true });
    } catch (err) {
        console.error('[SETTINGS ERROR]', err.message);
        res.status(500).json({ error: 'Error leyendo settings: ' + err.message });
    }
});

app.get('/api/whatsapp/status', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (!canWriteProtectedSettings(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede ver esta configuración' });
        }

        const [mode, inviteLink, autoBroadcast, activePromotions, businessName] = await Promise.all([
            getTenantSettingValue(pool, tenantId, 'whatsapp_marketing_mode'),
            getTenantSettingValue(pool, tenantId, 'whatsapp_group_invite_link'),
            getTenantSettingValue(pool, tenantId, 'whatsapp_auto_broadcast_promotions'),
            getActivePromotions(pool, tenantId, 25).catch(() => []),
            (async () => (
                await getTenantSettingValue(pool, tenantId, 'business_name')
                || await getTenantSettingValue(pool, tenantId, 'store_name')
                || await getTenantSettingValue(pool, tenantId, 'store_display_name')
                || await getTenantSettingValue(pool, tenantId, 'local_name')
                || ''
            ))(),
        ]);
        const cloudConfig = await resolveWhatsAppCloudConfig(pool, tenantId);
        const normalizedActivePromotions = (Array.isArray(activePromotions) ? activePromotions : []).map((promotion) => ({
            id: Number(promotion?.id || 0),
            productName: String(promotion?.product_name || '').trim(),
            message: formatPromoBroadcastMessage({ businessName, promo: promotion }),
        })).filter((promotion) => promotion.id > 0 && promotion.message);
        const latestPromotion = normalizedActivePromotions[0] || null;

        const autoBroadcastEnabled = autoBroadcast == null
            ? true
            : ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(String(autoBroadcast).trim().toLowerCase());

        return res.json({
            ok: true,
            mode: String(mode || 'free').trim().toLowerCase() === 'paid' ? 'paid' : 'free',
            inviteLink: String(inviteLink || '').trim(),
            autoBroadcastPromotions: autoBroadcastEnabled,
            promoPreview: latestPromotion?.message || '',
            promoPreviewMeta: latestPromotion
                ? {
                    id: Number(latestPromotion.id || 0),
                    productName: String(latestPromotion.productName || '').trim(),
                }
                : null,
            activePromotions: normalizedActivePromotions,
            cloud: {
                configured: Boolean(cloudConfig.token && cloudConfig.phoneNumberId),
                hasToken: Boolean(cloudConfig.token),
                phoneNumberId: cloudConfig.phoneNumberId || '',
                apiVersion: cloudConfig.apiVersion || 'v21.0',
            },
        });
    } catch (err) {
        console.error('[WHATSAPP STATUS ERROR]', err.message);
        res.status(500).json({ error: 'No se pudo leer el estado de WhatsApp: ' + err.message });
    }
});

app.post('/api/whatsapp/config', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (!canWriteProtectedSettings(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede modificar esta configuración' });
        }

        const modeRaw = String(req.body?.mode || 'free').trim().toLowerCase();
        const mode = modeRaw === 'paid' ? 'paid' : 'free';
        const inviteLink = String(req.body?.inviteLink || '').trim();
        const autoBroadcastPromotions = Boolean(req.body?.autoBroadcastPromotions);
        const phoneNumberId = String(req.body?.phoneNumberId || '').trim();
        const apiVersion = String(req.body?.apiVersion || 'v21.0').trim();
        const token = String(req.body?.token || '').trim();
        const updateToken = Boolean(req.body?.updateToken);

        const settingPairs = [
            ['whatsapp_marketing_mode', mode],
            ['whatsapp_group_invite_link', inviteLink],
            ['whatsapp_auto_broadcast_promotions', autoBroadcastPromotions ? '1' : '0'],
            ['whatsapp_cloud_phone_number_id', phoneNumberId],
            ['whatsapp_cloud_api_version', apiVersion],
        ];
        if (updateToken) {
            settingPairs.push(['whatsapp_cloud_api_token', token]);
        }

        for (const [key, value] of settingPairs) {
            await pool.query(
                'INSERT INTO settings (`tenant_id`, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
                [tenantId, key, String(value ?? '')]
            );
        }

        return res.json({ ok: true });
    } catch (err) {
        console.error('[WHATSAPP CONFIG ERROR]', err.message);
        res.status(500).json({ error: 'No se pudo guardar la configuración de WhatsApp: ' + err.message });
    }
});

// ── RUTA: GET /api/bootstrap ───────────────────────────────────────────────
// Devuelve un set inicial de tablas para hidratar el frontend local.
app.get('/api/bootstrap', verifyFirebaseToken, async (req, res) => {
    try {
        const requestedTables = String(req.query.tables || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

        const tables = requestedTables.length > 0
            ? requestedTables.filter((t) => ALLOWED_TABLES.has(t))
            : ['settings', 'users', 'user_permissions', 'scale_users', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'purchase_items', 'clients', 'products', 'product_prices', 'branch_product_prices', 'prices', 'promotions', 'stock'];

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);

        const payload = {};
        for (const table of tables) {
            const scope = tenantWhereClause(table, tenantId);
            const validCols = await getTableColumns(pool, dbName, table);
            const scopedBranchId = Number(
                accessContext?.activeBranch?.id
                ?? accessContext?.user?.branchRecordId
                ?? accessContext?.user?.branchId
            );
            const branchScoped = BRANCH_SCOPED_TABLES.has(table) && validCols.includes('branch_id') && Number.isFinite(scopedBranchId) && scopedBranchId > 0;
            const strictWithoutBranch = BRANCH_SCOPED_TABLES.has(table) && STRICT_BRANCH_SCOPED_TABLES.has(table) && validCols.includes('branch_id') && !branchScoped;
            const branchSql = strictWithoutBranch
                ? ' AND 1 = 0'
                : branchScoped
                    ? (STRICT_BRANCH_SCOPED_TABLES.has(table) ? ' AND `branch_id` = ?' : ' AND (`branch_id` = ? OR `branch_id` IS NULL)')
                    : '';
            const branchParams = branchScoped ? [scopedBranchId] : [];
            try {
                const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE ${scope.sql}${branchSql}`, [...scope.params, ...branchParams]);
                payload[table] = rows.map(deserializeRow);
            } catch (error) {
                if (!isUnknownBranchColumnError(error) || !validCols.includes('branch_id')) {
                    throw error;
                }
                const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE ${scope.sql}`, scope.params);
                payload[table] = rows.map(deserializeRow);
            }
        }

        return res.json({
            ok: true,
            tables: payload,
        });
    } catch (err) {
        console.error('[BOOTSTRAP ERROR]', err.message);
        res.status(500).json({ error: 'Error armando bootstrap: ' + err.message });
    }
});

// ── RUTA: GET /api/products/:id/prices ────────────────────────────────────
// Historial de precios de un producto, ordenado por effective_at DESC.
app.get('/api/products/:id/prices', verifyFirebaseToken, async (req, res) => {
    try {
        const productId = parseInt(req.params.id, 10);
        if (!Number.isFinite(productId) || productId <= 0) {
            return res.status(400).json({ error: 'product id inválido' });
        }
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 500));
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        const resolvedBranchId = await resolveOperationalBranchId({
            pool,
            tenantId,
            accessContext,
            record: {
                branch_id: req.query?.branch_id,
                branchId: req.query?.branchId,
            },
        });
        const productCols = await getTableColumns(pool, dbName, 'products');
        const priceCols = await getTableColumns(pool, dbName, 'product_prices');
        if (productCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            const [[product]] = await pool.query(
                `SELECT id FROM products WHERE tenant_id = ? AND id = ? AND branch_id = ? LIMIT 1`,
                [tenantId, productId, resolvedBranchId]
            );
            if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const branchFilterSql = priceCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0
            ? ' AND branch_id = ?'
            : '';
        const params = priceCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0
            ? [tenantId, productId, resolvedBranchId, limit]
            : [tenantId, productId, limit];
        const [rows] = await pool.query(
            `SELECT id, product_id, price, plu, source, effective_at, created_at
             FROM product_prices
             WHERE tenant_id = ? AND product_id = ?${branchFilterSql}
             ORDER BY effective_at DESC, id DESC
             LIMIT ?`,
            params
        );
        return res.json({ ok: true, prices: rows });
    } catch (err) {
        console.error('[PRODUCT PRICES ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: POST /api/products/:id/prices ───────────────────────────────────
// Registra un nuevo precio para un producto (append-only, nunca modifica histórico).
// Body: { price, plu?, source?, branchId? }
app.post('/api/products/:id/prices', verifyFirebaseToken, async (req, res) => {
    try {
        const productId = parseInt(req.params.id, 10);
        if (!Number.isFinite(productId) || productId <= 0) {
            return res.status(400).json({ error: 'product id inválido' });
        }
        const price = parseFloat(req.body?.price);
        if (!Number.isFinite(price) || price < 0) {
            return res.status(400).json({ error: 'price inválido' });
        }
        const plu = normalizePluValue(req.body?.plu);
        const source = String(req.body?.source || 'manual').trim().slice(0, 50);
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        const resolvedBranchId = await resolveOperationalBranchId({
            pool,
            tenantId,
            accessContext,
            record: {
                branch_id: req.body?.branch_id,
                branchId: req.body?.branchId,
            },
        });

        const productCols = await getTableColumns(pool, dbName, 'products');
        const productsHaveBranchId = productCols.includes('branch_id');

        // Verificar que el producto pertenece a este tenant
        const productWhere = Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 && productsHaveBranchId
            ? 'tenant_id = ? AND id = ? AND branch_id = ?'
            : 'tenant_id = ? AND id = ?';
        const productParams = Number.isFinite(resolvedBranchId) && resolvedBranchId > 0 && productsHaveBranchId
            ? [tenantId, productId, resolvedBranchId]
            : [tenantId, productId];
        const [[product]] = await pool.query(
            `SELECT id FROM products WHERE ${productWhere} LIMIT 1`,
            productParams
        );
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
        await assertUniqueProductPlu(pool, tenantId, plu, productId, productsHaveBranchId ? resolvedBranchId : null);

        const now = new Date();
        if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            const [result] = await pool.query(
                `INSERT INTO branch_product_prices
                    (tenant_id, branch_id, product_id, price, plu, source, effective_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    price = VALUES(price),
                    plu = VALUES(plu),
                    source = VALUES(source),
                    effective_at = VALUES(effective_at),
                    updated_at = VALUES(updated_at)`,
                [tenantId, resolvedBranchId, productId, price, plu, source, now, now, now]
            );
            await pool.query(
                `INSERT INTO product_prices
                    (tenant_id, branch_id, product_id, price, plu, source, effective_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [tenantId, resolvedBranchId, productId, price, plu, source, now, now]
            );
            await pool.query(
                'UPDATE products SET current_price = ?, plu = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
                [price, plu, now, tenantId, productId]
            );
            await queueScaleProductSyncIfNeeded({
                pool,
                tenantId,
                table: 'branch_product_prices',
                operation: 'upsert',
                record: { product_id: productId, branch_id: resolvedBranchId, price, plu, source },
                id: result.insertId || productId,
            });
            return res.json({ ok: true, id: result.insertId || productId, branchId: resolvedBranchId });
        }

        const productPriceCols = await getTableColumns(pool, dbName, 'product_prices');
        const productPriceInsertSql = productPriceCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0
            ? `INSERT INTO product_prices (tenant_id, branch_id, product_id, price, plu, source, effective_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            : `INSERT INTO product_prices (tenant_id, product_id, price, plu, source, effective_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const productPriceParams = productPriceCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0
            ? [tenantId, resolvedBranchId, productId, price, plu, source, now, now]
            : [tenantId, productId, price, plu, source, now, now];
        const [result] = await pool.query(productPriceInsertSql, productPriceParams);
        await pool.query(
            'UPDATE products SET current_price = ?, plu = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
            [price, plu, now, tenantId, productId]
        );
        await queueScaleProductSyncIfNeeded({
            pool,
            tenantId,
            table: 'product_prices',
            operation: 'insert',
            record: { product_id: productId, price, plu, source },
            id: result.insertId,
        });
        return res.json({ ok: true, id: result.insertId, branchId: null });
    } catch (err) {
        console.error('[PRODUCT PRICES WRITE ERROR]', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ── RUTA: GET /api/table/:table ────────────────────────────────────────────
// Lectura paginada para tablas del tenant.
app.get('/api/table/:table', verifyFirebaseToken, async (req, res) => {
    try {
        const table = String(req.params.table || '').trim();
        if (!ALLOWED_TABLES.has(table)) {
            return res.status(400).json({ error: 'Tabla no permitida' });
        }

        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 1000));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const orderBy = String(req.query.orderBy || 'id').trim();
        const direction = String(req.query.direction || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const includeInactive = String(req.query.include_inactive || '').trim() === '1';

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const validCols = await getTableColumns(pool, dbName, table);
        const safeOrderBy = validCols.includes(orderBy) ? orderBy : (validCols.includes('id') ? 'id' : validCols[0]);
        const scope = tenantWhereClause(table, tenantId);
        const extraWhere = [];
        const extraParams = [];
        let scopedBranchIdForRead = null;

        if (table === 'products' && validCols.includes('active') && !includeInactive) {
            extraWhere.push('COALESCE(active, 1) = 1');
        }

        if (BRANCH_SCOPED_TABLES.has(table) && validCols.includes('branch_id')) {
            const accessContext = await getClientAccessContext({
                uid: req.firebaseUser.uid,
                email: req.firebaseUser.email,
                _internalAdmin: req.firebaseUser?._internalAdmin || null,
                _supportClientId: req.firebaseUser?._supportClientId || null,
            });
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
            const isAdminGlobal = String(req.query.admin_global || '').trim() === '1';
            const isAdminUser = accessContext?.user?.role === 'admin';
            const requestedBranchId = accessContext?.activeBranch?.id;
            const userBranchId = Number(
                accessContext?.user?.branchRecordId
                ?? accessContext?.user?.branchId
            );
            const scopedBranchId = requestedBranchId || userBranchId || NaN;
            if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
                if (STRICT_BRANCH_SCOPED_TABLES.has(table)) {
                    extraWhere.push('`branch_id` = ?');
                } else {
                    extraWhere.push('(`branch_id` = ? OR `branch_id` IS NULL)');
                }
                extraParams.push(scopedBranchId);
                scopedBranchIdForRead = scopedBranchId;
            } else if (isAdminGlobal && isAdminUser) {
                // Admin global mode: no scoping, returns all branches
            } else if (STRICT_BRANCH_SCOPED_TABLES.has(table)) {
                extraWhere.push('1 = 0');
            }
        }

        if (table === 'products') {
            const accessContext = await getClientAccessContext({
                uid: req.firebaseUser.uid,
                email: req.firebaseUser.email,
                _internalAdmin: req.firebaseUser?._internalAdmin || null,
                _supportClientId: req.firebaseUser?._supportClientId || null,
            });
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
            const isAdminGlobal = String(req.query.admin_global || '').trim() === '1';
            const isAdminUser = accessContext?.user?.role === 'admin';
            const requestedBranchId = accessContext?.activeBranch?.id;
            const userBranchId = Number(
                accessContext?.user?.branchRecordId
                ?? accessContext?.user?.branchId
            );
            const productReadBranchId = requestedBranchId || userBranchId || NaN;
            if (Number.isFinite(productReadBranchId) && productReadBranchId > 0) {
                scopedBranchIdForRead = productReadBranchId;
            } else if (isAdminGlobal && isAdminUser) {
                scopedBranchIdForRead = null;
            }
        }

        const whereSql = extraWhere.length > 0
            ? `${scope.sql} AND ${extraWhere.join(' AND ')}`
            : scope.sql;

        let rows;
        try {
            [rows] = await pool.query(
                `SELECT * FROM \`${table}\` WHERE ${whereSql} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
                [...scope.params, ...extraParams, limit, offset]
            );
        } catch (error) {
            if (!isUnknownBranchColumnError(error) || !validCols.includes('branch_id')) {
                throw error;
            }
            const fallbackWhere = table === 'products' && validCols.includes('active') && !includeInactive
                ? `${scope.sql} AND COALESCE(active, 1) = 1`
                : scope.sql;
            [rows] = await pool.query(
                `SELECT * FROM \`${table}\` WHERE ${fallbackWhere} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
                table === 'products' && validCols.includes('active') && !includeInactive
                    ? [...scope.params, limit, offset]
                    : [...scope.params, limit, offset]
            );
            scopedBranchIdForRead = null;
        }

        if (table === 'products') {
            rows = await applyBranchProductPrices(pool, tenantId, scopedBranchIdForRead, rows);
        }

        // Si faltan medios de pago predeterminados para este tenant, agregarlos sin pisar datos existentes
        if (table === 'payment_methods') {
            const PAYMENT_DEFAULTS = [
                { name: 'Postnet',          type: 'card',             percentage: 0, enabled: 1 },
                { name: 'Mercado Pago',     type: 'wallet',           percentage: 0, enabled: 1 },
                { name: 'Cuenta DNI',       type: 'wallet',           percentage: 0, enabled: 1 },
                { name: 'Efectivo',         type: 'cash',             percentage: 0, enabled: 1 },
                { name: 'Transferencia',    type: 'transfer',         percentage: 0, enabled: 1 },
                { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: 1 },
                { name: 'Mixto',            type: 'mixed',            percentage: 0, enabled: 1 },
            ];

            const normalizePaymentMethodKey = (value) => {
                const raw = String(value || '').trim().toLowerCase();
                if (raw.includes('postnet') || raw.includes('posnet')) return 'postnet';
                if (raw.includes('mercado pago')) return 'mercado pago';
                if (raw.includes('cuenta dni')) return 'cuenta dni';
                if (raw.includes('efectivo')) return 'efectivo';
                if (raw.includes('transferencia')) return 'transferencia';
                if (raw.includes('cuenta corriente')) return 'cuenta corriente';
                if (raw.includes('mixto') || raw.includes('mixed')) return 'mixto';
                return raw;
            };

            const existingNames = new Set(rows.map((row) => normalizePaymentMethodKey(row?.name)));
            const missingDefaults = PAYMENT_DEFAULTS.filter((pm) => !existingNames.has(normalizePaymentMethodKey(pm.name)));

            for (const pm of missingDefaults) {
                await pool.query('INSERT INTO `payment_methods` SET ?', [{ [TENANT_COLUMN]: tenantId, ...pm }]);
            }

            if (missingDefaults.length > 0) {
                [rows] = await pool.query(
                    `SELECT * FROM \`${table}\` WHERE ${whereSql} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
                    [...scope.params, ...extraParams, limit, offset]
                );
            }
        }

        if (table === 'product_categories' && rows.length === 0) {
            const CATEGORY_DEFAULTS = [
                { code: 'vaca', name: 'Vaca' },
                { code: 'cerdo', name: 'Cerdo' },
                { code: 'pollo', name: 'Pollo' },
                { code: 'pescado', name: 'Pescado' },
                { code: 'pre_elaborados', name: 'Pre-elaborados' },
                { code: 'almacen', name: 'Almacen' },
                { code: 'limpieza', name: 'Limpieza' },
                { code: 'bebidas', name: 'Bebidas' },
                { code: 'insumo', name: 'Insumo General' },
                { code: 'otros', name: 'Otros' },
            ];
            for (const category of CATEGORY_DEFAULTS) {
                await pool.query(
                    `INSERT IGNORE INTO product_categories (\`${TENANT_COLUMN}\`, code, name, active, synced)
                     VALUES (?, ?, ?, 1, 0)`,
                    [tenantId, category.code, category.name]
                );
            }
            [rows] = await pool.query(
                `SELECT * FROM \`${table}\` WHERE ${whereSql} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
                [...scope.params, ...extraParams, limit, offset]
            );
        }

        if (table === 'products' && rows.length > 0) {
            const categoryIds = Array.from(
                new Set(
                    rows
                        .map((row) => Number(row?.category_id))
                        .filter((idValue) => Number.isFinite(idValue) && idValue > 0)
                )
            );
            let categoriesById = new Map();
            if (categoryIds.length > 0) {
                const placeholders = categoryIds.map(() => '?').join(', ');
                const [categoryRows] = await pool.query(
                    `SELECT id, code, name
                     FROM product_categories
                     WHERE \`${TENANT_COLUMN}\` = ?
                       AND id IN (${placeholders})`,
                    [tenantId, ...categoryIds]
                );
                categoriesById = new Map(categoryRows.map((cat) => [Number(cat.id), cat]));
            }
            rows = rows.map((row) => {
                const category = categoriesById.get(Number(row?.category_id));
                if (!category) return row;
                return {
                    ...row,
                    category: category.code,
                    category_code: category.code,
                    category_name: category.name,
                };
            });
        }

        return res.json({
            ok: true,
            table,
            limit,
            offset,
            rows: rows.map(deserializeRow),
        });
    } catch (err) {
        console.error('[TABLE READ ERROR]', err.message);
        res.status(500).json({ error: 'Error leyendo tabla: ' + err.message });
    }
});

// ── RUTA: GET /api/scale/tickets/by-barcode/:barcode ───────────────────────
// Devuelve un ticket de balanza (cabecera + items) a partir del codigo de barras
// generado por el bridge directo.
async function ensureScaleTicketLifecycleColumns(conn) {
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'printed_ticket_barcode', '`printed_ticket_barcode` VARCHAR(32) NULL AFTER `ticket_barcode`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'vendor_name', '`vendor_name` VARCHAR(100) NULL AFTER `vendor_code`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'ticket_status', '`ticket_status` VARCHAR(16) NOT NULL DEFAULT \'open\' AFTER `item_count`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'charged_sale_id', '`charged_sale_id` BIGINT NULL AFTER `ticket_status`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'charged_at', '`charged_at` DATETIME NULL AFTER `charged_sale_id`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'voided_sale_id', '`voided_sale_id` BIGINT NULL AFTER `charged_at`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'voided_at', '`voided_at` DATETIME NULL AFTER `voided_sale_id`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'voided_by_user_id', '`voided_by_user_id` BIGINT NULL AFTER `voided_at`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'voided_by_username', '`voided_by_username` VARCHAR(150) NULL AFTER `voided_by_user_id`');
    await ensureColumn(conn, 'scale_bridge_ticket_map', 'voided_reason', '`voided_reason` VARCHAR(255) NULL AFTER `voided_by_username`');
}

async function ensureScaleTicketItemColumns(conn) {
    await ensureColumn(conn, 'scale_bridge_sales_item', 'printed_ticket_barcode', '`printed_ticket_barcode` VARCHAR(32) NULL AFTER `ticket_barcode`');
    await ensureColumn(conn, 'scale_bridge_sales_item', 'vendor_name', '`vendor_name` VARCHAR(100) NULL AFTER `vendor_code`');
    await ensureColumn(conn, 'scale_bridge_sales_item', 'ticket_total_amount', '`ticket_total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `amount`');
    await ensureColumn(conn, 'scale_bridge_sales_item', 'ticket_item_count', '`ticket_item_count` INT NOT NULL DEFAULT 0 AFTER `ticket_total_amount`');
    await ensureColumn(conn, 'scale_bridge_sales_item', 'item_quantity', '`item_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `ticket_item_count`');
    await ensureColumn(conn, 'scale_bridge_sales_item', 'item_quantity_unit', '`item_quantity_unit` VARCHAR(8) NOT NULL DEFAULT \'un\' AFTER `item_quantity`');

        await conn.query(
        `UPDATE scale_bridge_sales_item s
         LEFT JOIN scale_bridge_ticket_map t
           ON t.device_id = s.device_id
          AND t.tenant_id = s.tenant_id
          AND COALESCE(t.branch_id, 0) = COALESCE(s.branch_id, 0)
          AND t.ticket_id = s.ticket_id
          AND t.sale_at = s.sale_at
         SET s.printed_ticket_barcode = COALESCE(t.printed_ticket_barcode, s.printed_ticket_barcode),
             s.vendor_name = COALESCE(t.vendor_name, s.vendor_name),
             s.ticket_total_amount = CASE
                WHEN t.total_amount IS NOT NULL THEN t.total_amount
                ELSE s.ticket_total_amount
             END,
             s.ticket_item_count = CASE
                WHEN t.item_count IS NOT NULL THEN t.item_count
                ELSE s.ticket_item_count
             END,
             s.item_quantity = CASE
                WHEN COALESCE(s.grams, 0) > 0 THEN ROUND(COALESCE(s.grams, 0) / 1000, 3)
                ELSE COALESCE(s.units, 0)
             END,
             s.item_quantity_unit = CASE
                WHEN COALESCE(s.grams, 0) > 0 THEN 'kg'
                ELSE 'un'
             END
         WHERE (
                t.printed_ticket_barcode IS NOT NULL
                OR t.total_amount IS NOT NULL
                OR t.item_count IS NOT NULL
                OR t.vendor_name IS NOT NULL
                OR COALESCE(s.item_quantity, 0) = 0
                OR COALESCE(s.item_quantity_unit, '') = ''
         )`
    ).catch(() => {});
}

async function getScaleTicketLookupSchema(conn) {
    const [
        ticketPrintedBarcode,
        ticketStatus,
        ticketScaleAddress,
        ticketVendorName,
        itemPrintedBarcode,
        itemTicketTotalAmount,
        itemTicketItemCount,
        itemQuantity,
        itemQuantityUnit,
        itemVendorName,
        ventaTicketBarcode,
        ventaQendraTicketId,
    ] = await Promise.all([
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_ticket_map', 'printed_ticket_barcode'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_ticket_map', 'ticket_status'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_ticket_map', 'scale_address'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_ticket_map', 'vendor_name'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'printed_ticket_barcode'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'ticket_total_amount'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'ticket_item_count'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'item_quantity'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'item_quantity_unit'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'scale_bridge_sales_item', 'vendor_name'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'ventas', 'ticket_barcode'),
        hasColumn(conn, OPERATIONAL_DB_NAME, 'ventas', 'qendra_ticket_id'),
    ]);

    return {
        ticketPrintedBarcode,
        ticketStatus,
        ticketScaleAddress,
        ticketVendorName,
        itemPrintedBarcode,
        itemTicketTotalAmount,
        itemTicketItemCount,
        itemQuantity,
        itemQuantityUnit,
        itemVendorName,
        ventaTicketBarcode,
        ventaQendraTicketId,
    };
}

function buildScaleTicketLookupSelect(schema) {
    return [
        'id',
        'device_id',
        'ticket_id',
        'ticket_barcode',
        schema.ticketPrintedBarcode ? 'printed_ticket_barcode' : 'NULL AS printed_ticket_barcode',
        'vendor_code',
        schema.ticketVendorName ? 'vendor_name' : 'NULL AS vendor_name',
        'sale_at',
        'total_amount',
        'item_count',
        schema.ticketScaleAddress ? 'scale_address' : 'NULL AS scale_address',
        schema.ticketStatus ? 'ticket_status' : "'open' AS ticket_status",
        'charged_sale_id',
        'branch_id',
    ].join(', ');
}

function buildScaleTicketItemSelect(schema) {
    return [
        's.line_no',
        's.sale_at',
        's.vendor_code',
        schema.itemVendorName ? 's.vendor_name' : 'NULL AS vendor_name',
        's.plu_code',
        's.units',
        's.grams',
        's.amount',
        schema.itemTicketTotalAmount ? 's.ticket_total_amount' : 'NULL AS ticket_total_amount',
        schema.itemTicketItemCount ? 's.ticket_item_count' : 'NULL AS ticket_item_count',
        schema.itemQuantity ? 's.item_quantity' : 'NULL AS item_quantity',
        schema.itemQuantityUnit ? 's.item_quantity_unit' : 'NULL AS item_quantity_unit',
        schema.itemPrintedBarcode ? 's.printed_ticket_barcode' : 'NULL AS printed_ticket_barcode',
        'p.id AS product_id',
        'p.name AS product_name',
        'p.category AS product_category',
        'p.unit AS product_unit',
        'p.current_price AS product_price',
        'p.plu AS product_plu',
    ].join(', ');
}

async function triggerScaleBridgePullSales({
    reason = 'barcode_lookup',
    barcode = '',
    lookbackMinutes = SCALE_BRIDGE_PULL_LOOKBACK_MINUTES,
} = {}) {
    const pullStartedAt = Date.now();
    const now = new Date();
    const fromDate = new Date(now.getTime() - (Math.max(1, Number(lookbackMinutes) || 1) * 60 * 1000));
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS);
    appendScaleLatencyLog('pull_sales_start', {
        reason,
        barcode,
        bridgeBaseUrl: SCALE_BRIDGE_DIRECT_BASE_URL,
        lookbackMinutes,
    });
    try {
        const response = await fetch(`${SCALE_BRIDGE_DIRECT_BASE_URL}/api/scale/pull-sales`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromDate: fromDate.toISOString(),
                toDate: now.toISOString(),
                closeAfter: false,
            }),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
            console.warn('[SCALE LOOKUP] pull-sales devolvio error', {
                reason,
                barcode,
                status: response.status,
                message: payload?.error || null,
            });
            appendScaleLatencyLog('pull_sales_error', {
                reason,
                barcode,
                status: response.status,
                elapsedMs: Date.now() - pullStartedAt,
                message: payload?.error || null,
            });
            return false;
        }
        appendScaleLatencyLog('pull_sales_done', {
            reason,
            barcode,
            status: response.status,
            elapsedMs: Date.now() - pullStartedAt,
            fetched: payload?.fetched ?? null,
            stored: payload?.stored ?? null,
            tickets: payload?.tickets ?? null,
            newTickets: payload?.newTickets ?? null,
            latestSaleAt: payload?.latestSaleAt || null,
        });
        return true;
    } catch (error) {
        console.warn('[SCALE LOOKUP] pull-sales no disponible', {
            reason,
            barcode,
            baseUrl: SCALE_BRIDGE_DIRECT_BASE_URL,
            error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
        });
        appendScaleLatencyLog('pull_sales_failed', {
            reason,
            barcode,
            bridgeBaseUrl: SCALE_BRIDGE_DIRECT_BASE_URL,
            elapsedMs: Date.now() - pullStartedAt,
            error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
        });
        return false;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

app.get('/api/scale/tickets/by-barcode/:barcode', verifyFirebaseToken, async (req, res) => {
    const lookupStartedAt = Date.now();
    let lookupTenantId = null;
    let lookupBarcode = '';
    try {
        const barcode = String(req.params.barcode || '').trim();
        if (!barcode) return res.status(400).json({ error: 'barcode requerido' });
        lookupBarcode = barcode;
        const barcodeDigits = barcode.replace(/\D/g, '');
        const barcodeCandidates = buildScaleBarcodeCandidates(barcode);
        const isScaleSummaryBarcode = barcodeDigits.length >= 12 && barcodeDigits.startsWith('22');

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        lookupTenantId = tenantId;
        const pool = getTenantPool(dbName);
        const scaleSchema = await getScaleTicketLookupSchema(pool);
        const ticketSelect = buildScaleTicketLookupSelect(scaleSchema);
        const itemSelect = buildScaleTicketItemSelect(scaleSchema);
        const openTicketFilter = scaleSchema.ticketStatus ? " AND ticket_status = 'open'" : '';
        appendScaleLatencyLog('lookup_start', {
            tenantId,
            barcode,
            barcodeDigitsLength: barcodeDigits.length,
            isScaleSummaryBarcode,
        });

        let [ticketRows] = await pool.query(
            `SELECT ${ticketSelect}
             FROM scale_bridge_ticket_map
             WHERE tenant_id = ?
               AND UPPER(ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})${openTicketFilter}
             ORDER BY sale_at DESC
             LIMIT 1`,
            [tenantId, ...barcodeCandidates]
        );

        if (!ticketRows.length && scaleSchema.ticketPrintedBarcode) {
            [ticketRows] = await pool.query(
                `SELECT ${ticketSelect}
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ?
                   AND UPPER(printed_ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})${openTicketFilter}
                 ORDER BY sale_at DESC
                 LIMIT 1`,
                [tenantId, ...barcodeCandidates]
            );
        }

        // Lectura resiliente: cuando el usuario escanea inmediatamente después de imprimir,
        // damos una ventana corta para que el bridge termine de persistir el ticket.
        if (!ticketRows.length && isScaleSummaryBarcode) {
            const pullPromise = triggerScaleBridgePullSales({
                reason: 'lookup_summary_barcode',
                barcode,
            });
            const retryUntil = Date.now() + 15000;
            let retryCount = 0;
            while (!ticketRows.length && Date.now() < retryUntil) {
                // 300ms: el bridge pulsa cada ~0.5s; sondear mas fino que el pulso
                // recorta la latencia percibida del escaneo sin cargar la DB.
                await new Promise((resolve) => setTimeout(resolve, 300));
                retryCount += 1;
                [ticketRows] = await pool.query(
                    `SELECT ${ticketSelect}
                     FROM scale_bridge_ticket_map
                     WHERE tenant_id = ?
                       AND (
                            UPPER(ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})
                            ${scaleSchema.ticketPrintedBarcode ? ` OR UPPER(printed_ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})` : ''}
                       )
                       ${openTicketFilter}
                     ORDER BY sale_at DESC
                     LIMIT 1`,
                    scaleSchema.ticketPrintedBarcode
                        ? [tenantId, ...barcodeCandidates, ...barcodeCandidates]
                        : [tenantId, ...barcodeCandidates]
                );
            }
            appendScaleLatencyLog('lookup_retry_window_done', {
                tenantId,
                barcode,
                retryCount,
                found: ticketRows.length > 0,
                elapsedMs: Date.now() - lookupStartedAt,
            });
            if (!ticketRows.length) {
                await pullPromise.catch(() => false);
                [ticketRows] = await pool.query(
                    `SELECT ${ticketSelect}
                     FROM scale_bridge_ticket_map
                     WHERE tenant_id = ?
                       AND (
                            UPPER(ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})
                            ${scaleSchema.ticketPrintedBarcode ? ` OR UPPER(printed_ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})` : ''}
                       )
                       ${openTicketFilter}
                     ORDER BY sale_at DESC
                     LIMIT 1`,
                    scaleSchema.ticketPrintedBarcode
                        ? [tenantId, ...barcodeCandidates, ...barcodeCandidates]
                        : [tenantId, ...barcodeCandidates]
                );
            }
        }

        if (!ticketRows.length && scaleSchema.ticketStatus) {
            const statusConditions = [`UPPER(ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})`];
            const statusParams = [tenantId, ...barcodeCandidates];
            if (scaleSchema.ticketPrintedBarcode) {
                statusConditions.push(`UPPER(printed_ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})`);
                statusParams.push(...barcodeCandidates);
            }
            const [anyStatusRows] = await pool.query(
                `SELECT ${ticketSelect}
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ? AND (${statusConditions.join(' OR ')})
                 ORDER BY sale_at DESC`,
                statusParams
            );
            if (anyStatusRows.length) {
                const openCandidate = anyStatusRows.find(
                    (r) => String(r.ticket_status || '').toLowerCase() === 'open'
                );
                if (openCandidate) {
                    ticketRows = [openCandidate];
                } else {
                    const nonOpenRow = anyStatusRows[0];
                    const nonOpenStatus = String(nonOpenRow.ticket_status || '').toLowerCase();
                    if (nonOpenStatus === 'charged' && nonOpenRow.charged_sale_id) {
                        const [saleCheck] = await pool.query(
                            `SELECT id FROM ventas WHERE tenant_id = ? AND id = ? LIMIT 1`,
                            [tenantId, nonOpenRow.charged_sale_id]
                        );
                        if (saleCheck.length === 0) {
                            await pool.query(
                                `UPDATE scale_bridge_ticket_map
                                 SET ticket_status = 'open', charged_sale_id = NULL, charged_at = NULL
                                 WHERE tenant_id = ? AND id = ?`,
                                [tenantId, nonOpenRow.id]
                            );
                            nonOpenRow.ticket_status = 'open';
                            ticketRows = [nonOpenRow];
                            appendScaleLatencyLog('lookup_auto_liberated_phantom', {
                                tenantId,
                                barcode,
                                ticketId: nonOpenRow.id,
                                elapsedMs: Date.now() - lookupStartedAt,
                            });
                        }
                    }
                    if (!ticketRows.length) {
                        appendScaleLatencyLog('lookup_ticket_not_open', {
                            tenantId,
                            barcode,
                            status: nonOpenStatus,
                            elapsedMs: Date.now() - lookupStartedAt,
                        });
                        return res.status(409).json({
                            ok: false,
                            error: `Ese ticket ya fue ${nonOpenStatus} y no debe reutilizarse`,
                        });
                    }
                }
            }
        }

        if (!ticketRows.length && isScaleSummaryBarcode) {
            const totalRaw = Number.parseInt(barcodeDigits.substring(6, 12), 10);
            const totalCandidates = Array.from(new Set([
                Number.isFinite(totalRaw) ? totalRaw : 0,
                Number.isFinite(totalRaw) ? Number((totalRaw / 100).toFixed(2)) : 0,
            ])).filter((value) => Number.isFinite(value) && value >= 0);
            const deviceHint = Number.parseInt(barcodeDigits.substring(2, 4), 10);
            const itemCountHint = Number.parseInt(barcodeDigits.substring(4, 6), 10);
            const safeDeviceHint = Number.isFinite(deviceHint) ? deviceHint : null;
            const safeItemCountHint = Number.isFinite(itemCountHint) ? itemCountHint : null;
            for (const totalAmount of totalCandidates) {
                const amountMatchParams = [tenantId, totalAmount];
                let scaleAddressClause = '';
                if (scaleSchema.ticketScaleAddress) {
                    scaleAddressClause = ' AND (? IS NULL OR scale_address = ?)';
                    amountMatchParams.push(safeDeviceHint, safeDeviceHint);
                }
                amountMatchParams.push(
                    safeItemCountHint,
                    safeItemCountHint,
                    safeItemCountHint,
                );
                const [amountMatches] = await pool.query(
                    `SELECT ${ticketSelect}
                     FROM scale_bridge_ticket_map
                     WHERE tenant_id = ?
                       ${scaleSchema.ticketStatus ? "AND ticket_status = 'open'" : ''}
                       AND ABS(total_amount - ?) < 0.01
                       ${scaleAddressClause}
                       AND (? IS NULL OR ? = 0 OR item_count = ?)
                       AND sale_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
                     ORDER BY sale_at DESC
                     LIMIT 3`,
                    amountMatchParams
                );
                if (amountMatches.length === 1) {
                    ticketRows = [amountMatches[0]];
                    appendScaleLatencyLog('lookup_amount_fallback_match', {
                        tenantId,
                        barcode,
                        ticketId: amountMatches[0]?.ticket_id || null,
                        ticketBarcode: amountMatches[0]?.ticket_barcode || null,
                        printedTicketBarcode: amountMatches[0]?.printed_ticket_barcode || null,
                        totalAmount,
                        elapsedMs: Date.now() - lookupStartedAt,
                    });
                    break;
                }
                if (amountMatches.length > 1) {
                    appendScaleLatencyLog('lookup_amount_fallback_conflict', {
                        tenantId,
                        barcode,
                        totalAmount,
                        candidates: amountMatches.length,
                        elapsedMs: Date.now() - lookupStartedAt,
                    });
                    return res.status(409).json({
                        ok: false,
                        error: 'Hay mas de un ticket posible para ese codigo resumen. Reimprima ticket con codigo unico o escanee codigo MM.',
                        candidates: amountMatches.map((row) => ({
                            ticketId: row.ticket_id,
                            printedBarcode: row.printed_ticket_barcode || null,
                            saleAt: row.sale_at,
                            total: Number(row.total_amount || 0),
                        })),
                    });
                }
            }

            if (!ticketRows.length) {
                appendScaleLatencyLog('lookup_amount_only_fallback_skipped', {
                    tenantId,
                    barcode,
                    totals: totalCandidates,
                    elapsedMs: Date.now() - lookupStartedAt,
                });
            }
        }

        if (!ticketRows.length && scaleSchema.ventaTicketBarcode) {
            const ventasSelect = [
                'id',
                'date',
                'total',
                scaleSchema.ventaQendraTicketId ? 'qendra_ticket_id' : 'NULL AS qendra_ticket_id',
                'ticket_barcode',
            ].join(', ');
            const [ventaRows] = await pool.query(
                `SELECT ${ventasSelect}
                 FROM ventas
                 WHERE tenant_id = ?
                   AND UPPER(ticket_barcode) IN (${barcodeCandidates.map(() => 'UPPER(?)').join(', ')})
                 ORDER BY date DESC
                 LIMIT 1`,
                [tenantId, ...barcodeCandidates]
            );
            if (ventaRows.length) {
                const venta = ventaRows[0];
                const [itemsVenta] = await pool.query(
                    `SELECT vi.product_id, vi.product_name, vi.quantity, vi.price, vi.subtotal,
                            p.plu AS product_plu, p.category AS product_category, p.unit AS product_unit
                     FROM ventas_items vi
                     LEFT JOIN products p
                       ON p.tenant_id = vi.tenant_id
                      AND p.id = vi.product_id
                     WHERE vi.tenant_id = ? AND vi.venta_id = ?
                     ORDER BY vi.id ASC`,
                    [tenantId, venta.id]
                );
                appendScaleLatencyLog('lookup_existing_sale_found', {
                    tenantId,
                    barcode,
                    ventaId: venta.id,
                    ticketBarcode: venta.ticket_barcode,
                    saleAt: toIsoSafe(venta.date),
                    elapsedMs: Date.now() - lookupStartedAt,
                    items: itemsVenta.length,
                });
                return res.json({
                    ok: true,
                    ticket: {
                        deviceId: null,
                        ticketId: venta.qendra_ticket_id || String(venta.id),
                        barcode: venta.ticket_barcode,
                        internalBarcode: venta.ticket_barcode,
                        printedBarcode: venta.ticket_barcode,
                        vendorCode: null,
                        saleAt: venta.date,
                        total: Number(venta.total || 0),
                        itemCount: itemsVenta.length,
                    },
                    items: itemsVenta.map((row, idx) => ({
                        lineNo: idx + 1,
                        plu: row.product_plu ? String(row.product_plu) : '',
                        quantity: Number(row.quantity || 0),
                        unit: String(row.product_unit || '').trim() || 'un',
                        amount: Number(row.subtotal || 0),
                        vendorCode: null,
                        product: {
                            id: row.product_id ? Number(row.product_id) : null,
                            name: row.product_name || null,
                            category: row.product_category || null,
                            unit: row.product_unit || null,
                            price: row.price != null ? Number(row.price) : null,
                            plu: row.product_plu ? String(row.product_plu) : null,
                        },
                    })),
                });
            }
        }

        if (!ticketRows.length) {
            appendScaleLatencyLog('lookup_not_found', {
                tenantId,
                barcode,
                elapsedMs: Date.now() - lookupStartedAt,
            });
            return res.status(404).json({ ok: false, error: 'Ticket no encontrado para ese barcode' });
        }

        const ticket = ticketRows[0];
        appendScaleLatencyLog('lookup_ticket_found', {
            tenantId,
            barcode,
            deviceId: ticket.device_id,
            ticketId: ticket.ticket_id,
            ticketBarcode: ticket.ticket_barcode,
            printedTicketBarcode: ticket.printed_ticket_barcode || null,
            saleAt: toIsoSafe(ticket.sale_at),
            saleToLookupMs: diffMs(ticket.sale_at, lookupStartedAt),
            elapsedMs: Date.now() - lookupStartedAt,
        });

        // Lazy normalization: sync item barcodes/metadata from ticket_map if stale.
        // The bridge's fingerprint dedup can prevent re-sending old tickets, leaving
        // items with outdated barcodes.  This one-time fix per lookup keeps the data
        // consistent without waiting for a re-sync.
        try {
            await pool.query(
                `UPDATE scale_bridge_sales_item s
                 INNER JOIN scale_bridge_ticket_map t
                    ON t.device_id = s.device_id
                   AND t.tenant_id = s.tenant_id
                   AND COALESCE(t.branch_id, 0) = COALESCE(s.branch_id, 0)
                   AND t.ticket_id = s.ticket_id
                   AND t.sale_at = s.sale_at
                 SET s.ticket_barcode         = t.ticket_barcode,
                     s.printed_ticket_barcode = t.printed_ticket_barcode,
                     s.vendor_name            = t.vendor_name,
                     s.ticket_total_amount    = t.total_amount,
                     s.ticket_item_count      = t.item_count,
                     s.synced_at              = NOW()
                 WHERE s.device_id = ?
                   AND s.tenant_id = ?
                   AND s.ticket_id = ?
                   AND s.sale_at = ?
                   AND (
                        s.ticket_barcode IS NULL
                        OR s.ticket_barcode <> t.ticket_barcode
                        OR COALESCE(s.printed_ticket_barcode, '') <> COALESCE(t.printed_ticket_barcode, '')
                        OR COALESCE(s.vendor_name, '') <> COALESCE(t.vendor_name, '')
                        OR ABS(COALESCE(s.ticket_total_amount, 0) - COALESCE(t.total_amount, 0)) >= 0.01
                        OR COALESCE(s.ticket_item_count, 0) <> COALESCE(t.item_count, 0)
                   )`,
                [ticket.device_id, tenantId, ticket.ticket_id, ticket.sale_at]
            );
        } catch (_) { /* best-effort */ }

        const itemBaseSql = `SELECT ${itemSelect}
             FROM scale_bridge_sales_item s
             LEFT JOIN (
                SELECT device_id, tenant_id, plu_code, MIN(product_id) AS product_id
                  FROM scale_bridge_product_map
                 GROUP BY device_id, tenant_id, plu_code
             ) m
               ON m.device_id = s.device_id
              AND m.tenant_id = s.tenant_id
              AND CAST(m.plu_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
             LEFT JOIN products p
               ON p.tenant_id = s.tenant_id
              AND (
                   (m.product_id IS NOT NULL AND p.id = m.product_id)
                   OR (
                        m.product_id IS NULL
                        AND p.id = (
                            SELECT p2.id
                              FROM products p2
                             WHERE p2.tenant_id = s.tenant_id
                               AND (p2.branch_id <=> s.branch_id OR p2.branch_id IS NULL)
                               AND (
                                    CAST(p2.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                                    OR CAST(p2.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4)) COLLATE utf8mb4_unicode_ci
                               )
                             ORDER BY CASE WHEN p2.branch_id <=> s.branch_id THEN 0 ELSE 1 END, p2.id DESC
                             LIMIT 1
                        )
                   )
              )
             WHERE s.tenant_id = ?`;

        let [itemRows] = await pool.query(
            `${itemBaseSql}
               AND s.device_id = ?
               AND s.ticket_id = ?
               AND s.sale_at = ?
             ORDER BY s.line_no ASC`,
            [tenantId, ticket.device_id, ticket.ticket_id, ticket.sale_at]
        );

        // Fallback defensivo:
        // algunos firmwares/lectores pueden desalinear el identificador interno,
        // pero los barcodes del ticket siguen siendo estables.
        if (!itemRows.length) {
            const ticketBarcodeCandidates = buildScaleBarcodeCandidates(ticket.ticket_barcode);
            const barcodeConditions = [`UPPER(s.ticket_barcode) IN (${ticketBarcodeCandidates.map(() => 'UPPER(?)').join(', ')})`];
            const barcodeParams = [tenantId, ...ticketBarcodeCandidates];
            if (scaleSchema.itemPrintedBarcode && ticket.printed_ticket_barcode) {
                const printedBarcodeCandidates = buildScaleBarcodeCandidates(ticket.printed_ticket_barcode);
                barcodeConditions.push(`UPPER(s.printed_ticket_barcode) IN (${printedBarcodeCandidates.map(() => 'UPPER(?)').join(', ')})`);
                barcodeParams.push(...printedBarcodeCandidates);
            }
            [itemRows] = await pool.query(
                `${itemBaseSql}
                   AND (${barcodeConditions.join(' OR ')})
                   AND s.sale_at = ?
                 ORDER BY s.line_no ASC`,
                [...barcodeParams, ticket.sale_at]
            );
        }

        // Fallback extra de resiliencia: si por cualquier motivo el mapeo por
        // device/ticket no matchea (cambio de device_id, recaptura parcial, etc),
        // buscamos por cualquier identificador estable del ticket dentro del tenant.
        if (!itemRows.length) {
            const anyIdConditions = [];
            const anyIdParams = [tenantId];
            if (ticket.ticket_id) {
                anyIdConditions.push('s.ticket_id = ?');
                anyIdParams.push(ticket.ticket_id);
            }
            if (ticket.ticket_barcode) {
                const ticketBarcodeCandidates = buildScaleBarcodeCandidates(ticket.ticket_barcode);
                anyIdConditions.push(`UPPER(s.ticket_barcode) IN (${ticketBarcodeCandidates.map(() => 'UPPER(?)').join(', ')})`);
                anyIdParams.push(...ticketBarcodeCandidates);
            }
            if (scaleSchema.itemPrintedBarcode && ticket.printed_ticket_barcode) {
                const printedBarcodeCandidates = buildScaleBarcodeCandidates(ticket.printed_ticket_barcode);
                anyIdConditions.push(`UPPER(s.printed_ticket_barcode) IN (${printedBarcodeCandidates.map(() => 'UPPER(?)').join(', ')})`);
                anyIdParams.push(...printedBarcodeCandidates);
            }

            if (anyIdConditions.length > 0) {
                [itemRows] = await pool.query(
                    `${itemBaseSql}
                       AND (${anyIdConditions.join(' OR ')})
                       AND s.sale_at = ?
                     ORDER BY s.sale_at DESC, s.line_no ASC`,
                    [...anyIdParams, ticket.sale_at]
                );
            }
        }

        const expectedItemCount = Number(ticket.item_count || 0);
        const expectedTotalAmount = Number(ticket.total_amount || 0);
        const itemRowsTotal = Number(itemRows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
        const itemCountMismatch = expectedItemCount > 0 && itemRows.length !== expectedItemCount;
        const itemTotalMismatch = expectedTotalAmount > 0 && Math.abs(itemRowsTotal - expectedTotalAmount) >= 0.01;
        if (itemRows.length > 0 && (itemCountMismatch || itemTotalMismatch)) {
            appendScaleLatencyLog('lookup_items_integrity_mismatch', {
                tenantId,
                barcode,
                deviceId: ticket.device_id,
                ticketId: ticket.ticket_id,
                ticketBarcode: ticket.ticket_barcode,
                printedTicketBarcode: ticket.printed_ticket_barcode || null,
                expectedItemCount,
                actualItemCount: itemRows.length,
                expectedTotalAmount,
                actualTotalAmount: itemRowsTotal,
                elapsedMs: Date.now() - lookupStartedAt,
            });
            return res.status(409).json({
                ok: false,
                error: 'El detalle sincronizado del ticket no coincide con la cabecera. Reintentá en unos segundos o reimprimí el ticket con código único MM.',
                details: {
                    expectedItemCount,
                    actualItemCount: itemRows.length,
                    expectedTotalAmount,
                    actualTotalAmount: itemRowsTotal,
                },
            });
        }

        const items = itemRows.map((row) => {
            const grams = Number(row.grams || 0);
            const units = Number(row.units || 0);
            const qty = row.item_quantity != null ? Number(row.item_quantity) : (grams > 0 ? Number((grams / 1000).toFixed(3)) : units);
            const qtyUnit = String(row.item_quantity_unit || '').trim() || (grams > 0 ? 'kg' : 'un');
            return {
                lineNo: Number(row.line_no || 0),
                plu: String(row.plu_code || '').trim(),
                quantity: qty,
                unit: qtyUnit,
                amount: Number(row.amount || 0),
                ticketTotal: Number(row.ticket_total_amount || ticket.total_amount || 0),
                ticketItemCount: Number(row.ticket_item_count || ticket.item_count || 0),
                vendorCode: String(row.vendor_code || ticket.vendor_code || '').trim() || null,
                vendorName: String(row.vendor_name || ticket.vendor_name || '').trim() || null,
                product: {
                    id: row.product_id ? Number(row.product_id) : null,
                    name: row.product_name || null,
                    category: row.product_category || null,
                    unit: row.product_unit || null,
                    price: row.product_price != null ? Number(row.product_price) : null,
                    plu: row.product_plu != null ? String(row.product_plu) : null,
                },
            };
        });

        appendScaleLatencyLog('lookup_response_ready', {
            tenantId,
            barcode,
            deviceId: ticket.device_id,
            ticketId: ticket.ticket_id,
            ticketBarcode: ticket.ticket_barcode,
            printedTicketBarcode: ticket.printed_ticket_barcode || null,
            saleAt: toIsoSafe(ticket.sale_at),
            saleToLookupMs: diffMs(ticket.sale_at, lookupStartedAt),
            elapsedMs: Date.now() - lookupStartedAt,
            itemRows: itemRows.length,
            mappedItems: items.length,
        });
        return res.json({
            ok: true,
            ticket: {
                deviceId: ticket.device_id,
                ticketId: ticket.ticket_id,
                barcode: ticket.ticket_barcode,
                internalBarcode: ticket.ticket_barcode,
                printedBarcode: ticket.printed_ticket_barcode || null,
                vendorCode: ticket.vendor_code || null,
                vendorName: ticket.vendor_name || null,
                saleAt: ticket.sale_at,
                total: Number(ticket.total_amount || 0),
                itemCount: Number(ticket.item_count || items.length),
            },
            items,
        });
    } catch (err) {
        appendScaleLatencyLog('lookup_error', {
            tenantId: lookupTenantId,
            barcode: lookupBarcode,
            elapsedMs: Date.now() - lookupStartedAt,
            error: err?.message || String(err),
        });
        if (
            String(err?.message || '').includes('scale_bridge_ticket_map')
            || String(err?.message || '').includes('scale_bridge_sales_item')
        ) {
            return res.status(404).json({
                ok: false,
                error: 'Todavia no existe la tabla de tickets del bridge. Ejecuta una sincronizacion del bridge directo.',
            });
        }
        console.error('[GET /api/scale/tickets/by-barcode ERROR]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── RUTA: POST /api/compras ────────────────────────────────────────────────
// Registra una compra de forma ATÓMICA: compras + compras_items + stock
// + animal_lots (despostada) + caja_movimientos — en una sola transacción MySQL.
// Dual-write: actualiza product_prices con el precio de costo al guardar.
// Body: {
//   supplier, invoice_num, date, total, payment_method, is_account,
//   payment_method_type,   should_affect_cash, cash_amount,
//   has_despostada_module,
//   items: [{ product_id?, product_name, quantity, weight, unit_price, subtotal,
//             iva_rate, iva_amount, net_subtotal, destination, unit, type, species }],
//   catalog_updates: [{ purchase_item_id, last_price, usage, default_iva_rate }]
// }
app.post('/api/compras', verifyFirebaseToken, async (req, res) => {
    const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
    const pool = getTenantPool(dbName);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const {
            supplier, invoice_num, date, total, payment_method, is_account,
            payment_method_type, should_affect_cash, cash_amount,
            has_despostada_module,
            items, catalog_updates,
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'items requeridos' });
        }

        const purchaseDate = date ? new Date(String(date).split('T')[0] + 'T12:00:00') : new Date();
        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: { branch_id: req.body?.branch_id },
            })
            : null;

        // 1. INSERT compras
        const [compraResult] = await conn.query(
            `INSERT INTO compras
             (tenant_id, branch_id, date, supplier, invoice_num, total, payment_method, is_account, items_detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, resolvedBranchId || null, purchaseDate, String(supplier || '').trim(),
                invoice_num || null, parseFloat(total) || 0,
                payment_method || null, is_account ? 1 : 0,
                JSON.stringify(items),
            ]
        );
        const purchaseId = compraResult.insertId;

        // 2. INSERT compras_items
        for (const item of items) {
            const subtotal = parseFloat(item.subtotal) || 0;
            const ivaRate = parseFloat(item.iva_rate) || 0;
            const ivaAmount = parseFloat(item.iva_amount) || 0;
            const netSubtotal = parseFloat(item.net_subtotal) || (subtotal - ivaAmount);
            await conn.query(
                `INSERT INTO compras_items
                 (tenant_id, branch_id, purchase_id, product_id, product_name, quantity, weight,
                  unit_price, subtotal, iva_rate, iva_amount, net_subtotal, destination)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId, resolvedBranchId || null, purchaseId,
                    item.product_id || null,
                    String(item.product_name || '').trim(),
                    parseFloat(item.quantity) || 0,
                    parseFloat(item.weight) || 0,
                    parseFloat(item.unit_price) || 0,
                    subtotal, ivaRate, ivaAmount, netSubtotal,
                    item.destination || 'venta',
                ]
            );
        }

        // 3. Stock / animal_lots por item
        for (const item of items) {
            let effectiveType = item.type;
            let effectiveSpecies = item.species || 'vaca';
            if (item.product_id) {
                const [[productRule]] = await conn.query(
                    `SELECT use_for_despostada, despostada_species
                     FROM products
                     WHERE tenant_id = ? AND id = ?
                     LIMIT 1`,
                    [tenantId, item.product_id]
                );
                if (Number(productRule?.use_for_despostada || 0) === 1 && effectiveType === 'despostada') {
                    effectiveSpecies = productRule.despostada_species || effectiveSpecies || 'vaca';
                }
            }
            const isDespostada = effectiveType === 'despostada';
            const isInternal = item.destination === 'interno';

            // Despostada → crear lotes (solo si tiene módulo)
            if (isDespostada && has_despostada_module) {
                const qty = parseFloat(item.quantity) || 1;
                const weight = parseFloat(item.weight) || 0;
                const numLots = item.unit === 'un' ? Math.floor(qty) : 1;
                const weightPerLot = item.unit === 'un' ? (weight / qty) : weight;
                for (let i = 0; i < numLots; i++) {
                    await conn.query(
                        `INSERT INTO animal_lots
                         (tenant_id, branch_id, purchase_id, supplier, date, species, weight, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'disponible')`,
                        [tenantId, resolvedBranchId || null, purchaseId, String(supplier || '').trim(),
                         purchaseDate, effectiveSpecies || 'vaca', weightPerLot]
                    );
                }
                continue; // no va al stock de venta
            }

            if (isInternal) continue; // interno → no afecta stock venta

            // Directo / insumo → incrementar stock
            const stockQty = item.unit === 'kg'
                ? (parseFloat(item.weight) || parseFloat(item.quantity) || 0)
                : (parseFloat(item.quantity) || 0);

            await conn.query(
                `INSERT INTO stock
                 (tenant_id, branch_id, product_id, name, type, quantity, unit, reference)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    resolvedBranchId,
                    item.product_id || null,
                    String(item.product_name || '').trim(),
                    effectiveSpecies || effectiveType || 'vaca',
                    stockQty,
                    item.unit || 'kg',
                    `compra_${purchaseId}`,
                ]
            );

            // Dual-write: registrar precio de costo en product_prices (source='compra')
            if (item.product_id && parseFloat(item.unit_price) > 0) {
                const productPriceCols = await getTableColumns(conn, dbName, 'product_prices');
                if (productPriceCols.includes('branch_id') && Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
                    await conn.query(
                        `INSERT INTO product_prices
                         (tenant_id, branch_id, product_id, price, source, effective_at, created_at)
                         VALUES (?, ?, ?, ?, 'compra', ?, NOW())`,
                        [tenantId, resolvedBranchId, item.product_id, parseFloat(item.unit_price), purchaseDate]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO product_prices
                         (tenant_id, product_id, price, source, effective_at, created_at)
                         VALUES (?, ?, ?, 'compra', ?, NOW())`,
                        [tenantId, item.product_id, parseFloat(item.unit_price), purchaseDate]
                    );
                }
            }
        }

        // 4. Caja movimientos (egreso si compra interna pagada con efectivo/transferencia)
        if (should_affect_cash && parseFloat(cash_amount) > 0) {
            const desc = `${String(supplier || '').trim()}${invoice_num ? ` · Comprobante ${invoice_num}` : ''}`;
            await conn.query(
                `INSERT INTO caja_movimientos
                 (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, purchase_id, branch_id)
                 VALUES (?, 'egreso', ?, 'Compra interna', ?, ?, ?, 'principal', ?, ?, ?)`,
                [
                    tenantId, parseFloat(cash_amount) || 0, desc,
                    payment_method || 'Efectivo',
                    payment_method_type || 'cash',
                    purchaseDate, purchaseId,
                    resolvedBranchId || null,
                ]
            );
            await conn.query(
                `UPDATE caja_movimientos
                 SET money_flow_kind = 'internal_purchase_payment',
                     origin_table = 'compras',
                     origin_id = ?,
                     origin_group_id = CONCAT('purchase_', ?)
                 WHERE tenant_id = ? AND purchase_id = ? AND type = 'egreso'`,
                [purchaseId, purchaseId, tenantId, purchaseId]
            );
        }

        await conn.commit();
        conn.release();

        // 5. Best-effort: actualizar purchase_items.last_price (fuera de transacción)
        if (Array.isArray(catalog_updates)) {
            for (const cu of catalog_updates) {
                if (!cu.purchase_item_id || !(parseFloat(cu.last_price) > 0)) continue;
                try {
                    await pool.query(
                        `UPDATE purchase_items
                         SET last_price = ?, \`usage\` = ?, default_iva_rate = ?
                         WHERE tenant_id = ? AND id = ? AND branch_id <=> ?`,
                        [parseFloat(cu.last_price), cu.usage || 'venta',
                         parseFloat(cu.default_iva_rate) || 10.5, tenantId, cu.purchase_item_id, resolvedBranchId || null]
                    );
                } catch (e) {
                    console.warn('[POST /api/compras] last_price update skipped:', e.message);
                }
            }
        }

        // 6. Best-effort: upsert supplier_item_tax_profiles
        for (const item of items) {
            if (!(parseFloat(item.iva_rate) >= 0)) continue;
            try {
                await pool.query(
                    `INSERT INTO supplier_item_tax_profiles
                     (tenant_id, branch_id, supplier_name, product_name, last_iva_rate, updated_at)
                     VALUES (?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE last_iva_rate = VALUES(last_iva_rate), updated_at = NOW()`,
                    [tenantId, resolvedBranchId || null, String(supplier || '').trim(),
                     String(item.product_name || '').trim(), parseFloat(item.iva_rate) || 0]
                );
            } catch (e) {
                console.warn('[POST /api/compras] tax profile upsert skipped:', e.message);
            }
        }

        return res.json({ ok: true, insertId: purchaseId });

    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        conn.release();
        console.error('[POST /api/compras ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

const inferPaymentTypeByName = (paymentMethodName) => {
    const normalized = String(paymentMethodName || '').trim().toLowerCase();
    if (!normalized) return 'cash';
    if (normalized.includes('cuenta corriente')) return 'cuenta_corriente';
    if (normalized.includes('mercado pago') || normalized.includes('cuenta dni')) return 'wallet';
    if (normalized.includes('postnet') || normalized.includes('posnet') || normalized.includes('tarjeta')) return 'card';
    if (normalized.includes('mixto') || normalized.includes('mixed')) return 'mixed';
    if (normalized.includes('efectivo')) return 'cash';
    return 'cash';
};

const isCurrentAccountPayment = (paymentMethodName, paymentMethodType) => {
    const normalizedName = String(paymentMethodName || '').trim().toLowerCase();
    const normalizedType = String(paymentMethodType || '').trim().toLowerCase();
    return normalizedType === 'cuenta_corriente' || normalizedName.includes('cuenta corriente');
};

const getCurrentAccountAmountFromSale = ({ paymentMethod, paymentMethodType, paymentBreakdown, totalAmount }) => {
    const breakdown = Array.isArray(paymentBreakdown) ? paymentBreakdown : null;
    if (!breakdown || breakdown.length === 0) {
        const safeTotal = parseFloat(totalAmount) || 0;
        if (safeTotal <= 0) return 0;
        return isCurrentAccountPayment(paymentMethod, paymentMethodType) ? safeTotal : 0;
    }

    return breakdown.reduce((sum, part) => {
        const methodName = String(
            part?.method_name || part?.name || paymentMethod || 'Efectivo'
        ).trim();
        const methodType = String(
            part?.method_type || part?.type || inferPaymentTypeByName(methodName)
        ).trim();
        if (!isCurrentAccountPayment(methodName, methodType)) return sum;
        return sum + (parseFloat(part?.amount_charged ?? part?.amount ?? part?.total ?? 0) || 0);
    }, 0);
};

async function resolveClientBalanceTargetId(conn, tenantId, clientId, branchId = null) {
    const normalizedClientId = Number(clientId);
    if (!Number.isFinite(normalizedClientId) || normalizedClientId <= 0) return null;

    const normalizedBranchId = Number(branchId);
    if (Number.isFinite(normalizedBranchId) && normalizedBranchId > 0) {
        const [rows] = await conn.query(
            `SELECT id
             FROM clients
             WHERE tenant_id = ?
               AND id = ?
               AND branch_id = ?
             LIMIT 1`,
            [tenantId, normalizedClientId, normalizedBranchId]
        );
        if (rows?.[0]?.id) return Number(rows[0].id);
        return null;
    }

    const [fallbackRows] = await conn.query(
        `SELECT id
         FROM clients
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [tenantId, normalizedClientId]
    );
    return fallbackRows?.[0]?.id ? Number(fallbackRows[0].id) : null;
}

async function assertClientBelongsToBranch(conn, { tenantId, clientId, branchId, label = 'cliente' } = {}) {
    const normalizedClientId = Number(clientId);
    if (!Number.isFinite(normalizedClientId) || normalizedClientId <= 0) return null;

    const normalizedBranchId = Number(branchId);
    if (!Number.isFinite(normalizedBranchId) || normalizedBranchId <= 0) {
        const error = new Error(`Debe especificar branch_id para validar ${label}`);
        error.statusCode = 400;
        throw error;
    }

    const [[client]] = await conn.query(
        `SELECT id, branch_id
         FROM clients
         WHERE tenant_id = ?
           AND id = ?
           AND branch_id = ?
         LIMIT 1`,
        [tenantId, normalizedClientId, normalizedBranchId]
    );

    if (!client) {
        const error = new Error(`El ${label} no pertenece a la sucursal activa`);
        error.statusCode = 409;
        throw error;
    }

    return client;
}

async function applyClientBalanceDelta(conn, { tenantId, clientId, branchId = null, delta = 0 } = {}) {
    const amount = Number(delta);
    if (!Number.isFinite(amount) || Math.abs(amount) <= 0.0001) return false;

    const targetClientId = await resolveClientBalanceTargetId(conn, tenantId, clientId, branchId);
    if (!targetClientId) return false;

    await conn.query(
        `UPDATE clients
         SET balance = COALESCE(balance, 0) + ?,
             last_updated = NOW()
         WHERE tenant_id = ?
           AND id = ?`,
        [amount, tenantId, targetClientId]
    );
    return true;
}

const buildCajaPartsFromSale = ({ paymentMethod, paymentMethodType, paymentBreakdown, totalAmount }) => {
    const breakdown = Array.isArray(paymentBreakdown) ? paymentBreakdown : null;
    if (!breakdown || breakdown.length === 0) {
        const safeTotal = parseFloat(totalAmount) || 0;
        if (safeTotal <= 0) return [];
        const methodName = String(paymentMethod || 'Efectivo').trim();
        const methodType = String(paymentMethodType || inferPaymentTypeByName(methodName)).trim();
        if (isCurrentAccountPayment(methodName, methodType)) return [];
        return [{ methodName, methodType, amount: safeTotal }];
    }

    const parts = [];
    for (const part of breakdown) {
        const amount = parseFloat(
            part?.amount_charged ?? part?.amount ?? part?.total ?? 0
        ) || 0;
        if (amount <= 0) continue;

        const methodName = String(
            part?.method_name || part?.name || paymentMethod || 'Efectivo'
        ).trim();
        const methodType = String(
            part?.method_type || part?.type || inferPaymentTypeByName(methodName)
        ).trim();
        if (isCurrentAccountPayment(methodName, methodType)) continue;

        parts.push({ methodName, methodType, amount });
    }
    return parts;
};

// ── RUTA: POST /api/ventas ─────────────────────────────────────────────────
// Registra una venta de forma ATÓMICA: ventas + ventas_items + stock (descuento)
// + ajuste de balance de cliente (cta cte) — todo en una sola transacción MySQL.
// Body: {
//   date, subtotal, adjustment, total,
//   receipt_number, receipt_code,
//   payment_method, payment_method_id,
//   payment_breakdown?,    // array para pago mixto
//   clientId?,             // cliente para cuenta corriente
//   discount_client_id?, client_discount_pct?, client_discount_amount?,
//   qendra_ticket_id?, ticket_barcode?, source?,
//   items: [{ product_id?, product_name, quantity, price, subtotal, category?, unit? }]
// }
app.post('/api/ventas', verifyFirebaseToken, async (req, res) => {
    const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
    const pool = getTenantPool(dbName);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const {
            date, subtotal, adjustment, total,
            receipt_number, receipt_code,
            payment_method, payment_method_id,
            payment_breakdown,
            clientId,
            discount_client_id,
            client_discount_pct,
            client_discount_amount,
            qendra_ticket_id, ticket_barcode, source,
            items,
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'items requeridos' });
        }

        const safeTotal = parseFloat(total) || 0;
        const safeSubtotal = parseFloat(subtotal) || 0;
        const safeAdj = parseFloat(adjustment) || 0;
        const parsedClientId = Number.parseInt(clientId, 10);
        const safeClientId = Number.isFinite(parsedClientId) && parsedClientId > 0 ? parsedClientId : null;
        const parsedDiscountClientId = Number.parseInt(
            discount_client_id != null ? discount_client_id : clientId,
            10
        );
        const requestedDiscountClientId = Number.isFinite(parsedDiscountClientId) && parsedDiscountClientId > 0
            ? parsedDiscountClientId
            : null;

        const clampDiscountPct = (value) => {
            const n = parseFloat(value);
            if (!Number.isFinite(n) || n <= 0) return 0;
            if (n >= 100) return 100;
            return n;
        };

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: { branch_id: req.body?.branch_id, receipt_code },
            })
            : null;

        if (safeClientId) {
            await assertClientBelongsToBranch(conn, {
                tenantId,
                clientId: safeClientId,
                branchId: resolvedBranchId,
                label: 'cliente de cuenta corriente',
            });
        }

        let safeDiscountClientId = null;
        let safeClientDiscountPct = 0;
        let safeClientDiscountAmount = 0;

        if (requestedDiscountClientId) {
            const [[discountClient]] = await conn.query(
                `SELECT id, employee_discount_enabled, employee_discount_pct
                 FROM clients
                 WHERE tenant_id = ?
                   AND id = ?
                   AND branch_id = ?
                 LIMIT 1`,
                [tenantId, requestedDiscountClientId, resolvedBranchId]
            );
            const discountEnabled = Number(discountClient?.employee_discount_enabled) === 1
                || discountClient?.employee_discount_enabled === true;
            const discountPct = clampDiscountPct(discountClient?.employee_discount_pct);
            if (discountClient && discountEnabled && discountPct > 0) {
                safeDiscountClientId = Number(discountClient.id);
                safeClientDiscountPct = discountPct;
                safeClientDiscountAmount = Math.round(((safeSubtotal * discountPct) / 100) * 100) / 100;
            }
        }

        const requestedDiscountPct = clampDiscountPct(client_discount_pct);
        const requestedDiscountAmount = parseFloat(client_discount_amount);
        if (safeDiscountClientId && safeClientDiscountPct === 0 && requestedDiscountPct > 0) {
            safeClientDiscountPct = requestedDiscountPct;
        }
        if (safeDiscountClientId && safeClientDiscountAmount === 0 && Number.isFinite(requestedDiscountAmount) && requestedDiscountAmount > 0) {
            safeClientDiscountAmount = Math.round(requestedDiscountAmount * 100) / 100;
        }
        const now = date ? new Date(date) : new Date();
        const ticketBarcode = String(ticket_barcode || '').trim() || null;
        const rawMultiBarcodes = req.body.ticket_barcodes;
        const ticketBarcodes = Array.isArray(rawMultiBarcodes) && rawMultiBarcodes.length > 0
            ? rawMultiBarcodes.map(b => String(b).trim()).filter(Boolean)
            : (ticketBarcode ? [ticketBarcode] : []);
        const primaryBarcode = ticketBarcodes[0] || null;

        await ensureScaleTicketLifecycleColumns(conn);
        let ticketDate = null;
        if (ticketBarcodes.length > 0) {
            const inList = ticketBarcodes.map(() => '?').join(',');
            const [ticketRows] = await conn.query(
                `SELECT ticket_barcode, ticket_status, sale_at, total_amount
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ? AND (UPPER(ticket_barcode) IN (${inList})
                     OR UPPER(printed_ticket_barcode) IN (${inList}))`,
                [tenantId, ...ticketBarcodes, ...ticketBarcodes]
            );
            if (ticketRows.length < ticketBarcodes.length) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ error: 'Uno o más tickets no existen o aún no se sincronizaron' });
            }
            const notOpen = ticketRows.filter(r => String(r.ticket_status || '').toLowerCase() !== 'open');
            if (notOpen.length > 0) {
                await conn.rollback();
                conn.release();
                return res.status(409).json({ error: 'Uno o más tickets ya fueron cobrados o anulados' });
            }

            // RED DE SEGURIDAD: un ticket de balanza se cobra ENTERO. Si el cajero borró
            // un renglón del carrito (o el producto no estaba configurado y se descartó),
            // el total de la venta queda por debajo del total del ticket y ANTES el ticket
            // igual se marcaba 'charged' por su importe completo -> se perdía plata en
            // silencio (caso picada+bondiola: se borró la bondiola y quedó "cobrado" el
            // total con solo la picada vendida). Acá exigimos que lo que se está cobrando
            // cubra al menos el total de los tickets matcheados por su código INTERNO (el
            // único que matchea sin verificar importe; el impreso ya exige importe+fecha).
            // Sumar de más (extras cargados a mano) está permitido; cobrar de menos, no.
            const wantedUpper = new Set(ticketBarcodes.map((b) => String(b).toUpperCase()));
            const internalMatched = ticketRows.filter(
                (r) => wantedUpper.has(String(r.ticket_barcode || '').toUpperCase())
            );
            const expectedTicketsTotal = internalMatched.reduce(
                (acc, r) => acc + (parseFloat(r.total_amount) || 0), 0
            );
            if (expectedTicketsTotal > 0) {
                const itemsSubtotalSum = items.reduce((acc, it) => {
                    const sub = parseFloat(it.subtotal);
                    const line = Number.isFinite(sub)
                        ? sub
                        : (parseFloat(it.price) || 0) * (parseFloat(it.quantity) || 0);
                    return acc + (Number.isFinite(line) ? line : 0);
                }, 0);
                // Tolerancia de $1 por redondeos de precio unitario.
                if (itemsSubtotalSum + 1 < expectedTicketsTotal) {
                    await conn.rollback();
                    conn.release();
                    return res.status(409).json({
                        error: `El importe a cobrar ($${itemsSubtotalSum.toFixed(2)}) es menor al del ticket de balanza ($${expectedTicketsTotal.toFixed(2)}). `
                            + 'Un ticket de balanza se cobra completo: no borres renglones sueltos. '
                            + 'Si un producto no está configurado, cargalo en Stock; si querés descartar el ticket, quitalo entero del carrito.',
                        code: 'SCALE_TICKET_PARTIAL_CHARGE',
                    });
                }
            }

            const earliest = ticketRows.sort((a, b) => new Date(a.sale_at) - new Date(b.sale_at))[0];
            if (earliest?.sale_at) ticketDate = new Date(earliest.sale_at);
        }

        // 1. INSERT ventas
        const saleDate = ticketDate || now;
        const [ventaResult] = await conn.query(
            `INSERT INTO ventas
             (tenant_id, branch_id, date, subtotal, adjustment, total,
               receipt_number, receipt_code,
               payment_method, payment_method_id, payment_breakdown,
               clientId, discount_client_id, client_discount_pct, client_discount_amount,
               qendra_ticket_id, ticket_barcode, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, resolvedBranchId, saleDate, safeSubtotal, safeAdj, safeTotal,
                receipt_number || null, receipt_code || null,
                payment_method || null, payment_method_id || null,
                payment_breakdown ? JSON.stringify(payment_breakdown) : null,
                safeClientId,
                safeDiscountClientId,
                safeClientDiscountPct,
                safeClientDiscountAmount,
                qendra_ticket_id || null, primaryBarcode, source || 'manual',
            ]
        );
        const saleId = ventaResult.insertId;

        if (ticketBarcodes.length > 0) {
            // Marca cobrado matcheando por codigo interno (MM...) o por codigo impreso
            // (escaneado en el resolver offline). Asi un ticket vendido offline tambien
            // queda cobrado si ya sincronizo al momento del cobro.
            //
            // OJO: el codigo IMPRESO no es unico (solo codifica balanza + importe), asi
            // que matchear solo por el marcaria como 'charged' TODOS los tickets open con
            // el mismo total y los haria desaparecer de conciliacion. Por eso, en la rama
            // del impreso, exigimos ademas mismo importe y fecha cercana. El codigo interno
            // si es unico, asi que matchea sin restriccion.
            const inList = ticketBarcodes.map(() => '?').join(',');
            await conn.query(
                `UPDATE scale_bridge_ticket_map
                 SET ticket_status = 'charged',
                     charged_sale_id = ?,
                     charged_at = NOW()
                 WHERE tenant_id = ?
                   AND (
                        UPPER(ticket_barcode) IN (${inList})
                        OR (
                            UPPER(printed_ticket_barcode) IN (${inList})
                            AND ABS(total_amount - ?) < 0.01
                            AND ABS(DATEDIFF(sale_at, ?)) <= 1
                        )
                   )`,
                [saleId, tenantId, ...ticketBarcodes, ...ticketBarcodes, safeTotal, saleDate]
            );
        }

        // 2. INSERT ventas_items
        const promoUsageById = new Map();
        const isGenericScaleTicketItem = (item) => (
            Boolean(item?.is_scale_offline_ticket)
            || /^ticket.*balanza.*offline/i.test(String(item?.product_name || '').trim())
        );
        for (const item of items) {
            const itemSubtotal = parseFloat(item.subtotal) || (parseFloat(item.price) * parseFloat(item.quantity));
            const promoId = item?.promo_payload?.id != null
                ? Number(item.promo_payload.id)
                : (item?.promo_id != null ? Number(item.promo_id) : null);
            const promoKgApplied = item?.promo_payload?.covered_qty != null
                ? parseFloat(item.promo_payload.covered_qty)
                : parseFloat(item?.promo_kg_applied);

            await conn.query(
                `INSERT INTO ventas_items
                 (tenant_id, branch_id, venta_id, product_id, product_name, quantity, price, subtotal, promo_id, promo_kg_applied, promo_payload)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId, resolvedBranchId || null, saleId,
                    isGenericScaleTicketItem(item) ? null : (item.product_id || null),
                    String(item.product_name || '').trim(),
                    parseFloat(item.quantity) || 0,
                    parseFloat(item.price) || 0,
                    itemSubtotal,
                    Number.isFinite(promoId) && promoId > 0 ? promoId : null,
                    Number.isFinite(promoKgApplied) && promoKgApplied > 0 ? promoKgApplied : null,
                    item?.promo_payload ? JSON.stringify(item.promo_payload) : null,
                ]
            );

            if (Number.isFinite(promoId) && promoId > 0 && Number.isFinite(promoKgApplied) && promoKgApplied > 0) {
                promoUsageById.set(promoId, (promoUsageById.get(promoId) || 0) + promoKgApplied);
            }
        }

        // 2.1 Acumular uso de promociones (kg vendidos con promo)
        for (const [promoId, usedKg] of promoUsageById.entries()) {
            await conn.query(
                `UPDATE promotions
                 SET used_kg = used_kg + ?
                 WHERE tenant_id = ? AND id = ?`,
                [usedKg, tenantId, promoId]
            );
        }

        // 3. INSERT movimientos negativos en stock (descuento)
        for (const item of items) {
            if (isGenericScaleTicketItem(item)) {
                continue;
            }
            // Resolver product_id por FK si no vino desde el frontend
            let productId = item.product_id || null;
            if (!productId && item.product_name) {
                const [[prod]] = await conn.query(
                    `SELECT id FROM products
                     WHERE tenant_id = ?
                       AND branch_id <=> ?
                       AND canonical_key = ?
                     LIMIT 1`,
                    [tenantId, resolvedBranchId || null, item.product_name.trim().toLowerCase().replace(/\s+/g, '_')]
                );
                if (prod) productId = prod.id;
            }
            await conn.query(
                `INSERT INTO stock
                 (tenant_id, branch_id, product_id, name, type, \`usage\`, quantity, unit, reference)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    resolvedBranchId,
                    productId,
                    String(item.product_name || '').trim(),
                    String(item.category || '').trim() || null,
                    'venta',
                    -(parseFloat(item.quantity) || 0),
                    String(item.unit || 'kg').trim(),
                    `venta_${saleId}`,
                ]
            );
        }

        // 4. Actualizar balance del cliente (solo cuenta corriente)
        if (safeClientId) {
            const currentAccountAmount = getCurrentAccountAmountFromSale({
                paymentMethod: payment_method,
                paymentMethodType: null,
                paymentBreakdown: payment_breakdown,
                totalAmount: safeTotal,
            });
            if (currentAccountAmount > 0) {
                await applyClientBalanceDelta(conn, {
                    tenantId,
                    clientId: safeClientId,
                    branchId: resolvedBranchId || null,
                    delta: -currentAccountAmount,
                });
            }
        }

        // 5. Registrar ingreso en caja por métodos que impactan caja (no cuenta corriente)
        const salePaymentParts = buildCajaPartsFromSale({
            paymentMethod: payment_method,
            paymentMethodType: null,
            paymentBreakdown: payment_breakdown,
            totalAmount: safeTotal,
        });
        if (salePaymentParts.length > 0) {
            const saleReceiptLabel = receipt_code || (receipt_number ? `Ticket ${receipt_number}` : `Venta #${saleId}`);
            const cajaDate = ticketDate || now;
            for (const part of salePaymentParts) {
                await conn.query(
                    `INSERT INTO caja_movimientos
                     (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, client_id, branch_id, receipt_number, receipt_code, sale_id, money_flow_kind, origin_table, origin_id, origin_group_id)
                     VALUES (?, 'venta', ?, 'Venta', ?, ?, ?, 'principal', ?, ?, ?, ?, ?, ?, 'sale_collection', 'ventas', ?, CONCAT('sale_', ?))`,
                    [
                        tenantId,
                        parseFloat(part.amount) || 0,
                        `Cobro ${saleReceiptLabel}`,
                        part.methodName,
                        part.methodType || inferPaymentTypeByName(part.methodName),
                        cajaDate,
                        safeClientId,
                        resolvedBranchId || null,
                        receipt_number || null,
                        receipt_code || null,
                        saleId,
                        saleId,
                        saleId,
                    ]
                );
            }
        }

        await conn.commit();
        conn.release();
        return res.json({ ok: true, insertId: saleId, receipt_number, receipt_code });

    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        conn.release();
        console.error('[POST /api/ventas ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Revierte una venta DENTRO de una transacción YA ABIERTA (conn en beginTransaction):
// revierte promos, restaura stock, ajusta saldo cta cte, registra el contramovimiento
// de caja (devolución), deja rastro en deleted_sales_history, marca el ticket de balanza
// como anulado (limpiando charged_sale_id) y borra la venta. Es la MISMA lógica que
// usaba DELETE /api/ventas; se extrajo para reusarla al anular un ticket YA cobrado desde
// conciliación, y garantizar que el reverso de plata pase siempre por un único camino auditado.
// `ticketBarcode` permite indicar el ticket a anular cuando la venta no guarda ticket_barcode
// (p. ej. las ventas por cobro-manual de conciliación).
async function reverseSaleTx(conn, { tenantId, saleId, venta, items, ticketBarcode = null, deletedBy = null, deletedByUsername = 'Sistema' }) {
    // 0. Revertir el consumo de promociones aplicado por esta venta
    const promoUsageToRevert = new Map();
    for (const item of items) {
        const promoId = item?.promo_id != null ? Number(item.promo_id) : null;
        const promoKg = item?.promo_kg_applied != null ? parseFloat(item.promo_kg_applied) : 0;
        if (Number.isFinite(promoId) && promoId > 0 && Number.isFinite(promoKg) && promoKg > 0) {
            promoUsageToRevert.set(promoId, (promoUsageToRevert.get(promoId) || 0) + promoKg);
        }
    }
    for (const [promoId, usedKg] of promoUsageToRevert.entries()) {
        await conn.query(
            `UPDATE promotions SET used_kg = GREATEST(used_kg - ?, 0) WHERE tenant_id = ? AND id = ?`,
            [usedKg, tenantId, promoId]
        );
    }

    // 1. Restaurar stock (movimiento por cada item)
    for (const item of items) {
        let productId = item.product_id || null;
        if (!productId && item.product_name) {
            const [[prod]] = await conn.query(
                `SELECT id FROM products WHERE tenant_id = ? AND canonical_key = ? LIMIT 1`,
                [tenantId, item.product_name.trim().toLowerCase().replace(/\s+/g, '_')]
            );
            if (prod) productId = prod.id;
        }
        await conn.query(
            `INSERT INTO stock (tenant_id, branch_id, product_id, name, \`usage\`, quantity, unit, reference)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, venta.branch_id || null, productId,
                String(item.product_name || '').trim(),
                'venta', parseFloat(item.quantity) || 0,
                String(item.unit || 'kg').trim(), `anulacion_venta_${saleId}`,
            ]
        );
    }

    const ventaBreakdown = (() => {
        try {
            if (!venta.payment_breakdown) return null;
            return typeof venta.payment_breakdown === 'string'
                ? JSON.parse(venta.payment_breakdown)
                : venta.payment_breakdown;
        } catch {
            return null;
        }
    })();

    // 2. Revertir balance cliente (solo cta cte)
    if (venta.clientId) {
        const currentAccountAmount = getCurrentAccountAmountFromSale({
            paymentMethod: venta.payment_method,
            paymentMethodType: null,
            paymentBreakdown: ventaBreakdown,
            totalAmount: venta.total,
        });
        if (currentAccountAmount > 0) {
            await applyClientBalanceDelta(conn, {
                tenantId,
                clientId: venta.clientId,
                branchId: venta.branch_id || null,
                delta: currentAccountAmount,
            });
        }
    }

    // 3. Registrar contramovimiento de caja (devolución) por la venta anulada
    const reversalParts = buildCajaPartsFromSale({
        paymentMethod: venta.payment_method,
        paymentMethodType: null,
        paymentBreakdown: ventaBreakdown,
        totalAmount: venta.total,
    });
    if (reversalParts.length > 0) {
        const saleReceiptLabel = venta.receipt_code || (venta.receipt_number ? `Ticket ${venta.receipt_number}` : `Venta #${saleId}`);
        for (const part of reversalParts) {
            await conn.query(
                `INSERT INTO caja_movimientos
                 (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, client_id, branch_id, receipt_number, receipt_code, sale_id, money_flow_kind, origin_table, origin_id, origin_group_id)
                 VALUES (?, 'anulacion_venta', ?, 'Anulación venta', ?, ?, ?, 'principal', NOW(), ?, ?, ?, ?, ?, 'sale_reversal', 'ventas', ?, CONCAT('sale_', ?))`,
                [
                    tenantId,
                    parseFloat(part.amount) || 0,
                    `Anulación ${saleReceiptLabel}`,
                    part.methodName,
                    part.methodType || inferPaymentTypeByName(part.methodName),
                    venta.clientId || null,
                    venta.branch_id || null,
                    venta.receipt_number || null,
                    venta.receipt_code || null,
                    saleId,
                    saleId,
                    saleId,
                ]
            );
        }
    }

    // 4. Registrar en historial de eliminaciones
    await conn.query(
        `INSERT INTO deleted_sales_history
         (tenant_id, sale_id, receipt_number, receipt_code, sale_date,
          deleted_at, deleted_by_user_id, deleted_by_username,
          payment_method, clientId, total, source,
          authorization_verified, sale_snapshot, items_snapshot)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
            tenantId, saleId,
            venta.receipt_number || null,
            venta.receipt_code || null,
            venta.date || null,
            deletedBy, deletedByUsername,
            venta.payment_method || '',
            venta.clientId || null,
            parseFloat(venta.total) || 0,
            venta.source || 'manual',
            JSON.stringify(venta),
            JSON.stringify(items),
        ]
    );

    // 5. Eliminar items, marcar ticket anulado (limpiando el cobro) y borrar la venta
    await conn.query(`DELETE FROM ventas_items WHERE tenant_id = ? AND venta_id = ?`, [tenantId, saleId]);
    const barcodeForTicket = ticketBarcode || venta.ticket_barcode;
    if (barcodeForTicket) {
        await conn.query(
            `UPDATE scale_bridge_ticket_map
             SET ticket_status = 'voided',
                 voided_sale_id = ?,
                 voided_at = NOW(),
                 voided_by_user_id = ?,
                 voided_by_username = ?,
                 charged_sale_id = NULL,
                 charged_at = NULL
             WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)`,
            [saleId, deletedBy, deletedByUsername, tenantId, String(barcodeForTicket)]
        );
    }
    await conn.query(`DELETE FROM ventas WHERE tenant_id = ? AND id = ?`, [tenantId, saleId]);
}

// ── RUTA: DELETE /api/ventas/:id ───────────────────────────────────────────
// Anula una venta de forma ATÓMICA: restaura stock + ajusta balance cta cte
// + registra deleted_sales_history + elimina ventas_items y ventas.
// Body: { deleted_by_user_id?, deleted_by_username? }
app.delete('/api/ventas/:id', verifyFirebaseToken, async (req, res) => {
    const saleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(saleId) || saleId <= 0) {
        return res.status(400).json({ error: 'id inválido' });
    }
    const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
    const pool = getTenantPool(dbName);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Verificar que la venta existe y pertenece al tenant
        const [[venta]] = await conn.query(
            `SELECT * FROM ventas WHERE tenant_id = ? AND id = ? LIMIT 1`,
            [tenantId, saleId]
        );
        if (!venta) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        await ensureScaleTicketLifecycleColumns(conn);

        // Cargar items
        const [items] = await conn.query(
            `SELECT * FROM ventas_items WHERE tenant_id = ? AND venta_id = ?`,
            [tenantId, saleId]
        );

        const deletedByRaw = req.body?.deleted_by_user_id;
        const deletedByParsed = Number.parseInt(deletedByRaw, 10);
        const deletedBy = Number.isFinite(deletedByParsed) && deletedByParsed > 0
            ? deletedByParsed
            : null;
        const deletedByUsername = req.body?.deleted_by_username || 'Sistema';

        await reverseSaleTx(conn, {
            tenantId, saleId, venta, items,
            deletedBy, deletedByUsername,
        });

        await conn.commit();
        conn.release();
        return res.json({ ok: true });

    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        conn.release();
        console.error('[DELETE /api/ventas ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: GET /api/users ───────────────────────────────────────────────────
// Devuelve usuarios y permisos en un solo payload para login/seguridad.
app.get('/api/users', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);

        const [usersRows] = await pool.query('SELECT * FROM users WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
        const [permRows] = await pool.query('SELECT * FROM user_permissions WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);

        return res.json({
            ok: true,
            users: usersRows.map(deserializeRow),
            permissions: permRows.map(deserializeRow),
        });
    } catch (err) {
        console.error('[USERS ERROR]', err.message);
        res.status(500).json({ error: 'Error leyendo usuarios: ' + err.message });
    }
});

app.post('/api/internal-admin/login', async (req, res) => {
    try {
        const identifier = String(req.body?.identifier || '').trim();
        const password = String(req.body?.password || '');

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Usuario/email y contraseña son obligatorios' });
        }

        const conn = await clientsControlPool.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT id, email, username, name, lastname, passwordHash, role, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${INTERNAL_ADMINS_TABLE}\`
                 WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)
                 LIMIT 1`,
                [identifier, identifier]
            );
            const internalAdmin = rows[0] || null;

            if (!internalAdmin) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const isPasswordValid = await bcrypt.compare(password, internalAdmin.passwordHash);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            if (!isActiveStatus(internalAdmin.status, false)) {
                return res.status(403).json({ error: 'El SuperAdmin está inactivo' });
            }

            const adminPayload = {
                id: internalAdmin.id,
                email: internalAdmin.email,
                username: internalAdmin.username,
                name: internalAdmin.name,
                lastname: internalAdmin.lastname,
                role: internalAdmin.role,
                status: internalAdmin.status,
            };

            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${INTERNAL_ADMINS_TABLE}\`
                 SET lastLogin = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [internalAdmin.id]
            );

            return res.json({
                ok: true,
                token: signInternalAdminToken(adminPayload),
                admin: adminPayload,
            });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[INTERNAL ADMIN LOGIN ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudo iniciar sesión como SuperAdmin' });
    }
});

app.get('/api/internal-admin/me', verifyInternalAdminSession, async (req, res) => {
    return res.json({
        ok: true,
        admin: req.internalAdmin,
    });
});

app.get('/api/internal-admin/clients', verifyInternalAdminSession, async (req, res) => {
    try {
        const search = String(req.query?.search || '').trim();
        const conn = await clientsControlPool.getConnection();
        try {
            const searchLike = `%${search}%`;
            const [rows] = await conn.query(
                `SELECT
                    c.id,
                    c.businessName,
                    c.taxId,
                    c.billingEmail,
                    c.status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                 ${search ? 'WHERE c.businessName LIKE ? OR c.taxId LIKE ? OR c.billingEmail LIKE ?' : ''}
                 ORDER BY c.businessName ASC
                 LIMIT 1000`,
                search ? [searchLike, searchLike, searchLike] : []
            );
            const clientIds = rows
                .map((client) => Number(client.id))
                .filter((clientId) => Number.isFinite(clientId) && clientId > 0);
            let branchRows = [];
            if (clientIds.length) {
                const placeholders = clientIds.map(() => '?').join(', ');
                [branchRows] = await conn.query(
                    `SELECT
                        id,
                        clientId,
                        name,
                        internalCode,
                        address,
                        isBillable,
                        status
                     FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\`
                     WHERE clientId IN (${placeholders})
                       AND status = 'ACTIVE'
                     ORDER BY clientId ASC, id ASC`,
                    clientIds
                );
            }
            const branchesByClientId = new Map();
            branchRows.forEach((branch) => {
                const clientId = Number(branch.clientId);
                if (!branchesByClientId.has(clientId)) branchesByClientId.set(clientId, []);
                branchesByClientId.get(clientId).push({
                    id: branch.id,
                    clientId: branch.clientId,
                    name: String(branch.name || '').trim() || `Sucursal ${branch.id}`,
                    internalCode: branch.internalCode || null,
                    address: branch.address || null,
                    isBillable: branch.isBillable === 1 || branch.isBillable === true,
                    status: branch.status || 'ACTIVE',
                });
            });
            const clients = rows.map((client) => ({
                ...client,
                branches: branchesByClientId.get(Number(client.id)) || [],
            }));

            return res.json({
                ok: true,
                clients,
            });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[INTERNAL ADMIN CLIENTS ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudieron leer los tenants' });
    }
});

app.get('/api/internal-admin/clients/:clientId/branches', verifyInternalAdminSession, async (req, res) => {
    try {
        const clientId = Number.parseInt(req.params.clientId, 10);
        if (!Number.isFinite(clientId) || clientId <= 0) {
            return res.status(400).json({ error: 'clientId invalido' });
        }

        const conn = await clientsControlPool.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT
                    b.id,
                    b.clientId,
                    b.name,
                    b.address,
                    b.status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\` b
                 WHERE b.clientId = ?
                 ORDER BY b.name ASC`,
                [clientId]
            );

            return res.json({
                ok: true,
                branches: rows,
            });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[INTERNAL ADMIN CLIENT BRANCHES ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudieron leer las sucursales del cliente' });
    }
});

// ── RUTA: GET /api/firebase-users ──────────────────────────────────────────
// Lista usuarios web/Firebase de la misma empresa (mismo CUIT).
app.get('/api/firebase-users', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        const scopedBranchId = Number(
            accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
            ?? accessContext?.activeBranch?.id
        );

        const conn = await clientsControlPool.getConnection();
        let rows;
        try {
            const branchScopedWhere = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? 'AND (cu.branchId = ? OR cu.id = ?)'
                : '';
            const branchScopedParams = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? [scopedBranchId, accessContext.user.id]
                : [];
            [rows] = await conn.query(
                `SELECT
                    cu.id AS id,
                    cu.clientId AS clientId,
                    cu.branchId AS branchId,
                    cu.firebaseUid AS firebaseUid,
                    cu.name AS name,
                    cu.lastname AS lastname,
                    cu.email AS email,
                    cu.role AS role,
                    cu.status AS status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 cu
                 LEFT JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENT_BRANCHES_TABLE}\` b
                    ON b.id = cu.branchId
                 WHERE cu.clientId = ?
                 ${branchScopedWhere}
                 ORDER BY cu.id ASC`,
                [accessContext.client.id, ...branchScopedParams]
            );
            const [licenseRows] = await conn.query(
                `SELECT
                    cl.id AS clientLicenseId,
                    cl.clientId,
                    cl.licenseId,
                    cl.branchId,
                    cl.userId,
                    cl.status AS assignmentStatus,
                    l.commercialName,
                    l.internalCode,
                    l.category,
                    l.billingScope,
                    l.isMandatory,
                    l.featureFlags,
                    l.status AS licenseStatus,
                    l.appliesToWebapp
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\` cl
                 INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${LICENSES_TABLE}\` l
                    ON l.id = cl.licenseId
                 WHERE cl.clientId = ?
                   AND cl.status = 'ACTIVE'
                   AND l.status = 'ACTIVE'`,
                [accessContext.client.id]
            );

            const licensePool = await getClientLicensePool(conn, accessContext.client.id);
            const users = [];
            const userRows = [...rows];

            const currentUserId = String(accessContext.user?.id || '');
            const currentUserAlreadyListed = userRows.some((row) => String(row.id || '') === currentUserId);
            if (accessContext.user && !currentUserAlreadyListed && !accessContext.user.isGlobalSuperAdmin) {
                userRows.unshift({
                    id: accessContext.user.id,
                    clientId: accessContext.user.clientId,
                    branchId: accessContext.user.branchId ?? null,
                    firebaseUid: accessContext.user.firebaseUid || null,
                    name: accessContext.user.name || accessContext.client.businessName || accessContext.user.email || 'Administrador',
                    lastname: accessContext.user.lastname || '',
                    email: accessContext.user.email || '',
                    role: accessContext.user.role || 'admin',
                    status: accessContext.user.userStatus || 'ACTIVE',
                    isOwnerFallback: Boolean(accessContext.user.isOwnerFallback),
                });
            }

            for (const row of userRows) {
                const perms = row.isOwnerFallback ? [] : await getUserPermissions(conn, row.id);
                const scopedLicenses = buildScopedLicensesForUser({
                    ...row,
                    userStatus: row.status,
                    perms,
                }, licenseRows);
                const baseUser = buildAccessResponse({
                    user: {
                        ...row,
                        userStatus: row.status,
                        perms,
                    },
                    client: accessContext.client,
                    effectiveLicenses: scopedLicenses.effectiveLicenses,
                });
                users.push({
                    ...baseUser,
                    licenses: scopedLicenses.assignedLicenses,
                    perms,
                    assignedLicenses: scopedLicenses.assignedLicenses,
                    deliveryLicenses: scopedLicenses.deliveryLicenses,
                });
            }

            return res.json({ ok: true, users, licensePool });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[FIREBASE USERS READ ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudieron leer los usuarios web' });
    }
});

// ── RUTA: GET /api/firebase-users/me ───────────────────────────────────────
// Devuelve el perfil web/Firebase del usuario autenticado.
app.get('/api/firebase-users/me', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);

        const baseUser = buildAccessResponse(accessContext);
        return res.json({
            ok: true,
            user: baseUser,
        });
    } catch (err) {
        console.error('[FIREBASE ME ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo resolver el usuario actual' });
    }
});

// ── RUTA: POST /api/firebase-users ─────────────────────────────────────────
// Crea usuario en Firebase Auth y su perfil/permisos en Firestore.
app.post('/api/firebase-users', verifyFirebaseToken, async (req, res) => {
    try {
        const {
            email,
            password,
            username,
            role = 'employee',
            active = 1,
            perms = [],
            assignedClientLicenseIds = [],
            branchId: requestedBranchId,
        } = req.body || {};

        if (!email || !String(email).trim()) {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!password || String(password).length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        if (!username || !String(username).trim()) {
            return res.status(400).json({ error: 'Nombre de usuario requerido' });
        }

        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        if (!canWriteProtectedSettings(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
        }
        const isRequesterAdmin = accessContext.user.role === 'admin';
        const requestedRole = String(role || 'employee').trim().toLowerCase();
        const effectiveRole = isRequesterAdmin ? 'employee' : requestedRole;

        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let insertId;
        let job;
        const normalizedRole = effectiveRole === 'admin' ? 'admin' : 'employee';
        const userPerms = normalizedRole === 'admin' ? [] : (Array.isArray(perms) ? perms : []);
        const scopedBranchId = Number(
            accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
            ?? accessContext?.activeBranch?.id
        );
        // Si se envía branchId explícito (desde el formulario), usarlo; si no, heredar del admin si tiene sucursal
        const newUserBranchId = (() => {
            if (requestedBranchId !== undefined) {
                return requestedBranchId ? Number(requestedBranchId) : null;
            }
            if (normalizedRole === 'employee' && Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
                return scopedBranchId;
            }
            return null;
        })();
        try {
            const [existingRows] = await conn.query(
                `SELECT id FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE clientId = ? AND LOWER(email) = ? LIMIT 1`,
                [ownerData.clientId, normalizeEmail(email)]
            );
            if (existingRows.length > 0) {
                return res.status(400).json({ error: 'Ese email ya existe para este cliente' });
            }

            await assertAssignableUserBranch({
                clientId: ownerData.clientId,
                role: normalizedRole,
                branchId: newUserBranchId,
            });

            const [result] = await conn.query(
                `INSERT INTO \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 (clientId, branchId, firebaseUid, name, lastname, email, role, status, isSynced, createdAt, updatedAt)
                 VALUES (?, ?, NULL, ?, '', ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [
                    ownerData.clientId,
                    newUserBranchId,
                    String(username).trim(),
                    normalizeEmail(email),
                    normalizedRole,
                    Number(active) === 1 ? 'ACTIVE' : 'INACTIVE',
                ]
            );
            insertId = result.insertId;
            const assignedLicenses = await syncClientUserPerUserLicenses(conn, {
                clientId: ownerData.clientId,
                userId: insertId,
                clientLicenseIds: assignedClientLicenseIds,
            });
            assertDeliveryLicenseSelection({
                role: normalizedRole,
                perms: userPerms,
                assignedLicenses,
            });
            await enqueueAuthSync(conn, insertId, 'CREATE_FIREBASE', {
                action: 'CREATE',
                email: normalizeEmail(email),
                password: String(password),
                username: String(username).trim(),
                active: Number(active) === 1 ? 1 : 0,
            });
            const [jobs] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.auth_sync_queue WHERE entityId = ? ORDER BY id DESC LIMIT 1`,
                [insertId]
            );
            job = jobs[0];
        } finally {
            conn.release();
        }

        const syncResult = await runClientUserSync(job);
        if (userPerms.length > 0) {
            const permConn = await clientsControlPool.getConnection();
            try {
                for (const pathValue of userPerms) {
                    await permConn.query(
                        `INSERT IGNORE INTO \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` (userId, path) VALUES (?, ?)`,
                        [insertId, String(pathValue || '').trim()]
                    );
                }
            } finally {
                permConn.release();
            }
        }

        return res.json({
            ok: true,
            user: {
                id: insertId,
                uid: syncResult.uid,
                email: normalizeEmail(email),
                username: String(username).trim(),
                role: normalizedRole,
                active: Number(active) === 1 ? 1 : 0,
                perms: userPerms,
                branchId: newUserBranchId,
            },
        });
    } catch (err) {
        console.error('[FIREBASE USER CREATE ERROR]', err.message);
        if (err.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'Ese email ya existe en Firebase' });
        }
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo crear el usuario web' });
    }
});

// ── RUTA: PATCH /api/firebase-users/:id ────────────────────────────────────
app.patch('/api/firebase-users/:id', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) {
            return res.status(400).json({ error: 'Usuario inválido' });
        }

        const { email, password, username, role, active, perms, assignedClientLicenseIds = [], branchId: requestedBranchId } = req.body || {};
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        if (!canWriteProtectedSettings(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede editar usuarios' });
        }
        const isRequesterAdmin = accessContext.user.role === 'admin';
        const ownerData = await getTenantClientData(req.firebaseUser);
        const scopedBranchId = Number(
            accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
            ?? accessContext?.activeBranch?.id
        );
        const conn = await clientsControlPool.getConnection();
        let currentData;
        try {
            const branchScopedWhere = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? 'AND (branchId = ? OR id = ?)'
                : '';
            const branchScopedParams = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? [scopedBranchId, accessContext.user.id]
                : [];
            const [rows] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE id = ? AND clientId = ? ${branchScopedWhere} LIMIT 1`,
                [userId, ownerData.clientId, ...branchScopedParams]
            );
            currentData = rows[0];
        } finally {
            conn.release();
        }

        if (!currentData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const nextEmail = email ? normalizeEmail(email) : normalizeEmail(currentData.email);
        const nextUsername = username ? String(username).trim() : String(currentData.name || '').trim();
        const requestedRole = String(role || '').trim().toLowerCase();
        // Solo un admin puede promover a otro usuario a admin; un no-admin nunca puede escalar privilegios
        const safeRequestedRole = !isRequesterAdmin && requestedRole === 'admin' ? 'employee' : requestedRole;
        const nextRole = safeRequestedRole === 'admin'
            ? 'admin'
            : (safeRequestedRole === 'employee' ? 'employee' : currentData.role || 'employee');
        const nextActive = active === undefined ? currentData.status === 'ACTIVE' : Number(active) === 1;
        const nextPerms = nextRole === 'admin' ? [] : (Array.isArray(perms) ? perms : []);
        // Si el admin envía un branchId explícito, usarlo. Si no, mantener el actual.
        const nextBranchId = (() => {
            if (isRequesterAdmin && requestedBranchId !== undefined) {
                // Admin puede asignar o quitar sucursal explícitamente
                return requestedBranchId ? Number(requestedBranchId) : null;
            }
            if (nextRole === 'employee' && Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
                return scopedBranchId;
            }
            return currentData.branchId;
        })();

        const writeConn = await clientsControlPool.getConnection();
        let job;
        try {
            await assertAssignableUserBranch({
                clientId: ownerData.clientId,
                role: nextRole,
                branchId: nextBranchId,
            });

            await writeConn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 SET name = ?, email = ?, role = ?, branchId = ?, status = ?, isSynced = 0, updatedAt = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [nextUsername, nextEmail, nextRole, nextBranchId ?? null, nextActive ? 'ACTIVE' : 'INACTIVE', userId]
            );
            const assignedLicenses = await syncClientUserPerUserLicenses(writeConn, {
                clientId: ownerData.clientId,
                userId: Number(userId),
                clientLicenseIds: assignedClientLicenseIds,
            });
            assertDeliveryLicenseSelection({
                role: nextRole,
                perms: nextPerms,
                assignedLicenses,
            });
            await enqueueAuthSync(writeConn, Number(userId), 'UPDATE_FIREBASE', {
                action: nextActive ? 'UPDATE' : 'DISABLE',
                email: nextEmail,
                password: password ? String(password) : null,
                username: nextUsername,
                active: nextActive ? 1 : 0,
            });
            const [jobs] = await writeConn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.auth_sync_queue WHERE entityId = ? ORDER BY id DESC LIMIT 1`,
                [userId]
            );
            job = jobs[0];
        } finally {
            writeConn.release();
        }

        const syncResult = await runClientUserSync(job);
        const permsConn = await clientsControlPool.getConnection();
        try {
            await permsConn.query(
                `DELETE FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` WHERE userId = ?`,
                [userId]
            );
            for (const pathValue of nextPerms) {
                await permsConn.query(
                    `INSERT IGNORE INTO \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` (userId, path) VALUES (?, ?)`,
                    [userId, String(pathValue || '').trim()]
                );
            }
        } finally {
            permsConn.release();
        }

        return res.json({ ok: true });
    } catch (err) {
        console.error('[FIREBASE USER UPDATE ERROR]', err.message);
        if (err.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'Ese email ya existe en Firebase' });
        }
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo actualizar el usuario web' });
    }
});

// ── RUTA: DELETE /api/firebase-users/:id ───────────────────────────────────
app.delete('/api/firebase-users/:id', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) {
            return res.status(400).json({ error: 'Usuario inválido' });
        }
        if (userId === req.firebaseUser.uid) {
            return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
        }

        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        if (!canWriteProtectedSettings(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede eliminar usuarios' });
        }
        const scopedBranchId = Number(
            accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
            ?? accessContext?.activeBranch?.id
        );
        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let user;
        let job;
        try {
            const branchScopedWhere = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? 'AND branchId = ?'
                : '';
            const branchScopedParams = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? [scopedBranchId]
                : [];
            const [rows] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE id = ? AND clientId = ? ${branchScopedWhere} LIMIT 1`,
                [userId, ownerData.clientId, ...branchScopedParams]
            );
            user = rows[0];
            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            if (String(user.firebaseUid || '') === String(req.firebaseUser.uid || '')) {
                return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
            }

            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 SET status = 'INACTIVE', isSynced = 0, updatedAt = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [userId]
            );
            await conn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_LICENSES_TABLE}\`
                 SET userId = NULL, branchId = NULL
                 WHERE clientId = ? AND userId = ?`,
                [ownerData.clientId, userId]
            );
            await enqueueAuthSync(conn, Number(userId), 'DISABLE_FIREBASE', {
                action: 'DELETE',
                active: 0,
            });
            const [jobs] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.auth_sync_queue WHERE entityId = ? ORDER BY id DESC LIMIT 1`,
                [userId]
            );
            job = jobs[0];
        } finally {
            conn.release();
        }

        await runClientUserSync(job);
        const permsConn = await clientsControlPool.getConnection();
        try {
            await permsConn.query(
                `DELETE FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` WHERE userId = ?`,
                [userId]
            );
        } finally {
            permsConn.release();
        }

        return res.json({ ok: true });
    } catch (err) {
        console.error('[FIREBASE USER DELETE ERROR]', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo eliminar el usuario web' });
    }
});

// ── RUTA: POST /api/users/:id/permissions ──────────────────────────────────
// Reemplaza la lista completa de permisos de un usuario.
app.post('/api/users/:id/permissions', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) {
            return res.status(400).json({ error: 'userId inválido' });
        }

        const paths = Array.isArray(req.body?.paths)
            ? req.body.paths.map((pathValue) => String(pathValue || '').trim()).filter(Boolean)
            : [];

        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        const scopedBranchId = Number(
            accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
            ?? accessContext?.activeBranch?.id
        );
        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let user;
        try {
            const branchScopedWhere = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? 'AND branchId = ?'
                : '';
            const branchScopedParams = Number.isFinite(scopedBranchId) && scopedBranchId > 0
                ? [scopedBranchId]
                : [];
            const [rows] = await conn.query(
                `SELECT id, firebaseUid, email, name, role, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 WHERE id = ? AND clientId = ? ${branchScopedWhere} LIMIT 1`,
                [userId, ownerData.clientId, ...branchScopedParams]
            );
            user = rows[0];
        } finally {
            conn.release();
        }

        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const writeConn = await clientsControlPool.getConnection();
        try {
            await writeConn.query(
                `DELETE FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` WHERE userId = ?`,
                [user.id]
            );
            for (const pathValue of paths) {
                await writeConn.query(
                    `INSERT IGNORE INTO \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USER_PERMISSIONS_TABLE}\` (userId, path) VALUES (?, ?)`,
                    [user.id, String(pathValue || '').trim()]
                );
            }
        } finally {
            writeConn.release();
        }

        return res.json({ ok: true, userId, paths });
    } catch (err) {
        console.error('[PERMISSIONS ERROR]', err.message);
        res.status(500).json({ error: 'Error guardando permisos: ' + err.message });
    }
});

async function getNextSequenceData({ tenantConn, tenantId, counterKey, branchKey = 'branch_code', branchCodeOverride = null }) {
    const [counterRows] = await tenantConn.query(
        'SELECT `key`, value FROM settings WHERE `tenant_id` = ? AND `key` = ? FOR UPDATE',
        [tenantId, counterKey]
    );

    const currentValue = Number(counterRows[0]?.value || 0);
    const nextValue = currentValue + 1;

    await tenantConn.query(
        'INSERT INTO settings (`tenant_id`, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [tenantId, counterKey, String(nextValue)]
    );

    let branchCode = Number(branchCodeOverride || 0);
    if (!Number.isFinite(branchCode) || branchCode <= 0) {
        const [branchRows] = await tenantConn.query(
            'SELECT value FROM settings WHERE `tenant_id` = ? AND `key` = ? LIMIT 1',
            [tenantId, branchKey]
        );
        branchCode = Number(branchRows[0]?.value || 1);
    }

    const receiptCode = `${String(branchCode).padStart(4, '0')}-${String(nextValue).padStart(6, '0')}`;
    return { nextValue, receiptCode, branchCode };
}

const BRANCH_TRANSFER_DOCUMENT_TYPES = Object.freeze({
    REMITO: 'remito',
    INTERNAL_INVOICE: 'factura_interna',
});

const BRANCH_TRANSFER_DOCUMENT_META = Object.freeze({
    [BRANCH_TRANSFER_DOCUMENT_TYPES.REMITO]: {
        label: 'Remito',
        counterKey: 'remito',
        codePrefix: 'R',
    },
    [BRANCH_TRANSFER_DOCUMENT_TYPES.INTERNAL_INVOICE]: {
        label: 'Factura interna',
        counterKey: 'factura_interna',
        codePrefix: 'FI',
    },
});

function normalizeBranchTransferDocumentType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === BRANCH_TRANSFER_DOCUMENT_TYPES.INTERNAL_INVOICE) {
        return BRANCH_TRANSFER_DOCUMENT_TYPES.INTERNAL_INVOICE;
    }
    return BRANCH_TRANSFER_DOCUMENT_TYPES.REMITO;
}

function getBranchTransferDocumentMeta(documentType) {
    const normalizedType = normalizeBranchTransferDocumentType(documentType);
    return BRANCH_TRANSFER_DOCUMENT_META[normalizedType] || BRANCH_TRANSFER_DOCUMENT_META[BRANCH_TRANSFER_DOCUMENT_TYPES.REMITO];
}

function buildBranchTransferDocumentCode(documentType, baseCode) {
    const normalizedCode = String(baseCode || '').trim();
    if (!normalizedCode) return null;
    const meta = getBranchTransferDocumentMeta(documentType);
    return `${meta.codePrefix}-${normalizedCode}`;
}

// ── RUTA: POST /api/sequences/next ─────────────────────────────────────────
// Incrementa un contador en settings y devuelve correlativo + código.
app.post('/api/sequences/next', verifyFirebaseToken, async (req, res) => {
    const conn = await provisionPool.getConnection();
    try {
        const counterKey = String(req.body?.counterKey || '').trim();
        const branchKey = String(req.body?.branchKey || 'branch_code').trim();

        if (!counterKey) {
            return res.status(400).json({ error: 'counterKey requerido' });
        }

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const tenantConn = await pool.getConnection();

        try {
            await tenantConn.beginTransaction();

            const { nextValue, receiptCode, branchCode } = await getNextSequenceData({
                tenantConn,
                tenantId,
                counterKey,
                branchKey,
            });

            await tenantConn.commit();

            return res.json({
                ok: true,
                counterKey,
                receiptNumber: nextValue,
                receiptCode,
                branchCode,
            });
        } catch (err) {
            await tenantConn.rollback();
            throw err;
        } finally {
            tenantConn.release();
        }
    } catch (err) {
        console.error('[SEQUENCE ERROR]', err.message);
        res.status(500).json({ error: 'Error generando correlativo: ' + err.message });
    } finally {
        conn.release();
    }
});

// â”€â”€ RUTA: GET /api/branch-transfers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/branch-transfers', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const conn = await pool.getConnection();
        try {
            const direction = String(req.query?.direction || 'incoming').trim().toLowerCase();
            const status = String(req.query?.status || '').trim().toLowerCase();
            const userBranchId = Number(accessContext.user?.branchRecordId ?? accessContext.user?.branchId ?? 0);
            const canSeeAll = hasAdminPanelAccess(accessContext);

            if (!canSeeAll && (!Number.isFinite(userBranchId) || userBranchId <= 0)) {
                return res.status(400).json({ error: 'Sucursal no asignada para ver transferencias' });
            }

            const where = ['tenant_id = ?'];
            const params = [tenantId];

            if (direction === 'incoming') {
                where.push('to_branch_id = ?');
                params.push(userBranchId);
            } else if (direction === 'outgoing') {
                where.push('from_branch_id = ?');
                params.push(userBranchId);
            } else if (!canSeeAll) {
                where.push('(from_branch_id = ? OR to_branch_id = ?)');
                params.push(userBranchId, userBranchId);
            }

            if (status) {
                where.push('status = ?');
                params.push(status);
            }

            const [rows] = await conn.query(
                `SELECT * FROM branch_transfers WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 200`,
                params
            );

            const transferIds = rows.map((row) => row.id);
            let itemsByTransfer = new Map();
            if (transferIds.length > 0) {
                const placeholders = transferIds.map(() => '?').join(', ');
                const [items] = await conn.query(
                    `SELECT * FROM branch_transfer_items WHERE tenant_id = ? AND transfer_id IN (${placeholders})`,
                    [tenantId, ...transferIds]
                );
                itemsByTransfer = items.reduce((acc, item) => {
                    const list = acc.get(item.transfer_id) || [];
                    list.push(item);
                    acc.set(item.transfer_id, list);
                    return acc;
                }, new Map());
            }

            const branches = await listClientBranches(accessContext.client.id);
            const branchesById = new Map(branches.map((branch) => [Number(branch.id), branch]));

            const payload = rows.map((row) => {
                const documentType = normalizeBranchTransferDocumentType(row.document_type);
                const documentMeta = getBranchTransferDocumentMeta(documentType);
                const computedDocumentCode = buildBranchTransferDocumentCode(documentType, row.remito_code);
                const documentCode = String(row.document_code || '').trim() || computedDocumentCode;
                return {
                    ...row,
                    document_type: documentType,
                    document_label: documentMeta.label,
                    document_number: Number(row.remito_number || 0) || null,
                    document_code: documentCode || null,
                    items: itemsByTransfer.get(row.id) || [],
                    from_branch: branchesById.get(Number(row.from_branch_id)) || null,
                    to_branch: branchesById.get(Number(row.to_branch_id)) || null,
                };
            });

            return res.json({ ok: true, count: payload.length, transfers: payload });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[BRANCH TRANSFERS READ ERROR]', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudieron leer las transferencias' });
    }
});

// â”€â”€ RUTA: POST /api/branch-transfers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/branch-transfers', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const userBranchId = Number(accessContext.user?.branchRecordId ?? accessContext.user?.branchId ?? 0);
            const fromBranchId = Number(req.body?.from_branch_id || req.body?.fromBranchId || userBranchId);
            const toBranchId = Number(req.body?.to_branch_id || req.body?.toBranchId || 0);
            const documentType = normalizeBranchTransferDocumentType(req.body?.document_type || req.body?.documentType);
            const documentMeta = getBranchTransferDocumentMeta(documentType);

            if (!Number.isFinite(fromBranchId) || fromBranchId <= 0) {
                throw new Error('Sucursal remitente inválida');
            }
            if (!Number.isFinite(toBranchId) || toBranchId <= 0) {
                throw new Error('Sucursal destino inválida');
            }
            if (fromBranchId === toBranchId) {
                throw new Error('La sucursal destino debe ser distinta a la remitente');
            }

            const items = Array.isArray(req.body?.items) ? req.body.items : [];
            if (!items.length) {
                throw new Error('items requeridos');
            }

            const branches = await listClientBranches(accessContext.client.id);
            const fromBranch = branches.find((branch) => Number(branch.id) === fromBranchId);
            const toBranch = branches.find((branch) => Number(branch.id) === toBranchId);
            if (!fromBranch || !toBranch) {
                throw new Error('Sucursal remitente o destino no encontrada');
            }

            const branchCodeOverride = normalizeBranchCodeValue(fromBranch.internalCode) || null;
            const { nextValue, receiptCode, branchCode } = await getNextSequenceData({
                tenantConn: conn,
                tenantId,
                counterKey: documentMeta.counterKey,
                branchKey: 'branch_code',
                branchCodeOverride,
            });
            const documentCode = buildBranchTransferDocumentCode(documentType, receiptCode);

            const note = String(req.body?.note || '').trim() || null;
            const createdBy = getAccessDisplayName(accessContext.user);

            const [result] = await conn.query(
                `INSERT INTO branch_transfers
                 (tenant_id, from_branch_id, to_branch_id, status, document_type, remito_number, remito_code, document_code, note,
                  created_by_user_id, created_by_username)
                 VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    fromBranchId,
                    toBranchId,
                    documentType,
                    nextValue,
                    receiptCode,
                    documentCode,
                    note,
                    accessContext.user?.id || null,
                    createdBy,
                ]
            );

            const transferId = result.insertId;
            for (const item of items) {
                const qty = parseFloat(item.quantity) || 0;
                if (qty <= 0) {
                    throw new Error('Cantidad inválida en item');
                }
                let productId = item.product_id || item.productId || null;
                const productName = String(item.product_name || item.productName || '').trim();
                if (!productId && productName) {
                    const [[prod]] = await conn.query(
                        `SELECT id FROM products WHERE tenant_id = ? AND canonical_key = ? LIMIT 1`,
                        [tenantId, productName.toLowerCase().replace(/\s+/g, '_')]
                    );
                    if (prod) productId = prod.id;
                }

                await conn.query(
                    `INSERT INTO branch_transfer_items
                     (tenant_id, transfer_id, product_id, product_name, quantity, unit)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        tenantId,
                        transferId,
                        productId,
                        productName || (productId ? `Producto ${productId}` : ''),
                        qty,
                        String(item.unit || 'kg').trim(),
                    ]
                );
            }

            await conn.commit();
            return res.json({
                ok: true,
                transferId,
                document_type: documentType,
                document_label: documentMeta.label,
                document_number: nextValue,
                document_code: documentCode,
                remito_number: nextValue,
                remito_code: receiptCode,
                branch_code: branchCode,
            });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[BRANCH TRANSFER CREATE ERROR]', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo crear el comprobante interno' });
    }
});

// â”€â”€ RUTA: POST /api/branch-transfers/:id/receive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/branch-transfers/:id/receive', verifyFirebaseToken, async (req, res) => {
    const transferId = Number(req.params.id || 0);
    if (!Number.isFinite(transferId) || transferId <= 0) {
        return res.status(400).json({ error: 'id inválido' });
    }
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [[transfer]] = await conn.query(
                'SELECT * FROM branch_transfers WHERE tenant_id = ? AND id = ? LIMIT 1',
                [tenantId, transferId]
            );
            if (!transfer) {
                await conn.rollback();
                return res.status(404).json({ error: 'Remito no encontrado' });
            }
            if (transfer.status !== 'pending') {
                await conn.rollback();
                return res.status(400).json({ error: 'El remito ya fue procesado' });
            }

            const userBranchId = Number(accessContext.user?.branchRecordId ?? accessContext.user?.branchId ?? 0);
            const canSeeAll = hasAdminPanelAccess(accessContext);
            if (!canSeeAll && userBranchId !== Number(transfer.to_branch_id)) {
                await conn.rollback();
                return res.status(403).json({ error: 'No autorizado para recibir este remito' });
            }

            const [items] = await conn.query(
                'SELECT * FROM branch_transfer_items WHERE tenant_id = ? AND transfer_id = ?',
                [tenantId, transferId]
            );
            if (!items.length) {
                await conn.rollback();
                return res.status(400).json({ error: 'El remito no tiene ítems' });
            }

            for (const item of items) {
                const qty = parseFloat(item.quantity) || 0;
                if (qty <= 0) continue;

                if (item.product_id) {
                    const stockBranchScope = buildBranchScopeClause({
                        branchId: transfer.from_branch_id,
                        allowLegacyNullFallback: false,
                    });
                    const stockBranchWhereSql = stockBranchScope.sql || 'branch_id IS NULL';
                    const [[stockRow]] = await conn.query(
                        `SELECT COALESCE(SUM(quantity), 0) AS total
                         FROM stock
                         WHERE tenant_id = ?
                           AND product_id = ?
                           AND ${stockBranchWhereSql}`,
                        [tenantId, item.product_id, ...stockBranchScope.params]
                    );
                    const available = Number(stockRow?.total || 0);
                    if (available < qty) {
                        await conn.rollback();
                        return res.status(400).json({
                            error: `Stock insuficiente en sucursal origen para ${item.product_name || 'producto'} (${available} disponible, ${qty} requerido)`,
                        });
                    }
                }
            }

            for (const item of items) {
                const qty = parseFloat(item.quantity) || 0;
                if (qty <= 0) continue;
                const unit = String(item.unit || 'kg').trim();
                const productName = String(item.product_name || '').trim();

                await conn.query(
                    `INSERT INTO stock
                     (tenant_id, branch_id, product_id, name, \`usage\`, quantity, unit, reference)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        tenantId,
                        transfer.from_branch_id,
                        item.product_id || null,
                        productName,
                        'transfer_out',
                        -qty,
                        unit,
                        `transfer_${transferId}`,
                    ]
                );

                await conn.query(
                    `INSERT INTO stock
                     (tenant_id, branch_id, product_id, name, \`usage\`, quantity, unit, reference)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        tenantId,
                        transfer.to_branch_id,
                        item.product_id || null,
                        productName,
                        'transfer_in',
                        qty,
                        unit,
                        `transfer_${transferId}`,
                    ]
                );
            }

            const receivedBy = getAccessDisplayName(accessContext.user);
            await conn.query(
                `UPDATE branch_transfers
                 SET status = 'received',
                     received_at = NOW(),
                     received_by_user_id = ?,
                     received_by_username = ?
                 WHERE tenant_id = ? AND id = ?`,
                [accessContext.user?.id || null, receivedBy, tenantId, transferId]
            );

            await conn.commit();
            return res.json({ ok: true, transferId });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[BRANCH TRANSFER RECEIVE ERROR]', err.message);
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo confirmar la recepción' });
    }
});

// ── RUTAS: Autorización de retiros de caja ─────────────────────────────────
// El código de autorización es numérico de 6 dígitos con TTL corto: sin un
// límite estricto de intentos, la verificación es vulnerable a fuerza bruta.
const cashWithdrawalRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

const cashWithdrawalVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
});

// ── RUTA: POST /api/cash/withdrawals/request-authorization ────────────────
app.post('/api/cash/withdrawals/request-authorization', cashWithdrawalRequestLimiter, verifyFirebaseToken, async (req, res) => {
    try {
        const { amount, paymentMethod, category, description } = req.body || {};
        if (Number(amount || 0) <= 0) {
            return res.status(400).json({ error: 'Monto invalido para solicitar autorizacion' });
        }

        if (String(category || '').trim() !== 'Retiro Socios') {
            return res.status(400).json({ error: 'Solo los retiros societarios requieren esta autorizacion' });
        }

        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        const tenantInfo = await getTenantInfo(req.firebaseUser);

        const result = await createCashWithdrawalAuthorization({
            tenantInfo,
            accessContext,
            amount,
            paymentMethod,
            category,
            description,
        });

        return res.json({
            ok: true,
            authorizationId: result.authorizationId,
            expiresAt: result.expiresAt,
            recipient: maskEmailAddress(result.recipientEmail),
        });
    } catch (err) {
        console.error('[CASH AUTH REQUEST ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo enviar el codigo de autorizacion' });
    }
});

// ── RUTA: POST /api/cash/withdrawals/verify-authorization ────────────────
app.post('/api/cash/withdrawals/verify-authorization', cashWithdrawalVerifyLimiter, verifyFirebaseToken, async (req, res) => {
    try {
        const { authorizationId, code, amount, paymentMethod, category } = req.body || {};
        if (!authorizationId || !code) {
            return res.status(400).json({ error: 'Faltan datos para validar la autorizacion' });
        }

        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        const tenantInfo = await getTenantInfo(req.firebaseUser);

        const result = await verifyCashWithdrawalAuthorization({
            tenantInfo,
            authorizationId: Number(authorizationId),
            code: String(code || '').trim(),
            amount,
            paymentMethod,
            category,
        });

        return res.json({
            ok: true,
            authorizationId: result.authorizationId,
            recipient: maskEmailAddress(result.recipientEmail),
            usedAt: result.usedAt,
        });
    } catch (err) {
        console.error('[CASH AUTH VERIFY ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo validar el codigo' });
    }
});

// ── RUTA: GET /api/delivery/me ────────────────────────────────────────────
app.get('/api/delivery/me', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });
        assertLogisticsAccess(accessContext);

        const driverIdentity = buildDriverIdentity(accessContext);
        const profileLicenses = [
            ...(Array.isArray(accessContext.effectiveLicenses) ? accessContext.effectiveLicenses : []),
            ...(Array.isArray(accessContext.deliveryLicenses) ? accessContext.deliveryLicenses : []),
        ].filter((license, index, arr) => (
            arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
        ));

        return res.json({
            ok: true,
            profile: {
                id: accessContext.user.id,
                firebaseUid: accessContext.user.firebaseUid,
                email: accessContext.user.email,
                name: driverIdentity.name,
                username: driverIdentity.name,
                role: accessContext.user.role,
                isOwnerFallback: Boolean(accessContext.user.isOwnerFallback),
                active: isActiveStatus(accessContext.user.userStatus, false) ? 1 : 0,
                perms: Array.isArray(accessContext.user.perms) ? accessContext.user.perms : [],
                clientId: accessContext.client.id,
                branchId: accessContext.user.branchId ?? null,
                logisticsEnabled: true,
                tenantHasDeliveryLicense: Boolean(accessContext.client.tenantHasDeliveryLicense),
                licenses: profileLicenses,
            },
        });
    } catch (err) {
        console.error('[DELIVERY ME ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo resolver el perfil de delivery' });
    }
});

// ── RUTA: GET /api/delivery/orders ────────────────────────────────────────
app.get('/api/delivery/orders', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });
        assertLogisticsAccess(accessContext);

        const tenantInfo = await getTenantInfo(req.firebaseUser, { allowDeliveryOnly: true });
        const pool = getTenantPool(tenantInfo.dbName);
        const driverIdentity = buildDriverIdentity(accessContext);
        const scope = String(req.query.scope || '').trim().toLowerCase();
        const status = req.query.status ? String(req.query.status).split(',') : null;
        const canViewAllDeliveries = hasAdminPanelAccess(accessContext);

        const rows = await listDeliveryOrders(pool, tenantInfo.tenantId, {
            limit: req.query.limit,
            status,
            driverIdentity: canViewAllDeliveries && scope === 'all' ? null : driverIdentity,
        });

        return res.json({
            ok: true,
            count: rows.length,
            scope: canViewAllDeliveries && scope === 'all' ? 'all' : 'assigned',
            orders: rows,
        });
    } catch (err) {
        console.error('[DELIVERY ORDERS ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudieron leer los pedidos de delivery' });
    }
});

// ── RUTA: GET /api/logistics/drivers ──────────────────────────────────────
app.get('/api/logistics/drivers', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        assertLogisticsAccess(accessContext);

        if (!hasAdminPanelAccess(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede listar repartidores' });
        }

        const drivers = await listEligibleLogisticsDrivers(accessContext.client.id);

        return res.json({
            ok: true,
            count: drivers.length,
            drivers,
        });
    } catch (err) {
        console.error('[LOGISTICS DRIVERS ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudieron leer los repartidores habilitados' });
    }
});

// ── RUTA: GET /api/client/branches ────────────────────────────────────────
app.get('/api/client/branches', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);

        const branches = await listClientBranches(accessContext.client.id);

        return res.json({
            ok: true,
            count: branches.length,
            branches,
        });
    } catch (err) {
        console.error('[CLIENT BRANCHES ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudieron leer las sucursales del cliente' });
    }
});

// ── RUTA: POST /api/logistics/orders/:id/assign ───────────────────────────
app.post('/api/logistics/orders/:id/assign', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        assertLogisticsAccess(accessContext);

        if (!hasAdminPanelAccess(accessContext)) {
            return res.status(403).json({ error: 'Solo un administrador puede asignar repartos' });
        }

        const tenantInfo = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(tenantInfo.dbName);
        const orderId = Number(req.params.id);
        const driverIdentity = {
            userId: req.body?.driverUserId ?? null,
            firebaseUid: String(req.body?.driverFirebaseUid || '').trim() || null,
            email: normalizeEmail(req.body?.driverEmail || ''),
            name: String(req.body?.driverName || '').trim() || null,
            role: 'employee',
        };

        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Pedido inválido' });
        }
        if (!driverIdentity.name && !driverIdentity.firebaseUid && !driverIdentity.email) {
            return res.status(400).json({ error: 'Falta el repartidor a asignar' });
        }

        await assignDeliveryOrder(pool, tenantInfo.tenantId, orderId, driverIdentity, req.body?.status || 'assigned');
        await createDeliveryTrackingEvent(pool, tenantInfo.tenantId, {
            orderId,
            eventType: 'assigned',
            status: normalizeDeliveryStatus(req.body?.status || 'assigned'),
            driverName: driverIdentity.name,
            driverUid: driverIdentity.firebaseUid,
            driverEmail: driverIdentity.email || null,
            actorUserId: accessContext.user.id,
            actorFirebaseUid: accessContext.user.firebaseUid || null,
            actorEmail: accessContext.user.email || null,
            payloadJson: req.body || {},
        });

        const order = await fetchDeliveryOrderById(pool, tenantInfo.tenantId, orderId);
        return res.json({
            ok: true,
            order: mapDeliveryOrder(order),
        });
    } catch (err) {
        console.error('[DELIVERY ASSIGN ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo asignar el reparto' });
    }
});

// ── RUTA: POST /api/delivery/orders/:id/status ────────────────────────────
app.post('/api/delivery/orders/:id/status', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });
        assertLogisticsAccess(accessContext);

        const tenantInfo = await getTenantInfo(req.firebaseUser, { allowDeliveryOnly: true });
        const pool = getTenantPool(tenantInfo.dbName);
        const orderId = Number(req.params.id);
        const status = normalizeDeliveryStatus(req.body?.status);
        const driverIdentity = buildDriverIdentity(accessContext);
        driverIdentity.paymentMethodOverride = req.body?.paymentMethod !== undefined
            ? String(req.body.paymentMethod || '').trim() || null
            : undefined;
        driverIdentity.paymentStatusOverride = req.body?.paymentStatus !== undefined
            ? normalizePaymentStatus(req.body.paymentStatus)
            : undefined;
        driverIdentity.paidOverride = req.body?.paid !== undefined
            ? (req.body.paid === true || String(req.body.paid).trim().toLowerCase() === 'true')
            : undefined;
        driverIdentity.amountDueOverride = req.body?.amountDue !== undefined
            ? (() => {
                if (req.body.amountDue == null || req.body.amountDue === '') return null;
                const nextAmountDue = Number(req.body.amountDue);
                return Number.isFinite(nextAmountDue) ? nextAmountDue : null;
            })()
            : undefined;
        const lat = req.body?.lat == null ? null : Number(req.body.lat);
        const lng = req.body?.lng == null ? null : Number(req.body.lng);
        const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
        const speed = req.body?.speed == null ? null : Number(req.body.speed);
        const heading = req.body?.heading == null ? null : Number(req.body.heading);

        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Pedido inválido' });
        }
        if (!status) {
            return res.status(400).json({ error: 'Estado inválido' });
        }

        const updatedOrder = await updateDeliveryOrderStatus(pool, tenantInfo.tenantId, orderId, status, driverIdentity);
        await createDeliveryTrackingEvent(pool, tenantInfo.tenantId, {
            orderId,
            eventType: 'status_changed',
            status,
            driverName: updatedOrder.repartidor || driverIdentity.name,
            driverUid: updatedOrder.assigned_driver_uid || driverIdentity.firebaseUid,
            driverEmail: updatedOrder.assigned_driver_email || driverIdentity.email || null,
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            speed: Number.isFinite(speed) ? speed : null,
            heading: Number.isFinite(heading) ? heading : null,
            actorUserId: accessContext.user.id,
            actorFirebaseUid: accessContext.user.firebaseUid || null,
            actorEmail: accessContext.user.email || null,
            payloadJson: {
                ...(req.body || {}),
                paymentMethod: driverIdentity.paymentMethodOverride,
                paymentStatus: driverIdentity.paymentStatusOverride,
                paid: driverIdentity.paidOverride,
                amountDue: driverIdentity.amountDueOverride,
            },
        });

        return res.json({
            ok: true,
            order: mapDeliveryOrder(updatedOrder),
        });
    } catch (err) {
        console.error('[DELIVERY STATUS ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo actualizar el estado del reparto' });
    }
});

// ── RUTA: POST /api/delivery/location ─────────────────────────────────────
app.post('/api/delivery/location', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });
        assertLogisticsAccess(accessContext);

        const tenantInfo = await getTenantInfo(req.firebaseUser, { allowDeliveryOnly: true });
        const tenantId = Number(tenantInfo.tenantId || accessContext.client?.id || DEFAULT_OPERATIONAL_TENANT_ID);
        const firebaseUid = String(accessContext.user?.firebaseUid || req.firebaseUser?.uid || '').trim();
        const lat = Number(req.body?.lat);
        const lng = Number(req.body?.lng);
        const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
        const speed = req.body?.speed == null ? null : Number(req.body.speed);
        const heading = req.body?.heading == null ? null : Number(req.body.heading);
        const orderId = req.body?.orderId == null ? null : Number(req.body.orderId);
        const status = req.body?.status ? normalizeDeliveryStatus(req.body.status) : null;

        if (!firebaseUid) {
            return res.status(400).json({ error: 'Usuario Firebase inválido' });
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ error: 'lat y lng son requeridos' });
        }

        const payload = await storeDriverLocationPresence({
            tenantId,
            firebaseUid,
            payload: {
                lat,
                lng,
                accuracy: Number.isFinite(accuracy) ? accuracy : null,
                speed: Number.isFinite(speed) ? speed : null,
                heading: Number.isFinite(heading) ? heading : null,
                repartidor: getAccessDisplayName(accessContext.user),
                email: req.firebaseUser?.email || null,
                orderId: Number.isFinite(orderId) ? orderId : null,
                status,
            },
        });

        const pool = getTenantPool(tenantInfo.dbName);
        await upsertDriverLastLocation(pool, tenantId, {
            orderId: Number.isFinite(orderId) ? orderId : null,
            status,
            driverName: getAccessDisplayName(accessContext.user),
            driverUid: firebaseUid,
            driverEmail: normalizeEmail(req.firebaseUser?.email || ''),
            latitude: lat,
            longitude: lng,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            speed: Number.isFinite(speed) ? speed : null,
            heading: Number.isFinite(heading) ? heading : null,
            payloadJson: req.body || {},
        });

        return res.json({
            ok: true,
            ttlSeconds: REDIS_TRACKING_TTL_SECONDS,
            location: payload,
        });
    } catch (err) {
        console.error('[DELIVERY LOCATION WRITE ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudo guardar la ubicacion en Redis' });
    }
});

// ── RUTA: GET /api/delivery/locations ─────────────────────────────────────
app.get('/api/delivery/locations', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext, { allowDeliveryOnly: true });
        assertLogisticsAccess(accessContext);
        const tenantId = Number(accessContext.client?.id || DEFAULT_OPERATIONAL_TENANT_ID);
        const locations = await getActiveDriverLocations(tenantId);
        return res.json({
            ok: true,
            ttlSeconds: REDIS_TRACKING_TTL_SECONDS,
            count: locations.length,
            locations,
        });
    } catch (err) {
        console.error('[DELIVERY LOCATION READ ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudo leer ubicaciones desde Redis' });
    }
});

// ── RUTA: GET /api/logistics/drivers/live ─────────────────────────────────
app.get('/api/logistics/drivers/live', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        assertLogisticsAccess(accessContext);

        const tenantInfo = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(tenantInfo.dbName);
        const locations = await getActiveDriverLocations(tenantInfo.tenantId);
        const drivers = await buildLiveDriversSummary(pool, tenantInfo.tenantId, locations);

        return res.json({
            ok: true,
            ttlSeconds: REDIS_TRACKING_TTL_SECONDS,
            count: drivers.length,
            drivers,
        });
    } catch (err) {
        console.error('[LIVE DRIVERS ERROR]', err.message);
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'No se pudo leer el mapa en tiempo real' });
    }
});

// ── RUTAS: Onboarding del Bridge ───────────────────────────────────────────
const bridgeAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/bridge/auth/login', bridgeAuthLimiter, async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const firebaseUser = await firebaseSignInWithPassword(email, password);

        // Usa la misma resolucion que el resto del API (cubre owner fallback
        // por billingEmail y Firestore).
        const accessContext = await getClientAccessContext({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
        });

        if (!accessContext?.user) {
            return res.status(403).json({ error: 'El usuario no está vinculado a un cliente' });
        }
        const user = accessContext.user;
        const client = accessContext.client;
        if (String(user.role || '').toLowerCase() !== 'admin') {
            return res.status(403).json({ error: 'Sólo usuarios admin pueden instalar el bridge' });
        }
        if (String(user.userStatus || '').toUpperCase() !== 'ACTIVE') {
            return res.status(403).json({ error: 'El usuario no está activo' });
        }
        if (String(client?.status || '').toUpperCase() !== 'ACTIVE') {
            return res.status(403).json({ error: 'El cliente no está activo' });
        }

        const clientId = Number(client.id);
        const branches = await listClientBranches(clientId);
        if (branches.length === 0) {
            return res.status(409).json({ error: 'El cliente no tiene sucursales activas' });
        }

        const sessionToken = signBridgeSessionToken({
            uid: firebaseUser.uid,
            email: normalizeEmail(firebaseUser.email),
            clientId,
            branchIds: branches.map((branch) => Number(branch.id)),
        });

        return res.json({
            sessionToken,
            clientId,
            tenantId: clientId,
            clientName: client.businessName,
            taxId: client.taxId,
            branches: branches.map((branch) => ({
                id: branch.id,
                name: branch.name,
                internalCode: branch.internalCode,
                address: branch.address,
            })),
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) {
            console.error('[BRIDGE LOGIN ERROR]', error?.message || error);
        }
        return res.status(statusCode).json({ error: error?.message || 'No se pudo iniciar sesión' });
    }
});

app.post('/api/bridge/onboarding/complete', bridgeAuthLimiter, async (req, res) => {
    try {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        const branchId = Number(req.body?.branchId);
        const hostname = String(req.body?.hostname || '').trim().slice(0, 255) || null;
        if (!sessionToken) {
            return res.status(400).json({ error: 'sessionToken es requerido' });
        }
        if (!Number.isFinite(branchId) || branchId <= 0) {
            return res.status(400).json({ error: 'branchId es requerido' });
        }

        let session;
        try {
            session = verifyBridgeSessionToken(sessionToken);
        } catch (error) {
            return res.status(401).json({ error: 'sessionToken inválido o expirado' });
        }

        const allowedBranches = Array.isArray(session.branchIds) ? session.branchIds.map(Number) : [];
        if (!allowedBranches.includes(branchId)) {
            return res.status(403).json({ error: 'La sucursal seleccionada no pertenece al cliente' });
        }

        const clientId = Number(session.clientId);
        const branches = await listClientBranches(clientId);
        const branch = branches.find((row) => Number(row.id) === branchId);
        if (!branch) {
            return res.status(409).json({ error: 'La sucursal ya no está activa' });
        }

        const conn = await clientsControlPool.getConnection();
        let clientRow = null;
        try {
            const [clientRows] = await conn.query(
                `SELECT id, businessName, taxId, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\`
                 WHERE id = ?
                 LIMIT 1`,
                [clientId]
            );
            clientRow = clientRows?.[0] || null;
        } finally {
            conn.release();
        }

        if (!clientRow || String(clientRow.status || '').toUpperCase() !== 'ACTIVE') {
            return res.status(409).json({ error: 'El cliente ya no está activo' });
        }

        const deviceId = generateBridgeDeviceId();
        const deviceToken = generateBridgeDeviceToken();
        const deviceTokenHash = hashBridgeDeviceToken(deviceToken);

        await clientsControlPool.query(
            `INSERT INTO \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
                (tenantId, clientId, branchId, deviceId, deviceTokenHash, hostname, status, lastSeenAt)
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NOW())`,
            [clientId, clientId, branchId, deviceId, deviceTokenHash, hostname]
        );

        return res.json({
            deviceToken,
            deviceId,
            tenantId: clientId,
            clientId,
            clientName: clientRow.businessName,
            taxId: clientRow.taxId,
            branchId: branch.id,
            branchName: branch.name,
            branchInternalCode: branch.internalCode,
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) {
            console.error('[BRIDGE ONBOARDING ERROR]', error?.message || error);
        }
        return res.status(statusCode).json({ error: error?.message || 'No se pudo completar el onboarding' });
    }
});

// ── RUTAS: Bridge autenticado por deviceToken ──────────────────────────────
function getOperationalPool() {
    return getTenantPool(OPERATIONAL_DB_NAME);
}

function resolveBridgeScaleDeviceId(req, scaleIdRaw) {
    const scaleId = String(scaleIdRaw == null ? '' : scaleIdRaw).trim();
    if (!scaleId || !/^[a-zA-Z0-9_-]{1,32}$/.test(scaleId)) {
        const error = new Error('scaleId requerido (alfanumérico, 1-32 chars)');
        error.statusCode = 400;
        throw error;
    }
    return { scaleId, deviceId: `${req.bridge.deviceId}-scale-${scaleId}` };
}

function normalizeAsciiServer(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\x20-\x7E]/g, '');
}

function parseBridgeSectionMappings(rawValue) {
    try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((row) => {
                const category = normalizeAsciiServer(row?.category).toLowerCase().trim();
                if (!category) return null;
                const sectionId = Math.max(1, Math.min(99, Number.parseInt(row?.sectionId, 10) || 2));
                const sectionName = (normalizeAsciiServer(row?.sectionName || 'CARNICERIA').toUpperCase().slice(0, 18)) || 'CARNICERIA';
                return { category, sectionId, sectionName };
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function parseBridgeMarqueeText(rawMessages, fallback = '') {
    const fallbackText = normalizeAsciiServer(String(fallback || '')).slice(0, 80);
    if (!rawMessages) return fallbackText;
    try {
        const parsed = JSON.parse(String(rawMessages));
        if (!Array.isArray(parsed)) return fallbackText;
        const active = parsed.find((line) => (
            Number(line?.active ?? 1) === 1 && String(line?.text || '').trim().length > 0
        ));
        return normalizeAsciiServer(String(active?.text || '')).slice(0, 80) || fallbackText;
    } catch {
        return fallbackText;
    }
}

function normalizePriceFormatServer(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '6d' ? '6d' : '4d2d';
}

app.get('/api/bridge/settings', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const branchId = Number(req.bridge.branchId || 0);
        const keys = [
            'scale_ticket_header_line1',
            'scale_ticket_header_line2',
            'scale_ticket_header_line3',
            'scale_section_mappings',
            'scale_marquee_messages',
            'scale_marquee_text',
            'precio_formato',
        ];
        const placeholders = keys.map(() => '?').join(', ');

        let byKey;
        if (branchId > 0) {
            // Trae tanto los de la sucursal como los tenant-level; branch-specific gana
            const [rows] = await pool.query(
                `SELECT \`key\`, value, branch_id FROM settings
                 WHERE \`${TENANT_COLUMN}\` = ? AND \`key\` IN (${placeholders})
                   AND (branch_id = ? OR branch_id = 0)`,
                [tenantId, ...keys, branchId]
            );
            const map = {};
            for (const row of rows) {
                const k = String(row.key);
                if (!map[k] || Number(row.branch_id) > Number(map[k].branch_id)) {
                    map[k] = row;
                }
            }
            byKey = Object.fromEntries(Object.entries(map).map(([k, r]) => [k, r.value]));
        } else {
            const [rows] = await pool.query(
                `SELECT \`key\`, value FROM settings
                 WHERE \`${TENANT_COLUMN}\` = ? AND \`key\` IN (${placeholders}) AND branch_id = 0`,
                [tenantId, ...keys]
            );
            byKey = rows.reduce((acc, row) => { acc[String(row.key)] = row.value; return acc; }, {});
        }

        return res.json({
            ticketHeader: {
                line1: normalizeAsciiServer(byKey.scale_ticket_header_line1 || '').slice(0, 18),
                line2: normalizeAsciiServer(byKey.scale_ticket_header_line2 || '').slice(0, 34),
                line3: normalizeAsciiServer(byKey.scale_ticket_header_line3 || '').slice(0, 34),
            },
            sectionMappings: parseBridgeSectionMappings(byKey.scale_section_mappings),
            marqueeText: parseBridgeMarqueeText(byKey.scale_marquee_messages, byKey.scale_marquee_text),
            priceFormat: normalizePriceFormatServer(byKey.precio_formato),
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE SETTINGS ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudieron leer los settings' });
    }
});

app.get('/api/bridge/catalog', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const requestedBranchId = Number(req.bridge.branchId || 0);
        const activeBranches = req.bridge.clientId ? await listClientBranches(req.bridge.clientId) : [];
        const requiresExplicitBranch = hasMultipleActiveBranches(activeBranches);
        const resolvedBranchId = Number.isFinite(requestedBranchId) && requestedBranchId > 0
            ? requestedBranchId
            : (activeBranches.length === 1 ? Number(activeBranches[0]?.id || 0) : null);
        if (requiresExplicitBranch && (!Number.isFinite(resolvedBranchId) || resolvedBranchId <= 0)) {
            if (STRICT_BRANCH_SCOPING) {
                return res.status(400).json({
                    error: 'El bridge requiere una sucursal asignada',
                    code: 'BRIDGE_BRANCH_REQUIRED',
                });
            }
            warnBranchScopeFallback('bridge-catalog-without-branch', {
                tenantId,
                clientId: req.bridge.clientId ?? null,
                deviceId: req.bridge.deviceId ?? null,
                path: req.path,
            });
        }
        const promotionScope = buildBranchScopeClause({
            branchId: resolvedBranchId,
            allowLegacyNullFallback: false,
        });
        const promotionWhereSql = promotionScope.sql ? `AND ${promotionScope.sql}` : 'AND branch_id IS NULL';

        const [duplicateRows] = await pool.query(
            `SELECT effective_plu_code, COUNT(*) AS qty
             FROM (
                SELECT COALESCE(NULLIF(TRIM(CAST(plu AS CHAR)), ''), CAST(id AS CHAR)) AS effective_plu_code
                FROM (
                    SELECT p.id, p.plu, COALESCE(bpp.price, p.current_price) AS effective_price
                    FROM products p
                    LEFT JOIN branch_product_prices bpp
                      ON bpp.tenant_id = p.tenant_id
                     AND bpp.product_id = p.id
                                         AND bpp.branch_id = ?
                    WHERE p.\`${TENANT_COLUMN}\` = ?
                      AND p.branch_id = ?
                      AND COALESCE(p.active, 1) = 1
                      AND p.deleted_at IS NULL
                ) products_with_price
                WHERE 1 = 1
                  AND COALESCE(effective_price, 0) > 0
                UNION ALL
                SELECT TRIM(CAST(promo_plu AS CHAR)) AS effective_plu_code
                FROM promotions
                WHERE \`${TENANT_COLUMN}\` = ?
                  ${promotionWhereSql}
                  AND COALESCE(active, 1) = 1
                  AND TRIM(COALESCE(CAST(promo_plu AS CHAR), '')) <> ''
             ) x
             GROUP BY effective_plu_code
             HAVING COUNT(*) > 1
             ORDER BY effective_plu_code`,
            [resolvedBranchId, tenantId, resolvedBranchId, tenantId, ...promotionScope.params]
        );

        const [productRows] = await pool.query(
            `SELECT p.id, p.plu, p.name, p.category, p.unit,
                    COALESCE(bpp.price, p.current_price) AS current_price,
                    COALESCE(bpp.updated_at, p.updated_at) AS updated_at,
                    COALESCE(NULLIF(TRIM(CAST(p.plu AS CHAR)), ''), CAST(p.id AS CHAR)) AS effective_plu_code
             FROM products p
             LEFT JOIN branch_product_prices bpp
               ON bpp.tenant_id = p.tenant_id
              AND bpp.product_id = p.id
                            AND bpp.branch_id = ?
             WHERE p.\`${TENANT_COLUMN}\` = ?
               AND p.branch_id = ?
               AND COALESCE(p.active, 1) = 1
               AND p.deleted_at IS NULL
               AND COALESCE(bpp.price, p.current_price, 0) > 0
             ORDER BY COALESCE(bpp.updated_at, p.updated_at) ASC, p.id ASC`,
            [resolvedBranchId, tenantId, resolvedBranchId]
        );

        let promotionRows = [];
        try {
            const [rows] = await pool.query(
                `SELECT *
                 FROM promotions
                 WHERE \`${TENANT_COLUMN}\` = ?
                   ${promotionWhereSql}
                   AND TRIM(COALESCE(CAST(promo_plu AS CHAR), '')) <> ''
                 ORDER BY updated_at ASC, id ASC`,
                [tenantId, ...promotionScope.params]
            );
            promotionRows = rows;
        } catch (error) {
            console.warn('[BRIDGE CATALOG] No se pudieron leer promociones:', error?.message || error);
        }

        const productById = new Map(productRows.map((row) => [Number(row.id), row]));

        const products = productRows.map((row) => ({
            mapProductId: Number(row.id),
            sourceType: 'product',
            sourceId: Number(row.id),
            plu: row.plu,
            name: row.name,
            category: row.category,
            unit: row.unit,
            currentPrice: Number(row.current_price) || 0,
            updatedAt: row.updated_at,
            effectivePluCode: String(row.effective_plu_code || '').trim(),
        }));

        const promotions = promotionRows
            .map((row) => {
                const activeRaw = row.active;
                const isActive = activeRaw == null
                    || activeRaw === true
                    || Number(activeRaw) === 1
                    || String(activeRaw).trim().toLowerCase() === 'true';
                if (!isActive) return null;
                const promoPlu = String(row.promo_plu || '').trim();
                if (!promoPlu) return null;
                const linkedProduct = productById.get(Number(row.product_id)) || null;
                const promoName = String(row.promo_name || '').trim();
                const productName = String(row.product_name || '').trim();
                const priceMode = String(row.promo_price_mode || 'total_kg').trim().toLowerCase();
                const minQty = Number(row.min_qty_kg) || 0;
                const totalPrice = Number(row.promo_total_price) || 0;
                const unitPriceRaw = Number(row.promo_unit_price);
                const effectiveUnitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
                    ? unitPriceRaw
                    : (priceMode === 'per_kg'
                        ? totalPrice
                        : (minQty > 0 ? (totalPrice / minQty) : totalPrice));
                if (!(effectiveUnitPrice > 0)) return null;
                const sourceId = Number(row.id);
                return {
                    mapProductId: -sourceId,
                    sourceType: 'promotion',
                    sourceId,
                    plu: promoPlu,
                    name: promoName || productName || `PROMO ${sourceId}`,
                    category: linkedProduct?.category || 'PROMOCIONES',
                    unit: linkedProduct?.unit || 'kg',
                    currentPrice: effectiveUnitPrice,
                    updatedAt: row.updated_at,
                    effectivePluCode: promoPlu,
                };
            })
            .filter(Boolean);

        return res.json({
            products,
            promotions,
            pluDuplicates: duplicateRows.map((row) => ({
                pluCode: String(row.effective_plu_code || ''),
                count: Number(row.qty) || 0,
            })),
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[BRIDGE CATALOG ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudo leer el catálogo' });
    }
});

app.get('/api/bridge/catalog/removed', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.query?.scaleId);
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const [rows] = await pool.query(
            `SELECT m.product_id AS mapProductId,
                    m.plu_code   AS pluCode,
                    CASE
                        WHEN m.product_id < 0 THEN TRIM(CAST(pr.promo_plu AS CHAR))
                        ELSE COALESCE(NULLIF(TRIM(CAST(p.plu AS CHAR)), ''), CAST(p.id AS CHAR))
                    END AS expectedPluCode
             FROM scale_bridge_product_map m
             LEFT JOIN products p
                ON m.product_id > 0 AND p.id = m.product_id AND p.\`${TENANT_COLUMN}\` = m.tenant_id
             LEFT JOIN promotions pr
                ON m.product_id < 0 AND pr.id = ABS(m.product_id) AND pr.\`${TENANT_COLUMN}\` = m.tenant_id
             WHERE m.device_id = ?
               AND m.tenant_id = ?
               AND (
                    (m.product_id > 0 AND (
                        p.id IS NULL
                        OR COALESCE(p.active, 1) <> 1
                        OR p.deleted_at IS NOT NULL
                        OR COALESCE(p.current_price, 0) <= 0
                        OR COALESCE(NULLIF(TRIM(CAST(p.plu AS CHAR)), ''), CAST(p.id AS CHAR)) <> CAST(m.plu_code AS CHAR)
                    ))
                    OR (m.product_id < 0 AND (
                        pr.id IS NULL
                        OR COALESCE(pr.active, 1) <> 1
                        OR TRIM(COALESCE(CAST(pr.promo_plu AS CHAR), '')) = ''
                        OR TRIM(CAST(pr.promo_plu AS CHAR)) <> CAST(m.plu_code AS CHAR)
                    ))
               )`,
            [deviceId, tenantId]
        );
        return res.json({
            removed: rows.map((row) => ({
                mapProductId: Number(row.mapProductId),
                pluCode: String(row.pluCode || ''),
                expectedPluCode: row.expectedPluCode ? String(row.expectedPluCode) : null,
            })),
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE CATALOG/REMOVED ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudieron leer productos removidos' });
    }
});

app.get('/api/bridge/catalog/observed-plu', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.query?.scaleId);
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const [rows] = await pool.query(
            `SELECT DISTINCT plu_code
             FROM (
                SELECT m.plu_code
                FROM scale_bridge_product_map m
                WHERE m.device_id = ? AND m.tenant_id = ?
                UNION ALL
                SELECT s.plu_code
                FROM scale_bridge_sales_item s
                WHERE s.device_id = ? AND s.tenant_id = ?
                  AND s.sale_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
             ) x
             WHERE TRIM(COALESCE(plu_code, '')) <> ''`,
            [deviceId, tenantId, deviceId, tenantId]
        );
        return res.json({ observedPlus: rows.map((row) => String(row.plu_code || '').trim()).filter(Boolean) });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE CATALOG/OBSERVED-PLU ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudieron leer PLUs observados' });
    }
});

app.get('/api/bridge/sync-state/product-map', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.query?.scaleId);
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const idsRaw = String(req.query?.productIds || '').trim();
        const productIds = idsRaw
            ? idsRaw.split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((value) => Number.isFinite(value))
            : null;

        let rows = [];
        if (productIds && productIds.length > 0) {
            const placeholders = productIds.map(() => '?').join(', ');
            const [data] = await pool.query(
                `SELECT product_id, plu_code, fingerprint, synced_at
                 FROM scale_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND product_id IN (${placeholders})`,
                [deviceId, tenantId, ...productIds]
            );
            rows = data;
        } else {
            const [data] = await pool.query(
                `SELECT product_id, plu_code, fingerprint, synced_at
                 FROM scale_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ?`,
                [deviceId, tenantId]
            );
            rows = data;
        }

        return res.json({
            entries: rows.map((row) => ({
                productId: Number(row.product_id),
                pluCode: String(row.plu_code || ''),
                fingerprint: String(row.fingerprint || ''),
                syncedAt: row.synced_at,
            })),
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE SYNC-STATE GET ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudo leer el sync state' });
    }
});

app.put('/api/bridge/sync-state/product-map', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.body?.scaleId);
        const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
        if (entries.length === 0) {
            return res.json({ ok: true, upserted: 0 });
        }
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;

        const values = [];
        const placeholders = [];
        for (const entry of entries) {
            const productId = Number.parseInt(entry?.productId, 10);
            const pluCode = String(entry?.pluCode || '').trim().slice(0, 16);
            const fingerprint = String(entry?.fingerprint || '').trim().slice(0, 128);
            if (!Number.isFinite(productId) || !pluCode || !fingerprint) continue;
            placeholders.push('(?, ?, ?, ?, ?, NOW())');
            values.push(deviceId, tenantId, productId, pluCode, fingerprint);
        }
        if (placeholders.length === 0) {
            return res.json({ ok: true, upserted: 0 });
        }

        await pool.query(
            `INSERT INTO scale_bridge_product_map (device_id, tenant_id, product_id, plu_code, fingerprint, synced_at)
             VALUES ${placeholders.join(', ')}
             ON DUPLICATE KEY UPDATE
                plu_code    = VALUES(plu_code),
                fingerprint = VALUES(fingerprint),
                synced_at   = VALUES(synced_at)`,
            values
        );

        return res.json({ ok: true, upserted: placeholders.length });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE SYNC-STATE PUT ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudo escribir el sync state' });
    }
});

app.delete('/api/bridge/sync-state/product-map', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.body?.scaleId);
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const resetAll = req.body?.resetAll === true;
        const productIdsRaw = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
        const pluCodesRaw = Array.isArray(req.body?.pluCodes) ? req.body.pluCodes : [];

        if (resetAll) {
            const [result] = await pool.query(
                `DELETE FROM scale_bridge_product_map WHERE device_id = ? AND tenant_id = ?`,
                [deviceId, tenantId]
            );
            return res.json({ ok: true, deleted: Number(result?.affectedRows || 0), mode: 'resetAll' });
        }

        const productIds = productIdsRaw
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value));

        const pluCodes = pluCodesRaw
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .slice(0, 500);

        let totalDeleted = 0;

        if (productIds.length > 0) {
            const placeholders = productIds.map(() => '?').join(', ');
            const [result] = await pool.query(
                `DELETE FROM scale_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND product_id IN (${placeholders})`,
                [deviceId, tenantId, ...productIds]
            );
            totalDeleted += Number(result?.affectedRows || 0);
        }

        for (const pluCode of pluCodes) {
            const pluNumber = Number.parseInt(pluCode, 10);
            const params = [deviceId, tenantId, pluCode];
            let extraSql = '';
            if (Number.isFinite(pluNumber)) {
                extraSql = ` OR (TRIM(CAST(plu_code AS CHAR)) REGEXP '^[0-9]+$' AND CAST(TRIM(CAST(plu_code AS CHAR)) AS UNSIGNED) = ?)`;
                params.push(pluNumber);
            }
            const [result] = await pool.query(
                `DELETE FROM scale_bridge_product_map
                 WHERE device_id = ?
                   AND tenant_id = ?
                   AND (TRIM(CAST(plu_code AS CHAR)) = ?${extraSql})`,
                params
            );
            totalDeleted += Number(result?.affectedRows || 0);
        }

        return res.json({ ok: true, deleted: totalDeleted });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE SYNC-STATE DELETE ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudo borrar del sync state' });
    }
});

async function runBridgeSalesNormalization({ pool, deviceId, tenantId, branchId }) {
    const branchKey = Number.isFinite(branchId) && branchId > 0 ? branchId : null;

    await pool.query(
        `UPDATE scale_bridge_sales_item s
         INNER JOIN scale_bridge_ticket_map t
            ON t.device_id = s.device_id
           AND t.tenant_id = s.tenant_id
           AND COALESCE(t.branch_id, 0) = COALESCE(s.branch_id, 0)
           AND t.ticket_id = s.ticket_id
           AND t.sale_at = s.sale_at
         SET s.ticket_barcode         = t.ticket_barcode,
             s.printed_ticket_barcode = t.printed_ticket_barcode,
             s.vendor_name            = t.vendor_name,
             s.ticket_total_amount    = t.total_amount,
             s.ticket_item_count      = t.item_count,
             s.synced_at              = NOW()
         WHERE s.device_id = ?
           AND s.tenant_id = ?
           AND COALESCE(s.branch_id, 0) = COALESCE(?, 0)
           AND (
                s.ticket_barcode IS NULL
                OR s.ticket_barcode <> t.ticket_barcode
                OR COALESCE(s.printed_ticket_barcode, '') <> COALESCE(t.printed_ticket_barcode, '')
                OR COALESCE(s.vendor_name, '') <> COALESCE(t.vendor_name, '')
                OR ABS(COALESCE(s.ticket_total_amount, 0) - COALESCE(t.total_amount, 0)) >= 0.01
                OR COALESCE(s.ticket_item_count, 0) <> COALESCE(t.item_count, 0)
           )`,
        [deviceId, tenantId, branchKey]
    );

    await pool.query(
        `UPDATE scale_bridge_sales_item s
         INNER JOIN (
            SELECT device_id, tenant_id, COALESCE(branch_id, 0) AS branch_id_key, ticket_id, sale_at,
                   ROUND(SUM(amount), 2) AS ticket_total_amount,
                   COUNT(*)              AS ticket_item_count
              FROM scale_bridge_sales_item
             WHERE device_id = ? AND tenant_id = ?
               AND COALESCE(branch_id, 0) = COALESCE(?, 0)
             GROUP BY device_id, tenant_id, COALESCE(branch_id, 0), ticket_id, sale_at
         ) totals
            ON totals.device_id     = s.device_id
           AND totals.tenant_id     = s.tenant_id
           AND totals.branch_id_key = COALESCE(s.branch_id, 0)
           AND totals.ticket_id     = s.ticket_id
           AND totals.sale_at       = s.sale_at
         SET s.ticket_total_amount = totals.ticket_total_amount,
             s.ticket_item_count   = totals.ticket_item_count,
             s.synced_at           = NOW()
         WHERE s.device_id = ?
           AND s.tenant_id = ?
           AND COALESCE(s.branch_id, 0) = COALESCE(?, 0)
           AND (
                ABS(COALESCE(s.ticket_total_amount, 0) - COALESCE(totals.ticket_total_amount, 0)) >= 0.01
                OR COALESCE(s.ticket_item_count, 0) <> COALESCE(totals.ticket_item_count, 0)
           )`,
        [deviceId, tenantId, branchKey, deviceId, tenantId, branchKey]
    );

    await pool.query(
        `UPDATE scale_bridge_sales_item
         SET item_quantity = CASE
                WHEN COALESCE(grams, 0) > 0 THEN ROUND(COALESCE(grams, 0) / 1000, 3)
                ELSE COALESCE(units, 0)
             END,
             item_quantity_unit = CASE
                WHEN COALESCE(grams, 0) > 0 THEN 'kg'
                ELSE 'un'
             END,
             synced_at = NOW()
         WHERE device_id = ?
           AND tenant_id = ?
           AND COALESCE(branch_id, 0) = COALESCE(?, 0)
           AND (
                ABS(COALESCE(item_quantity, 0) - CASE
                    WHEN COALESCE(grams, 0) > 0 THEN ROUND(COALESCE(grams, 0) / 1000, 3)
                    ELSE COALESCE(units, 0)
                END) >= 0.001
                OR COALESCE(item_quantity_unit, '') <> CASE
                    WHEN COALESCE(grams, 0) > 0 THEN 'kg'
                    ELSE 'un'
                END
           )`,
        [deviceId, tenantId, branchKey]
    );

    await pool.query(
        `UPDATE scale_bridge_ticket_map t
         LEFT JOIN scale_users u
           ON u.\`${TENANT_COLUMN}\` = t.tenant_id
          AND u.branch_id <=> t.branch_id
          AND COALESCE(u.active, 1) = 1
          AND CAST(u.slot_no AS UNSIGNED) = CAST(t.vendor_code AS UNSIGNED)
         SET t.vendor_name = COALESCE(NULLIF(TRIM(u.display_name), ''), t.vendor_name)
         WHERE t.device_id = ?
           AND t.tenant_id = ?
           AND COALESCE(t.branch_id, 0) = COALESCE(?, 0)
           AND (t.vendor_name IS NULL OR t.vendor_name = '')`,
        [deviceId, tenantId, branchKey]
    );

    await pool.query(
        `UPDATE scale_bridge_sales_item s
         LEFT JOIN scale_users u
           ON u.\`${TENANT_COLUMN}\` = s.tenant_id
          AND u.branch_id <=> s.branch_id
          AND COALESCE(u.active, 1) = 1
          AND CAST(u.slot_no AS UNSIGNED) = CAST(s.vendor_code AS UNSIGNED)
         SET s.vendor_name = COALESCE(NULLIF(TRIM(u.display_name), ''), s.vendor_name),
             s.synced_at   = NOW()
         WHERE s.device_id = ?
           AND s.tenant_id = ?
           AND COALESCE(s.branch_id, 0) = COALESCE(?, 0)
           AND (s.vendor_name IS NULL OR s.vendor_name = '')`,
        [deviceId, tenantId, branchKey]
    );
}

// Archiva un ticket de balanza en scale_sales_log (registro PERMANENTE append-only
// que alimenta la solapa "Detalle de Ventas"). Congela los renglones con el nombre
// de producto YA resuelto (mismo criterio que la conciliacion: mapa PLU->producto
// del bridge, y si no products.plu), para poder reimprimir el ticket identico a como
// salio aunque despues cambie el catalogo o se vacie la balanza. Idempotente por
// (tenant_id, ticket_barcode): una re-lectura del mismo ticket refresca el snapshot,
// no duplica; y NUNCA pisa un snapshot mas completo con uno parcial (guard por
// item_count). Lanza si no pudo archivar (el caller NO cuenta el ticket → el bridge
// no vacia la balanza sin registro).
async function storeScaleSalesLog(pool, ctx) {
    const {
        tenantId, branchId, deviceId, scaleAddress,
        ticketId, ticketBarcode, printedTicketBarcode,
        vendorCode, vendorName, saleAt, totalAmount, itemCount,
    } = ctx;

    const [lines] = await pool.query(`
        SELECT
            i.line_no, i.plu_code, i.sector_code, i.vendor_code, i.vendor_name,
            i.units, i.grams, i.drained_grams, i.amount,
            i.item_quantity, i.item_quantity_unit, i.sale_at,
            COALESCE(
                (SELECT p.name FROM scale_bridge_product_map m
                 JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
                 WHERE m.tenant_id = i.tenant_id AND m.device_id = i.device_id
                   AND CAST(m.plu_code AS CHAR) = CAST(i.plu_code AS CHAR)
                 LIMIT 1),
                (SELECT p.name FROM products p
                 WHERE p.tenant_id = i.tenant_id
                   AND (
                       CAST(p.plu AS CHAR) = CAST(i.plu_code AS CHAR)
                       OR CAST(p.plu AS CHAR) = TRIM(LEADING '0' FROM CAST(i.plu_code AS CHAR))
                   )
                 ORDER BY CASE WHEN p.branch_id IS NULL THEN 1 ELSE 0 END, p.id DESC
                 LIMIT 1),
                -- Los PLU de promo (rango 1000+, product_id<0 en el mapa) no estan en
                -- products; su nombre vive en promotions.promo_plu. Sin esto las lineas
                -- de promo salian con "-".
                (SELECT COALESCE(NULLIF(pr.product_name, ''), pr.promo_name) FROM promotions pr
                 WHERE pr.tenant_id = i.tenant_id
                   AND (
                       CAST(pr.promo_plu AS CHAR) = CAST(i.plu_code AS CHAR)
                       OR CAST(pr.promo_plu AS CHAR) = TRIM(LEADING '0' FROM CAST(i.plu_code AS CHAR))
                   )
                 ORDER BY CASE WHEN pr.branch_id IS NULL THEN 1 ELSE 0 END, pr.active DESC, pr.id DESC
                 LIMIT 1)
            ) AS product_name
        FROM scale_bridge_sales_item i
        WHERE i.tenant_id = ?
          AND i.ticket_barcode = ?
        ORDER BY i.line_no
    `, [tenantId, ticketBarcode]);

    const linesJson = JSON.stringify(lines.map((l) => ({
        lineNo: l.line_no,
        pluCode: l.plu_code,
        productName: l.product_name || null,
        sectorCode: l.sector_code,
        vendorCode: l.vendor_code,
        vendorName: l.vendor_name,
        units: l.units,
        grams: l.grams,
        drainedGrams: l.drained_grams,
        amount: l.amount,
        itemQuantity: l.item_quantity,
        itemQuantityUnit: l.item_quantity_unit,
        saleAt: toIsoSafe(l.sale_at),
    })));

    await pool.query(`
        INSERT INTO scale_sales_log
            (tenant_id, branch_id, device_id, scale_address, ticket_id, ticket_barcode,
             printed_ticket_barcode, vendor_code, vendor_name, sale_at, total_amount,
             item_count, lines_json, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            branch_id              = VALUES(branch_id),
            scale_address          = VALUES(scale_address),
            ticket_barcode         = IF(VALUES(item_count) >= item_count, VALUES(ticket_barcode), ticket_barcode),
            printed_ticket_barcode = IF(VALUES(item_count) >= item_count, VALUES(printed_ticket_barcode), printed_ticket_barcode),
            vendor_code            = VALUES(vendor_code),
            vendor_name            = VALUES(vendor_name),
            total_amount           = IF(VALUES(item_count) >= item_count, VALUES(total_amount), total_amount),
            lines_json             = IF(VALUES(item_count) >= item_count, VALUES(lines_json), lines_json),
            item_count             = GREATEST(item_count, VALUES(item_count))
    `, [
        tenantId, branchId, deviceId, scaleAddress, ticketId, ticketBarcode,
        printedTicketBarcode, vendorCode, vendorName, saleAt, totalAmount,
        itemCount, linesJson,
    ]);
    return true;
}

// Red de seguridad del Detalle de Ventas: reconcilia los tickets RECIENTES que esten
// en la tabla operativa (scale_bridge_ticket_map) pero que la captura en vivo no haya
// archivado (p.ej. por un error transitorio, que hoy no se reintenta). Garantiza que
// el reporte-control no se pierda ninguna venta. Disenada para ser BARATA e INOFENSIVA:
// ventana de 48h + LIMIT 100 (no dredgea historia), corre sobre la unique key del
// archivo, tiene guard anti-solapamiento y NUNCA lanza (todo en try/catch).
let _reconcileScaleLogRunning = false;
async function reconcileScaleSalesLog(pool) {
    if (_reconcileScaleLogRunning) return 0;
    _reconcileScaleLogRunning = true;
    let archived = 0;
    try {
        const [pending] = await pool.query(`
            SELECT t.tenant_id, t.branch_id, t.device_id, t.scale_address, t.ticket_id,
                   t.ticket_barcode, t.printed_ticket_barcode, t.vendor_code, t.vendor_name,
                   t.sale_at, t.total_amount, t.item_count
            FROM scale_bridge_ticket_map t
            WHERE t.sale_at >= (UTC_TIMESTAMP() - INTERVAL 2 DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM scale_sales_log s
                  WHERE s.device_id = t.device_id
                    AND s.ticket_id = t.ticket_id
                    AND s.sale_at   = t.sale_at
              )
            ORDER BY t.sale_at DESC
            LIMIT 100
        `);
        for (const t of pending) {
            try {
                await storeScaleSalesLog(pool, {
                    tenantId: t.tenant_id, branchId: t.branch_id, deviceId: t.device_id,
                    scaleAddress: t.scale_address, ticketId: t.ticket_id,
                    ticketBarcode: t.ticket_barcode, printedTicketBarcode: t.printed_ticket_barcode,
                    vendorCode: t.vendor_code, vendorName: t.vendor_name, saleAt: t.sale_at,
                    totalAmount: t.total_amount, itemCount: t.item_count,
                });
                archived += 1;
            } catch (e) {
                console.warn('[RECONCILE scale_sales_log] ticket', t.ticket_barcode, e?.message || e);
            }
        }
    } catch (e) {
        console.warn('[RECONCILE scale_sales_log]', e?.message || e);
    } finally {
        _reconcileScaleLogRunning = false;
    }
    if (archived > 0) console.log(`[RECONCILE scale_sales_log] ${archived} tickets recuperados`);
    return archived;
}

app.post('/api/bridge/sales', verifyBridgeDeviceToken, async (req, res) => {
    const bridgeRequestStartedAt = Date.now();
    try {
        const { deviceId } = resolveBridgeScaleDeviceId(req, req.body?.scaleId);
        const scaleAddress = Number.parseInt(req.body?.scaleAddress, 10);
        const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
        const pool = getOperationalPool();
        const tenantId = req.bridge.tenantId;
        const branchId = req.bridge.branchId || null;

        appendScaleLatencyLog('bridge_sales_received', {
            tenantId,
            branchId,
            deviceId,
            scaleId: req.body?.scaleId ?? null,
            scaleAddress: Number.isFinite(scaleAddress) ? scaleAddress : null,
            ticketCount: tickets.length,
        });

        if (tickets.length === 0) {
            appendScaleLatencyLog('bridge_sales_empty', {
                tenantId,
                branchId,
                deviceId,
                elapsedMs: Date.now() - bridgeRequestStartedAt,
            });
            return res.json({ ok: true, ticketsUpserted: 0, itemsUpserted: 0 });
        }

        let ticketsUpserted = 0;
        let itemsUpserted = 0;

        for (const ticket of tickets) {
            const ticketPersistStartedAt = Date.now();
            const ticketId = String(ticket?.ticketId || '').trim();
            if (!ticketId) continue;
            const fingerprint = String(ticket?.fingerprint || '').slice(0, 128);
            const ticketBarcode = String(ticket?.ticketBarcode || '').slice(0, 64);
            const printedTicketBarcode = ticket?.printedTicketBarcode ? String(ticket.printedTicketBarcode).slice(0, 32) : null;
            const vendorCode = ticket?.vendorCode != null ? String(ticket.vendorCode).slice(0, 16) : null;
            const vendorName = ticket?.vendorName ? String(ticket.vendorName).slice(0, 100) : null;
            const saleAt = ticket?.saleAt ? new Date(ticket.saleAt) : new Date();
            const totalAmount = Number(ticket?.totalAmount) || 0;
            const itemCount = Number.parseInt(ticket?.itemCount, 10) || 0;
            const effectiveScaleAddress = Number.isFinite(scaleAddress) ? scaleAddress : null;

            if (!fingerprint || !ticketBarcode) {
                continue;
            }

            appendScaleLatencyLog('bridge_ticket_persist_start', {
                tenantId,
                branchId,
                deviceId,
                ticketId,
                ticketBarcode,
                printedTicketBarcode,
                saleAt: toIsoSafe(saleAt),
                saleToBridgeReceiveMs: diffMs(saleAt, bridgeRequestStartedAt),
                totalAmount,
                itemCount,
                lineCount: Array.isArray(ticket?.lines) ? ticket.lines.length : 0,
            });

            await pool.query(
                `INSERT INTO scale_bridge_ticket_map
                    (device_id, tenant_id, branch_id, scale_address, ticket_id, ticket_barcode, printed_ticket_barcode,
                     vendor_code, vendor_name, sale_at, total_amount, item_count, fingerprint, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    scale_address          = VALUES(scale_address),
                    ticket_barcode         = VALUES(ticket_barcode),
                    printed_ticket_barcode = VALUES(printed_ticket_barcode),
                    vendor_code            = VALUES(vendor_code),
                    vendor_name            = VALUES(vendor_name),
                    sale_at                = VALUES(sale_at),
                    total_amount           = VALUES(total_amount),
                    item_count             = VALUES(item_count),
                    fingerprint            = VALUES(fingerprint),
                    synced_at              = VALUES(synced_at)`,
                [
                    deviceId, tenantId, branchId, effectiveScaleAddress, ticketId, ticketBarcode, printedTicketBarcode,
                    vendorCode, vendorName, saleAt, totalAmount, itemCount, fingerprint,
                ]
            );
            const ticketHeaderPersistedAt = Date.now();

            await pool.query(
                `UPDATE scale_bridge_sales_item
                 SET ticket_barcode         = ?,
                     printed_ticket_barcode = ?,
                     vendor_name            = ?,
                     synced_at              = NOW()
                 WHERE device_id = ?
                   AND tenant_id = ?
                   AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
                   AND ticket_id = ?
                   AND sale_at = ?`,
                [ticketBarcode, printedTicketBarcode, vendorName, deviceId, tenantId, branchId, branchId, ticketId, saleAt]
            );

            const lines = Array.isArray(ticket?.lines) ? ticket.lines : [];
            if (lines.length > 0) {
                await pool.query(
                    `DELETE FROM scale_bridge_sales_item
                     WHERE device_id = ?
                       AND tenant_id = ?
                       AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
                       AND ticket_id = ?
                       AND sale_at = ?
                       AND line_no > ?`,
                    [deviceId, tenantId, branchId, branchId, ticketId, saleAt, lines.length]
                );
            }
            for (const line of lines) {
                const lineNo = Number.parseInt(line?.lineNo, 10);
                if (!Number.isFinite(lineNo)) continue;
                const plu = String(line?.plu || '').slice(0, 16);
                const sector = String(line?.sector || '').slice(0, 8);
                const units = Number.parseInt(line?.units, 10) || 0;
                const grams = Number.parseInt(line?.grams, 10) || 0;
                const drainedGrams = Number.parseInt(line?.drainedGrams, 10) || 0;
                const amount = Number(line?.amount) || 0;
                const itemQuantity = Number(line?.itemQuantity) || 0;
                const itemQuantityUnit = String(line?.itemQuantityUnit || 'un').slice(0, 8);
                const lineSaleAt = line?.saleAt ? new Date(line.saleAt) : saleAt;
                const rawPayload = line?.rawPayload != null ? JSON.stringify(line.rawPayload) : null;
                const lineVendorCode = line?.vendorCode != null ? String(line.vendorCode).slice(0, 8) : (vendorCode || '');
                const lineVendorName = line?.vendorName ? String(line.vendorName).slice(0, 100) : vendorName;

                await pool.query(
                    `INSERT INTO scale_bridge_sales_item
                        (device_id, tenant_id, branch_id, ticket_id, ticket_barcode, printed_ticket_barcode,
                         line_no, sale_at, vendor_code, vendor_name, plu_code, sector_code,
                         units, grams, drained_grams, amount,
                         ticket_total_amount, ticket_item_count, item_quantity, item_quantity_unit,
                         raw_payload, synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                        ticket_barcode         = VALUES(ticket_barcode),
                        printed_ticket_barcode = VALUES(printed_ticket_barcode),
                        sale_at                = VALUES(sale_at),
                        vendor_code            = VALUES(vendor_code),
                        vendor_name            = VALUES(vendor_name),
                        plu_code               = VALUES(plu_code),
                        sector_code            = VALUES(sector_code),
                        units                  = VALUES(units),
                        grams                  = VALUES(grams),
                        drained_grams          = VALUES(drained_grams),
                        amount                 = VALUES(amount),
                        ticket_total_amount    = VALUES(ticket_total_amount),
                        ticket_item_count      = VALUES(ticket_item_count),
                        item_quantity          = VALUES(item_quantity),
                        item_quantity_unit     = VALUES(item_quantity_unit),
                        raw_payload            = VALUES(raw_payload),
                        synced_at              = VALUES(synced_at)`,
                    [
                        deviceId, tenantId, branchId, ticketId, ticketBarcode, printedTicketBarcode,
                        lineNo, lineSaleAt, lineVendorCode, lineVendorName, plu, sector,
                        units, grams, drainedGrams, amount,
                        totalAmount, itemCount, itemQuantity, itemQuantityUnit,
                        rawPayload,
                    ]
                );
                itemsUpserted += 1;
            }
            const ticketItemsPersistedAt = Date.now();
            appendScaleLatencyLog('bridge_ticket_persist_done', {
                tenantId,
                branchId,
                deviceId,
                ticketId,
                ticketBarcode,
                printedTicketBarcode,
                saleAt: toIsoSafe(saleAt),
                saleToBridgeReceiveMs: diffMs(saleAt, bridgeRequestStartedAt),
                saleToDbHeaderMs: diffMs(saleAt, ticketHeaderPersistedAt),
                saleToDbItemsMs: diffMs(saleAt, ticketItemsPersistedAt),
                headerPersistMs: ticketHeaderPersistedAt - ticketPersistStartedAt,
                itemsPersistMs: ticketItemsPersistedAt - ticketHeaderPersistedAt,
                totalPersistMs: ticketItemsPersistedAt - ticketPersistStartedAt,
                lineCount: lines.length,
                totalAmount,
                itemCount,
            });

            // Archivo permanente para la solapa "Detalle de Ventas". El ticket cuenta
            // como confirmado (ticketsUpserted) SOLO si quedo archivado aca: asi, si no
            // pudimos guardar el registro historico, el bridge NO vacia la balanza y el
            // ticket sigue disponible para el proximo pulso (no se pierde nada).
            try {
                await storeScaleSalesLog(pool, {
                    tenantId, branchId, deviceId, scaleAddress: effectiveScaleAddress,
                    ticketId, ticketBarcode, printedTicketBarcode,
                    vendorCode, vendorName, saleAt, totalAmount, itemCount,
                });
                ticketsUpserted += 1;
            } catch (logErr) {
                appendScaleLatencyLog('sales_log_archive_error', {
                    tenantId, branchId, deviceId, ticketId, ticketBarcode,
                    error: logErr?.message || String(logErr),
                });
            }
        }

        const normalizationStartedAt = Date.now();
        await runBridgeSalesNormalization({ pool, deviceId, tenantId, branchId });
        const finishedAt = Date.now();

        appendScaleLatencyLog('bridge_sales_done', {
            tenantId,
            branchId,
            deviceId,
            ticketsUpserted,
            itemsUpserted,
            normalizationMs: finishedAt - normalizationStartedAt,
            totalElapsedMs: finishedAt - bridgeRequestStartedAt,
        });

        return res.json({ ok: true, ticketsUpserted, itemsUpserted });
    } catch (error) {
        appendScaleLatencyLog('bridge_sales_error', {
            totalElapsedMs: Date.now() - bridgeRequestStartedAt,
            error: error?.message || String(error),
        });
        const statusCode = error?.statusCode || 500;
        if (statusCode >= 500) console.error('[BRIDGE SALES ERROR]', error?.message || error);
        return res.status(statusCode).json({ error: error?.message || 'No se pudieron persistir las ventas' });
    }
});

app.post('/api/bridge/heartbeat', verifyBridgeDeviceToken, async (req, res) => {
    try {
        // El middleware ya actualizó lastSeenAt. Aceptamos info de balanzas para
        // forward-compat (próxima fase: persistir un registro por balanza).
        const scales = Array.isArray(req.body?.scales) ? req.body.scales.length : 0;

        // Estado del agente (monitor): bridges viejos no lo mandan -> opcional.
        const agent = req.body?.agent;
        if (agent && typeof agent === 'object') {
            const toMysqlDatetime = (iso) => {
                if (!iso) return null;
                const d = new Date(iso);
                return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
            };
            clientsControlPool
                .query(
                    `UPDATE \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
                     SET app_version = ?, last_run_status = ?, last_ticket_sync_at = ?,
                         scale_reachable = ?, last_error = ?, recent_e3_count = ?, agent_reported_at = NOW()
                     WHERE id = ?`,
                    [
                        agent.version ? String(agent.version).slice(0, 20) : null,
                        agent.lastRunStatus ? String(agent.lastRunStatus).slice(0, 16) : null,
                        toMysqlDatetime(agent.lastTicketSyncAt),
                        agent.scaleReachable == null ? null : (agent.scaleReachable ? 1 : 0),
                        agent.lastError ? String(agent.lastError).slice(0, 255) : null,
                        Number.isFinite(Number(agent.recentE3Count)) ? Number(agent.recentE3Count) : null,
                        req.bridge.id,
                    ]
                )
                .catch((e) => console.warn('[HEARTBEAT] No se pudo persistir estado del agente:', e?.message || e));
        }

        const pool = getOperationalPool();
        // Comandos de control remoto sistema -> bridge. Cada uno es un seq en
        // settings; el bridge ejecuta cuando ve un seq mayor al que persistio.
        const commandKeys = [
            SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY,
            SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY,
            'scale_bridge_restart_seq',
            'scale_bridge_restart_app_seq',
            'scale_bridge_apply_update_seq',
        ];
        const [rows] = await pool.query(
            'SELECT `key`, value FROM settings WHERE `tenant_id` = ? AND `key` IN (?, ?, ?, ?, ?)',
            [req.bridge.tenantId, ...commandKeys]
        );
        const byKey = Object.fromEntries(rows.map((r) => [String(r.key), Number(r.value || 0) || 0]));
        const commands = [];
        if (byKey[SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY] > 0) commands.push({ type: 'sync_products', seq: byKey[SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY] });
        if (byKey[SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY] > 0) commands.push({ type: 'clear_sales_memory', seq: byKey[SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY] });
        if (byKey.scale_bridge_restart_seq > 0) commands.push({ type: 'restart_bridge', seq: byKey.scale_bridge_restart_seq });
        if (byKey.scale_bridge_restart_app_seq > 0) commands.push({ type: 'restart_app', seq: byKey.scale_bridge_restart_app_seq });
        if (byKey.scale_bridge_apply_update_seq > 0) commands.push({ type: 'apply_update', seq: byKey.scale_bridge_apply_update_seq });

        return res.json({ ok: true, scales, lastSeenAt: new Date().toISOString(), commands });
    } catch (error) {
        console.error('[BRIDGE HEARTBEAT ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudo procesar heartbeat del bridge' });
    }
});

// Encola un comando de control remoto para el bridge del tenant (lo levanta
// por heartbeat en <=5s). Tipos: restart (reinicia el proceso que habla con la
// balanza), restart_app (reinicia la app desktop completa), apply_update
// (busca la ultima release y la instala+relanza automaticamente).
// Estado del bridge del tenant del usuario (tarjeta en Config Balanza).
app.get('/api/scale/bridge/status', verifyFirebaseToken, async (req, res) => {
    try {
        const { tenantId } = await getTenantInfo(req.firebaseUser);
        const [devices] = await clientsControlPool.query(
            `SELECT id, tenantId, clientId, branchId, deviceId, hostname, status, lastSeenAt,
                    app_version, last_run_status, last_ticket_sync_at, scale_reachable,
                    last_error, recent_e3_count, agent_reported_at
             FROM \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
             WHERE tenantId = ? AND UPPER(status) = 'ACTIVE'
             ORDER BY lastSeenAt DESC`,
            [tenantId]
        );
        const latestVersion = await getLatestBridgeVersion();
        const now = Date.now();
        const bridges = devices.map((d) => ({
            deviceId: d.deviceId,
            hostname: d.hostname || null,
            branchId: d.branchId,
            ...computeBridgeHealth(d, latestVersion, now),
        }));
        return res.json({ ok: true, latestVersion, bridges });
    } catch (error) {
        console.error('[BRIDGE STATUS ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudo obtener el estado del bridge' });
    }
});

// Panel global de soporte (DEF Software): todos los bridges de todos los tenants.
app.get('/api/admin/bridges', verifyFirebaseToken, async (req, res) => {
    try {
        const [devices] = await clientsControlPool.query(
            `SELECT id, tenantId, clientId, branchId, deviceId, hostname, status, lastSeenAt,
                    app_version, last_run_status, last_ticket_sync_at, scale_reachable,
                    last_error, recent_e3_count, agent_reported_at
             FROM \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\`
             ORDER BY lastSeenAt DESC`
        );
        const latestVersion = await getLatestBridgeVersion();
        const now = Date.now();
        const order = { warn: 0, down: 1, unknown: 2, ok: 3 };
        const bridges = devices
            .map((d) => ({
                deviceId: d.deviceId,
                hostname: d.hostname || null,
                clientId: d.clientId,
                branchId: d.branchId,
                status_active: String(d.status || '').toUpperCase() === 'ACTIVE',
                ...computeBridgeHealth(d, latestVersion, now),
            }))
            .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        return res.json({ ok: true, latestVersion, count: bridges.length, bridges });
    } catch (error) {
        console.error('[ADMIN BRIDGES ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudo obtener el listado de bridges' });
    }
});

app.post('/api/scale/bridge/command', verifyFirebaseToken, async (req, res) => {
    try {
        const type = String(req.body?.type || '').trim().toLowerCase();
        const keyByType = {
            restart: 'scale_bridge_restart_seq',
            restart_app: 'scale_bridge_restart_app_seq',
            apply_update: 'scale_bridge_apply_update_seq',
            sync_products: SCALE_BRIDGE_PRODUCT_SYNC_SEQ_KEY,
            clear_sales_memory: SCALE_BRIDGE_CLEAR_SALES_SEQ_KEY,
        };
        const key = keyByType[type];
        if (!key) return res.status(400).json({ error: `Tipo de comando invalido: ${type}` });

        const { tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getOperationalPool();
        const seq = Date.now();
        await pool.query(
            'INSERT INTO settings (`tenant_id`, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
            [tenantId, key, String(seq)]
        );
        return res.json({ ok: true, type, seq, note: 'El bridge lo ejecuta en el proximo heartbeat (<=5s)' });
    } catch (error) {
        console.error('[BRIDGE COMMAND ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudo encolar el comando' });
    }
});

app.get('/api/bridge/vendors', verifyBridgeDeviceToken, async (req, res) => {
    try {
        const pool = getOperationalPool();
        const [rows] = await pool.query(
            `SELECT id, slot_no, display_name, active
             FROM scale_users
             WHERE \`${TENANT_COLUMN}\` = ?
               AND branch_id <=> ?
               AND COALESCE(active, 1) = 1
             ORDER BY slot_no ASC, id ASC
             LIMIT 4`,
            [req.bridge.tenantId, req.bridge.branchId || null]
        );
        const bySlot = [];
        for (let slot = 1; slot <= 4; slot += 1) {
            const row = rows.find((entry) => Number(entry.slot_no) === slot) || null;
            bySlot.push({
                slot,
                id: row ? Number(row.id) : null,
                displayName: row ? String(row.display_name || '').trim() : `VENDEDOR ${slot}`,
            });
        }
        return res.json({ vendors: bySlot });
    } catch (error) {
        console.error('[BRIDGE VENDORS ERROR]', error?.message || error);
        return res.status(500).json({ error: 'No se pudieron leer los vendedores' });
    }
});

// ── RUTA: POST /api/conciliacion/balanza/cobro-manual ────────────────────
app.post('/api/conciliacion/balanza/cobro-manual', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        conn = await pool.getConnection();
        await ensureScaleTicketLifecycleColumns(conn);

        const { ticket_barcode, payment_method_id, payment_method_name, notes } = req.body;
        if (!ticket_barcode) return res.status(400).json({ error: 'ticket_barcode es requerido' });
        const barcode = String(ticket_barcode).trim().toUpperCase();

        // Verificar que el ticket existe y está open
        const [[ticket]] = await conn.query(
            `SELECT * FROM scale_bridge_ticket_map WHERE tenant_id = ? AND UPPER(ticket_barcode) = ? LIMIT 1`,
            [tenantId, barcode]
        );
        if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
        if (String(ticket.ticket_status || '').toLowerCase() !== 'open') {
            return res.status(409).json({ error: `El ticket ya fue procesado (estado: ${ticket.ticket_status})` });
        }

        // Obtener items
        const [items] = await conn.query(
            `SELECT i.*, p.name AS product_name, p.id AS product_db_id
             FROM scale_bridge_sales_item i
             LEFT JOIN products p ON p.tenant_id = ? AND CAST(p.plu AS CHAR) = CAST(i.plu_code AS CHAR) AND p.inactive != 1
             WHERE i.tenant_id = ? AND UPPER(i.ticket_barcode) = ?
             ORDER BY i.line_no`,
            [tenantId, tenantId, barcode]
        );

        // Resolver método de pago
        let pmId = payment_method_id ? Number(payment_method_id) : null;
        let pmName = payment_method_name || 'Efectivo';
        if (pmId) {
            const [[pm]] = await conn.query(
                `SELECT id, name FROM payment_methods WHERE tenant_id = ? AND id = ? LIMIT 1`,
                [tenantId, pmId]
            );
            if (pm) pmName = pm.name;
        }

        const total = Number(ticket.total_amount || 0);
        // La venta y la caja se fechan con la fecha REAL del ticket (sale_at), no
        // con la de hoy, y se imputan a la sucursal del ticket. Asi conciliar un
        // ticket viejo impacta en la caja del dia que corresponde.
        const saleDate = ticket.sale_at ? new Date(ticket.sale_at) : new Date();
        const branchId = ticket.branch_id || null;

        await conn.beginTransaction();
        try {
            // Insertar venta con la fecha del ticket y su sucursal.
            // Guardamos tambien el desglose de pago (un solo medio) para que las
            // pantallas de "como se pago" no salgan vacias: antes cobro-manual solo
            // guardaba payment_method y el detalle que lee payment_breakdown no mostraba nada.
            const paymentBreakdown = [{
                method_name: pmName,
                method_type: inferPaymentTypeByName(pmName),
                amount_charged: total,
            }];
            const [ventaResult] = await conn.query(
                `INSERT INTO ventas (tenant_id, branch_id, date, subtotal, total, payment_method, payment_method_id, payment_breakdown, source, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'conciliacion_manual', NOW())`,
                [tenantId, branchId, saleDate, total, total, pmName, pmId || null, JSON.stringify(paymentBreakdown)]
            );
            const saleId = ventaResult.insertId;

            // Insertar items
            if (items.length > 0) {
                const itemRows = items.map(it => [
                    tenantId,
                    branchId,
                    saleId,
                    it.product_db_id || null,
                    it.product_name || `PLU ${it.plu_code}`,
                    Number(it.item_quantity || 0),
                    Number(it.item_quantity) > 0 ? Number((Number(it.amount) / Number(it.item_quantity)).toFixed(2)) : 0,
                    Number(it.amount || 0),
                ]);
                await conn.query(
                    `INSERT INTO ventas_items (tenant_id, branch_id, venta_id, product_id, product_name, quantity, price, subtotal) VALUES ?`,
                    [itemRows]
                );
            }

            // Registrar ingreso en caja del DIA DEL TICKET (cuenta corriente no toca caja)
            const cajaParts = buildCajaPartsFromSale({
                paymentMethod: pmName,
                paymentMethodType: null,
                paymentBreakdown: null,
                totalAmount: total,
            });
            for (const part of cajaParts) {
                await conn.query(
                    `INSERT INTO caja_movimientos
                     (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, branch_id, sale_id, money_flow_kind, origin_table, origin_id, origin_group_id)
                     VALUES (?, 'venta', ?, 'Venta', ?, ?, ?, 'principal', ?, ?, ?, 'sale_collection', 'ventas', ?, CONCAT('sale_', ?))`,
                    [
                        tenantId,
                        parseFloat(part.amount) || 0,
                        `Cobro conciliación ticket ${ticket.printed_ticket_barcode || barcode}`,
                        part.methodName,
                        part.methodType || inferPaymentTypeByName(part.methodName),
                        saleDate,
                        branchId,
                        saleId,
                        saleId,
                        saleId,
                    ]
                );
            }

            // Marcar ticket como cobrado
            await conn.query(
                `UPDATE scale_bridge_ticket_map
                 SET ticket_status = 'charged', charged_sale_id = ?, charged_at = NOW()
                 WHERE tenant_id = ? AND UPPER(ticket_barcode) = ?`,
                [saleId, tenantId, barcode]
            );

            await conn.commit();
            return res.json({ sale_id: saleId, total });
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        }
    } catch (err) {
        console.error('[POST /api/conciliacion/balanza/cobro-manual ERROR]', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// ── RUTA: GET /api/informes/kilos ────────────────────────────────────────
// Kilos por dia y sucursal, en dos series para comparar:
//  - pesado: TODO lo que paso por la balanza (de las tablas del bridge),
//    salga o no el ticket / se haya cobrado o no.
//  - cobrado: kilos de ventas registradas (ventas_items), solo items por peso.
// La diferencia (pesado - cobrado) deja ver lo que se peso pero no se cobro.
app.get('/api/informes/kilos', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        conn = await pool.getConnection();

        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: 'from y to requeridos en formato YYYY-MM-DD' });
        }
        const fromDt = `${from} 00:00:00`;
        const toDt = `${to} 23:59:59`;

        const [pesado] = await conn.query(
            `SELECT DATE(m.sale_at) AS dia, m.branch_id AS branch_id,
                    ROUND(SUM(CASE WHEN s.item_quantity_unit = 'kg' THEN s.item_quantity ELSE 0 END), 3) AS kg
             FROM scale_bridge_ticket_map m
             JOIN scale_bridge_sales_item s
               ON s.tenant_id = m.tenant_id AND UPPER(s.ticket_barcode) = UPPER(m.ticket_barcode)
             WHERE m.tenant_id = ? AND m.sale_at BETWEEN ? AND ?
             GROUP BY DATE(m.sale_at), m.branch_id`,
            [tenantId, fromDt, toDt]
        );

        const [cobrado] = await conn.query(
            `SELECT DATE(v.date) AS dia, v.branch_id AS branch_id,
                    ROUND(SUM(CASE WHEN COALESCE(p.unit, 'kg') = 'kg' THEN vi.quantity ELSE 0 END), 3) AS kg
             FROM ventas v
             JOIN ventas_items vi ON vi.tenant_id = v.tenant_id AND vi.venta_id = v.id
             LEFT JOIN products p ON p.tenant_id = v.tenant_id AND p.id = vi.product_id
             WHERE v.tenant_id = ? AND v.date BETWEEN ? AND ?
             GROUP BY DATE(v.date), v.branch_id`,
            [tenantId, fromDt, toDt]
        );

        const norm = (rows) => (Array.isArray(rows) ? rows : []).map((r) => ({
            dia: r.dia instanceof Date
                ? `${r.dia.getFullYear()}-${String(r.dia.getMonth() + 1).padStart(2, '0')}-${String(r.dia.getDate()).padStart(2, '0')}`
                : String(r.dia),
            branch_id: r.branch_id == null ? null : Number(r.branch_id),
            kg: Number(r.kg || 0),
        }));

        return res.json({ from, to, pesado: norm(pesado), cobrado: norm(cobrado) });
    } catch (err) {
        console.error('[GET /api/informes/kilos ERROR]', err.message);
        return res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// ── RUTA: GET /api/informes/descuentos ───────────────────────────────────
// Descuentos de empleado otorgados en ventas, por dia y por empleado.
// La balanza suma SIN descuento (bruto = SUM(subtotal)); la caja cobra el
// neto (SUM(total)). La diferencia entre ambos es, exactamente, la suma de
// los descuentos (SUM(client_discount_amount)). Esto le permite al comercio
// cuadrar el control contra la balanza sin cazar la diferencia ticket por
// ticket: bruto = neto + descuento.
app.get('/api/informes/descuentos', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }
        conn = await pool.getConnection();

        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            return res.status(400).json({ error: 'from y to requeridos en formato YYYY-MM-DD' });
        }
        const fromDt = `${from} 00:00:00`;
        const toDt = `${to} 23:59:59`;

        // Scope por sucursal: sin este filtro el informe mezclaba los descuentos
        // de TODAS las sucursales del tenant (p. ej. Fatima veía los de Pilar).
        // Usamos la sucursal activa que manda el front (X-MM-Active-Branch-Id) o
        // la asignada al usuario. Soporte/admin interno (sin accessContext) ve todo.
        let branchFilter = '';
        const branchParams = [];
        const scopedBranchId = Number(
            accessContext?.activeBranch?.id
            ?? accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
        );
        if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
            branchFilter = ' AND v.branch_id = ?';
            branchParams.push(scopedBranchId);
        }

        // Solo ventas con descuento efectivamente aplicado Y que hayan sido a
        // cuenta corriente (fiado). Cuenta corriente = payment_method
        // 'Cuenta Corriente', o pago mixto cuyo payment_breakdown incluye una
        // parte de cuenta corriente (method_type/method_name).
        const whereDto = `v.tenant_id = ? AND v.date BETWEEN ? AND ?${branchFilter}
              AND v.client_discount_amount > 0
              AND (
                  LOWER(TRIM(COALESCE(v.payment_method, ''))) = 'cuenta corriente'
                  OR LOWER(COALESCE(v.payment_breakdown, '')) LIKE '%cuenta_corriente%'
                  OR LOWER(COALESCE(v.payment_breakdown, '')) LIKE '%cuenta corriente%'
              )`;
        const whereParams = [tenantId, fromDt, toDt, ...branchParams];

        const [porDia] = await conn.query(
            `SELECT DATE(v.date) AS dia,
                    COUNT(*) AS tickets,
                    ROUND(SUM(v.subtotal), 2) AS bruto,
                    ROUND(SUM(v.client_discount_amount), 2) AS descuento,
                    ROUND(SUM(v.total), 2) AS neto
             FROM ventas v
             WHERE ${whereDto}
             GROUP BY DATE(v.date)`,
            whereParams
        );

        const [porEmpleado] = await conn.query(
            `SELECT v.discount_client_id AS empleado_id,
                    c.name AS empleado,
                    COUNT(*) AS tickets,
                    ROUND(SUM(v.subtotal), 2) AS bruto,
                    ROUND(SUM(v.client_discount_amount), 2) AS descuento,
                    ROUND(SUM(v.total), 2) AS neto
             FROM ventas v
             LEFT JOIN clients c ON c.tenant_id = v.tenant_id AND c.id = v.discount_client_id
             WHERE ${whereDto}
             GROUP BY v.discount_client_id, c.name`,
            whereParams
        );

        const [[totalRow]] = await conn.query(
            `SELECT COUNT(*) AS tickets,
                    ROUND(SUM(v.subtotal), 2) AS bruto,
                    ROUND(SUM(v.client_discount_amount), 2) AS descuento,
                    ROUND(SUM(v.total), 2) AS neto
             FROM ventas v
             WHERE ${whereDto}`,
            whereParams
        );

        const normDia = (rows) => (Array.isArray(rows) ? rows : []).map((r) => ({
            dia: r.dia instanceof Date
                ? `${r.dia.getFullYear()}-${String(r.dia.getMonth() + 1).padStart(2, '0')}-${String(r.dia.getDate()).padStart(2, '0')}`
                : String(r.dia),
            tickets: Number(r.tickets || 0),
            bruto: Number(r.bruto || 0),
            descuento: Number(r.descuento || 0),
            neto: Number(r.neto || 0),
        }));
        const normEmpleado = (rows) => (Array.isArray(rows) ? rows : []).map((r) => ({
            empleado_id: r.empleado_id == null ? null : Number(r.empleado_id),
            empleado: r.empleado || 'Sin asignar',
            tickets: Number(r.tickets || 0),
            bruto: Number(r.bruto || 0),
            descuento: Number(r.descuento || 0),
            neto: Number(r.neto || 0),
        }));

        return res.json({
            from,
            to,
            porDia: normDia(porDia),
            porEmpleado: normEmpleado(porEmpleado),
            total: {
                tickets: Number(totalRow?.tickets || 0),
                bruto: Number(totalRow?.bruto || 0),
                descuento: Number(totalRow?.descuento || 0),
                neto: Number(totalRow?.neto || 0),
            },
        });
    } catch (err) {
        console.error('[GET /api/informes/descuentos ERROR]', err.message);
        return res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// ── RUTA: GET /api/informes/cortes-ranking ───────────────────────────────
// Ranking de cortes vendidos por especie (vaca/cerdo/pollo). Top 10 por especie.
// Se muestra como solapa dentro de "Kilos Vendidos".
app.get('/api/informes/cortes-ranking', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }
        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({ pool, tenantId, accessContext, record: { branch_id: req.query.branch_id } })
            : null;

        // Filtro por año, mes y día
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month);
        const day = parseInt(req.query.day);
        let startDate, endDate;
        if (Number.isFinite(month) && month >= 1 && month <= 12) {
            if (Number.isFinite(day) && day >= 1 && day <= 31) {
                // Filtrar por día específico
                startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const d = new Date(year, month - 1, day + 1);
                endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } else {
                // Filtrar por mes completo
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                const nextMonth = month === 12 ? 1 : month + 1;
                const nextYear = month === 12 ? year + 1 : year;
                endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            }
        } else {
            // Filtrar por año completo
            startDate = `${year}-01-01`;
            endDate = `${year + 1}-01-01`;
        }

        const saleDate = 'COALESCE(v.date, v.created_at)';
        const where = ['vi.tenant_id = ?', `${saleDate} >= ?`, `${saleDate} < ?`];
        const params = [tenantId, startDate, endDate];

        if (Number.isFinite(resolvedBranchId) && resolvedBranchId > 0) {
            where.push('v.branch_id = ?');
            params.push(resolvedBranchId);
        }

        const [rows] = await pool.query(`
            SELECT
                pc.code AS especie,
                pc.name AS especie_nombre,
                vi.product_name AS corte,
                ROUND(SUM(vi.quantity), 2) AS total_kg,
                ROUND(SUM(vi.subtotal), 2) AS total_vendido,
                COUNT(DISTINCT vi.venta_id) AS veces_vendido
            FROM ventas_items vi
            JOIN ventas v ON v.tenant_id = vi.tenant_id AND v.id = vi.venta_id
            JOIN products p ON p.tenant_id = vi.tenant_id AND p.id = vi.product_id
            JOIN product_categories pc ON pc.tenant_id = p.tenant_id AND pc.id = p.category_id
            WHERE ${where.join(' AND ')}
              AND pc.code IN ('vaca', 'cerdo', 'pollo')
            GROUP BY pc.code, pc.name, vi.product_name
            ORDER BY pc.code, total_kg DESC
        `, params);

        // Armar estructura: ranking general de especies + top 10 por especie
        const rankingEspecies = [];
        const rankingCortes = { vaca: [], cerdo: [], pollo: [] };
        const acum = {};
        for (const r of rows) {
            const kg = Number(r.total_kg) || 0;
            const vendido = Number(r.total_vendido) || 0;
            if (!acum[r.especie]) acum[r.especie] = { code: r.especie, nombre: r.especie_nombre, total_kg: 0, total_vendido: 0 };
            acum[r.especie].total_kg += kg;
            acum[r.especie].total_vendido += vendido;
            if (rankingCortes[r.especie] && rankingCortes[r.especie].length < 10) {
                rankingCortes[r.especie].push({
                    corte: r.corte,
                    total_kg: kg,
                    total_vendido: vendido,
                    veces_vendido: Number(r.veces_vendido) || 0,
                });
            }
        }
        for (const key of ['vaca', 'cerdo', 'pollo']) {
            if (acum[key]) rankingEspecies.push(acum[key]);
        }
        rankingEspecies.sort((a, b) => b.total_kg - a.total_kg);

        const totalGeneral = rankingEspecies.reduce((s, e) => s + Number(e.total_kg) || 0, 0);

        res.json({
            year,
            month: Number.isFinite(month) ? month : null,
            day: Number.isFinite(day) ? day : null,
            rankingEspecies,
            rankingCortes,
            totalGeneral,
        });
    } catch (err) {
        console.error('[CORTES-RANKING ERROR]', err.message);
        res.status(500).json({ error: err.message || 'Error al obtener ranking de cortes' });
    }
});

// ── RUTA: POST /api/conciliacion/balanza/anular ──────────────────────────
// Anula tickets de balanza PENDIENTES (estado 'open') que nunca se cobraron.
// No mueve plata ni stock — el ticket nunca generó venta. Solo cambia el estado
// a 'voided' para que desaparezca del listado de pendientes y quede registrado.
app.post('/api/conciliacion/balanza/anular', verifyFirebaseToken, async (req, res) => {
    let conn;
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        conn = await pool.getConnection();
        await ensureScaleTicketLifecycleColumns(conn);

        const { ticket_barcode, ticket_barcodes, anulado_by_user_id, anulado_by_username, reason } = req.body;
        const rawList = Array.isArray(ticket_barcodes) && ticket_barcodes.length > 0
            ? ticket_barcodes
            : (ticket_barcode ? [ticket_barcode] : []);
        const barcodes = [...new Set(rawList.map(b => String(b).trim().toUpperCase()).filter(Boolean))];
        if (barcodes.length === 0) {
            return res.status(400).json({ error: 'ticket_barcode(s) es requerido' });
        }

        const userIdParsed = Number.parseInt(anulado_by_user_id, 10);
        const voidedByUserId = Number.isFinite(userIdParsed) && userIdParsed > 0 ? userIdParsed : null;
        const voidedByUsername = (anulado_by_username && String(anulado_by_username).trim()) || 'Sistema';
        const voidedReason = (reason && String(reason).trim()) ? String(reason).trim().slice(0, 255) : null;

        const anulados = [];
        const skipped = [];

        await conn.beginTransaction();
        try {
            for (const barcode of barcodes) {
                const [[ticket]] = await conn.query(
                    `SELECT ticket_status, charged_sale_id FROM scale_bridge_ticket_map
                     WHERE tenant_id = ? AND UPPER(ticket_barcode) = ? LIMIT 1`,
                    [tenantId, barcode]
                );
                if (!ticket) {
                    skipped.push({ ticket_barcode: barcode, reason: 'no_encontrado' });
                    continue;
                }
                const st = String(ticket.ticket_status || '').toLowerCase();

                if (st === 'voided') {
                    skipped.push({ ticket_barcode: barcode, reason: 'ya_anulado' });
                    continue;
                }

                // Ticket YA cobrado: anular = revertir la venta por el camino auditado
                // (caja, stock, saldo, historial). Antes esta ruta lo salteaba en silencio
                // y el ticket quedaba figurando "cobrado" pese a estar anulado.
                if (st === 'charged') {
                    const chargedSaleId = ticket.charged_sale_id ? Number(ticket.charged_sale_id) : null;
                    if (chargedSaleId) {
                        const [[venta]] = await conn.query(
                            `SELECT * FROM ventas WHERE tenant_id = ? AND id = ? LIMIT 1`,
                            [tenantId, chargedSaleId]
                        );
                        if (venta) {
                            const [saleItems] = await conn.query(
                                `SELECT * FROM ventas_items WHERE tenant_id = ? AND venta_id = ?`,
                                [tenantId, chargedSaleId]
                            );
                            await reverseSaleTx(conn, {
                                tenantId, saleId: chargedSaleId, venta, items: saleItems,
                                ticketBarcode: barcode,
                                deletedBy: voidedByUserId, deletedByUsername: voidedByUsername,
                            });
                            anulados.push(barcode);
                            continue;
                        }
                    }
                    // charged_sale_id colgado (la venta ya no existe): no hay plata que revertir,
                    // solo limpiamos el cobro fantasma y marcamos el ticket como anulado.
                    await conn.query(
                        `UPDATE scale_bridge_ticket_map
                         SET ticket_status = 'voided',
                             voided_at = NOW(),
                             voided_by_user_id = ?,
                             voided_by_username = ?,
                             voided_reason = ?,
                             charged_sale_id = NULL,
                             charged_at = NULL
                         WHERE tenant_id = ? AND UPPER(ticket_barcode) = ?`,
                        [voidedByUserId, voidedByUsername, voidedReason, tenantId, barcode]
                    );
                    anulados.push(barcode);
                    continue;
                }

                // Ticket pendiente (open): anulación simple, no mueve plata ni stock.
                await conn.query(
                    `UPDATE scale_bridge_ticket_map
                     SET ticket_status = 'voided',
                         voided_at = NOW(),
                         voided_by_user_id = ?,
                         voided_by_username = ?,
                         voided_reason = ?
                     WHERE tenant_id = ? AND UPPER(ticket_barcode) = ? AND ticket_status = 'open'`,
                    [voidedByUserId, voidedByUsername, voidedReason, tenantId, barcode]
                );
                anulados.push(barcode);
            }
            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        }

        return res.json({ anulados, skipped });
    } catch (err) {
        console.error('[POST /api/conciliacion/balanza/anular ERROR]', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// ── RUTA: GET /api/conciliacion/balanza ───────────────────────────────────
app.get('/api/conciliacion/balanza', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }
        const conn = await pool.getConnection();
        try { await ensureScaleTicketLifecycleColumns(conn); } finally { conn.release(); }

        const { dateFrom, dateTo } = req.query;
        const params = [tenantId];

        // Scope por sucursal: cada balanza/bridge sube sus tickets con su branch_id
        // (ver ingesta del bridge). Sin este filtro, el listado mezclaba los tickets
        // y vendedores de TODAS las sucursales del tenant. Usamos la sucursal activa
        // que el front manda (X-MM-Active-Branch-Id) o la sucursal asignada al usuario.
        // Soporte/admin interno (sin accessContext) ve todo, para debug.
        let branchFilter = '';
        const scopedBranchId = Number(
            accessContext?.activeBranch?.id
            ?? accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
        );
        if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
            branchFilter = ' AND t.branch_id = ?';
            params.push(scopedBranchId);
        }

        let dateFilter = '';
        if (dateFrom && dateTo) {
            dateFilter = ' AND DATE(t.sale_at) BETWEEN ? AND ?';
            params.push(dateFrom, dateTo);
        } else if (dateFrom) {
            dateFilter = ' AND DATE(t.sale_at) >= ?';
            params.push(dateFrom);
        } else if (dateTo) {
            dateFilter = ' AND DATE(t.sale_at) <= ?';
            params.push(dateTo);
        }

        const [tickets] = await pool.query(`
            SELECT
                t.id,
                t.ticket_barcode,
                t.printed_ticket_barcode,
                t.vendor_code,
                t.vendor_name,
                t.sale_at,
                t.total_amount,
                t.item_count,
                t.ticket_status,
                t.scale_address,
                t.synced_at
            FROM scale_bridge_ticket_map t
            WHERE t.tenant_id = ?
              AND t.ticket_status = 'open'${branchFilter}
              -- Excluir tickets que ya tienen una venta vinculada (cobrados, incluso
              -- offline). Un ticket nunca vendido no tiene venta asociada.
              AND NOT EXISTS (
                  SELECT 1 FROM ventas v
                  WHERE v.tenant_id = t.tenant_id
                    AND v.ticket_barcode IS NOT NULL
                    AND (
                        -- Match por codigo interno (MM...): es unico, siempre seguro.
                        UPPER(v.ticket_barcode) = UPPER(t.ticket_barcode)
                        OR (
                            -- Match por codigo IMPRESO (resumen). OJO: el codigo
                            -- impreso NO es unico — solo codifica balanza + importe,
                            -- asi que dos tickets distintos con el mismo total
                            -- comparten codigo impreso. Si solo matcheamos por el
                            -- codigo, una venta vieja con el mismo total esconde un
                            -- ticket nuevo que nunca se cobro (bug de conciliacion:
                            -- "no aparecen tickets"). Por eso, ademas del codigo,
                            -- exigimos mismo importe y fecha cercana: la venta offline
                            -- se registra el mismo dia de la venta fisica.
                            t.printed_ticket_barcode IS NOT NULL
                            AND UPPER(v.ticket_barcode) = UPPER(t.printed_ticket_barcode)
                            AND ABS(COALESCE(v.total, 0) - COALESCE(t.total_amount, 0)) < 0.01
                            AND ABS(DATEDIFF(v.date, t.sale_at)) <= 1
                        )
                    )
              )
              ${dateFilter}
            ORDER BY t.sale_at DESC
        `, params);

        if (tickets.length === 0) return res.json({ tickets: [] });

        const barcodes = tickets.map(t => t.ticket_barcode);
        const [items] = await pool.query(`
            SELECT
                i.ticket_barcode,
                i.line_no,
                i.plu_code,
                i.vendor_name,
                i.grams,
                i.drained_grams,
                i.amount,
                i.item_quantity,
                i.item_quantity_unit,
                i.sale_at,
                COALESCE(
                    (SELECT p.name FROM scale_bridge_product_map m
                     JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
                     WHERE m.tenant_id = i.tenant_id AND m.device_id = i.device_id
                       AND CAST(m.plu_code AS CHAR) = CAST(i.plu_code AS CHAR)
                     LIMIT 1),
                    (SELECT p.name FROM products p
                     WHERE p.tenant_id = i.tenant_id
                       AND (
                           CAST(p.plu AS CHAR) = CAST(i.plu_code AS CHAR)
                           OR CAST(p.plu AS CHAR) = TRIM(LEADING '0' FROM CAST(i.plu_code AS CHAR))
                       )
                     ORDER BY CASE WHEN p.branch_id IS NULL THEN 1 ELSE 0 END, p.id DESC
                     LIMIT 1)
                ) AS product_name
            FROM scale_bridge_sales_item i
            WHERE i.tenant_id = ?
              AND i.ticket_barcode IN (${barcodes.map(() => '?').join(',')})
            ORDER BY i.ticket_barcode, i.line_no
        `, [tenantId, ...barcodes]);

        const itemsByBarcode = {};
        for (const item of items) {
            if (!itemsByBarcode[item.ticket_barcode]) itemsByBarcode[item.ticket_barcode] = [];
            itemsByBarcode[item.ticket_barcode].push(item);
        }
        return res.json({ tickets: tickets.map(t => ({ ...t, items: itemsByBarcode[t.ticket_barcode] || [] })) });
    } catch (err) {
        console.error('[GET /api/conciliacion/balanza ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: GET /api/scale/detalle-ventas ───────────────────────────────────
// Registro PERMANENTE de tickets de balanza (scale_sales_log) para la solapa
// "Detalle de Ventas". A diferencia de la conciliacion (que muestra solo tickets sin
// cobrar), aca se ven TODOS los tickets del dia tal cual salieron de la balanza — es
// para control (la clienta busca tickets que "desaparecen"). Sobrevive al vaciado de
// la balanza (fn32) y a las limpiezas de las tablas operativas del bridge.
app.get('/api/scale/detalle-ventas', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }

        const { dateFrom, dateTo } = req.query;
        const params = [tenantId];

        // Mismo scope por sucursal que la conciliacion: cada balanza sube con su
        // branch_id; sin este filtro se mezclarian los tickets de todas las sucursales.
        let branchFilter = '';
        const scopedBranchId = Number(
            accessContext?.activeBranch?.id
            ?? accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
        );
        if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
            branchFilter = ' AND l.branch_id = ?';
            params.push(scopedBranchId);
        }

        // sale_at guarda la hora local de la balanza (ART), igual que la conciliacion;
        // por eso filtramos por DATE(sale_at) directo, sin conversion de zona horaria.
        let dateFilter = '';
        if (dateFrom && dateTo) {
            dateFilter = ' AND DATE(l.sale_at) BETWEEN ? AND ?';
            params.push(dateFrom, dateTo);
        } else if (dateFrom) {
            dateFilter = ' AND DATE(l.sale_at) >= ?';
            params.push(dateFrom);
        } else if (dateTo) {
            dateFilter = ' AND DATE(l.sale_at) <= ?';
            params.push(dateTo);
        }

        const [rows] = await pool.query(`
            SELECT
                l.id,
                l.ticket_id,
                l.ticket_barcode,
                l.printed_ticket_barcode,
                l.vendor_code,
                l.vendor_name,
                l.sale_at,
                l.total_amount,
                l.item_count,
                l.lines_json,
                l.captured_at,
                t.ticket_status,
                t.charged_sale_id,
                t.voided_sale_id,
                cv.id AS charged_venta_id
            FROM scale_sales_log l
            LEFT JOIN scale_bridge_ticket_map t
                   ON t.device_id = l.device_id
                  AND t.ticket_id = l.ticket_id
                  AND t.sale_at   = l.sale_at
            -- Verifica que la venta del cobro siga existiendo: si se anulo/borro,
            -- charged_sale_id queda colgado y el ticket NO debe figurar "cobrado".
            LEFT JOIN ventas cv
                   ON cv.tenant_id = l.tenant_id
                  AND cv.id = t.charged_sale_id
            WHERE l.tenant_id = ?${branchFilter}${dateFilter}
            ORDER BY l.sale_at DESC, l.id DESC
        `, params);

        const scaleTickets = rows.map((r) => {
            let items = [];
            try {
                items = typeof r.lines_json === 'string' ? JSON.parse(r.lines_json) : (r.lines_json || []);
            } catch {
                items = [];
            }
            // Estado best-effort desde la tabla operativa (puede faltar si se limpio):
            // cobrado / anulado / pendiente. Sirve para el control de la clienta.
            // "cobrado" exige que la venta asociada exista de verdad: un charged_sale_id
            // colgado (venta ya anulada) vuelve a contar como pendiente, no como cobrado.
            const chargedSaleExists = r.charged_venta_id != null;
            let status = 'pendiente';
            if (r.voided_sale_id || r.ticket_status === 'voided') status = 'anulado';
            else if ((r.charged_sale_id || r.ticket_status === 'charged') && chargedSaleExists) status = 'cobrado';

            return {
                id: r.id,
                ticket_id: r.ticket_id,
                ticket_barcode: r.ticket_barcode,
                printed_ticket_barcode: r.printed_ticket_barcode,
                vendor_code: r.vendor_code,
                vendor_name: r.vendor_name,
                sale_at: r.sale_at,
                total_amount: r.total_amount,
                item_count: r.item_count,
                captured_at: r.captured_at,
                status,
                origin: 'balanza',
                items: Array.isArray(items) ? items : [],
            };
        });

        // ── Ventas MANUALES (cargadas a mano, sin ticket de balanza) ──────────
        // El Detalle de Ventas es el control de TODO lo vendido, no solo de la
        // balanza. Las ventas manuales se guardan en `ventas`/`ventas_items` y
        // nunca pasan por `scale_sales_log`, asi que las sumamos aca.
        // Dedup: las ventas originadas en balanza SIEMPRE llevan ticket_barcode
        // (y ya salen arriba desde scale_sales_log); las manuales lo tienen NULL.
        const manualParams = [tenantId];
        let manualBranchFilter = '';
        if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
            manualBranchFilter = ' AND v.branch_id = ?';
            manualParams.push(scopedBranchId);
        }
        let manualDateFilter = '';
        if (dateFrom && dateTo) {
            manualDateFilter = ' AND v.date BETWEEN ? AND ?';
            manualParams.push(`${dateFrom} 00:00:00`, `${dateTo} 23:59:59`);
        } else if (dateFrom) {
            manualDateFilter = ' AND v.date >= ?';
            manualParams.push(`${dateFrom} 00:00:00`);
        } else if (dateTo) {
            manualDateFilter = ' AND v.date <= ?';
            manualParams.push(`${dateTo} 23:59:59`);
        }

        const [ventaRows] = await pool.query(`
            SELECT v.id, v.date, v.total, v.receipt_number, v.receipt_code, v.source
            FROM ventas v
            WHERE v.tenant_id = ?
              AND (v.ticket_barcode IS NULL OR v.ticket_barcode = '')
              ${manualBranchFilter}${manualDateFilter}
            ORDER BY v.date DESC, v.id DESC
        `, manualParams);

        const itemsByVenta = new Map();
        if (ventaRows.length > 0) {
            const ventaIds = ventaRows.map((v) => v.id);
            const inList = ventaIds.map(() => '?').join(',');
            const [itemRows] = await pool.query(`
                SELECT vi.venta_id, vi.product_name, vi.quantity, vi.price, vi.subtotal,
                       p.plu AS product_plu, COALESCE(p.unit, 'un') AS product_unit
                FROM ventas_items vi
                LEFT JOIN products p
                       ON p.tenant_id = vi.tenant_id AND p.id = vi.product_id
                WHERE vi.tenant_id = ? AND vi.venta_id IN (${inList})
                ORDER BY vi.venta_id, vi.id
            `, [tenantId, ...ventaIds]);
            for (const it of itemRows) {
                if (!itemsByVenta.has(it.venta_id)) itemsByVenta.set(it.venta_id, []);
                const arr = itemsByVenta.get(it.venta_id);
                arr.push({
                    lineNo: arr.length + 1,
                    pluCode: it.product_plu || null,
                    productName: it.product_name || null,
                    sectorCode: null,
                    vendorCode: null,
                    vendorName: null,
                    units: null,
                    grams: null,
                    drainedGrams: null,
                    amount: it.subtotal,
                    itemQuantity: it.quantity,
                    itemQuantityUnit: it.product_unit || 'un',
                });
            }
        }

        const manualTickets = ventaRows.map((v) => {
            const items = itemsByVenta.get(v.id) || [];
            return {
                id: `v${v.id}`,               // prefijo para no chocar con los IDs de balanza
                ticket_id: v.receipt_number || v.receipt_code || `Manual #${v.id}`,
                ticket_barcode: null,
                printed_ticket_barcode: null,
                vendor_code: null,
                vendor_name: null,
                sale_at: v.date,
                total_amount: v.total,
                item_count: items.length,
                captured_at: v.date,
                status: 'cobrado',            // una venta manual registrada es una venta concretada
                origin: 'manual',
                items,
            };
        });

        const tickets = [...scaleTickets, ...manualTickets].sort(
            (a, b) => new Date(b.sale_at) - new Date(a.sale_at)
        );

        return res.json({ tickets });
    } catch (err) {
        console.error('[GET /api/scale/detalle-ventas ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: GET /api/conciliacion/balanza/anulados ──────────────────────────
// Registro de tickets de balanza anulados (estado 'voided'). Filtra por fecha
// de anulación (voided_at).
app.get('/api/conciliacion/balanza/anulados', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        if (accessContext) {
            assertClientAccess(accessContext);
            accessContext.activeBranch = await resolveRequestedActiveBranch(accessContext, req);
        }
        const conn = await pool.getConnection();
        try { await ensureScaleTicketLifecycleColumns(conn); } finally { conn.release(); }

        const { dateFrom, dateTo } = req.query;
        const params = [tenantId];

        // Mismo scope por sucursal que el listado de pendientes (ver arriba): no
        // mezclar anulados entre sucursales del tenant.
        let branchFilter = '';
        const scopedBranchId = Number(
            accessContext?.activeBranch?.id
            ?? accessContext?.user?.branchRecordId
            ?? accessContext?.user?.branchId
        );
        if (Number.isFinite(scopedBranchId) && scopedBranchId > 0) {
            branchFilter = ' AND t.branch_id = ?';
            params.push(scopedBranchId);
        }

        let dateFilter = '';
        if (dateFrom && dateTo) {
            dateFilter = ' AND DATE(t.voided_at) BETWEEN ? AND ?';
            params.push(dateFrom, dateTo);
        } else if (dateFrom) {
            dateFilter = ' AND DATE(t.voided_at) >= ?';
            params.push(dateFrom);
        } else if (dateTo) {
            dateFilter = ' AND DATE(t.voided_at) <= ?';
            params.push(dateTo);
        }

        const [tickets] = await pool.query(`
            SELECT
                t.id,
                t.ticket_barcode,
                t.printed_ticket_barcode,
                t.vendor_code,
                t.vendor_name,
                t.sale_at,
                t.total_amount,
                t.item_count,
                t.ticket_status,
                t.scale_address,
                t.synced_at,
                t.voided_at,
                t.voided_by_username,
                t.voided_reason
            FROM scale_bridge_ticket_map t
            WHERE t.tenant_id = ?
              AND t.ticket_status = 'voided'${branchFilter}
              ${dateFilter}
            ORDER BY t.voided_at DESC
        `, params);

        if (tickets.length === 0) return res.json({ tickets: [] });

        const barcodes = tickets.map(t => t.ticket_barcode);
        const [items] = await pool.query(`
            SELECT
                i.ticket_barcode,
                i.line_no,
                i.plu_code,
                i.vendor_name,
                i.grams,
                i.drained_grams,
                i.amount,
                i.item_quantity,
                i.item_quantity_unit,
                i.sale_at,
                COALESCE(
                    (SELECT p.name FROM scale_bridge_product_map m
                     JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
                     WHERE m.tenant_id = i.tenant_id AND m.device_id = i.device_id
                       AND CAST(m.plu_code AS CHAR) = CAST(i.plu_code AS CHAR)
                     LIMIT 1),
                    (SELECT p.name FROM products p
                     WHERE p.tenant_id = i.tenant_id
                       AND (
                           CAST(p.plu AS CHAR) = CAST(i.plu_code AS CHAR)
                           OR CAST(p.plu AS CHAR) = TRIM(LEADING '0' FROM CAST(i.plu_code AS CHAR))
                       )
                     ORDER BY CASE WHEN p.branch_id IS NULL THEN 1 ELSE 0 END, p.id DESC
                     LIMIT 1)
                ) AS product_name
            FROM scale_bridge_sales_item i
            WHERE i.tenant_id = ?
              AND i.ticket_barcode IN (${barcodes.map(() => '?').join(',')})
            ORDER BY i.ticket_barcode, i.line_no
        `, [tenantId, ...barcodes]);

        const itemsByBarcode = {};
        for (const item of items) {
            if (!itemsByBarcode[item.ticket_barcode]) itemsByBarcode[item.ticket_barcode] = [];
            itemsByBarcode[item.ticket_barcode].push(item);
        }
        return res.json({ tickets: tickets.map(t => ({ ...t, items: itemsByBarcode[t.ticket_barcode] || [] })) });
    } catch (err) {
        console.error('[GET /api/conciliacion/balanza/anulados ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: POST /api/admin/setup-inter-branch-relationships ────────────────
app.post('/api/admin/setup-inter-branch-relationships', verifyFirebaseToken, async (req, res) => {
    try {
        const { tenantId, dbName, clientId } = await getTenantInfo(req.firebaseUser);
        if (!clientId) return res.status(400).json({ error: 'No se pudo determinar el clientId del tenant' });

        const allBranches = await listClientBranches(clientId);

        // Acepta lista opcional de IDs de sucursales a vincular; si no se pasa, usa todas.
        const { branchIds } = req.body || {};
        const branches = Array.isArray(branchIds) && branchIds.length >= 2
            ? allBranches.filter((b) => branchIds.map(Number).includes(Number(b.id)))
            : allBranches;

        if (branches.length < 2) {
            return res.status(400).json({ error: 'Se necesitan al menos 2 sucursales activas para crear relaciones inter-sucursal' });
        }

        const pool = getTenantPool(dbName);
        const conn = await pool.getConnection();

        const created = [];
        const skipped = [];

        try {
            for (let i = 0; i < branches.length; i++) {
                for (let j = 0; j < branches.length; j++) {
                    if (i === j) continue;
                    const owner = branches[i];
                    const other = branches[j];

                    // Check + insert client
                    const [[existingClient]] = await conn.query(
                        `SELECT id FROM clients WHERE tenant_id = ? AND branch_id = ? AND name = ? LIMIT 1`,
                        [tenantId, owner.id, other.name]
                    );
                    if (existingClient) {
                        skipped.push({ type: 'client', owner: owner.name, other: other.name, id: existingClient.id });
                    } else {
                        const [clientResult] = await conn.query(
                            `INSERT INTO clients (tenant_id, branch_id, name, has_current_account, balance)
                             VALUES (?, ?, ?, 1, 0)`,
                            [tenantId, owner.id, other.name]
                        );
                        created.push({ type: 'client', owner: owner.name, other: other.name, id: clientResult.insertId });
                    }

                    // Check + insert supplier
                    const [[existingSupplier]] = await conn.query(
                        `SELECT id FROM suppliers WHERE tenant_id = ? AND branch_id = ? AND name = ? LIMIT 1`,
                        [tenantId, owner.id, other.name]
                    );
                    if (existingSupplier) {
                        skipped.push({ type: 'supplier', owner: owner.name, other: other.name, id: existingSupplier.id });
                    } else {
                        const [supplierResult] = await conn.query(
                            `INSERT INTO suppliers (tenant_id, branch_id, name)
                             VALUES (?, ?, ?)`,
                            [tenantId, owner.id, other.name]
                        );
                        created.push({ type: 'supplier', owner: owner.name, other: other.name, id: supplierResult.insertId });
                    }
                }
            }
        } finally {
            conn.release();
        }

        console.log(`[INTER-BRANCH] tenant=${tenantId} creados=${created.length} ya-existentes=${skipped.length}`);
        res.json({ ok: true, branches: branches.map((b) => ({ id: b.id, name: b.name })), created, skipped });
    } catch (err) {
        console.error('[POST /api/admin/setup-inter-branch-relationships ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: GET /health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    ok: true,
    ts: new Date(),
    redis: process.env.REDIS_HOST ? redisClient.isReady : false,
}));

// ── Cierre automático de balanza a medianoche ──────────────────────────────
// Cada noche a las 00:00 de Argentina (UTC-3) encola clear_sales_memory para
// todos los tenants con bridge ACTIVE. El bridge lo levanta en el siguiente
// heartbeat (<5s): lee los tickets del día, los sube al API y ejecuta fn32
// para limpiar la memoria de la balanza. Al otro día arranca en cero, sin
// que nadie tenga que tocar nada manualmente.
const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';
function scheduleMidnightScaleClear() {
    const msUntilMidnight = () => {
        // La medianoche es en hora de Argentina, NO en la del proceso (el server
        // corre en UTC). Sin esto disparaba a las 00:00 UTC = 21:00 ART y vaciaba
        // balanzas de locales todavía abiertos. Reinterpretamos la hora de pared
        // de AR como Date local del proceso: el delta hasta la próxima 00:00 ART
        // es el mismo lapso real (AR no tiene horario de verano, sin saltos).
        const now = new Date();
        const artNow = new Date(now.toLocaleString('en-US', { timeZone: AR_TIMEZONE }));
        const artNext = new Date(artNow);
        artNext.setDate(artNext.getDate() + 1);
        artNext.setHours(0, 0, 0, 0);
        return artNext.getTime() - artNow.getTime();
    };

    const runMidnightClear = async () => {
        console.log('[MIDNIGHT CLEAR] Iniciando cierre automático de balanzas...');
        try {
            const [devices] = await clientsControlPool.query(
                `SELECT DISTINCT tenantId FROM \`${CLIENTS_DB_NAME}\`.\`${BRIDGE_DEVICES_TABLE}\` WHERE status = 'ACTIVE'`
            );
            if (!devices.length) {
                console.log('[MIDNIGHT CLEAR] No hay bridges activos, nada que hacer.');
            } else {
                const pool = getOperationalPool();
                let ok = 0;
                let fail = 0;
                for (const { tenantId } of devices) {
                    try {
                        await queueScaleClearSales(pool, tenantId);
                        ok++;
                    } catch (e) {
                        fail++;
                        console.warn(`[MIDNIGHT CLEAR] No se pudo encolar tenant=${tenantId}:`, e?.message || e);
                    }
                }
                console.log(`[MIDNIGHT CLEAR] clear_sales_memory encolado: ${ok} OK, ${fail} errores`);
            }
        } catch (e) {
            console.error('[MIDNIGHT CLEAR] Error al encolar limpiezas de balanza:', e?.message || e);
        }
        setTimeout(runMidnightClear, msUntilMidnight());
    };

    const delay = msUntilMidnight();
    console.log(`[MIDNIGHT CLEAR] Proximo cierre de balanza en ${Math.round(delay / 60000)} min`);
    setTimeout(runMidnightClear, delay);
}

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
ensureClientsControlStore()
    .then(() => {
        console.log('[BOOT] Clients control store OK');
        if (SKIP_SCHEMA_BOOT) {
            console.warn('[BOOT] SKIP_SCHEMA_BOOT activo. Se omite la verificación/migración de schema.');
            return null;
        }
        return ensureOperationalTenantIsolation();
    })
    .then(async () => {
        if (!SKIP_SCHEMA_BOOT) {
            console.log('[BOOT] Operational tenant isolation OK');
        }
        await ensureBridgeDeviceMonitorColumns().catch((e) => {
            console.warn('[BOOT] No se pudieron asegurar columnas de monitor de bridge:', e?.message || e);
        });
        await cleanupFatimaTestData().catch((e) => {
            console.error('[BOOT] Cleanup datos de prueba Fatima FALLÓ:', e?.stack || e?.message || e);
        });
        await cleanupStrayInterBranchEntries().catch((e) => {
            console.warn('[BOOT] Cleanup inter-sucursal stray:', e?.message || e);
        });
        await ensureInterBranchEntries().catch((e) => {
            console.warn('[BOOT] No se pudieron asegurar entradas inter-sucursal:', e?.message || e);
        });
        await seedFatimaProductsFromPilar().catch((e) => {
            console.warn('[BOOT] Seed productos Fatima desde Pilar:', e?.message || e);
        });
        await seedFatimaPurchaseItemsFromPilar().catch((e) => {
            console.warn('[BOOT] Seed artículos (purchase_items) Fatima desde Pilar:', e?.message || e);
        });
        await connectRedisSafely();
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log(`MeatManager API corriendo en puerto ${PORT}`);
            scheduleMidnightScaleClear();
            // Red de seguridad del Detalle de Ventas: reconcilia cada 5 min los tickets
            // recientes que la captura en vivo pueda haber salteado. Liviano y aislado
            // (nunca throwea, guard anti-solapamiento) → no bloquea ni afecta el resto.
            const runReconcileScaleLog = () => reconcileScaleSalesLog(getOperationalPool())
                .catch((e) => console.warn('[RECONCILE scale_sales_log] scheduler:', e?.message || e));
            setTimeout(runReconcileScaleLog, 15000);
            setInterval(runReconcileScaleLog, 5 * 60 * 1000);
        });
    })
    .catch((err) => {
        console.error('[AUTH STORE INIT ERROR]', err?.stack || err?.message || err);
        process.exit(1);
    });
