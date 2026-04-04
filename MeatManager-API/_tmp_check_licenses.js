require('dotenv').config({ path: '.env' });
const mysql = require('mysql2/promise');

async function main() {
    const email = process.argv[2];
    const conn = await mysql.createConnection({
        host: process.env.CLIENTS_DB_HOST || process.env.DB_HOST,
        port: Number(process.env.CLIENTS_DB_PORT || process.env.DB_PORT || 3306),
        user: process.env.CLIENTS_DB_USER || process.env.DB_USER,
        password: process.env.CLIENTS_DB_PASS || process.env.DB_PASS,
        database: process.env.CLIENTS_DB_NAME || 'GestionClientes',
    });

    const [rows] = await conn.query(
        `SELECT
            cu.id AS userId,
            cu.clientId,
            cu.branchId AS userBranchId,
            cu.email,
            cl.id AS clientLicenseId,
            cl.licenseId,
            cl.userId AS assignedUserId,
            cl.branchId AS assignedBranchId,
            cl.status AS assignmentStatus,
            l.commercialName,
            l.internalCode,
            l.category,
            l.appliesToWebapp,
            l.status AS licenseStatus
        FROM client_users cu
        LEFT JOIN client_licenses cl ON cl.clientId = cu.clientId
        LEFT JOIN licenses l ON l.id = cl.licenseId
        WHERE LOWER(cu.email) = LOWER(?)
        ORDER BY cl.id ASC`,
        [email]
    );

    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
