// MeatManager API - Provisioning Multi-Tenant
// Genera y gestiona una BD MySQL por cada empresa (identificada por CUIT)

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
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
const MEATMANAGER_DB_NAME = process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || MEATMANAGER_DB_NAME;
const SCALE_BRIDGE_DIRECT_BASE_URL = String(process.env.SCALE_BRIDGE_DIRECT_BASE_URL || 'http://127.0.0.1:4045')
    .trim()
    .replace(/\/+$/, '');
const SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS || '6500', 10) || 6500);
const SCALE_BRIDGE_PULL_LOOKBACK_MINUTES = Math.max(1, Number.parseInt(process.env.SCALE_BRIDGE_PULL_LOOKBACK_MINUTES || '45', 10) || 45);
const DEFAULT_OPERATIONAL_TENANT_ID = Number(process.env.DEFAULT_OPERATIONAL_TENANT_ID || 1);
const TENANT_COLUMN = 'tenant_id';
const REDIS_TRACKING_TTL_SECONDS = Number(process.env.REDIS_TRACKING_TTL_SECONDS || 90);
const CASH_WITHDRAWAL_CODE_TTL_MINUTES = Number(process.env.CASH_WITHDRAWAL_CODE_TTL_MINUTES || 10);
const INTERNAL_ADMIN_JWT_SECRET = process.env.JWT_SECRET || process.env.INTERNAL_ADMIN_JWT_SECRET || 'change-this-in-production-super-secret-key';
const INTERNAL_ADMIN_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const SKIP_SCHEMA_BOOT = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.SKIP_SCHEMA_BOOT || '').trim().toLowerCase()
);
const smtpSecure = ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(
    String(process.env.SMTP_SECURE || '').trim().toLowerCase()
);

let smtpTransport = null;

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
    'caja_movimientos', 'cash_closures', 'delivery_tracking_events', 'prices', 'product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'app_logs', 'promotions', 'scale_users',
]);

