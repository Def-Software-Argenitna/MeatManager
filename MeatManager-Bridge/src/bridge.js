const {
    query: firebirdQuery,
    getColumns,
    tableExists,
    firstMatchingColumn,
} = require('./firebird');
const { query: mysqlQuery, execute: mysqlExecute, withTransaction } = require('./mysql');
const {
    normalizeText,
    hashObject,
    hashText,
    formatTicketBarcode,
    toNumber,
    toDate,
    decodeFirebirdText,
} = require('./helpers');
const { ensureBridgeSchema } = require('./schema');
const fs = require('fs');

function chunkArray(values, size) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}

function asText(value) {
    return normalizeText(decodeFirebirdText(value));
}

function firebirdValue(value) {
    if (value === undefined) return null;
    if (value instanceof Date) return value;
    return value;
}

function inferTipoVenta(unit) {
    const normalized = normalizeText(unit).toLowerCase();
    if (!normalized) return 0;
    if (['kg', 'kilo', 'kilos', 'gr', 'gramo', 'gramos'].includes(normalized)) {
        return 0;
    }
    return 1;
}

function applyPluDefaults(row, columns, price) {
    const numericZeroColumns = [
        'PORC_AGUA',
        'TN_PORCIONES_ENVASE',
        'TN_PESO_PORCION',
        'TN_CAL_PORCION',
        'TN_CARBOHIDRATOS',
        'TN_AZUCARES_TOTALES',
        'TN_AZUCARES_AGREGADOS',
        'TN_PROTEINAS',
        'TN_GRASAS_TOT',
        'TN_GRASAS_SAT',
        'TN_GRASAS_TRANS',
        'TN_FIBRA',
        'TN_SODIO',
        'TN_COLESTEROL',
        'TN_VITAMINA_D',
        'TN_CALCIO',
        'TN_HIERRO',
        'TN_POTASIO',
        'PRECIO_PROMO_2',
        'PRECIO_PROMO_3',
        'PRECIO_PROMO_4',
        'PRECIO_PROMO_5',
        'RANGO_PROMO_1',
        'RANGO_PROMO_2',
        'RANGO_PROMO_3',
        'RANGO_PROMO_4',
        'RANGO_PROMO_5',
    ];
    for (const column of numericZeroColumns) {
        if (columns.includes(column) && (row[column] === undefined || row[column] === null)) {
            row[column] = 0;
        }
    }

    const integerZeroColumns = ['IMPFLAG', 'VENCIMIENTO'];
    for (const column of integerZeroColumns) {
        if (columns.includes(column) && (row[column] === undefined || row[column] === null)) {
            row[column] = 0;
        }
    }

    const stringEmptyColumns = ['TN_MEDIDA_CASERA', 'TN_DESC', 'LOTE', 'EAN_CFG', 'MODIFBY'];
    for (const column of stringEmptyColumns) {
        if (columns.includes(column) && (row[column] === undefined || row[column] === null)) {
            row[column] = column === 'MODIFBY' ? 'BRIDGE' : '';
        }
    }

    if (columns.includes('TN_ACTIVA') && (row.TN_ACTIVA === undefined || row.TN_ACTIVA === null)) row.TN_ACTIVA = 0;
    if (columns.includes('EAN_TIPO') && (row.EAN_TIPO === undefined || row.EAN_TIPO === null)) row.EAN_TIPO = 2;
    if (columns.includes('PRECIO_PROMO_1') && (row.PRECIO_PROMO_1 === undefined || row.PRECIO_PROMO_1 === null)) row.PRECIO_PROMO_1 = price;
    if (columns.includes('ID_ORIGEN') && row.ID_ORIGEN === undefined) row.ID_ORIGEN = null;
    if (columns.includes('ID_CONSERV') && row.ID_CONSERV === undefined) row.ID_CONSERV = null;
    if (columns.includes('ID_RECING') && row.ID_RECING === undefined) row.ID_RECING = null;
}

function isMeatCategory(category) {
    const normalized = normalizeText(category).toLowerCase();
    if (!normalized) return false;
    return [
        'vaca',
        'vacuno',
        'res',
        'carne',
        'carnes',
        'carniceria',
        'cerdo',
        'pollo',
        'ave',
        'aves',
        'cordero',
        'chivo',
        'embutidos',
        'fiambres',
    ].includes(normalized);
}

class QendraBridge {
    constructor({ config, logger, state, stateStore, mysqlPool }) {
        this.config = config;
        this.logger = logger;
        this.state = state;
        this.stateStore = stateStore;
        this.mysqlPool = mysqlPool;
        this.runtimeReady = false;
    }

    async ensureRuntime() {
        if (this.runtimeReady) return;
        await this.ensureImportDatabase();
        await this.normalizeFirebirdCompatibility();
        await ensureBridgeSchema(this.mysqlPool, this.logger);
        await mysqlExecute(
            this.mysqlPool,
            `INSERT INTO qendra_bridge_devices (device_id, bridge_name, site_name, last_seen_at, status)
             VALUES (?, ?, ?, NOW(), 'online')
             ON DUPLICATE KEY UPDATE
                bridge_name = VALUES(bridge_name),
                site_name = VALUES(site_name),
                last_seen_at = VALUES(last_seen_at),
                status = VALUES(status)`,
            [this.config.deviceId, this.config.bridgeName, this.config.siteName || null]
        );

        await mysqlExecute(
            this.mysqlPool,
            `INSERT INTO qendra_bridge_sync_state (device_id, last_product_sync_at, last_ticket_sync_at, last_success_at)
             VALUES (?, NULL, NULL, NULL)
             ON DUPLICATE KEY UPDATE device_id = VALUES(device_id)`,
            [this.config.deviceId]
        );

        this.runtimeReady = true;
    }

