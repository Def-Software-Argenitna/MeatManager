// MeatManager API - Provisioning Multi-Tenant
// Genera y gestiona una BD MySQL por cada empresa (identificada por CUIT)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');

// ── Firebase Admin init ────────────────────────────────────────────────────
const serviceAccountPath = path.join(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT || 'firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── Express setup ──────────────────────────────────────────────────────────
const app = express();
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

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

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
const CLIENT_USERS_TABLE = process.env.CLIENT_USERS_TABLE || 'client_users';
const CLIENT_LICENSES_TABLE = process.env.CLIENT_LICENSES_TABLE || 'client_licenses';
const CLIENT_USER_PERMISSIONS_TABLE = process.env.CLIENT_USER_PERMISSIONS_TABLE || 'client_user_permissions';
const LICENSES_TABLE = process.env.LICENSES_TABLE || 'licenses';

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
                c.status AS clientStatus
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\` cu
             INNER JOIN \`${CLIENTS_DB_NAME}\`.\`${CLIENTS_TABLE}\` c
                ON c.id = cu.clientId
             WHERE (cu.firebaseUid = ? OR LOWER(cu.email) = ?)
             ORDER BY CASE WHEN cu.firebaseUid = ? THEN 0 ELSE 1 END, cu.id ASC
             LIMIT 1`,
            [uid || null, normalizedEmail, uid || null]
        );

        const user = rows[0];
        if (!user) return null;
        user.perms = await getUserPermissions(conn, user.id);

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

        const effectiveLicenses = licenseRows
            .filter((license) => {
                if (Number(license.appliesToWebapp) !== 1) return false;

                const matchesUser = license.userId == null || String(license.userId) === String(user.id);
                const matchesBranch = license.branchId == null || String(license.branchId) === String(user.branchId);

                return matchesUser && matchesBranch;
            })
            .map((license) => ({
                clientLicenseId: license.clientLicenseId,
                licenseId: license.licenseId,
                commercialName: license.commercialName,
                internalCode: license.internalCode,
                category: license.category,
                billingScope: license.billingScope,
                appliesToWebapp: Number(license.appliesToWebapp) === 1,
                featureFlags: parseFeatureFlags(license.featureFlags),
            }));

        return {
            user,
            client: {
                id: user.clientId,
                businessName: user.businessName,
                taxId: user.taxId,
                billingEmail: user.billingEmail,
                status: user.clientStatus,
            },
            effectiveLicenses,
        };
    } finally {
        conn.release();
    }
}

