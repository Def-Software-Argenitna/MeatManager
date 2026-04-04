const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT || 'firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const CLIENTS_DB_NAME = process.env.CLIENTS_DB_NAME || 'GestionClientes';
const CLIENT_USERS_TABLE = process.env.CLIENT_USERS_TABLE || 'client_users';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

async function main() {
    const pool = mysql.createPool({
        host: process.env.CLIENTS_DB_HOST || process.env.DB_HOST,
        port: parseInt(process.env.CLIENTS_DB_PORT || process.env.DB_PORT, 10) || 3306,
        user: process.env.CLIENTS_DB_USER || process.env.DB_PROVISION_USER || process.env.DB_USER,
        password: process.env.CLIENTS_DB_PASS || process.env.DB_PROVISION_PASS || process.env.DB_PASS,
        waitForConnections: true,
        connectionLimit: 5,
    });

    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query(
            `SELECT id, email, firebaseUid, status
             FROM \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
             ORDER BY id ASC`
        );

        let linked = 0;
        let skipped = 0;
        let missing = 0;

        for (const row of rows) {
            const email = normalizeEmail(row.email);
            if (!email) {
                skipped += 1;
                console.log(`[SKIP] userId=${row.id} sin email`);
                continue;
            }

            try {
                const userRecord = await admin.auth().getUserByEmail(email);
                if (row.firebaseUid && row.firebaseUid === userRecord.uid) {
                    skipped += 1;
                    console.log(`[OK] userId=${row.id} ya enlazado a ${userRecord.uid}`);
                    continue;
                }

                await conn.query(
                    `UPDATE \`${CLIENTS_DB_NAME}\`.\`${CLIENT_USERS_TABLE}\`
                     SET firebaseUid = ?, isSynced = 1, updatedAt = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [userRecord.uid, row.id]
                );

                if (row.status === 'INACTIVE') {
                    await admin.auth().updateUser(userRecord.uid, { disabled: true });
                }

                linked += 1;
                console.log(`[LINK] userId=${row.id} email=${email} uid=${userRecord.uid}`);
            } catch (error) {
                if (error.code === 'auth/user-not-found') {
                    missing += 1;
                    console.log(`[MISS] userId=${row.id} email=${email} no existe en Firebase`);
                    continue;
                }
                throw error;
            }
        }

        console.log(`Resumen: linked=${linked} skipped=${skipped} missing=${missing}`);
    } finally {
        conn.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error('[RECONCILE ERROR]', error.message);
    process.exit(1);
});