    async normalizeFirebirdCompatibility() {
        const databases = [this.config.firebird];
        const importFirebird = this.getImportFirebirdConfig();
        if (importFirebird.dbFile && importFirebird.dbFile !== this.config.firebird.dbFile && fs.existsSync(importFirebird.dbFile)) {
            databases.push(importFirebird);
        }

        for (const firebirdConfig of databases) {
            await this.normalizeEquiposDefaults(firebirdConfig);
            await this.normalizePluDefaults(firebirdConfig);
        }
    }

    async normalizeEquiposDefaults(firebirdConfig) {
        try {
            if (!(await tableExists(firebirdConfig, 'EQUIPOS'))) return;
            const defaults = {
                UNIDAD_PESAJE: 1,
                SUBVERSION: 0,
                PUERTO_IP: 0,
                CANT_DEC_CFG_CHANGED: 0,
                CHECK_DIGIT_PRICE: 0,
                CHECK_DIGIT_PRICE_CFG_CHANGED: 0,
            };
            const columns = await getColumns(firebirdConfig, 'EQUIPOS');
            for (const [column, value] of Object.entries(defaults)) {
                if (!columns.includes(column)) continue;
                await firebirdQuery(
                    firebirdConfig,
                    `UPDATE EQUIPOS SET ${column} = ? WHERE ${column} IS NULL`,
                    [value]
                );
            }
        } catch (error) {
            this.logger.warn('No se pudo normalizar EQUIPOS en Firebird', {
                dbFile: firebirdConfig.dbFile,
                error: error.message,
            });
        }
    }

    async normalizePluDefaults(firebirdConfig) {
        try {
            if (!(await tableExists(firebirdConfig, 'PLU'))) return;
            const defaults = {
                IMPFLAG: 0,
                VENCIMIENTO: 0,
                TN_ACTIVA: 0,
                EAN_TIPO: 2,
            };
            const columns = await getColumns(firebirdConfig, 'PLU');
            for (const [column, value] of Object.entries(defaults)) {
                if (!columns.includes(column)) continue;
                await firebirdQuery(
                    firebirdConfig,
                    `UPDATE PLU SET ${column} = ? WHERE ${column} IS NULL`,
                    [value]
                );
            }
        } catch (error) {
            this.logger.warn('No se pudo normalizar PLU en Firebird', {
                dbFile: firebirdConfig.dbFile,
                error: error.message,
            });
        }
    }

    async ensureImportDatabase() {
        const importDb = this.getImportFirebirdConfig();
        if (fs.existsSync(importDb.dbFile)) {
            return;
        }

        const template = this.config.firebird.templateDbFile;
        if (!template || !fs.existsSync(template)) {
            throw new Error(`No existe la plantilla Firebird de importacion: ${template}`);
        }

        fs.copyFileSync(template, importDb.dbFile);
        this.logger.info('Base Firebird de importacion creada desde plantilla', {
            importDb: importDb.dbFile,
            template,
        });
    }

    getImportFirebirdConfig() {
        return {
            ...this.config.firebird,
            dbFile: this.config.firebird.importDbFile || this.config.firebird.dbFile,
        };
    }

    getImportWorkFirebirdConfig() {
        return {
            ...this.config.firebird,
            dbFile: this.config.firebird.importWorkDbFile || this.config.firebird.importDbFile || this.config.firebird.dbFile,
        };
    }

    async prepareImportWorkDatabase() {
        const importDb = this.getImportFirebirdConfig();
        if (this.config.firebird.importDirectWrite) {
            return importDb;
        }

        const workDb = this.getImportWorkFirebirdConfig();
        const source = fs.existsSync(importDb.dbFile)
            ? importDb.dbFile
            : this.config.firebird.templateDbFile;

        if (!source || !fs.existsSync(source)) {
            throw new Error(`No existe el origen para preparar la base de trabajo: ${source}`);
        }

        fs.copyFileSync(source, workDb.dbFile);
        return workDb;
    }

    async syncImportEquipmentsFromLive(importFirebirdConfig) {
        if (!importFirebirdConfig || importFirebirdConfig.dbFile === this.config.firebird.dbFile) {
            return;
        }

        if (!(await tableExists(this.config.firebird, 'EQUIPOS')) || !(await tableExists(importFirebirdConfig, 'EQUIPOS'))) {
            return;
        }

        const sourceColumns = await getColumns(this.config.firebird, 'EQUIPOS');
        const targetColumns = await getColumns(importFirebirdConfig, 'EQUIPOS');
        const sharedColumns = targetColumns.filter((column) => sourceColumns.includes(column));
        if (!sharedColumns.includes('IP')) return;

        const rows = await firebirdQuery(
            this.config.firebird,
            `SELECT ${sharedColumns.map((column) => `"${column}"`).join(', ')}
             FROM EQUIPOS
             WHERE COALESCE(PUERTO, 0) > 0 OR COALESCE(ESTADO, 0) IN (1, 3)`
        );

        for (const row of rows) {
            await this.upsertFirebirdRow(importFirebirdConfig, 'EQUIPOS', 'IP', row, targetColumns);
        }

        // Also copy EQ_SECCION so Qendra knows which sections each equipment handles
        if (
            (await tableExists(this.config.firebird, 'EQ_SECCION'))
            && (await tableExists(importFirebirdConfig, 'EQ_SECCION'))
        ) {
            const srcEqSec = await getColumns(this.config.firebird, 'EQ_SECCION');
            const tgtEqSec = await getColumns(importFirebirdConfig, 'EQ_SECCION');
            const sharedEqSec = tgtEqSec.filter((c) => srcEqSec.includes(c));
            if (sharedEqSec.includes('IP') && sharedEqSec.includes('ID_SECCION')) {
                const equipIps = rows.map((r) => String(r.IP ?? '').trim()).filter(Boolean);
                if (equipIps.length > 0) {
                    const placeholders = equipIps.map(() => '?').join(', ');
                    const eqSecRows = await firebirdQuery(
                        this.config.firebird,
                        `SELECT ${sharedEqSec.map((c) => `"${c}"`).join(', ')}
                         FROM EQ_SECCION
                         WHERE IP IN (${placeholders})`,
                        equipIps
                    );
                    for (const eqSecRow of eqSecRows) {
                        await this.upsertCompositeFirebirdRow(
                            importFirebirdConfig,
                            'EQ_SECCION',
                            ['IP', 'ID_SECCION'],
                            eqSecRow,
                            tgtEqSec
                        );
                    }
                }
            }
        }
    }