function assertClientAccess(accessContext) {
    if (!accessContext?.user) {
        const error = new Error('Usuario no encontrado en GestionClientes');
        error.statusCode = 404;
        throw error;
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
    if (!Array.isArray(accessContext.effectiveLicenses) || accessContext.effectiveLicenses.length === 0) {
        const error = new Error('El usuario no tiene licencias activas asignadas');
        error.statusCode = 403;
        throw error;
    }
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
        active: isActiveStatus(accessContext.user.userStatus, false) ? 1 : 0,
        perms: Array.isArray(accessContext.user.perms) ? accessContext.user.perms : [],
        clientId: accessContext.client.id,
        clientStatus: accessContext.client.status,
        licenses: accessContext.effectiveLicenses,
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
async function verifyFirebaseToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    try {
        const token = auth.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        req.firebaseUser = decoded;
        return next();
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

// ── Helper: nombre de BD seguro desde CUIT ────────────────────────────────
function dbNameFromCuit(cuit) {
    // Solo dígitos, prefijo mm_ para evitar conflictos
    const sanitized = String(cuit).replace(/\D/g, '');
    if (sanitized.length < 10) throw new Error('CUIT inválido');
    return `mm_${sanitized}`;
}

async function ensureTenantDatabase(cuit, empresa) {
    const dbName = dbNameFromCuit(cuit);
    const conn = await provisionPool.getConnection();

    try {
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
            \`key\`  VARCHAR(100) PRIMARY KEY,
            value   TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS payment_methods (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            name        VARCHAR(100) NOT NULL,
            type        VARCHAR(50),
            percentage  DECIMAL(5,2) DEFAULT 0,
            enabled     TINYINT(1) DEFAULT 1
        )`,
        `CREATE TABLE IF NOT EXISTS categories (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            name        VARCHAR(100) NOT NULL,
            parent_id   INT,
            synced      TINYINT(1) DEFAULT 0,
            FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS suppliers (
            id              INT AUTO_INCREMENT PRIMARY KEY,
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
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS purchase_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            name            VARCHAR(150) NOT NULL,
            category_id     INT,
            last_price      DECIMAL(12,2) DEFAULT 0,
            unit            VARCHAR(20),
            type            VARCHAR(50),
            species         VARCHAR(50),
            \`usage\`       VARCHAR(50),
            plu             VARCHAR(20),
            synced          TINYINT(1) DEFAULT 0,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS stock (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            name            VARCHAR(150) NOT NULL,
            type            VARCHAR(50),
            quantity        DECIMAL(12,3) DEFAULT 0,
            unit            VARCHAR(20),
            price           DECIMAL(12,2) DEFAULT 0,
            category_id     INT,
            reference       VARCHAR(100),
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            synced          TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS clients (
            id              INT AUTO_INCREMENT PRIMARY KEY,
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
            cuit            VARCHAR(20),
            balance         DECIMAL(12,2) DEFAULT 0,
            has_current_account TINYINT(1) DEFAULT 1,
            has_initial_balance TINYINT(1) DEFAULT 0,
            last_updated    DATETIME,
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS ventas (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            date                DATETIME NOT NULL,
            total               DECIMAL(12,2) NOT NULL,
            payment_method      VARCHAR(100),
            payment_method_id   INT,
            client_id           INT,
            clientId            INT,
            payment_breakdown   JSON,
            receipt_number      INT,
            receipt_code        VARCHAR(32),
            qendra_ticket_id    VARCHAR(100),
            source              VARCHAR(50),
            synced              TINYINT(1) DEFAULT 0,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ventas_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            venta_id        INT NOT NULL,
            product_name    VARCHAR(150),
            quantity        DECIMAL(12,3),
            price           DECIMAL(12,2),
            subtotal        DECIMAL(12,2),
            synced          TINYINT(1) DEFAULT 0,
            FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS compras (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            date            DATETIME NOT NULL,
            supplier        VARCHAR(150),
            supplier_id     INT,
            invoice_num     VARCHAR(50),
            total           DECIMAL(12,2),
            payment_method  VARCHAR(100),
            is_account      TINYINT(1) DEFAULT 0,
            synced          TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS compras_items (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            purchase_id     INT NOT NULL,
            product_name    VARCHAR(150),
            quantity        DECIMAL(12,3),
            weight          DECIMAL(12,3),
            unit_price      DECIMAL(12,2),
            subtotal        DECIMAL(12,2),
            destination     VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0,
            FOREIGN KEY (purchase_id) REFERENCES compras(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS animal_lots (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            purchase_id     INT,
            supplier        VARCHAR(150),
            date            DATETIME,
            species         VARCHAR(50),
            weight          DECIMAL(12,3),
            status          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS despostada_logs (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            type                VARCHAR(50),
            date                DATETIME,
            supplier            VARCHAR(150),
            total_weight        DECIMAL(12,3),
            yield_percentage    DECIMAL(5,2),
            lot_id              INT,
            synced              TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS pedidos (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            customer_id     INT,
            customer_name   VARCHAR(150),
            items           JSON,
            total           DECIMAL(12,2),
            status          VARCHAR(50),
            delivery_date   DATETIME,
            delivery_type   VARCHAR(50),
            address         VARCHAR(255),
            repartidor      VARCHAR(100),
            source          VARCHAR(50),
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            sync_cloud      TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS repartidores (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            name            VARCHAR(150),
            vehicle         VARCHAR(100),
            plate           VARCHAR(20),
            phone           VARCHAR(50),
            vtv_expiry      DATE,
            license_expiry  DATE,
            insurance_expiry DATE,
            status          VARCHAR(50),
            synced          TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS menu_digital (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            product_name    VARCHAR(150),
            price           DECIMAL(12,2),
            category        VARCHAR(100),
            is_offer        TINYINT(1) DEFAULT 0,
            synced          TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS caja_movimientos (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            type            VARCHAR(50),
            amount          DECIMAL(12,2),
            category        VARCHAR(100),
            description     VARCHAR(255),
            date            DATETIME,
            client_id       INT,
            payment_method  VARCHAR(100),
            payment_method_id INT,
            receipt_number  INT,
            receipt_code    VARCHAR(32),
            synced          TINYINT(1) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS deleted_sales_history (
            id                      INT AUTO_INCREMENT PRIMARY KEY,
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
            items_snapshot          LONGTEXT
        )`,
        `CREATE TABLE IF NOT EXISTS branch_stock_snapshots (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            branch_code     VARCHAR(20),
            branch_name     VARCHAR(150),
            snapshot_at     DATETIME,
            imported_at     DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            product_id      INT,
            price           DECIMAL(12,2),
            plu             VARCHAR(20),
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS users (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            username        VARCHAR(100) NOT NULL,
            pin             VARCHAR(20),
            role            ENUM('admin','employee') DEFAULT 'employee',
            active          TINYINT(1) DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS user_permissions (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_id         INT NOT NULL,
            path            VARCHAR(200) NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS app_logs (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            level           VARCHAR(20),
            message         TEXT,
            details         TEXT,
            timestamp       DATETIME,
            synced          TINYINT(1) DEFAULT 0
        )`,
    ];
}

// ── RUTA: POST /provision y /api/provision ─────────────────────────────────
// Verifica el token de Firebase, obtiene el CUIT del usuario en Firestore,
// crea la BD si no existe, devuelve la config de conexión.
async function handleProvision(req, res) {
    try {
        const ownerData = await getTenantClientData(req.firebaseUser);
        const { cuit, empresa } = ownerData;
        if (!cuit) {
            return res.status(403).json({ error: 'CUIT no configurado para este usuario' });
        }

        const { dbName, isNew } = await ensureTenantDatabase(cuit, empresa);

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
const tenantInfoCache = new Map();   // uid  → { dbName, cuit, empresa }
const tenantPools     = new Map();   // dbName → Pool
const tableColCache   = new Map();   // "dbName.table" → [colNames]

async function getTenantInfo(authUser) {
    const uid = typeof authUser === 'string' ? authUser : authUser?.uid;
    const email = typeof authUser === 'string' ? '' : authUser?.email;
    if (tenantInfoCache.has(uid)) return tenantInfoCache.get(uid);

    const accessContext = await getClientAccessContext({ uid, email });
    if (accessContext) {
        assertClientAccess(accessContext);
        const info = {
            dbName: dbNameFromCuit(accessContext.client.taxId),
            cuit: accessContext.client.taxId,
            empresa: accessContext.client.businessName,
            clientId: accessContext.client.id,
            licenses: accessContext.effectiveLicenses,
        };
        tenantInfoCache.set(uid, info);
        return info;
    }

    const firestoreDb = admin.firestore();
    const userDoc = await firestoreDb.collection('clientes').doc(uid).get();
    if (!userDoc.exists) throw new Error('Usuario no registrado como cliente');
    const { cuit, empresa } = userDoc.data();
    const dbName = dbNameFromCuit(cuit);
    const info = { dbName, cuit, empresa };
    tenantInfoCache.set(uid, info);
    return info;
}

async function getTenantClientData(authUser) {
    const uid = typeof authUser === 'string' ? authUser : authUser?.uid;
    const email = typeof authUser === 'string' ? '' : authUser?.email;
    const accessContext = await getClientAccessContext({ uid, email });
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
        };
    }

    const firestoreDb = admin.firestore();
    const userDoc = await firestoreDb.collection('clientes').doc(uid).get();
    if (!userDoc.exists) throw new Error('Usuario no registrado como cliente');
    return { id: userDoc.id, ...userDoc.data() };
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

async function getTableColumns(pool, dbName, table) {
    const key = `${dbName}.${table}`;
    if (tableColCache.has(key)) return tableColCache.get(key);
    const [rows] = await pool.query('DESCRIBE ??', [table]);
    const cols = rows.map(r => r.Field);
    tableColCache.set(key, cols);
    return cols;
}

// Tablas permitidas (whitelist contra inyección de nombres de tabla)
const ALLOWED_TABLES = new Set([
    'settings', 'payment_methods', 'categories', 'suppliers', 'purchase_items',
    'stock', 'clients', 'ventas', 'ventas_items', 'compras', 'compras_items',
    'animal_lots', 'despostada_logs', 'pedidos', 'repartidores', 'menu_digital',
    'caja_movimientos', 'prices', 'users', 'user_permissions',
    'deleted_sales_history', 'branch_stock_snapshots',
]);

// Columnas que MySQL gestiona solas y no se deben incluir en INSERT/UPDATE
const AUTO_COLS = new Set(['created_at', 'updated_at']);
const JSONISH_FIELDS = new Set(['items', 'payment_breakdown', 'sale_snapshot', 'items_snapshot']);

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

        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);

        // Helper: filtra el objeto para que solo tenga columnas válidas en MySQL
        const filterRecord = async (rec, excludeId = false) => {
            const validCols = await getTableColumns(pool, dbName, table);
            const out = {};
            for (const col of validCols) {
                if (AUTO_COLS.has(col)) continue;
                if (excludeId && col === 'id') continue;
                if (rec[col] !== undefined && rec[col] !== null) {
                    // Serializar objetos/arrays a JSON string para columnas JSON
                    out[col] = (typeof rec[col] === 'object') ? JSON.stringify(rec[col]) : rec[col];
                }
            }
            return out;
        };

        if (operation === 'insert') {
            if (!record) return res.status(400).json({ error: 'record requerido' });
            const filtered = await filterRecord(record, false); // incluir id si viene (Dexie lo manda)
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para insertar' });
            }
            const [result] = await pool.query('INSERT INTO ?? SET ?', [table, filtered]);
            return res.json({ ok: true, insertId: result.insertId });
        }

        if (operation === 'update') {
            const numId = parseInt(id, 10);
            if (!numId) return res.status(400).json({ error: 'id numérico requerido para update' });
            const filtered = await filterRecord(record, true); // excluir id del SET
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para actualizar' });
            }
            await pool.query('UPDATE ?? SET ? WHERE id = ?', [table, filtered, numId]);
            return res.json({ ok: true });
        }

        if (operation === 'delete') {
            const numId = parseInt(id, 10);
            if (!numId) return res.status(400).json({ error: 'id numérico requerido para delete' });
            await pool.query('DELETE FROM ?? WHERE id = ?', [table, numId]);
            return res.json({ ok: true });
        }

        if (operation === 'upsert') {
            // Para settings (PK = key) u otras tablas con ON DUPLICATE KEY UPDATE
            if (!record) return res.status(400).json({ error: 'record requerido' });
            const validCols = await getTableColumns(pool, dbName, table);
            const filtered = {};
            for (const col of validCols) {
                if (AUTO_COLS.has(col)) continue;
                if (record[col] !== undefined && record[col] !== null) {
                    filtered[col] = (typeof record[col] === 'object') ? JSON.stringify(record[col]) : record[col];
                }
            }
            if (Object.keys(filtered).length === 0) {
                return res.status(400).json({ error: 'Sin datos para upsert' });
            }
            const cols    = Object.keys(filtered).map(c => `\`${c}\``).join(', ');
            const vals    = Object.values(filtered);
            const holders = vals.map(() => '?').join(', ');
            const updates = Object.keys(filtered)
                .filter(c => c !== 'key' && c !== 'id')
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
        res.status(500).json({ error: 'Error de datos: ' + err.message });
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

        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const [rows] = await pool.query('SELECT `key`, value FROM settings WHERE `key` = ? LIMIT 1', [settingKey]);

        if (!rows.length) {
            return res.status(404).json({ ok: false, error: 'Setting no encontrada' });
        }

        return res.json({
            ok: true,
            key: rows[0].key,
            value: rows[0].value ?? null,
        });
    } catch (err) {
        console.error('[SETTINGS ERROR]', err.message);
        res.status(500).json({ error: 'Error leyendo settings: ' + err.message });
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
            : ['settings', 'users', 'user_permissions', 'payment_methods', 'categories', 'suppliers', 'purchase_items', 'clients', 'prices', 'stock'];

        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);

        const payload = {};
        for (const table of tables) {
            const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
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

        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const validCols = await getTableColumns(pool, dbName, table);
        const safeOrderBy = validCols.includes(orderBy) ? orderBy : (validCols.includes('id') ? 'id' : validCols[0]);

        const [rows] = await pool.query(
            `SELECT * FROM \`${table}\` ORDER BY \`${safeOrderBy}\` ${direction} LIMIT ? OFFSET ?`,
            [limit, offset]
        );

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

// ── RUTA: GET /api/users ───────────────────────────────────────────────────
// Devuelve usuarios y permisos en un solo payload para login/seguridad.
app.get('/api/users', verifyFirebaseToken, async (req, res) => {
    try {
        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);

        const [usersRows] = await pool.query('SELECT * FROM users ORDER BY id ASC');
        const [permRows] = await pool.query('SELECT * FROM user_permissions ORDER BY id ASC');

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

// ── RUTA: GET /api/firebase-users ──────────────────────────────────────────
// Lista usuarios web/Firebase de la misma empresa (mismo CUIT).
app.get('/api/firebase-users', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
        });
        assertClientAccess(accessContext);

        const conn = await clientsControlPool.getConnection();
        let rows;
        try {
            [rows] = await conn.query(
                `SELECT id, clientId, branchId, firebaseUid, name, lastname, email, role, status
                 FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                 WHERE clientId = ?
                 ORDER BY id ASC`,
                [accessContext.client.id]
            );
        } finally {
            conn.release();
        }

        const users = [];
        for (const row of rows) {
            const perms = await getUserPermissions(conn, row.id);
            const baseUser = buildAccessResponse({
                user: {
                    ...row,
                    userStatus: row.status,
                    perms,
                },
                client: accessContext.client,
                effectiveLicenses: accessContext.effectiveLicenses,
            });
            users.push({
                ...baseUser,
                perms,
            });
        }
        return res.json({ ok: true, users });
    } catch (err) {
        console.error('[FIREBASE USERS READ ERROR]', err.message);
        return res.status(500).json({ error: 'No se pudieron leer los usuarios web' });
    }
});

