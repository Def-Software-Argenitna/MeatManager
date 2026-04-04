require('dotenv').config({ path: '.env' });
const mysql = require('mysql2/promise');

function normalizeLicenseToken(value) {
    return String(value || '').trim().toLowerCase();
}

function parseBooleanLike(value) {
    if (value == null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized);
}

function licenseAppliesToWebapp(license) {
    const code = normalizeLicenseToken(license?.internalCode);
    const category = normalizeLicenseToken(license?.category);
    const commercialName = normalizeLicenseToken(license?.commercialName);

    if (parseBooleanLike(license?.appliesToWebapp)) return true;
    if (category.includes('webapp')) return true;
    if (['base_mm', 'man_webpage', 'superuser', 'su'].includes(code)) return true;
    if (commercialName === 'superuser') return true;
    return false;
}

async function main() {
    const email = process.argv[2];
    const conn = await mysql.createConnection({
        host: process.env.CLIENTS_DB_HOST || process.env.DB_HOST,
        port: Number(process.env.CLIENTS_DB_PORT || process.env.DB_PORT || 3306),
        user: process.env.CLIENTS_DB_USER || process.env.DB_USER,
        password: process.env.CLIENTS_DB_PASS || process.env.DB_PASS,
        database: process.env.CLIENTS_DB_NAME || 'GestionClientes',
    });

    const [userRows] = await conn.query(
        `SELECT
            cu.id,
            cu.clientId,
            cu.branchId,
            cu.email
         FROM client_users cu
         WHERE LOWER(cu.email) = LOWER(?)
         LIMIT 1`,
        [email]
    );

    const user = userRows[0];
    if (!user) throw new Error('Usuario no encontrado');

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
         FROM client_licenses cl
         INNER JOIN licenses l
            ON l.id = cl.licenseId
         WHERE cl.clientId = ?
           AND cl.status = 'ACTIVE'
           AND l.status = 'ACTIVE'`,
        [user.clientId]
    );

    const effectiveLicenses = licenseRows
        .filter((license) => {
            if (!licenseAppliesToWebapp(license)) return false;

            const matchesUser = license.userId == null || String(license.userId) === String(user.id);
            const matchesBranch = license.branchId == null || String(license.branchId) === String(user.branchId);

            const isMandatoryBase =
                Number(license.isMandatory) === 1 ||
                normalizeLicenseToken(license.internalCode) === 'base_mm' ||
                normalizeLicenseToken(license.category) === 'base_webapp';

            return (matchesUser && matchesBranch) || isMandatoryBase;
        })
        .map((license) => ({
            clientLicenseId: license.clientLicenseId,
            licenseId: license.licenseId,
            commercialName: license.commercialName,
            internalCode: license.internalCode,
            category: license.category,
            billingScope: license.billingScope,
            appliesToWebapp: licenseAppliesToWebapp(license),
        }))
        .filter((license, index, arr) => (
            arr.findIndex((item) => String(item.clientLicenseId || '') === String(license.clientLicenseId || '')) === index
        ));

    console.log(JSON.stringify({ user, effectiveLicenses, licenseRows }, null, 2));
    await conn.end();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