const TENANT_ID_TABLES = [
    'settings', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'products', 'purchase_items',
    'stock', 'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'cash_closures', 'delivery_tracking_events', 'prices', 'product_prices', 'users', 'user_permissions',
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
    'caja_movimientos', 'prices', 'product_prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots', 'branch_transfers', 'branch_transfer_items', 'app_logs', 'promotions', 'scale_users',
];
const BRANCH_SCOPED_TABLES = new Set(['ventas', 'caja_movimientos', 'pedidos', 'cash_closures', 'stock', 'promotions']);

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
    if (!(primaryColumns.length === 2 && primaryColumns[0] === TENANT_COLUMN && primaryColumns[1] === 'key')) {
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

async function ensureProductCatalogIntegrity(conn) {
    const canonicalNameSql = (expr) => `LOWER(REPLACE(TRIM(COALESCE(${expr}, '')), ' ', '_'))`;
    const cleanTextSql = (expr) => `NULLIF(TRIM(COALESCE(${expr}, '')), '')`;
    const cleanCategoryKeySql = (expr) => `NULLIF(LOWER(REPLACE(TRIM(COALESCE(${expr}, '')), ' ', '_')), '')`;
    const legacyPriceNameSql = `TRIM(REPLACE(SUBSTRING_INDEX(COALESCE(pr.product_id, ''), '-', 1), '_', ' '))`;
    const legacyPriceCategorySql = `NULLIF(TRIM(REPLACE(SUBSTRING(COALESCE(pr.product_id, ''), LENGTH(SUBSTRING_INDEX(COALESCE(pr.product_id, ''), '-', 1)) + 2), '_', ' ')), '')`;
    const canonicalPriceProductIdSql = `CONCAT(p.canonical_key, '-', COALESCE(NULLIF(LOWER(REPLACE(TRIM(COALESCE(p.category, '')), ' ', '_')), ''), 'general'))`;

    const insertStatements = [
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            s.\`${TENANT_COLUMN}\`,
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
          AND p.canonical_key = ${canonicalNameSql('s.name')}
         WHERE ${cleanTextSql('s.name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY s.\`${TENANT_COLUMN}\`, ${canonicalNameSql('s.name')}, TRIM(s.name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            pi.\`${TENANT_COLUMN}\`,
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
          AND p.canonical_key = ${canonicalNameSql('pi.name')}
         WHERE ${cleanTextSql('pi.name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY pi.\`${TENANT_COLUMN}\`, ${canonicalNameSql('pi.name')}, TRIM(pi.name)`,
        `INSERT INTO \`${OPERATIONAL_DB_NAME}\`.products
            (\`${TENANT_COLUMN}\`, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at)
         SELECT
            vi.\`${TENANT_COLUMN}\`,
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
          AND p.canonical_key = ${canonicalNameSql('vi.product_name')}
         WHERE ${cleanTextSql('vi.product_name')} IS NOT NULL
           AND p.id IS NULL
         GROUP BY vi.\`${TENANT_COLUMN}\`, ${canonicalNameSql('vi.product_name')}, TRIM(vi.product_name)`,
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
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
         JOIN (
            SELECT
                s.\`${TENANT_COLUMN}\` AS tenant_id,
                ${canonicalNameSql('s.name')} AS canonical_key,
                MAX(${cleanTextSql('s.type')}) AS category,
                MAX(${cleanTextSql('s.unit')}) AS unit,
                MAX(CASE WHEN COALESCE(s.price, 0) > 0 THEN s.price ELSE 0 END) AS current_price
            FROM \`${OPERATIONAL_DB_NAME}\`.stock s
            WHERE ${cleanTextSql('s.name')} IS NOT NULL
            GROUP BY s.\`${TENANT_COLUMN}\`, ${canonicalNameSql('s.name')}
         ) src
           ON src.tenant_id = p.\`${TENANT_COLUMN}\`
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

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.products p
         JOIN (
            SELECT
                pi.\`${TENANT_COLUMN}\` AS tenant_id,
                ${canonicalNameSql('pi.name')} AS canonical_key,
                MAX(COALESCE(${cleanTextSql('pi.type')}, ${cleanTextSql('pi.species')})) AS category,
                MAX(${cleanTextSql('pi.unit')}) AS unit,
                MAX(${cleanTextSql('pi.plu')}) AS plu,
                MAX(CASE WHEN COALESCE(pi.last_price, 0) > 0 THEN pi.last_price ELSE 0 END) AS current_price
            FROM \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
            WHERE ${cleanTextSql('pi.name')} IS NOT NULL
            GROUP BY pi.\`${TENANT_COLUMN}\`, ${canonicalNameSql('pi.name')}
         ) src
           ON src.tenant_id = p.\`${TENANT_COLUMN}\`
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

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.stock s
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = s.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('s.name')}
         SET s.product_id = p.id
         WHERE s.product_id IS NULL
           AND ${cleanTextSql('s.name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.purchase_items pi
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = pi.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('pi.name')}
         SET pi.product_id = p.id
         WHERE pi.product_id IS NULL
           AND ${cleanTextSql('pi.name')} IS NOT NULL`
    );

    await conn.query(
        `UPDATE \`${OPERATIONAL_DB_NAME}\`.ventas_items vi
         JOIN \`${OPERATIONAL_DB_NAME}\`.products p
           ON p.\`${TENANT_COLUMN}\` = vi.\`${TENANT_COLUMN}\`
          AND p.canonical_key = ${canonicalNameSql('vi.product_name')}
         SET vi.product_id = p.id
         WHERE vi.product_id IS NULL
           AND ${cleanTextSql('vi.product_name')} IS NOT NULL`
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
            (\`${TENANT_COLUMN}\`, product_id, price, plu, source, effective_at, created_at)
         SELECT
            p.\`${TENANT_COLUMN}\`,
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

    if (!(await hasIndex(conn, OPERATIONAL_DB_NAME, 'products', 'uniq_products_tenant_plu'))) {
        try {
            await conn.query(
                `ALTER TABLE \`${OPERATIONAL_DB_NAME}\`.products
                 ADD UNIQUE KEY uniq_products_tenant_plu (\`${TENANT_COLUMN}\`, plu)`
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                console.warn('[DB] No se pudo crear uniq_products_tenant_plu porque existen PLU duplicados. Limpialos y reiniciá la API.');
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
            await ensureColumn(conn, 'purchase_items', 'product_id', '`product_id` INT NULL AFTER `name`');
            await ensureColumn(conn, 'purchase_items', 'is_preelaborable', '`is_preelaborable` TINYINT(1) NULL DEFAULT 0 AFTER `type`');
            await ensureColumn(conn, 'products', 'category_id', '`category_id` INT NULL AFTER `name`');
            await ensureColumn(conn, 'products', 'active', '`active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `plu`');
            await ensureColumn(conn, 'products', 'deleted_at', '`deleted_at` DATETIME NULL AFTER `active`');
            await ensureColumn(conn, 'stock', 'product_id', '`product_id` INT NULL AFTER `tenant_id`');
            await ensureColumn(conn, 'stock', 'branch_id', '`branch_id` INT NULL AFTER `tenant_id`');
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
                    slot_no         TINYINT UNSIGNED NOT NULL,
                    display_name    VARCHAR(100) NOT NULL,
                    active          TINYINT(1) DEFAULT 1,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_scale_users_tenant_slot (\`${TENANT_COLUMN}\`, slot_no),
                    UNIQUE KEY uniq_scale_users_tenant_id (\`${TENANT_COLUMN}\`, id),
                    INDEX idx_scale_users_tenant (\`${TENANT_COLUMN}\`)
                )
            `);

            await ensureColumn(conn, 'prices', 'product_ref_id', '`product_ref_id` INT NULL AFTER `tenant_id`');
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
            await ensureColumn(conn, 'clients', 'client_type', '`client_type` VARCHAR(20) NULL DEFAULT \'person\'');
            await ensureColumn(conn, 'clients', 'company_name', '`company_name` VARCHAR(191) NULL');
            await ensureColumn(conn, 'clients', 'contact_first_name', '`contact_first_name` VARCHAR(120) NULL');
            await ensureColumn(conn, 'clients', 'contact_last_name', '`contact_last_name` VARCHAR(120) NULL');
            await ensureColumn(conn, 'clients', 'dni_cuit', '`dni_cuit` VARCHAR(32) NULL');
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
            await ensureColumn(conn, 'caja_movimientos', 'branch_id', '`branch_id` INT NULL AFTER `client_id`');
            await ensureColumn(conn, 'pedidos', 'branch_id', '`branch_id` INT NULL AFTER `customer_id`');
            await ensureColumn(conn, 'cash_closures', 'branch_id', '`branch_id` INT NULL AFTER `closure_date`');
            await ensureColumn(conn, 'caja_movimientos', 'authorization_id', '`authorization_id` BIGINT NULL');
            await ensureColumn(conn, 'caja_movimientos', 'authorization_verified', '`authorization_verified` TINYINT(1) NOT NULL DEFAULT 0');
            await ensureColumn(conn, 'caja_movimientos', 'authorized_recipient_email', '`authorized_recipient_email` VARCHAR(150) NULL');
            await ensureColumnType(conn, 'prices', 'product_id', '`product_id` VARCHAR(191) NULL', ['varchar']);

            // Normalize prices.product_id: lowercase + spaces to underscores (one-time migration)
            await conn.query(
                `UPDATE prices SET product_id = LOWER(REPLACE(product_id, ' ', '_'))
                 WHERE product_id REGEXP '[A-Z ]'`
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

            for (const tableName of TENANT_ID_TABLES) {
                await ensureTenantIdColumn(conn, tableName);
            }

            for (const tableName of TENANT_ID_TABLES) {
                await backfillTenantId(conn, tableName);
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
            for (const tableName of TABLES_WITH_NUMERIC_ID) {
                await ensureCompositePrimaryKey(conn, tableName);
            }

            await ensureProductCategoriesIntegrity(conn);
            await ensureProductCatalogIntegrity(conn);
            await ensureTenantScopedForeignKeys(conn);
        } finally {
            await conn.end();
        }
    } finally {
        adminConn.release();
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
        if (!(await hasColumn(conn, CLIENTS_DB_NAME, CLIENTS_TABLE, 'cashAuthorizationEmail'))) {
            await conn.query(`
                ALTER TABLE \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\`
                ADD COLUMN cashAuthorizationEmail VARCHAR(150) NULL AFTER billingEmail
            `);
        }
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

    const explicitBranchId = Number(record?.branch_id ?? record?.branchId);
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

    return resolveClientBranchId(accessContext.client.id, {
        branchCode: currentBranchCode,
        receiptCode: record?.receipt_code,
    });
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
            INDEX idx_suppliers_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS products (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            canonical_key   VARCHAR(191) NOT NULL,
            name            VARCHAR(150) NOT NULL,
            category_id     INT,
            category        VARCHAR(100),
            unit            VARCHAR(20),
            current_price   DECIMAL(12,2) DEFAULT 0,
            plu             VARCHAR(20),
            active          TINYINT(1) NOT NULL DEFAULT 1,
            deleted_at      DATETIME NULL,
            source          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_products_tenant_id (\`${TENANT_COLUMN}\`, id),
            UNIQUE KEY uniq_products_tenant_canonical (\`${TENANT_COLUMN}\`, canonical_key),
            UNIQUE KEY uniq_products_tenant_plu (\`${TENANT_COLUMN}\`, plu),
            INDEX idx_products_tenant (\`${TENANT_COLUMN}\`),
            INDEX idx_products_tenant_category (\`${TENANT_COLUMN}\`, category_id)
        )`,
        `CREATE TABLE IF NOT EXISTS purchase_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
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
            has_initial_balance TINYINT(1) DEFAULT 0,
            last_updated    DATETIME,
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_clients_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_clients_tenant (\`${TENANT_COLUMN}\`)
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
            INDEX idx_ventas_items_tenant_venta (\`${TENANT_COLUMN}\`, venta_id),
            INDEX idx_ventas_items_tenant_promo (\`${TENANT_COLUMN}\`, promo_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, venta_id) REFERENCES ventas(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS compras (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
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
            INDEX idx_compras_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS compras_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
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
            INDEX idx_compras_items_tenant_purchase (\`${TENANT_COLUMN}\`, purchase_id),
            FOREIGN KEY (\`${TENANT_COLUMN}\`, purchase_id) REFERENCES compras(\`${TENANT_COLUMN}\`, id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS supplier_item_tax_profiles (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            supplier_name   VARCHAR(150) NOT NULL,
            product_name    VARCHAR(150) NOT NULL,
            last_iva_rate   DECIMAL(5,2) DEFAULT 10.5,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_sitp_tenant_supplier_product (\`${TENANT_COLUMN}\`, supplier_name(100), product_name(100)),
            INDEX idx_sitp_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS animal_lots (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            purchase_id     INT,
            supplier        VARCHAR(150),
            date            DATETIME,
            species         VARCHAR(50),
            weight          DECIMAL(12,3),
            status          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_animal_lots_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_animal_lots_tenant (\`${TENANT_COLUMN}\`)
        )`,
        `CREATE TABLE IF NOT EXISTS despostada_logs (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            type                VARCHAR(50),
            date                DATETIME,
            supplier            VARCHAR(150),
            total_weight        DECIMAL(12,3),
            yield_percentage    DECIMAL(5,2),
            lot_id              INT,
            synced              TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_despostada_logs_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_despostada_logs_tenant (\`${TENANT_COLUMN}\`)
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
            product_id      INT,
            product_name    VARCHAR(150),
            price           DECIMAL(12,2),
            category        VARCHAR(100),
            is_offer        TINYINT(1) DEFAULT 0,
            synced          TINYINT(1) DEFAULT 0,
            UNIQUE KEY uniq_menu_digital_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_menu_digital_tenant (\`${TENANT_COLUMN}\`)
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
            remito_number   INT,
            remito_code     VARCHAR(32),
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
            product_ref_id  INT,
            product_id      VARCHAR(191),
            price           DECIMAL(12,2),
            plu             VARCHAR(20),
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_prices_tenant (\`${TENANT_COLUMN}\`)
        )`,
        // Tabla canónica de historial de precios (reemplaza a prices a mediano plazo).
        // Cada fila es un evento de precio: no se actualiza, se inserta una nueva.
        // El precio vigente de un producto es el último por (tenant_id, product_id, effective_at DESC).
        `CREATE TABLE IF NOT EXISTS product_prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            \`${TENANT_COLUMN}\` BIGINT NOT NULL DEFAULT ${DEFAULT_OPERATIONAL_TENANT_ID},
            product_id      INT NOT NULL,
            price           DECIMAL(12,2) NOT NULL DEFAULT 0,
            plu             VARCHAR(20),
            source          VARCHAR(50),
            effective_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_prices_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_pp_tenant_product_eff (\`${TENANT_COLUMN}\`, product_id, effective_at),
            INDEX idx_pp_tenant_plu (\`${TENANT_COLUMN}\`, plu)
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
            slot_no         TINYINT UNSIGNED NOT NULL,
            display_name    VARCHAR(100) NOT NULL,
            active          TINYINT(1) DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_scale_users_tenant_slot (\`${TENANT_COLUMN}\`, slot_no),
            UNIQUE KEY uniq_scale_users_tenant_id (\`${TENANT_COLUMN}\`, id),
            INDEX idx_scale_users_tenant (\`${TENANT_COLUMN}\`)
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
    'caja_movimientos', 'cash_closures', 'supplier_item_tax_profiles', 'prices', 'product_prices', 'users', 'user_permissions',
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

async function findProductByPlu(pool, tenantId, plu, excludeProductId = null) {
    const normalizedPlu = normalizePluValue(plu);
    if (!normalizedPlu) return null;

    const params = [tenantId, normalizedPlu, Number.parseInt(normalizedPlu, 10)];
    let sql = `SELECT id, name, plu
               FROM products
               WHERE tenant_id = ?
                 AND (
                    plu = ?
                    OR (plu REGEXP '^[0-9]+$' AND CAST(plu AS UNSIGNED) = ?)
                 )`;
    if (Number.isFinite(Number(excludeProductId)) && Number(excludeProductId) > 0) {
        sql += ' AND id <> ?';
        params.push(Number(excludeProductId));
    }
    sql += ' ORDER BY id ASC LIMIT 1';

    const [rows] = await pool.query(sql, params);
    return rows?.[0] || null;
}

async function assertUniqueProductPlu(pool, tenantId, plu, excludeProductId = null) {
    const conflict = await findProductByPlu(pool, tenantId, plu, excludeProductId);
    if (!conflict) return;

    const normalizedPlu = normalizePluValue(plu);
    const error = new Error(`El PLU ${normalizedPlu} ya esta asignado a "${conflict.name}" (producto ${conflict.id})`);
    error.statusCode = 409;
    throw error;
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

        if (operation === 'insert') {
            if (!normalizedRecord) return res.status(400).json({ error: 'record requerido' });
            const filtered = await filterRecord(normalizedRecord, false); // incluir id si viene (Dexie lo manda)
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para insertar' });
            }
            if (table === 'products') {
                filtered.plu = normalizePluValue(filtered.plu);
                await assertUniqueProductPlu(pool, tenantId, filtered.plu);
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
                        return res.json({ ok: true, insertId: result.insertId, broadcast });
                    }
                }
                return res.json({ ok: true, insertId: result.insertId });
            } catch (insertError) {
                if (insertError?.code === 'ER_DUP_ENTRY' && table === 'products' && filtered.canonical_key) {
                    const scope = tenantWhereClause(table, tenantId);
                    const [existingRows] = await pool.query(
                        `SELECT id FROM \`${table}\` WHERE canonical_key = ? AND ${scope.sql} LIMIT 1`,
                        [filtered.canonical_key, ...scope.params]
                    );
                    const existingId = existingRows?.[0]?.id;
                    if (existingId) {
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
            if (table === 'products' && Object.prototype.hasOwnProperty.call(filtered, 'plu')) {
                filtered.plu = normalizePluValue(filtered.plu);
                await assertUniqueProductPlu(pool, tenantId, filtered.plu, numId);
            }
            const scope = tenantWhereClause(table, tenantId);
            await pool.query(`UPDATE \`${table}\` SET ? WHERE id = ? AND ${scope.sql}`, [filtered, numId, ...scope.params]);
            return res.json({ ok: true });
        }

        if (operation === 'delete') {
            const numId = parseInt(id, 10);
            if (!numId) return res.status(400).json({ error: 'id numérico requerido para delete' });
            const scope = tenantWhereClause(table, tenantId);
            if (table === 'products') {
                const [result] = await pool.query(
                    `UPDATE \`${table}\`
                     SET active = 0,
                         deleted_at = NOW(),
                         updated_at = NOW()
                     WHERE id = ? AND ${scope.sql}`,
                    [numId, ...scope.params]
                );
                return res.json({ ok: true, archived: Number(result?.affectedRows || 0) > 0 });
            }
            await pool.query(`DELETE FROM \`${table}\` WHERE id = ? AND ${scope.sql}`, [numId, ...scope.params]);
            return res.json({ ok: true });
        }

        if (operation === 'upsert') {
            // Para settings (PK = key) u otras tablas con ON DUPLICATE KEY UPDATE
            if (!normalizedRecord) return res.status(400).json({ error: 'record requerido' });
            const validCols = await getTableColumns(pool, dbName, table);
            const filtered = {};
            for (const col of validCols) {
                if (AUTO_COLS.has(col)) continue;
                if (col === TENANT_COLUMN) {
                    filtered[col] = tenantId;
                    continue;
                }
                if (normalizedRecord[col] !== undefined && normalizedRecord[col] !== null) {
                    filtered[col] = normalizeColumnValue(normalizedRecord[col], tableDesc.get(col) || '');
                }
            }
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
app.get('/api/settings/:key', verifyFirebaseToken, async (req, res) => {
    try {
        const settingKey = String(req.params.key || '').trim();
        if (!settingKey) {
            return res.status(400).json({ error: 'Key requerida' });
        }

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const [rows] = await pool.query(
            'SELECT `key`, value FROM settings WHERE `tenant_id` = ? AND `key` = ? LIMIT 1',
            [tenantId, settingKey]
        );

        if (!rows.length) {
            return res.json({
                ok: true,
                key: settingKey,
                value: null,
                found: false,
            });
        }

        return res.json({
            ok: true,
            key: rows[0].key,
            value: rows[0].value ?? null,
            found: true,
        });
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
            : ['settings', 'users', 'user_permissions', 'scale_users', 'payment_methods', 'categories', 'product_categories', 'suppliers', 'purchase_items', 'clients', 'products', 'product_prices', 'prices', 'promotions', 'stock'];

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);

        const payload = {};
        for (const table of tables) {
            const scope = tenantWhereClause(table, tenantId);
            const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE ${scope.sql}`, scope.params);
            payload[table] = rows.map(deserializeRow);
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
        const [rows] = await pool.query(
            `SELECT id, product_id, price, plu, source, effective_at, created_at
             FROM product_prices
             WHERE tenant_id = ? AND product_id = ?
             ORDER BY effective_at DESC, id DESC
             LIMIT ?`,
            [tenantId, productId, limit]
        );
        return res.json({ ok: true, prices: rows });
    } catch (err) {
        console.error('[PRODUCT PRICES ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RUTA: POST /api/products/:id/prices ───────────────────────────────────
// Registra un nuevo precio para un producto (append-only, nunca modifica histórico).
// Body: { price, plu?, source? }
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

        // Verificar que el producto pertenece a este tenant
        const [[product]] = await pool.query(
            'SELECT id FROM products WHERE tenant_id = ? AND id = ? LIMIT 1',
            [tenantId, productId]
        );
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
        await assertUniqueProductPlu(pool, tenantId, plu, productId);

        const now = new Date();
        const [result] = await pool.query(
            `INSERT INTO product_prices (tenant_id, product_id, price, plu, source, effective_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, productId, price, plu, source, now, now]
        );
        // Actualizar snapshot en products.current_price
        await pool.query(
            'UPDATE products SET current_price = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
            [price, now, tenantId, productId]
        );
        return res.json({ ok: true, id: result.insertId });
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

        if (table === 'products' && validCols.includes('active') && !includeInactive) {
            extraWhere.push('COALESCE(active, 1) = 1');
        }

        const whereSql = extraWhere.length > 0
            ? `${scope.sql} AND ${extraWhere.join(' AND ')}`
            : scope.sql;

        let [rows] = await pool.query(
            `SELECT * FROM \`${table}\` WHERE ${whereSql} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
            [...scope.params, ...extraParams, limit, offset]
        );

        // Si la tabla de medios de pago está vacía para este tenant, sembrar los predeterminados
        if (table === 'payment_methods' && rows.length === 0) {
            const PAYMENT_DEFAULTS = [
                { name: 'Postnet',          type: 'card',             percentage: 0, enabled: 1 },
                { name: 'Mercado Pago',     type: 'wallet',           percentage: 0, enabled: 1 },
                { name: 'Cuenta DNI',       type: 'wallet',           percentage: 0, enabled: 1 },
                { name: 'Efectivo',         type: 'cash',             percentage: 0, enabled: 1 },
                { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: 1 },
                { name: 'Mixto',            type: 'mixed',            percentage: 0, enabled: 1 },
            ];
            for (const pm of PAYMENT_DEFAULTS) {
                await pool.query('INSERT INTO `payment_methods` SET ?', [{ [TENANT_COLUMN]: tenantId, ...pm }]);
            }
            [rows] = await pool.query(
                `SELECT * FROM \`${table}\` WHERE ${whereSql} ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
                [...scope.params, ...extraParams, limit, offset]
            );
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
    const now = new Date();
    const fromDate = new Date(now.getTime() - (Math.max(1, Number(lookbackMinutes) || 1) * 60 * 1000));
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), SCALE_BRIDGE_PULL_SALES_TIMEOUT_MS);
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
            return false;
        }
        return true;
    } catch (error) {
        console.warn('[SCALE LOOKUP] pull-sales no disponible', {
            reason,
            barcode,
            baseUrl: SCALE_BRIDGE_DIRECT_BASE_URL,
            error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
        });
        return false;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

app.get('/api/scale/tickets/by-barcode/:barcode', verifyFirebaseToken, async (req, res) => {
    try {
        const barcode = String(req.params.barcode || '').trim();
        if (!barcode) return res.status(400).json({ error: 'barcode requerido' });
        const barcodeDigits = barcode.replace(/\D/g, '');
        const isScaleSummaryBarcode = barcodeDigits.length >= 12 && barcodeDigits.startsWith('22');

        const { dbName, tenantId } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const scaleSchema = await getScaleTicketLookupSchema(pool);
        const ticketSelect = buildScaleTicketLookupSelect(scaleSchema);
        const itemSelect = buildScaleTicketItemSelect(scaleSchema);
        const openTicketFilter = scaleSchema.ticketStatus ? " AND ticket_status = 'open'" : '';

        let [ticketRows] = await pool.query(
            `SELECT ${ticketSelect}
             FROM scale_bridge_ticket_map
             WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)${openTicketFilter}
             LIMIT 1`,
            [tenantId, barcode]
        );

        if (!ticketRows.length && scaleSchema.ticketPrintedBarcode) {
            [ticketRows] = await pool.query(
                `SELECT ${ticketSelect}
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ? AND UPPER(printed_ticket_barcode) = UPPER(?)${openTicketFilter}
                 LIMIT 1`,
                [tenantId, barcode]
            );
        }

        // Lectura resiliente: cuando el usuario escanea inmediatamente después de imprimir,
        // damos una ventana corta para que el bridge termine de persistir el ticket.
        if (!ticketRows.length && isScaleSummaryBarcode) {
            const pullPromise = triggerScaleBridgePullSales({
                reason: 'lookup_summary_barcode',
                barcode,
            });
            const retryUntil = Date.now() + 7500;
            while (!ticketRows.length && Date.now() < retryUntil) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                [ticketRows] = await pool.query(
                    `SELECT ${ticketSelect}
                     FROM scale_bridge_ticket_map
                     WHERE tenant_id = ?
                       AND (
                            UPPER(ticket_barcode) = UPPER(?)
                            ${scaleSchema.ticketPrintedBarcode ? ' OR UPPER(printed_ticket_barcode) = UPPER(?)' : ''}
                       )
                       ${openTicketFilter}
                     ORDER BY sale_at DESC
                     LIMIT 1`,
                    scaleSchema.ticketPrintedBarcode
                        ? [tenantId, barcode, barcode]
                        : [tenantId, barcode]
                );
            }
            if (!ticketRows.length) {
                await pullPromise.catch(() => false);
                [ticketRows] = await pool.query(
                    `SELECT ${ticketSelect}
                     FROM scale_bridge_ticket_map
                     WHERE tenant_id = ?
                       AND (
                            UPPER(ticket_barcode) = UPPER(?)
                            ${scaleSchema.ticketPrintedBarcode ? ' OR UPPER(printed_ticket_barcode) = UPPER(?)' : ''}
                       )
                       ${openTicketFilter}
                     ORDER BY sale_at DESC
                     LIMIT 1`,
                    scaleSchema.ticketPrintedBarcode
                        ? [tenantId, barcode, barcode]
                        : [tenantId, barcode]
                );
            }
        }

        if (!ticketRows.length && scaleSchema.ticketStatus) {
            const statusConditions = ['UPPER(ticket_barcode) = UPPER(?)'];
            const statusParams = [tenantId, barcode];
            if (scaleSchema.ticketPrintedBarcode) {
                statusConditions.push('UPPER(printed_ticket_barcode) = UPPER(?)');
                statusParams.push(barcode);
            }
            const [anyStatusRows] = await pool.query(
                `SELECT ticket_status
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ? AND (${statusConditions.join(' OR ')})
                 LIMIT 1`,
                statusParams
            );
            if (anyStatusRows.length && String(anyStatusRows[0].ticket_status || '').toLowerCase() !== 'open') {
                return res.status(409).json({
                    ok: false,
                    error: `Ese ticket ya fue ${String(anyStatusRows[0].ticket_status || '').toLowerCase()} y no debe reutilizarse`,
                });
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
                    break;
                }
                if (amountMatches.length > 1) {
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
                 WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)
                 LIMIT 1`,
                [tenantId, barcode]
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
            return res.status(404).json({ ok: false, error: 'Ticket no encontrado para ese barcode' });
        }

        const ticket = ticketRows[0];
        const itemBaseSql = `SELECT ${itemSelect}
             FROM scale_bridge_sales_item s
             LEFT JOIN products p
               ON p.tenant_id = s.tenant_id
              AND (
                   CAST(p.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
                   OR CAST(p.plu AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM CAST(s.plu_code AS CHAR CHARACTER SET utf8mb4)) COLLATE utf8mb4_unicode_ci
              )
             WHERE s.tenant_id = ?`;

        let [itemRows] = await pool.query(
            `${itemBaseSql}
               AND s.device_id = ?
               AND s.ticket_id = ?
             ORDER BY s.line_no ASC`,
            [tenantId, ticket.device_id, ticket.ticket_id]
        );

        // Fallback defensivo:
        // algunos firmwares/lectores pueden desalinear el identificador interno,
        // pero los barcodes del ticket siguen siendo estables.
        if (!itemRows.length) {
            const barcodeConditions = ['UPPER(s.ticket_barcode) = UPPER(?)'];
            const barcodeParams = [tenantId, ticket.ticket_barcode];
            if (scaleSchema.itemPrintedBarcode && ticket.printed_ticket_barcode) {
                barcodeConditions.push('UPPER(s.printed_ticket_barcode) = UPPER(?)');
                barcodeParams.push(ticket.printed_ticket_barcode);
            }
            [itemRows] = await pool.query(
                `${itemBaseSql}
                   AND (${barcodeConditions.join(' OR ')})
                 ORDER BY s.line_no ASC`,
                barcodeParams
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
                anyIdConditions.push('UPPER(s.ticket_barcode) = UPPER(?)');
                anyIdParams.push(ticket.ticket_barcode);
            }
            if (scaleSchema.itemPrintedBarcode && ticket.printed_ticket_barcode) {
                anyIdConditions.push('UPPER(s.printed_ticket_barcode) = UPPER(?)');
                anyIdParams.push(ticket.printed_ticket_barcode);
            }

            if (anyIdConditions.length > 0) {
                [itemRows] = await pool.query(
                    `${itemBaseSql}
                       AND (${anyIdConditions.join(' OR ')})
                     ORDER BY s.sale_at DESC, s.line_no ASC`,
                    anyIdParams
                );
            }
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

        // 1. INSERT compras
        const [compraResult] = await conn.query(
            `INSERT INTO compras
             (tenant_id, date, supplier, invoice_num, total, payment_method, is_account, items_detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, purchaseDate, String(supplier || '').trim(),
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
                 (tenant_id, purchase_id, product_id, product_name, quantity, weight,
                  unit_price, subtotal, iva_rate, iva_amount, net_subtotal, destination)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId, purchaseId,
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

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: { branch_id: req.body?.branch_id },
            })
            : null;

        // 3. Stock / animal_lots por item
        for (const item of items) {
            const isDespostada = item.type === 'despostada';
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
                         (tenant_id, purchase_id, supplier, date, species, weight, status)
                         VALUES (?, ?, ?, ?, ?, ?, 'disponible')`,
                        [tenantId, purchaseId, String(supplier || '').trim(),
                         purchaseDate, item.species || 'vaca', weightPerLot]
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
                    item.species || item.type || 'vaca',
                    stockQty,
                    item.unit || 'kg',
                    `compra_${purchaseId}`,
                ]
            );

            // Dual-write: registrar precio de costo en product_prices (source='compra')
            if (item.product_id && parseFloat(item.unit_price) > 0) {
                await conn.query(
                    `INSERT INTO product_prices
                     (tenant_id, product_id, price, source, effective_at, created_at)
                     VALUES (?, ?, ?, 'compra', ?, NOW())`,
                    [tenantId, item.product_id, parseFloat(item.unit_price), purchaseDate]
                );
            }
        }

        // 4. Caja movimientos (egreso si compra interna pagada con efectivo/transferencia)
        if (should_affect_cash && parseFloat(cash_amount) > 0) {
            const desc = `${String(supplier || '').trim()}${invoice_num ? ` · Comprobante ${invoice_num}` : ''}`;
            await conn.query(
                `INSERT INTO caja_movimientos
                 (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, purchase_id)
                 VALUES (?, 'egreso', ?, 'Compra interna', ?, ?, ?, 'principal', ?, ?)`,
                [
                    tenantId, parseFloat(cash_amount) || 0, desc,
                    payment_method || 'Efectivo',
                    payment_method_type || 'cash',
                    purchaseDate, purchaseId,
                ]
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
                         WHERE tenant_id = ? AND id = ?`,
                        [parseFloat(cu.last_price), cu.usage || 'venta',
                         parseFloat(cu.default_iva_rate) || 10.5, tenantId, cu.purchase_item_id]
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
                     (tenant_id, supplier_name, product_name, last_iva_rate, updated_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE last_iva_rate = VALUES(last_iva_rate), updated_at = NOW()`,
                    [tenantId, String(supplier || '').trim(),
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
//   clientId?,
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
        }

        const {
            date, subtotal, adjustment, total,
            receipt_number, receipt_code,
            payment_method, payment_method_id,
            payment_breakdown,
            clientId,
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
        const now = date ? new Date(date) : new Date();
        const ticketBarcode = String(ticket_barcode || '').trim() || null;

        await ensureScaleTicketLifecycleColumns(conn);
        if (ticketBarcode) {
            const [ticketRows] = await conn.query(
                `SELECT ticket_status
                 FROM scale_bridge_ticket_map
                 WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)
                 LIMIT 1`,
                [tenantId, ticketBarcode]
            );
            if (!ticketRows.length) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ error: 'El ticket escaneado no existe o aun no se sincronizo' });
            }
            if (String(ticketRows[0].ticket_status || '').toLowerCase() !== 'open') {
                await conn.rollback();
                conn.release();
                return res.status(409).json({ error: 'Ese ticket ya fue cobrado o anulado y no puede reutilizarse' });
            }
        }

        const resolvedBranchId = accessContext
            ? await resolveOperationalBranchId({
                pool,
                tenantId,
                accessContext,
                record: { branch_id: req.body?.branch_id, receipt_code },
            })
            : null;

        // 1. INSERT ventas
        const [ventaResult] = await conn.query(
            `INSERT INTO ventas
             (tenant_id, branch_id, date, subtotal, adjustment, total,
               receipt_number, receipt_code,
               payment_method, payment_method_id, payment_breakdown,
               clientId, qendra_ticket_id, ticket_barcode, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, resolvedBranchId, now, safeSubtotal, safeAdj, safeTotal,
                receipt_number || null, receipt_code || null,
                payment_method || null, payment_method_id || null,
                payment_breakdown ? JSON.stringify(payment_breakdown) : null,
                clientId || null,
                qendra_ticket_id || null, ticketBarcode, source || 'manual',
            ]
        );
        const saleId = ventaResult.insertId;

        if (ticketBarcode) {
            await conn.query(
                `UPDATE scale_bridge_ticket_map
                 SET ticket_status = 'charged',
                     charged_sale_id = ?,
                     charged_at = NOW()
                 WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)`,
                [saleId, tenantId, ticketBarcode]
            );
        }

        // 2. INSERT ventas_items
        const promoUsageById = new Map();
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
                 (tenant_id, venta_id, product_id, product_name, quantity, price, subtotal, promo_id, promo_kg_applied, promo_payload)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId, saleId,
                    item.product_id || null,
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
            // Resolver product_id por FK si no vino desde el frontend
            let productId = item.product_id || null;
            if (!productId && item.product_name) {
                const [[prod]] = await conn.query(
                    `SELECT id FROM products WHERE tenant_id = ? AND canonical_key = ? LIMIT 1`,
                    [tenantId, item.product_name.trim().toLowerCase().replace(/\s+/g, '_')]
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
        if (clientId) {
            const isCurrentAccount = payment_method === 'Cuenta Corriente'
                || (Array.isArray(payment_breakdown) && payment_breakdown.some(
                    (p) => p.method_type === 'cuenta_corriente' || p.method_name === 'Cuenta Corriente'
                ));
            if (isCurrentAccount) {
                await conn.query(
                    `UPDATE clients SET balance = balance - ?, last_updated = NOW()
                     WHERE tenant_id = ? AND id = ?`,
                    [safeTotal, tenantId, clientId]
                );
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
            for (const part of salePaymentParts) {
                await conn.query(
                    `INSERT INTO caja_movimientos
                     (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, client_id, branch_id, receipt_number, receipt_code, sale_id)
                     VALUES (?, 'venta', ?, 'Venta', ?, ?, ?, 'principal', ?, ?, ?, ?, ?, ?)`,
                    [
                        tenantId,
                        parseFloat(part.amount) || 0,
                        `Cobro ${saleReceiptLabel}`,
                        part.methodName,
                        part.methodType || inferPaymentTypeByName(part.methodName),
                        now,
                        clientId || null,
                        resolvedBranchId || null,
                        receipt_number || null,
                        receipt_code || null,
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
                `UPDATE promotions
                 SET used_kg = GREATEST(used_kg - ?, 0)
                 WHERE tenant_id = ? AND id = ?`,
                [usedKg, tenantId, promoId]
            );
        }

        // 1. Restaurar stock (movimiento positivo por cada item)
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
                    tenantId,
                    venta.branch_id || null,
                    productId,
                    String(item.product_name || '').trim(),
                    'venta',
                    parseFloat(item.quantity) || 0,
                    String(item.unit || 'kg').trim(),
                    `anulacion_venta_${saleId}`,
                ]
            );
        }

        // 2. Revertir balance cliente (solo cta cte)
        if (venta.clientId) {
            const isCurrentAccount = venta.payment_method === 'Cuenta Corriente'
                || (() => {
                    try {
                        const pb = typeof venta.payment_breakdown === 'string'
                            ? JSON.parse(venta.payment_breakdown) : venta.payment_breakdown;
                        return Array.isArray(pb) && pb.some(
                            (p) => p.method_type === 'cuenta_corriente' || p.method_name === 'Cuenta Corriente'
                        );
                    } catch { return false; }
                })();
            if (isCurrentAccount) {
                await conn.query(
                    `UPDATE clients SET balance = balance + ?, last_updated = NOW()
                     WHERE tenant_id = ? AND id = ?`,
                    [parseFloat(venta.total) || 0, tenantId, venta.clientId]
                );
            }
        }

        // 3. Registrar contramovimiento de caja (devolución) por la venta anulada
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
                     (tenant_id, type, amount, category, description, payment_method, payment_method_type, cash_account, date, client_id, branch_id, receipt_number, receipt_code, sale_id)
                     VALUES (?, 'anulacion_venta', ?, 'Anulación venta', ?, ?, ?, 'principal', NOW(), ?, ?, ?, ?, ?)`,
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
                    ]
                );
            }
        }

        // 4. Registrar en historial de eliminaciones
        const deletedByRaw = req.body?.deleted_by_user_id;
        const deletedByParsed = Number.parseInt(deletedByRaw, 10);
        const deletedBy = Number.isFinite(deletedByParsed) && deletedByParsed > 0
            ? deletedByParsed
            : null;
        const deletedByUsername = req.body?.deleted_by_username || 'Sistema';
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

        // 5. Eliminar items y venta
        await conn.query(`DELETE FROM ventas_items WHERE tenant_id = ? AND venta_id = ?`, [tenantId, saleId]);
        if (venta.ticket_barcode) {
            await conn.query(
                `UPDATE scale_bridge_ticket_map
                 SET ticket_status = 'voided',
                     voided_sale_id = ?,
                     voided_at = NOW()
                 WHERE tenant_id = ? AND UPPER(ticket_barcode) = UPPER(?)`,
                [saleId, tenantId, String(venta.ticket_barcode)]
            );
        }
        await conn.query(`DELETE FROM ventas WHERE tenant_id = ? AND id = ?`, [tenantId, saleId]);

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

            return res.json({
                ok: true,
                clients: rows,
            });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[INTERNAL ADMIN CLIENTS ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudieron leer los tenants' });
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

        const conn = await clientsControlPool.getConnection();
        let rows;
        try {
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
                 ORDER BY cu.id ASC`,
                [accessContext.client.id]
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
        const isRequesterAdmin = accessContext.user.role === 'admin';
        const requestedRole = String(role || 'employee').trim().toLowerCase();
        const effectiveRole = isRequesterAdmin ? 'employee' : requestedRole;

        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let insertId;
        let job;
        const normalizedRole = effectiveRole === 'admin' ? 'admin' : 'employee';
        const userPerms = normalizedRole === 'admin' ? [] : (Array.isArray(perms) ? perms : []);
        try {
            const [existingRows] = await conn.query(
                `SELECT id FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE clientId = ? AND LOWER(email) = ? LIMIT 1`,
                [ownerData.clientId, normalizeEmail(email)]
            );
            if (existingRows.length > 0) {
                return res.status(400).json({ error: 'Ese email ya existe para este cliente' });
            }

            const [result] = await conn.query(
                `INSERT INTO \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 (clientId, branchId, firebaseUid, name, lastname, email, role, status, isSynced, createdAt, updatedAt)
                 VALUES (?, NULL, NULL, ?, '', ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [
                    ownerData.clientId,
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

        const { email, password, username, role, active, perms, assignedClientLicenseIds = [] } = req.body || {};
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
            _internalAdmin: req.firebaseUser?._internalAdmin || null,
            _supportClientId: req.firebaseUser?._supportClientId || null,
        });
        assertClientAccess(accessContext);
        const isRequesterAdmin = accessContext.user.role === 'admin';
        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let currentData;
        try {
            const [rows] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE id = ? AND clientId = ? LIMIT 1`,
                [userId, ownerData.clientId]
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
        const safeRequestedRole = isRequesterAdmin && requestedRole === 'admin' ? 'employee' : requestedRole;
        const nextRole = safeRequestedRole === 'admin'
            ? 'admin'
            : (safeRequestedRole === 'employee' ? 'employee' : currentData.role || 'employee');
        const nextActive = active === undefined ? currentData.status === 'ACTIVE' : Number(active) === 1;
        const nextPerms = nextRole === 'admin' ? [] : (Array.isArray(perms) ? perms : []);

        const writeConn = await clientsControlPool.getConnection();
        let job;
        try {
            await writeConn.query(
                `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 SET name = ?, email = ?, role = ?, status = ?, isSynced = 0, updatedAt = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [nextUsername, nextEmail, nextRole, nextActive ? 'ACTIVE' : 'INACTIVE', userId]
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

        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let user;
        let job;
        try {
            const [rows] = await conn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` WHERE id = ? AND clientId = ? LIMIT 1`,
                [userId, ownerData.clientId]
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

        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let user;
        try {
            const [rows] = await conn.query(
                `SELECT id, firebaseUid, email, name, role, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 WHERE id = ? AND clientId = ? LIMIT 1`,
                [userId, ownerData.clientId]
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

            const payload = rows.map((row) => ({
                ...row,
                items: itemsByTransfer.get(row.id) || [],
                from_branch: branchesById.get(Number(row.from_branch_id)) || null,
                to_branch: branchesById.get(Number(row.to_branch_id)) || null,
            }));

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
                counterKey: 'remito',
                branchKey: 'branch_code',
                branchCodeOverride,
            });

            const note = String(req.body?.note || '').trim() || null;
            const createdBy = getAccessDisplayName(accessContext.user);

            const [result] = await conn.query(
                `INSERT INTO branch_transfers
                 (tenant_id, from_branch_id, to_branch_id, status, remito_number, remito_code, note,
                  created_by_user_id, created_by_username)
                 VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    fromBranchId,
                    toBranchId,
                    nextValue,
                    receiptCode,
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
        return res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo crear el remito' });
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
                    const [[stockRow]] = await conn.query(
                        `SELECT COALESCE(SUM(quantity), 0) AS total
                         FROM stock
                         WHERE tenant_id = ?
                           AND product_id = ?
                           AND (branch_id = ? OR branch_id IS NULL)`,
                        [tenantId, item.product_id, transfer.from_branch_id]
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

// ── RUTA: POST /api/cash/withdrawals/request-authorization ────────────────
app.post('/api/cash/withdrawals/request-authorization', verifyFirebaseToken, async (req, res) => {
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
app.post('/api/cash/withdrawals/verify-authorization', verifyFirebaseToken, async (req, res) => {
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

// ── RUTA: GET /health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    ok: true,
    ts: new Date(),
    redis: process.env.REDIS_HOST ? redisClient.isReady : false,
}));

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
        await connectRedisSafely();
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log(`MeatManager API corriendo en puerto ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('[AUTH STORE INIT ERROR]', err?.stack || err?.message || err);
        process.exit(1);
    });