// ── RUTA: GET /api/firebase-users/me ───────────────────────────────────────
// Devuelve el perfil web/Firebase del usuario autenticado.
app.get('/api/firebase-users/me', verifyFirebaseToken, async (req, res) => {
    try {
        const accessContext = await getClientAccessContext({
            uid: req.firebaseUser.uid,
            email: req.firebaseUser.email,
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
        const { email, password, username, role = 'employee', active = 1, perms = [] } = req.body || {};

        if (!email || !String(email).trim()) {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!password || String(password).length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        if (!username || !String(username).trim()) {
            return res.status(400).json({ error: 'Nombre de usuario requerido' });
        }

        const ownerData = await getTenantClientData(req.firebaseUser);
        const conn = await clientsControlPool.getConnection();
        let insertId;
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
                    role === 'admin' ? 'admin' : 'employee',
                    Number(active) === 1 ? 'ACTIVE' : 'INACTIVE',
                ]
            );
            insertId = result.insertId;
            await enqueueAuthSync(conn, insertId, 'CREATE_FIREBASE', {
                action: 'CREATE',
                email: normalizeEmail(email),
                password: String(password),
                username: String(username).trim(),
                active: Number(active) === 1 ? 1 : 0,
            });
        } finally {
            conn.release();
        }

        const queueConn = await clientsControlPool.getConnection();
        let job;
        try {
            const [jobs] = await queueConn.query(
                `SELECT * FROM \`${CLIENTS_DB_NAME}\`.auth_sync_queue WHERE entityId = ? ORDER BY id DESC LIMIT 1`,
                [insertId]
            );
            job = jobs[0];
        } finally {
            queueConn.release();
        }

        const syncResult = await runClientUserSync(job);
        const userPerms = role === 'admin' ? [] : (Array.isArray(perms) ? perms : []);
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
                role: role === 'admin' ? 'admin' : 'employee',
                active: Number(active) === 1 ? 1 : 0,
                perms: userPerms,
            },
        });
    } catch (err) {
        console.error('[FIREBASE USER CREATE ERROR]', err.message);
        if (err.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'Ese email ya existe en Firebase' });
        }
        return res.status(500).json({ error: 'No se pudo crear el usuario web' });
    }
});

