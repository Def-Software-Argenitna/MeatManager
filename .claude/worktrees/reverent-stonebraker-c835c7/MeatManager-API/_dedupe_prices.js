const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const OPERATIONAL_DB_NAME = process.env.OPERATIONAL_DB_NAME || process.env.MEATMANAGER_DB_NAME || 'meatmanager';
const APPLY = process.argv.includes('--apply');

const getConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_PROVISION_USER || process.env.DB_USER,
    password: process.env.DB_PROVISION_PASS || process.env.DB_PASS,
    database: OPERATIONAL_DB_NAME,
});

const getDuplicateSummary = async (conn) => {
    const [[byRef]] = await conn.query(
        `SELECT COALESCE(SUM(x.c - 1), 0) AS duplicate_rows
         FROM (
            SELECT tenant_id, product_ref_id, COUNT(*) AS c
            FROM prices
            WHERE product_ref_id IS NOT NULL
            GROUP BY tenant_id, product_ref_id
            HAVING COUNT(*) > 1
         ) x`
    );

    const [[byLegacyProductId]] = await conn.query(
        `SELECT COALESCE(SUM(x.c - 1), 0) AS duplicate_rows
         FROM (
            SELECT tenant_id, LOWER(TRIM(product_id)) AS normalized_product_id, COUNT(*) AS c
            FROM prices
            WHERE (product_ref_id IS NULL OR product_ref_id = 0)
              AND product_id IS NOT NULL
              AND TRIM(product_id) <> ''
            GROUP BY tenant_id, LOWER(TRIM(product_id))
            HAVING COUNT(*) > 1
         ) x`
    );

    return {
        byRef: Number(byRef?.duplicate_rows || 0),
        byLegacyProductId: Number(byLegacyProductId?.duplicate_rows || 0),
        total: Number(byRef?.duplicate_rows || 0) + Number(byLegacyProductId?.duplicate_rows || 0),
    };
};

const normalizeLegacyIds = async (conn) => {
    const [result] = await conn.query(
        `UPDATE prices
         SET product_id = LOWER(REPLACE(TRIM(product_id), ' ', '_'))
         WHERE product_id IS NOT NULL
           AND TRIM(product_id) <> ''
           AND product_id <> LOWER(REPLACE(TRIM(product_id), ' ', '_'))`
    );
    return Number(result?.affectedRows || 0);
};

const dedupeByProductRefId = async (conn) => {
    const [result] = await conn.query(
        `DELETE p1
         FROM prices p1
         JOIN prices p2
           ON p1.tenant_id = p2.tenant_id
          AND p1.product_ref_id = p2.product_ref_id
          AND p1.product_ref_id IS NOT NULL
          AND (
                COALESCE(p1.updated_at, '1970-01-01 00:00:00') < COALESCE(p2.updated_at, '1970-01-01 00:00:00')
             OR (
                    COALESCE(p1.updated_at, '1970-01-01 00:00:00') = COALESCE(p2.updated_at, '1970-01-01 00:00:00')
                AND p1.id < p2.id
             )
          )`
    );
    return Number(result?.affectedRows || 0);
};

const dedupeByLegacyProductId = async (conn) => {
    const [result] = await conn.query(
        `DELETE p1
         FROM prices p1
         JOIN prices p2
           ON p1.tenant_id = p2.tenant_id
          AND (p1.product_ref_id IS NULL OR p1.product_ref_id = 0)
          AND (p2.product_ref_id IS NULL OR p2.product_ref_id = 0)
          AND p1.product_id IS NOT NULL
          AND p2.product_id IS NOT NULL
          AND TRIM(p1.product_id) <> ''
          AND TRIM(p2.product_id) <> ''
          AND LOWER(TRIM(p1.product_id)) = LOWER(TRIM(p2.product_id))
          AND (
                COALESCE(p1.updated_at, '1970-01-01 00:00:00') < COALESCE(p2.updated_at, '1970-01-01 00:00:00')
             OR (
                    COALESCE(p1.updated_at, '1970-01-01 00:00:00') = COALESCE(p2.updated_at, '1970-01-01 00:00:00')
                AND p1.id < p2.id
             )
          )`
    );
    return Number(result?.affectedRows || 0);
};

(async () => {
    const conn = await getConnection();
    try {
        console.log(`DB objetivo: ${OPERATIONAL_DB_NAME}`);
        const before = await getDuplicateSummary(conn);
        console.log('Duplicados detectados (antes):', before);

        if (!APPLY) {
            console.log('Modo DRY-RUN. No se hicieron cambios.');
            console.log('Para aplicar limpieza real: node _dedupe_prices.js --apply');
            return;
        }

        await conn.beginTransaction();

        const normalizedRows = await normalizeLegacyIds(conn);
        const deletedByRef = await dedupeByProductRefId(conn);
        const deletedByLegacy = await dedupeByLegacyProductId(conn);

        await conn.commit();

        const after = await getDuplicateSummary(conn);
        console.log('Filas normalizadas (product_id):', normalizedRows);
        console.log('Filas eliminadas por product_ref_id:', deletedByRef);
        console.log('Filas eliminadas por product_id legado:', deletedByLegacy);
        console.log('Duplicados detectados (después):', after);
        console.log('Limpieza completada.');
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        console.error('ERROR limpiando prices:', error.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();