    async publishImportDatabase(workDb) {
        const importDb = this.getImportFirebirdConfig();
        if (!workDb || workDb.dbFile === importDb.dbFile) {
            return;
        }

        const attempts = 5;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                fs.copyFileSync(workDb.dbFile, importDb.dbFile);
                const now = new Date();
                fs.utimesSync(importDb.dbFile, now, now);
                this.logger.info('Base Firebird de importacion publicada', {
                    importDb: importDb.dbFile,
                    workDb: workDb.dbFile,
                    attempt,
                });
                return;
            } catch (error) {
                if (attempt === attempts) {
                    throw new Error(`No se pudo publicar la base de importacion: ${error.message}`);
                }
                await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
            }
        }
    }

    async loadSyncState() {
        const rows = await mysqlQuery(
            this.mysqlPool,
            `SELECT * FROM qendra_bridge_sync_state WHERE device_id = ? LIMIT 1`,
            [this.config.deviceId]
        );
        return rows[0] || null;
    }

    async writeSyncState(patch) {
        const updates = [];
        const params = [];
        for (const [key, value] of Object.entries(patch)) {
            updates.push(`\`${key}\` = ?`);
            params.push(value);
        }
        if (updates.length === 0) return;
        params.push(this.config.deviceId);
        await mysqlExecute(
            this.mysqlPool,
            `UPDATE qendra_bridge_sync_state SET ${updates.join(', ')}, updated_at = NOW() WHERE device_id = ?`,
            params
        );
    }

    async recordLog(direction, entityType, entityKey, status, message, payload = null) {
        try {
            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO qendra_bridge_sync_log
                 (device_id, direction, entity_type, entity_key, status, message, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    this.config.deviceId,
                    direction,
                    entityType,
                    entityKey,
                    status,
                    message,
                    payload ? JSON.stringify(payload) : null,
                ]
            );
        } catch (error) {
            this.logger.warn('No se pudo escribir el log de sincronizacion en MySQL', { error: error.message });
        }
    }

    async runOnce() {
        await this.ensureRuntime();
        const startedAt = new Date();
        const result = {
            startedAt: startedAt.toISOString(),
            products: null,
            tickets: null,
        };

        try {
            const currentState = await this.loadSyncState();
            result.products = await this.syncProducts(currentState);
            result.tickets = await this.syncTickets(currentState);
            result.ok = true;

            const finishedAt = new Date();
            this.state.lastRunAt = finishedAt.toISOString();
            this.state.lastRunStatus = 'ok';
            this.state.lastRunMessage = 'Sincronizacion completada';
            this.state.lastError = null;
            this.state.lastProductSyncAt = finishedAt.toISOString();
            this.state.lastTicketSyncAt = finishedAt.toISOString();
            this.stateStore.save(this.state);

            await this.writeSyncState({
                last_product_sync_at: finishedAt,
                last_ticket_sync_at: finishedAt,
                last_success_at: finishedAt,
                last_error_at: null,
                last_error_message: null,
                cursor_product: this.state.productCursor || null,
                cursor_ticket: this.state.ticketCursor || null,
            });

            return result;
        } catch (error) {
            const finishedAt = new Date();
            this.state.lastRunAt = finishedAt.toISOString();
            this.state.lastRunStatus = 'error';
            this.state.lastRunMessage = error.message;
            this.state.lastError = error.message;
            this.stateStore.save(this.state);

            await this.writeSyncState({
                last_error_at: finishedAt,
                last_error_message: error.message,
            });

            this.logger.error('Fallo la sincronizacion general', { error: error.message });
            result.ok = false;
            result.error = error.message;
            return result;
        }
    }

    async syncProducts(syncState) {
        const since = syncState?.last_product_sync_at || null;
        this.logger.info('Sincronizando productos desde MySQL hacia Firebird', { since });

        const params = [this.config.tenantId];
        let sql = `
            SELECT id, canonical_key, name, category, unit, current_price, plu, updated_at
            FROM products
            WHERE tenant_id = ?
              AND COALESCE(current_price, 0) > 0`;
        if (since) {
            sql += ` AND COALESCE(updated_at, created_at) > ?`;
            params.push(since);
        }
        sql += ` ORDER BY updated_at ASC, id ASC`;

        const products = await mysqlQuery(this.mysqlPool, sql, params);
        if (products.length === 0) {
            this.logger.info('No hay productos nuevos para sincronizar');
            return { ok: true, processed: 0, skipped: 0 };
        }

        const summary = { ok: true, processed: 0, skipped: 0, written: 0 };
        const targetMode = this.config.firebird.productTarget === 'import' ? 'import' : 'live';
        const targetFirebird = targetMode === 'import'
            ? await this.prepareImportWorkDatabase()
            : this.config.firebird;

        if (targetMode === 'import') {
            await this.syncImportEquipmentsFromLive(targetFirebird);
        }

        const hasPlu = await tableExists(targetFirebird, 'PLU');
        if (!hasPlu) {
            throw new Error('La tabla PLU no existe en Firebird');
        }

        const pluColumns = await getColumns(targetFirebird, 'PLU');
        const sectionMap = await this.loadSectionMap(targetFirebird);
        const sectionColumns = await getColumns(targetFirebird, 'SECCIONES').catch(() => []);

        // Track sections already ensured this cycle to avoid redundant Firebird calls
        const ensuredSections = new Set();
        // Cache loadTargetEquipments results per sectionId within this cycle
        const targetEquipmentsCache = new Map();

        for (const product of products) {
            summary.processed += 1;
            const pluId = String(product.plu || product.id);
            const productFingerprint = hashObject({
                pluId,
                name: product.name,
                category: product.category,
                unit: product.unit,
                current_price: product.current_price,
                updated_at: product.updated_at,
            });

            const description = asText(product.name).slice(0, 250) || `Producto ${pluId}`;
            const sectionId = this.resolveSectionId(product.category, sectionMap) || this.config.firebird.defaultSectionId;
            const price = toNumber(product.current_price, 0);
            const row = {
                ID: Number.isNaN(Number(pluId)) ? pluId : Number(pluId),
                ID_SECCION: sectionColumns.includes('ID_SECCION') ? sectionId : sectionId,
                DESCRIPCION: description,
                PRECIO: price,
            };
            if (pluColumns.includes('COD_LOCAL')) row.COD_LOCAL = String(pluId);
            if (pluColumns.includes('TIPO_VENTA')) row.TIPO_VENTA = inferTipoVenta(product.unit);
            if (pluColumns.includes('PRECIO2')) row.PRECIO2 = price;
            if (pluColumns.includes('TARA')) row.TARA = 0;
            if (pluColumns.includes('VENCIMIENTO')) row.VENCIMIENTO = null;
            if (pluColumns.includes('ULTIMA_MODIF')) row.ULTIMA_MODIF = new Date();
            if (pluColumns.includes('IMPFLAG')) row.IMPFLAG = 0;
            applyPluDefaults(row, pluColumns, price);

            if (!ensuredSections.has(String(sectionId))) {
                await this.ensureImportSection(targetFirebird, sectionId, product.category);
                await this.ensureSectionAssignedToEquipments(targetFirebird, sectionId);
                ensuredSections.add(String(sectionId));
            }
            if (!targetEquipmentsCache.has(String(sectionId))) {
                targetEquipmentsCache.set(String(sectionId), await this.loadTargetEquipments(targetFirebird, sectionId));
            }
            const expectedTargets = targetEquipmentsCache.get(String(sectionId));
            const assignmentsReady = await this.areProductAssignmentsReady(targetFirebird, {
                pluId,
                numero: row.COD_LOCAL || String(pluId),
                sectionId,
                targets: expectedTargets,
            });

            const mapRows = await mysqlQuery(
                this.mysqlPool,
                `SELECT * FROM qendra_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND (product_id = ? OR firebird_plu_id = ?)
                 LIMIT 1`,
                [this.config.deviceId, this.config.tenantId, product.id, pluId]
            );
            const mapRow = mapRows[0] || null;
            // If fingerprint matches (all product fields unchanged) and assignments are ready, skip.
            // The fingerprint covers name/category/price/unit/updated_at so trusting it is safe.
            if (mapRow && mapRow.fingerprint === productFingerprint && assignmentsReady) {
                summary.skipped += 1;
                continue;
            }

            await this.upsertFirebirdRow(targetFirebird, 'PLU', 'ID', row, pluColumns);
            const targets = await this.ensureProductAssignments(targetFirebird, {
                pluId,
                numero: row.COD_LOCAL || String(pluId),
                sectionId,
            });
            await this.markProductNeedsSync(targetFirebird, {
                pluId,
                numero: row.COD_LOCAL || String(pluId),
                targets,
            });

            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO qendra_bridge_product_map
                 (device_id, tenant_id, product_id, firebird_plu_id, firebird_section_id, fingerprint, last_source_update, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    firebird_plu_id = VALUES(firebird_plu_id),
                    firebird_section_id = VALUES(firebird_section_id),
                    fingerprint = VALUES(fingerprint),
                    last_source_update = VALUES(last_source_update),
                    synced_at = VALUES(synced_at)`,
                [
                    this.config.deviceId,
                    this.config.tenantId,
                    product.id,
                    pluId,
                    String(sectionId),
                    productFingerprint,
                    product.updated_at || product.created_at || null,
                ]
            );

            summary.written += 1;
            await this.recordLog('mysql-to-firebird', 'notification', String(pluId), 'ok', targetMode === 'import' ? 'Producto escrito en base de importacion de Qendra' : 'Producto escrito en base viva de Qendra', {
                pluId,
                targetDb: targetFirebird.dbFile,
            });
        }

        if (targetMode === 'import' && summary.written > 0) {
            await this.publishImportDatabase(targetFirebird);
        } else if (targetMode === 'import' && fs.existsSync(targetFirebird.dbFile) && targetFirebird.dbFile !== this.getImportFirebirdConfig().dbFile) {
            try {
                fs.unlinkSync(targetFirebird.dbFile);
            } catch {
                // noop
            }
        }

        this.state.productCursor = new Date().toISOString();
        this.state.lastProductSyncAt = this.state.productCursor;
        this.stateStore.save(this.state);

        this.logger.info('Sincronizacion de productos finalizada', summary);
        await this.recordLog('mysql-to-firebird', 'product', '*', 'ok', 'Productos sincronizados', summary);
        return summary;
    }

    async syncTickets(syncState) {
        const since = syncState?.last_ticket_sync_at || null;
        this.logger.info('Sincronizando tickets desde Firebird hacia MySQL', { since });

        const lookbackDays = Math.max(1, Number(this.config.ticketLookbackDays || 30));
        const whereClause = since
            ? 'WHERE v.FECHA >= ?'
            : `WHERE v.FECHA >= DATEADD(-${lookbackDays} DAY TO CURRENT_TIMESTAMP)`;

        const rows = await firebirdQuery(
            this.config.firebird,
            `SELECT v.ID_TICKET, v.FECHA, v.ID_PLU,
                    CAST(v.PESO AS DOUBLE PRECISION) AS PESO_G,
                    CAST(v.IMPORTE AS DOUBLE PRECISION) AS IMPORTE
             FROM VENTAS v
             ${whereClause}
             ORDER BY v.ID_TICKET, v.FECHA`,
            since ? [since] : []
        );

        if (!rows.length) {
            this.logger.info('No hay tickets nuevos para sincronizar');
            return { ok: true, processed: 0, skipped: 0 };
        }

        const tickets = new Map();
        const pluIds = new Set();
        for (const row of rows) {
            const ticketId = String(row.ID_TICKET ?? row.id_ticket ?? '').trim();
            if (!ticketId) continue;
            if (!tickets.has(ticketId)) {
                tickets.set(ticketId, {
                    ticketId,
                    firstDate: toDate(row.FECHA),
                    total: 0,
                    totalWeight: 0,
                    itemCount: 0,
                    items: [],
                });
            }
            const ticket = tickets.get(ticketId);
            const item = {
                ticketId,
                pluId: String(row.ID_PLU ?? row.id_plu ?? '').trim(),
                date: toDate(row.FECHA),
                weightKg: toNumber(row.PESO_G, 0) / 1000,
                amount: toNumber(row.IMPORTE, 0),
            };
            ticket.firstDate = ticket.firstDate || item.date;
            ticket.total += item.amount;
            ticket.totalWeight += item.weightKg;
            ticket.itemCount += 1;
            ticket.items.push(item);
            if (item.pluId) pluIds.add(item.pluId);
        }

        const pluLookup = await this.loadPluLookup([...pluIds]);
        const summary = { ok: true, processed: 0, skipped: 0, inserted: 0 };

        for (const ticket of tickets.values()) {
            summary.processed += 1;
            const enrichedItems = ticket.items.map((item) => {
                const plu = pluLookup.get(item.pluId) || {};
                return {
                    ...item,
                    productName: plu.description || `PLU ${item.pluId}`,
                    unitPrice: toNumber(plu.price, item.amount),
                };
            });

            const fingerprint = hashObject({
                ticketId: ticket.ticketId,
                firstDate: ticket.firstDate ? ticket.firstDate.toISOString() : null,
                total: Number(ticket.total.toFixed(2)),
                totalWeight: Number(ticket.totalWeight.toFixed(3)),
                itemCount: ticket.itemCount,
                items: enrichedItems.map((item) => ({
                    pluId: item.pluId,
                    productName: item.productName,
                    amount: Number(item.amount.toFixed(2)),
                    weightKg: Number(item.weightKg.toFixed(3)),
                })),
            });

            const existingMap = await mysqlQuery(
                this.mysqlPool,
                `SELECT * FROM qendra_bridge_ticket_map
                 WHERE device_id = ? AND firebird_ticket_id = ?
                 LIMIT 1`,
                [this.config.deviceId, ticket.ticketId]
            );
            const existingRow = existingMap[0] || null;
            if (existingRow && existingRow.fingerprint === fingerprint && existingRow.mysql_venta_id) {
                summary.skipped += 1;
                continue;
            }

            const barcode = existingRow?.ticket_barcode
                || formatTicketBarcode({
                    deviceId: this.config.deviceId,
                    ticketId: ticket.ticketId,
                    sourceDate: ticket.firstDate || new Date(),
                    fingerprint,
                });
            const externalTicketId = existingRow?.external_ticket_id || `${this.config.deviceId}-${ticket.ticketId}`;

            const ventaId = await withTransaction(this.mysqlPool, async (conn) => {
                const [ventaRows] = await conn.query(
                    `SELECT id FROM ventas
                     WHERE tenant_id = ? AND qendra_ticket_id = ? AND COALESCE(bridge_device_id, '') = ?
                     LIMIT 1`,
                    [this.config.tenantId, ticket.ticketId, this.config.deviceId]
                );
                let saleId = ventaRows[0]?.id || null;
                const isUpdate = Boolean(saleId);

                if (!saleId) {
                    const [saleInsert] = await conn.execute(
                        `INSERT INTO ventas
                         (tenant_id, date, total, payment_method, payment_method_id, client_id, branch_id,
                          payment_breakdown, receipt_number, receipt_code, qendra_ticket_id, source, synced,
                          ticket_barcode, bridge_device_id, bridge_synced_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                        [
                            this.config.tenantId,
                            ticket.firstDate || new Date(),
                            Number(ticket.total.toFixed(2)),
                            'efectivo',
                            null,
                            null,
                            this.config.branchId || null,
                            null,
                            ticket.ticketId,
                            barcode,
                            ticket.ticketId,
                            'qendra-bridge',
                            1,
                            barcode,
                            this.config.deviceId,
                        ]
                    );
                    saleId = saleInsert.insertId;
                } else {
                    await conn.execute(
                        `UPDATE ventas
                         SET date = ?, total = ?, receipt_number = ?, receipt_code = ?, ticket_barcode = ?,
                             branch_id = ?, bridge_device_id = ?, bridge_synced_at = NOW(), synced = 1
                         WHERE id = ?`,
                        [
                            ticket.firstDate || new Date(),
                            Number(ticket.total.toFixed(2)),
                            ticket.ticketId,
                            barcode,
                            barcode,
                            this.config.branchId || null,
                            this.config.deviceId,
                            saleId,
                        ]
                    );
                    await conn.execute(`DELETE FROM ventas_items WHERE tenant_id = ? AND venta_id = ?`, [this.config.tenantId, saleId]);
                    await conn.execute(
                        `DELETE FROM stock
                         WHERE tenant_id = ? AND COALESCE(branch_id, 0) = COALESCE(?, 0)
                           AND reference = ? AND usage = 'venta'`,
                        [this.config.tenantId, this.config.branchId || null, barcode]
                    );
                }

                for (const item of enrichedItems) {
                    const product = await this.ensureMySqlProduct(conn, item);
                    await conn.execute(
                        `INSERT INTO ventas_items
                         (tenant_id, venta_id, product_id, product_name, quantity, price, subtotal, synced)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
                        [
                            this.config.tenantId,
                            saleId,
                            product.id,
                            item.productName,
                            item.weightKg || 1,
                            item.unitPrice,
                            Number((item.weightKg || 1) * item.unitPrice),
                        ]
                    );

                    await conn.execute(
                        `INSERT INTO stock
                         (tenant_id, branch_id, product_id, name, type, usage, quantity, unit, price, category_id, reference, barcode, presentation, updated_at, synced)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
                        [
                            this.config.tenantId,
                            this.config.branchId || null,
                            product.id,
                            item.productName,
                            'salida',
                            'venta',
                            -(item.weightKg || 1),
                            'kg',
                            item.unitPrice,
                            null,
                            barcode,
                            barcode,
                            isUpdate ? 'bridge-update' : 'bridge',
                        ]
                    );
                }

                await conn.execute(
                    `INSERT INTO qendra_bridge_ticket_map
                     (device_id, tenant_id, branch_id, firebird_ticket_id, external_ticket_id, ticket_barcode,
                      fingerprint, mysql_venta_id, total_amount, total_weight, item_count, synced_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                        external_ticket_id = VALUES(external_ticket_id),
                        ticket_barcode = VALUES(ticket_barcode),
                        fingerprint = VALUES(fingerprint),
                        mysql_venta_id = VALUES(mysql_venta_id),
                        total_amount = VALUES(total_amount),
                        total_weight = VALUES(total_weight),
                        item_count = VALUES(item_count),
                        synced_at = VALUES(synced_at)`,
                    [
                        this.config.deviceId,
                        this.config.tenantId,
                        this.config.branchId || null,
                        ticket.ticketId,
                        externalTicketId,
                        barcode,
                        fingerprint,
                        saleId,
                        Number(ticket.total.toFixed(2)),
                        Number(ticket.totalWeight.toFixed(3)),
                        ticket.itemCount,
                    ]
                );

                return saleId;
            });

            await this.bestEffortWriteBarcodeToFirebird({
                ticketId: ticket.ticketId,
                barcode,
                firstDate: ticket.firstDate,
                total: ticket.total,
            });

            summary.inserted += 1;
            await this.recordLog('firebird-to-mysql', 'ticket', ticket.ticketId, 'ok', 'Ticket sincronizado', {
                ventaId,
                barcode,
                itemCount: ticket.itemCount,
            });
        }

        this.state.ticketCursor = new Date().toISOString();
        this.state.lastTicketSyncAt = this.state.ticketCursor;
        this.stateStore.save(this.state);

        this.logger.info('Sincronizacion de tickets finalizada', summary);
        return summary;
    }

    async ensureMySqlProduct(conn, item) {
        const canonicalKey = `qendra-plu-${item.pluId}`;
        const [rows] = await conn.query(
            `SELECT id, name FROM products
             WHERE tenant_id = ? AND (plu = ? OR canonical_key = ?)
             LIMIT 1`,
            [this.config.tenantId, item.pluId, canonicalKey]
        );
        if (rows[0]) {
            return rows[0];
        }

        const [result] = await conn.execute(
            `INSERT INTO products
             (tenant_id, canonical_key, name, category, unit, current_price, plu, source, created_at, updated_at,
              qendra_plu_id, qendra_fingerprint, qendra_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, NOW())`,
            [
                this.config.tenantId,
                canonicalKey,
                item.productName,
                'balanza',
                'kg',
                item.unitPrice,
                item.pluId,
                'qendra-bridge',
                item.pluId,
                hashObject(item),
            ]
        );
        return { id: result.insertId, name: item.productName };
    }

    async loadPluLookup(pluIds) {
        const lookup = new Map();
        if (!pluIds.length) return lookup;

        const chunks = chunkArray(pluIds, 50);
        for (const chunk of chunks) {
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = await firebirdQuery(
                this.config.firebird,
                `SELECT ID,
                        CAST(DESCRIPCION AS VARCHAR(250) CHARACTER SET OCTETS) AS DESCRIPCION,
                        PRECIO
                 FROM PLU
                 WHERE ID IN (${placeholders})`,
                chunk
            );
            for (const row of rows) {
                const pluId = String(row.ID ?? '').trim();
                if (!pluId) continue;
                lookup.set(pluId, {
                    description: asText(row.DESCRIPCION),
                    price: toNumber(row.PRECIO, 0),
                });
            }
        }
        return lookup;
    }

    async loadSectionMap(firebirdConfig = this.config.firebird) {
        const map = new Map();
        try {
            const columns = await getColumns(firebirdConfig, 'SECCIONES');
            const idColumn = firstMatchingColumn(columns, ['ID']);
            const nameColumn = firstMatchingColumn(columns, ['DESCRIPCION', 'NOMBRE', 'DESC', 'NOMBRE_SECCION', 'DESCRIP']);
            if (!idColumn || !nameColumn) return map;

            const rows = await firebirdQuery(
                firebirdConfig,
                `SELECT ${idColumn} AS ID, CAST(${nameColumn} AS VARCHAR(250) CHARACTER SET OCTETS) AS NOMBRE
                 FROM SECCIONES`
            );
            for (const row of rows) {
                map.set(String(row.ID).trim().toLowerCase(), asText(row.NOMBRE));
            }
        } catch (error) {
            this.logger.warn('No se pudo leer SECCIONES de Firebird', { error: error.message });
        }
        return map;
    }

    async ensureImportSection(firebirdConfig, sectionId, sectionName) {
        if (!(await tableExists(firebirdConfig, 'SECCIONES'))) {
            return;
        }

        const columns = await getColumns(firebirdConfig, 'SECCIONES');
        const row = { ID: firebirdValue(sectionId) };
        const resolvedName = Number(sectionId) === 2
            ? 'CARNICERIA'
            : (asText(sectionName) || `SECCION ${sectionId}`);
        if (columns.includes('NOMBRE')) row.NOMBRE = resolvedName;
        if (columns.includes('DESCRIPCION')) row.DESCRIPCION = resolvedName;
        if (columns.includes('IMPFLAG')) row.IMPFLAG = 0;
        await this.upsertFirebirdRow(firebirdConfig, 'SECCIONES', 'ID', row, columns);
    }

    resolveSectionId(category, sectionMap) {
        const categoryText = normalizeText(category).toLowerCase();
        if (isMeatCategory(categoryText)) return 2;
        if (!categoryText) return this.config.firebird.defaultSectionId;
        for (const [sectionId, sectionName] of sectionMap.entries()) {
            const sectionText = normalizeText(sectionName).toLowerCase();
            if (!sectionText) continue;
            if (sectionText === categoryText || sectionText.includes(categoryText) || categoryText.includes(sectionText)) {
                return sectionId;
            }
        }
        return this.config.firebird.defaultSectionId;
    }

    async ensureSectionAssignedToEquipments(firebirdConfig, sectionId) {
        if (!(await tableExists(firebirdConfig, 'EQ_SECCION')) || !(await tableExists(firebirdConfig, 'EQUIPOS'))) {
            return;
        }

        const columns = await getColumns(firebirdConfig, 'EQ_SECCION');
        const equipos = await firebirdQuery(
            firebirdConfig,
            `SELECT IP
             FROM EQUIPOS
             WHERE COALESCE(PUERTO, 0) > 0 OR COALESCE(ESTADO, 0) IN (1, 3)
             ORDER BY IP`
        );
        const existingRows = await firebirdQuery(
            firebirdConfig,
            `SELECT IP
             FROM EQ_SECCION
             WHERE ID_SECCION = ?`,
            [firebirdValue(sectionId)]
        );
        const existingIps = new Set(
            existingRows
                .map((row) => String(row.IP ?? '').trim())
                .filter(Boolean)
        );
        for (const equipo of equipos) {
            const ip = String(equipo.IP ?? '').trim();
            if (!ip || existingIps.has(ip)) continue;
            await this.upsertCompositeFirebirdRow(
                firebirdConfig,
                'EQ_SECCION',
                ['IP', 'ID_SECCION'],
                {
                    IP: ip,
                    ID_SECCION: firebirdValue(sectionId),
                    MODIF: 0,
                },
                columns
            );
        }
    }

    async loadTargetEquipments(firebirdConfig, sectionId) {
        const targets = new Set();
        const hasEqSeccion = await tableExists(firebirdConfig, 'EQ_SECCION');
        const hasEquipos = await tableExists(firebirdConfig, 'EQUIPOS');

        if (hasEqSeccion && hasEquipos) {
            const rows = await firebirdQuery(
                firebirdConfig,
                `SELECT s.IP
                 FROM EQ_SECCION s
                 JOIN EQUIPOS e ON e.IP = s.IP
                 WHERE s.ID_SECCION = ?
                   AND (COALESCE(e.PUERTO, 0) > 0 OR COALESCE(e.ESTADO, 0) IN (1, 3))`,
                [firebirdValue(sectionId)]
            );
            for (const row of rows) {
                const ip = String(row.IP ?? '').trim();
                if (ip) targets.add(ip);
            }
        }

        if (targets.size === 0 && hasEquipos) {
            const rows = await firebirdQuery(
                firebirdConfig,
                `SELECT IP
                 FROM EQUIPOS
                 WHERE COALESCE(PUERTO, 0) > 0 OR COALESCE(ESTADO, 0) IN (1, 3)`
            );
            for (const row of rows) {
                const ip = String(row.IP ?? '').trim();
                if (ip) targets.add(ip);
            }
        }

        return [...targets];
    }

    async ensureProductAssignments(firebirdConfig, { pluId, numero, sectionId }) {
        if (!(await tableExists(firebirdConfig, 'EQ_PLUS'))) {
            return [];
        }

        const targets = await this.loadTargetEquipments(firebirdConfig, sectionId);
        const columns = await getColumns(firebirdConfig, 'EQ_PLUS');
        for (const ip of targets) {
            await this.upsertCompositeFirebirdRow(
                firebirdConfig,
                'EQ_PLUS',
                ['IP', 'ID_PLU'],
                {
                    IP: ip,
                    ID_PLU: firebirdValue(Number.isNaN(Number(pluId)) ? pluId : Number(pluId)),
                    NUMERO: String(numero),
                    ID_SECCION: firebirdValue(sectionId),
                    MODIF: 3,
                },
                columns
            );
        }
        return targets;
    }

    async areProductAssignmentsReady(firebirdConfig, { pluId, numero, sectionId, targets }) {
        if (!(await tableExists(firebirdConfig, 'EQ_PLUS'))) {
            return true;
        }

        const resolvedTargets = Array.isArray(targets) && targets.length > 0
            ? targets
            : await this.loadTargetEquipments(firebirdConfig, sectionId);
        if (!resolvedTargets.length) {
            return false;
        }

        const placeholders = resolvedTargets.map(() => '?').join(', ');
        const assignmentRows = await firebirdQuery(
            firebirdConfig,
            `SELECT IP
             FROM EQ_PLUS
             WHERE ID_PLU = ?
               AND IP IN (${placeholders})`,
            [firebirdValue(Number.isNaN(Number(pluId)) ? pluId : Number(pluId)), ...resolvedTargets]
        );
        const assignedIps = new Set(assignmentRows.map((row) => String(row.IP ?? '').trim()).filter(Boolean));
        if (resolvedTargets.some((ip) => !assignedIps.has(String(ip)))) {
            return false;
        }

        if (!(await tableExists(firebirdConfig, 'NOVEDADES'))) {
            return true;
        }

        const notificationRows = await firebirdQuery(
            firebirdConfig,
            `SELECT IP
             FROM NOVEDADES
             WHERE TABLA = 3
               AND VALOR = ?
               AND IP IN (${placeholders})`,
            [firebirdValue(Number(numero || pluId)), ...resolvedTargets]
        );
        const notifiedIps = new Set(notificationRows.map((row) => String(row.IP ?? '').trim()).filter(Boolean));
        return !resolvedTargets.some((ip) => !notifiedIps.has(String(ip)));
    }

    async upsertFirebirdRow(firebirdConfig, tableName, keyColumn, row, columns) {
        const keyValue = row[keyColumn];
        const countRows = await firebirdQuery(
            firebirdConfig,
            `SELECT COUNT(*) AS TOTAL FROM ${tableName} WHERE ${keyColumn} = ?`,
            [firebirdValue(keyValue)]
        );
        const exists = Number(countRows?.[0]?.TOTAL || countRows?.[0]?.total || 0) > 0;

        const allowedColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!allowedColumns.length) return;

        if (exists) {
            const setClause = allowedColumns
                .filter((column) => column !== keyColumn)
                .map((column) => `"${column}" = ?`)
                .join(', ');
            const params = allowedColumns.filter((column) => column !== keyColumn).map((column) => firebirdValue(row[column]));
            if (!setClause) return;
            params.push(firebirdValue(keyValue));
            await firebirdQuery(
                firebirdConfig,
                `UPDATE ${tableName} SET ${setClause} WHERE ${keyColumn} = ?`,
                params
            );
            return;
        }

        const fields = allowedColumns.map((column) => `"${column}"`).join(', ');
        const placeholders = allowedColumns.map(() => '?').join(', ');
        const params = allowedColumns.map((column) => firebirdValue(row[column]));
        await firebirdQuery(
            firebirdConfig,
            `INSERT INTO ${tableName} (${fields}) VALUES (${placeholders})`,
            params
        );
    }

    async upsertCompositeFirebirdRow(firebirdConfig, tableName, keyColumns, row, columns) {
        const allowedColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!allowedColumns.length) return;

        const whereClause = keyColumns.map((column) => `${column} = ?`).join(' AND ');
        const whereParams = keyColumns.map((column) => firebirdValue(row[column]));
        const countRows = await firebirdQuery(
            firebirdConfig,
            `SELECT COUNT(*) AS TOTAL FROM ${tableName} WHERE ${whereClause}`,
            whereParams
        );
        const exists = Number(countRows?.[0]?.TOTAL || countRows?.[0]?.total || 0) > 0;

        if (exists) {
            const updateColumns = allowedColumns.filter((column) => !keyColumns.includes(column));
            if (!updateColumns.length) return;
            const setClause = updateColumns.map((column) => `"${column}" = ?`).join(', ');
            const params = updateColumns.map((column) => firebirdValue(row[column])).concat(whereParams);
            await firebirdQuery(
                firebirdConfig,
                `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
                params
            );
            return;
        }

        const fields = allowedColumns.map((column) => `"${column}"`).join(', ');
        const placeholders = allowedColumns.map(() => '?').join(', ');
        const params = allowedColumns.map((column) => firebirdValue(row[column]));
        await firebirdQuery(
            firebirdConfig,
            `INSERT INTO ${tableName} (${fields}) VALUES (${placeholders})`,
            params
        );
    }

    async markProductNeedsSync(firebirdConfig, { pluId, numero, targets }) {
        try {
            if (await tableExists(firebirdConfig, 'EQUIPOS')) {
                const columns = await getColumns(firebirdConfig, 'EQUIPOS');
                if (columns.includes('NOVEDADES') && targets.length > 0) {
                    const placeholders = targets.map(() => '?').join(', ');
                    await firebirdQuery(
                        firebirdConfig,
                        `UPDATE EQUIPOS SET NOVEDADES = 1 WHERE IP IN (${placeholders})`,
                        targets
                    );
                }
            }
        } catch (error) {
            this.logger.warn('No se pudo actualizar EQUIPOS.NOVEDADES', { error: error.message });
        }

        try {
            if (await tableExists(firebirdConfig, 'NOVEDADES')) {
                const columns = await getColumns(firebirdConfig, 'NOVEDADES');
                for (const ip of targets) {
                    const row = {};
                    if (columns.includes('IP')) row.IP = ip;
                    if (columns.includes('TABLA')) row.TABLA = 3;
                    if (columns.includes('VALOR')) row.VALOR = Number(numero || pluId);
                    const insert = this.buildFirebirdInsert('NOVEDADES', columns, row);
                    if (insert) {
                        await firebirdQuery(firebirdConfig, insert.sql, insert.params);
                    }
                }
            }
        } catch (error) {
            this.logger.warn('No se pudo insertar NOVEDADES', { error: error.message });
        }

        await this.recordLog('mysql-to-firebird', 'notification', String(pluId), 'ok', 'Producto marcado para publicacion en Qendra', {
            pluId,
            numero,
            targets,
        });
    }

    buildFirebirdInsert(tableName, columns, row) {
        const available = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!available.length) return null;
        return {
            sql: `INSERT INTO ${tableName} (${available.map((column) => `"${column}"`).join(', ')})
                  VALUES (${available.map(() => '?').join(', ')})`,
            params: available.map((column) => firebirdValue(row[column])),
        };
    }

    async bestEffortWriteBarcodeToFirebird({ ticketId, barcode, firstDate, total }) {
        try {
            if (!(await tableExists(this.config.firebird, 'BARCODE_TICKETS'))) return;
            const columns = await getColumns(this.config.firebird, 'BARCODE_TICKETS');
            const row = {};
            if (columns.includes('ID_TICKET')) row.ID_TICKET = ticketId;
            if (columns.includes('BARCODE')) row.BARCODE = barcode;
            if (columns.includes('CODIGO')) row.CODIGO = barcode;
            if (columns.includes('FECHA')) row.FECHA = firstDate || new Date();
            if (columns.includes('TOTAL')) row.TOTAL = total;
            const existsRows = await firebirdQuery(
                this.config.firebird,
                `SELECT COUNT(*) AS TOTAL FROM BARCODE_TICKETS WHERE ${columns.includes('ID_TICKET') ? 'ID_TICKET' : columns[0]} = ?`,
                [columns.includes('ID_TICKET') ? ticketId : barcode]
            );
            const exists = Number(existsRows?.[0]?.TOTAL || existsRows?.[0]?.total || 0) > 0;
            if (exists) return;
            const insert = this.buildFirebirdInsert('BARCODE_TICKETS', columns, row);
            if (insert) {
                await firebirdQuery(this.config.firebird, insert.sql, insert.params);
            }
        } catch (error) {
            this.logger.warn('No se pudo escribir BARCODE_TICKETS en Firebird', { error: error.message });
        }
    }
}

module.exports = { QendraBridge };