// ── RUTA: PATCH /api/firebase-users/:id ────────────────────────────────────
app.patch('/api/firebase-users/:id', verifyFirebaseToken, async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) {
            return res.status(400).json({ error: 'Usuario inválido' });
        }

        const { email, password, username, role, active, perms } = req.body || {};
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
        const nextRole = role === 'admin' ? 'admin' : (role === 'employee' ? 'employee' : currentData.role || 'employee');
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
        return res.status(500).json({ error: 'No se pudo actualizar el usuario web' });
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
        return res.status(500).json({ error: 'No se pudo eliminar el usuario web' });
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

        const { dbName } = await getTenantInfo(req.firebaseUser);
        const pool = getTenantPool(dbName);
        const tenantConn = await pool.getConnection();

        try {
            await tenantConn.beginTransaction();

            const [counterRows] = await tenantConn.query(
                'SELECT `key`, value FROM settings WHERE `key` = ? FOR UPDATE',
                [counterKey]
            );

            const currentValue = Number(counterRows[0]?.value || 0);
            const nextValue = currentValue + 1;

            await tenantConn.query(
                'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
                [counterKey, String(nextValue)]
            );

            const [branchRows] = await tenantConn.query(
                'SELECT value FROM settings WHERE `key` = ? LIMIT 1',
                [branchKey]
            );

            const branchCode = Number(branchRows[0]?.value || 1);
            const receiptCode = `${String(branchCode).padStart(4, '0')}-${String(nextValue).padStart(6, '0')}`;

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

// ── RUTA: GET /health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date() }));

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
ensureClientsControlStore()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`MeatManager API corriendo en puerto ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('[AUTH STORE INIT ERROR]', err.message);
        process.exit(1);
    });
