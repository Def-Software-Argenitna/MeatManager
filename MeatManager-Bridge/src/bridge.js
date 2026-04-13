const {
    query: firebirdQuery,
    batchQuery: firebirdBatchQuery,
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

function computeSafeSince(since, lookbackSeconds = 120) {
    if (!since) return null;
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) return since;
    const safeTs = new Date(parsed.getTime() - Math.max(0, Number(lookbackSeconds) || 0) * 1000);
    return safeTs.toISOString();
}

function shouldRunRecoveryRepublish(lastRunAtIso, minIntervalMs = 10 * 60 * 1000) {
    if (!lastRunAtIso) return true;
    const last = new Date(lastRunAtIso);
    if (Number.isNaN(last.getTime())) return true;
    return (Date.now() - last.getTime()) >= minIntervalMs;
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
        if (this.config.normalizeFirebirdOnStart) {
            await this.normalizeFirebirdCompatibility();
        }
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

    async runWithTimeout(label, task) {
        const timeoutMs = Math.max(10000, Number(this.config.syncStepTimeoutMs || 180000));
        let timer = null;
        try {
            return await Promise.race([
                Promise.resolve().then(task),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`${label} excedio el tiempo maximo de ${timeoutMs} ms`));
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
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
            result.products = await this.runWithTimeout('syncProducts', () => this.syncProducts(currentState));
            result.tickets = await this.runWithTimeout('syncTickets', () => this.syncTickets(currentState));
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
        const safeSince = computeSafeSince(since, this.config.productSinceLookbackSeconds || 120);
        this.logger.info('Sincronizando productos desde MySQL hacia Firebird', { since, safeSince });

        const params = [this.config.tenantId];
        let sql = `
            SELECT id, canonical_key, name, category, unit, current_price, plu, updated_at
            FROM products
            WHERE tenant_id = ?
              AND COALESCE(current_price, 0) > 0`;
        if (safeSince) {
            sql += ` AND COALESCE(updated_at, created_at) > ?`;
            params.push(safeSince);
        }
        sql += ` ORDER BY updated_at ASC, id ASC`;

        let products = await mysqlQuery(this.mysqlPool, sql, params);
        let usedRecovery = false;
        if (products.length === 0 && since) {
            const recoveryLimit = Math.max(20, Number(this.config.productRecoveryLimit || 250));
            const recoveryLookbackHours = Math.max(1, Number(this.config.productRecoveryLookbackHours || 24));
            const recovered = await mysqlQuery(
                this.mysqlPool,
                `SELECT id, canonical_key, name, category, unit, current_price, plu, updated_at
                 FROM products
                 WHERE tenant_id = ?
                   AND COALESCE(current_price, 0) > 0
                   AND COALESCE(updated_at, created_at) > DATE_SUB(NOW(), INTERVAL ? HOUR)
                 ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                 LIMIT ${recoveryLimit}`,
                [this.config.tenantId, recoveryLookbackHours]
            );
            products = recovered.reverse();
            usedRecovery = true;
            this.logger.info('Recuperacion acotada de productos aplicada', {
                since,
                safeSince,
                recovered: products.length,
                recoveryLimit,
            });
        }

        if (products.length === 0) {
            this.logger.info('No hay productos nuevos para sincronizar');
            return { ok: true, processed: 0, skipped: 0 };
        }

        const summary = { ok: true, processed: 0, skipped: 0, written: 0, deleted: 0, forcedTargets: 0 };
        const writtenProducts = [];
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
        const hasEqPlus = await tableExists(targetFirebird, 'EQ_PLUS');
        const eqPlusColumns = hasEqPlus ? await getColumns(targetFirebird, 'EQ_PLUS') : [];
        const hasNovedades = await tableExists(targetFirebird, 'NOVEDADES');
        const novedadesColumns = hasNovedades ? await getColumns(targetFirebird, 'NOVEDADES') : [];
        const sectionTargetsCache = new Map();

        const mapRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT product_id, firebird_plu_id, fingerprint
             FROM qendra_bridge_product_map
             WHERE device_id = ? AND tenant_id = ?`,
            [this.config.deviceId, this.config.tenantId]
        );
        const mapByProductId = new Map();
        const mapByPluId = new Map();
        for (const row of mapRows) {
            const productIdKey = row.product_id == null ? '' : String(row.product_id).trim();
            const pluIdKey = row.firebird_plu_id == null ? '' : String(row.firebird_plu_id).trim();
            if (productIdKey) mapByProductId.set(productIdKey, row);
            if (pluIdKey) mapByPluId.set(pluIdKey, row);
        }

        const removedOrDisabledProducts = await this.loadRemovedOrDisabledProducts(safeSince);
        for (const product of removedOrDisabledProducts) {
            const fallbackPluId = String(product.plu || product.id || '').trim();
            const mapRow = mapByProductId.get(String(product.id))
                || (fallbackPluId ? mapByPluId.get(fallbackPluId) : null)
                || null;
            if (!mapRow) continue;

            const syncedPluId = String(mapRow.firebird_plu_id || fallbackPluId || '').trim();
            if (!syncedPluId) continue;

            const targets = await this.loadTargetsForPlu(targetFirebird, syncedPluId);
            await this.removeProductFromFirebird(targetFirebird, syncedPluId);
            if (targets.length > 0) {
                await this.markProductNeedsSync(targetFirebird, {
                    pluId: syncedPluId,
                    numero: syncedPluId,
                    targets,
                });
            }

            await mysqlExecute(
                this.mysqlPool,
                `DELETE FROM qendra_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND product_id = ?`,
                [this.config.deviceId, this.config.tenantId, product.id]
            );

            mapByProductId.delete(String(product.id));
            mapByPluId.delete(syncedPluId);
            summary.deleted += 1;
            await this.recordLog('mysql-to-firebird', 'notification', String(syncedPluId), 'ok', 'Producto dado de baja en Firebird y marcado para publicacion en Qendra', {
                pluId: syncedPluId,
                targets,
            });
        }

        // Track sections already ensured this cycle to avoid redundant Firebird calls
        const ensuredSections = new Set();

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

            const mapRow = mapByProductId.get(String(product.id)) || mapByPluId.get(pluId) || null;
            if (mapRow && mapRow.fingerprint === productFingerprint) {
                summary.skipped += 1;
                continue;
            }

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

            // Load targets once per section (cached per cycle)
            let targets = sectionTargetsCache.get(String(sectionId));
            if (!targets) {
                targets = await this.loadTargetEquipments(targetFirebird, sectionId);
                sectionTargetsCache.set(String(sectionId), targets);
            }

            // Execute all Firebird writes in a single Python process (PLU + EQ_PLUS + EQUIPOS + NOVEDADES)
            const productOps = this.buildProductWriteOps(row, pluColumns, hasEqPlus, eqPlusColumns, hasNovedades, novedadesColumns, targets, pluId);
            if (productOps.length > 0) {
                await firebirdBatchQuery(targetFirebird, productOps);
            }

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
            writtenProducts.push({ product, row, pluId, sectionId });
            const persistedMap = { product_id: product.id, firebird_plu_id: pluId, fingerprint: productFingerprint };
            mapByProductId.set(String(product.id), persistedMap);
            mapByPluId.set(pluId, persistedMap);
            await this.recordLog('mysql-to-firebird', 'notification', String(pluId), 'ok', targetMode === 'import' ? 'Producto escrito en base de importacion de Qendra' : 'Producto escrito en base viva de Qendra', {
                pluId,
                targetDb: targetFirebird.dbFile,
            });
        }

        const shouldRepublishOnRecovery = usedRecovery && summary.written === 0 && products.length > 0;
        const shouldRepublishOnAllSkipped = summary.written === 0 && summary.processed > 0 && summary.skipped === summary.processed;
        if (shouldRepublishOnRecovery || shouldRepublishOnAllSkipped) {
            const republishIntervalMs = Math.max(60_000, Number(this.config.productRecoveryRepublishIntervalMs || 60_000));
            if (shouldRunRecoveryRepublish(this.state.lastRecoveryRepublishAt, republishIntervalMs)) {
                const republishLimit = Math.max(1, Number(this.config.productRecoveryRepublishLimit || 20));
                const republishProducts = products.slice(-republishLimit);
                let republished = 0;
                let rewritten = 0;

                for (const product of republishProducts) {
                    const pluId = String(product.plu || product.id);
                    const sectionId = this.resolveSectionId(product.category, sectionMap) || this.config.firebird.defaultSectionId;
                    const description = asText(product.name).slice(0, 250) || `Producto ${pluId}`;
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

                    // Load targets (from cache populated in main loop, lazy-load if needed)
                    let targets = sectionTargetsCache.get(String(sectionId));
                    if (!targets) {
                        targets = await this.loadTargetEquipments(targetFirebird, sectionId);
                        sectionTargetsCache.set(String(sectionId), targets);
                    }

                    // All Firebird writes (PLU + EQ_PLUS + EQUIPOS + NOVEDADES) in one Python process
                    const republishOps = this.buildProductWriteOps(row, pluColumns, hasEqPlus, eqPlusColumns, hasNovedades, novedadesColumns, targets, pluId);
                    if (republishOps.length > 0) {
                        await firebirdBatchQuery(targetFirebird, republishOps);
                    }
                    rewritten += 1;
                    if (!targets.length) continue;
                    republished += 1;
                }

                if (republished > 0) {
                    summary.written += rewritten;
                    this.state.lastRecoveryRepublishAt = new Date().toISOString();
                    this.stateStore.save(this.state);
                    this.logger.info('Republicacion periodica de novedades aplicada', {
                        republished,
                        rewritten,
                        republishLimit,
                        mode: shouldRepublishOnRecovery ? 'recovery' : 'all-skipped',
                    });
                    // Also push to bridge_import.fdb to trigger Qendra import → scale sync
                    if (targetMode === 'live') {
                        const republishWritten = republishProducts
                            .filter((p) => true) // all that were republished
                            .map((p) => {
                                const pid = String(p.plu || p.id);
                                const sid = this.resolveSectionId(p.category, sectionMap) || this.config.firebird.defaultSectionId;
                                const pr = toNumber(p.current_price, 0);
                                const r = {
                                    ID: Number.isNaN(Number(pid)) ? pid : Number(pid),
                                    ID_SECCION: sid,
                                    DESCRIPCION: asText(p.name).slice(0, 250) || `Producto ${pid}`,
                                    PRECIO: pr,
                                };
                                if (pluColumns.includes('COD_LOCAL')) r.COD_LOCAL = String(pid);
                                if (pluColumns.includes('TIPO_VENTA')) r.TIPO_VENTA = inferTipoVenta(p.unit);
                                if (pluColumns.includes('PRECIO2')) r.PRECIO2 = pr;
                                if (pluColumns.includes('TARA')) r.TARA = 0;
                                if (pluColumns.includes('ULTIMA_MODIF')) r.ULTIMA_MODIF = new Date();
                                if (pluColumns.includes('IMPFLAG')) r.IMPFLAG = 0;
                                applyPluDefaults(r, pluColumns, pr);
                                return { product: p, row: r, pluId: pid, sectionId: sid };
                            });
                        await this.syncProductsToImportDb(republishWritten, pluColumns, sectionColumns).catch((err) => {
                            this.logger.warn('No se pudo escribir republicacion en base de importacion', { error: err.message });
                        });
                    }
                }
            }
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

        if (summary.written > 0 || summary.deleted > 0) {
            const forcedTargets = await this.forceScaleSyncAfterProducts(targetFirebird);
            summary.forcedTargets = forcedTargets;
        }

        // Dual-write: when in live mode, also push changed PLU records to bridge_import.fdb
        // This changes the file hash → Qendra auto-imports (every AutoInterval=1 min) → TxNews=1 → scale sync via COM3
        if (targetMode === 'live' && writtenProducts.length > 0) {
            await this.syncProductsToImportDb(writtenProducts, pluColumns, sectionColumns).catch((err) => {
                this.logger.warn('No se pudo escribir en base de importacion', { error: err.message });
            });
        }

        this.state.productCursor = new Date().toISOString();
        this.state.lastProductSyncAt = this.state.productCursor;
        this.stateStore.save(this.state);

        this.logger.info('Sincronizacion de productos finalizada', summary);
        await this.recordLog('mysql-to-firebird', 'product', '*', 'ok', 'Productos sincronizados', summary);
        return summary;
    }

    /**
     * Write changed PLU records to bridge_import.fdb so Qendra detects the hash change,
     * auto-imports (AutoInterval=1 min), and fires TxNews=1 → scale sync via COM3.
     * Only updates PLU + SECCIONES — Qendra handles NOVEDADES during its import.
     */
    async syncProductsToImportDb(writtenProducts, pluColumns, sectionColumns) {
        const importConfig = this.getImportFirebirdConfig();
        if (!importConfig.dbFile || importConfig.dbFile === this.config.firebird.dbFile) {
            return;
        }
        if (!fs.existsSync(importConfig.dbFile)) {
            return;
        }
        if (!(await tableExists(importConfig, 'PLU'))) {
            return;
        }

        const importPluColumns = await getColumns(importConfig, 'PLU');
        const hasImportSecciones = await tableExists(importConfig, 'SECCIONES');
        const importSecCols = hasImportSecciones ? await getColumns(importConfig, 'SECCIONES') : [];
        const ensuredImportSections = new Set();
        const ops = [];

        for (const { product, row, pluId, sectionId } of writtenProducts) {
            // Ensure section exists in import db (deduplicated per sectionId)
            if (hasImportSecciones && !ensuredImportSections.has(String(sectionId))) {
                const resolvedName = Number(sectionId) === 2
                    ? 'CARNICERIA'
                    : (String(product.category || `SECCION ${sectionId}`).toUpperCase().slice(0, 40));
                const secRow = { ID: firebirdValue(sectionId) };
                if (importSecCols.includes('NOMBRE')) secRow.NOMBRE = resolvedName;
                if (importSecCols.includes('DESCRIPCION')) secRow.DESCRIPCION = resolvedName;
                if (importSecCols.includes('IMPFLAG')) secRow.IMPFLAG = 0;
                const secAllowed = importSecCols.filter((c) => Object.prototype.hasOwnProperty.call(secRow, c));
                if (secAllowed.length > 0) {
                    ops.push({
                        sql: `UPDATE OR INSERT INTO SECCIONES (${secAllowed.map((c) => `"${c}"`).join(', ')}) VALUES (${secAllowed.map(() => '?').join(', ')}) MATCHING (ID)`,
                        params: secAllowed.map((c) => secRow[c]),
                    });
                }
                ensuredImportSections.add(String(sectionId));
            }

            // PLU record
            const allowedPlu = importPluColumns.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
            if (allowedPlu.length > 0) {
                ops.push({
                    sql: `UPDATE OR INSERT INTO PLU (${allowedPlu.map((c) => `"${c}"`).join(', ')}) VALUES (${allowedPlu.map(() => '?').join(', ')}) MATCHING (ID)`,
                    params: allowedPlu.map((c) => firebirdValue(row[c])),
                });
            }
        }

        if (ops.length > 0) {
            await firebirdBatchQuery(importConfig, ops);
            this.logger.info('Productos escritos en base de importacion para disparo de sincronizacion a balanza', {
                count: writtenProducts.length,
                importDb: importConfig.dbFile,
            });
        }
    }

    async loadRemovedOrDisabledProducts(since) {
        const params = [this.config.tenantId];
        let sql = `
            SELECT id, plu, current_price, updated_at
            FROM products
            WHERE tenant_id = ?
              AND COALESCE(current_price, 0) <= 0`;
        if (since) {
            sql += ` AND COALESCE(updated_at, created_at) > ?`;
            params.push(since);
        }
        sql += ` ORDER BY updated_at ASC, id ASC`;
        return mysqlQuery(this.mysqlPool, sql, params);
    }

    async loadTargetsForPlu(firebirdConfig, pluId) {
        if (!(await tableExists(firebirdConfig, 'EQ_PLUS'))) {
            return [];
        }

        const rows = await firebirdQuery(
            firebirdConfig,
            `SELECT DISTINCT IP
             FROM EQ_PLUS
             WHERE ID_PLU = ?`,
            [firebirdValue(Number.isNaN(Number(pluId)) ? pluId : Number(pluId))]
        );
        return rows
            .map((row) => String(row.IP ?? '').trim())
            .filter(Boolean);
    }

    async removeProductFromFirebird(firebirdConfig, pluId) {
        const pluValue = firebirdValue(Number.isNaN(Number(pluId)) ? pluId : Number(pluId));
        try {
            if (await tableExists(firebirdConfig, 'EQ_PLUS')) {
                await firebirdQuery(
                    firebirdConfig,
                    `DELETE FROM EQ_PLUS WHERE ID_PLU = ?`,
                    [pluValue]
                );
            }
        } catch (error) {
            this.logger.warn('No se pudo eliminar EQ_PLUS para la baja del producto', { pluId, error: error.message });
        }

        try {
            if (await tableExists(firebirdConfig, 'PLU')) {
                await firebirdQuery(
                    firebirdConfig,
                    `DELETE FROM PLU WHERE ID = ?`,
                    [pluValue]
                );
            }
        } catch (error) {
            this.logger.warn('No se pudo eliminar PLU para la baja del producto', { pluId, error: error.message });
        }
    }

    async forceScaleSyncAfterProducts(firebirdConfig) {
        try {
            if (!(await tableExists(firebirdConfig, 'EQUIPOS'))) {
                return 0;
            }
            const columns = await getColumns(firebirdConfig, 'EQUIPOS');
            if (!columns.includes('NOVEDADES')) {
                return 0;
            }

            const targets = await this.loadTargetEquipments(firebirdConfig, null);
            if (targets.length === 0) {
                return 0;
            }

            const placeholders = targets.map(() => '?').join(', ');
            await firebirdQuery(
                firebirdConfig,
                `UPDATE EQUIPOS SET NOVEDADES = 1 WHERE IP IN (${placeholders})`,
                targets
            );
            this.logger.info('Forzado de sincronizacion hacia balanzas aplicado al finalizar productos', { targets });
            return targets.length;
        } catch (error) {
            this.logger.warn('No se pudo forzar la sincronizacion hacia balanzas al finalizar productos', { error: error.message });
            return 0;
        }
    }

    async forceScaleSyncNow(reason = 'manual') {
        const forcedTargets = await this.forceScaleSyncAfterProducts(this.config.firebird);
        this.logger.info('Forzado de sincronizacion a balanza ejecutado', {
            reason,
            forcedTargets,
        });
        return forcedTargets;
    }

    async getScalesStatus() {
        try {
            if (!(await tableExists(this.config.firebird, 'EQUIPOS'))) {
                return { ok: true, scales: [], message: 'Tabla EQUIPOS no existe' };
            }
            const columns = await getColumns(this.config.firebird, 'EQUIPOS');
            const wantedCols = ['IP', 'NOMBRE', 'MODELO', 'ESTADO', 'PUERTO', 'NOVEDADES', 'SUBVERSION', 'UNIDAD_PESAJE'];
            const available = wantedCols.filter((c) => columns.includes(c));
            if (!available.includes('IP')) {
                return { ok: true, scales: [], message: 'Tabla EQUIPOS sin columna IP' };
            }
            const rows = await firebirdQuery(
                this.config.firebird,
                `SELECT ${available.map((c) => `"${c}"`).join(', ')} FROM EQUIPOS ORDER BY IP`
            );
            const scales = rows.map((row) => {
                const ip = String(row.IP ?? row.ip ?? '').trim();
                const estado = Number(row.ESTADO ?? row.estado ?? -1);
                const novedades = Number(row.NOVEDADES ?? row.novedades ?? 0);
                const puerto = Number(row.PUERTO ?? row.puerto ?? 0);
                return {
                    ip,
                    nombre: String(row.NOMBRE ?? row.nombre ?? '').trim() || null,
                    modelo: String(row.MODELO ?? row.modelo ?? '').trim() || null,
                    estado,
                    estadoLabel: { 0: 'inactivo', 1: 'activo', 3: 'activo-secundario' }[estado] ?? 'desconocido',
                    puerto,
                    active: puerto > 0 || estado === 1 || estado === 3,
                    novedades: novedades,
                    pendingSync: novedades === 1,
                };
            });
            const pending = scales.filter((s) => s.pendingSync).length;
            const active = scales.filter((s) => s.active).length;
            return { ok: true, scales, active, pending };
        } catch (error) {
            return { ok: false, error: error.message, scales: [] };
        }
    }

    async resetProductFingerprintsAndSync() {
        // Borra huellas en MySQL para que el próximo ciclo reescriba todos los productos
        await mysqlExecute(
            this.mysqlPool,
            `DELETE FROM qendra_bridge_product_map WHERE device_id = ? AND tenant_id = ?`,
            [this.config.deviceId, this.config.tenantId]
        );
        // Limpia el cursor para rescatar todos los productos recientes
        delete this.state.productCursor;
        this.state.lastProductSyncAt = null;
        this.state.lastRecoveryRepublishAt = null;
        this.stateStore.save(this.state);
        this.logger.info('Huellas de productos reseteadas para forzar resincronizacion completa');
        return { ok: true, message: 'Huellas reseteadas. El proximo ciclo reescribira todos los productos.' };
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
            `SELECT v.IP, v.ID_TICKET, v.FECHA, v.ID_PLU,
                    CAST(v.PESO AS DOUBLE PRECISION) AS PESO_G,
                    CAST(v.IMPORTE AS DOUBLE PRECISION) AS IMPORTE
             FROM VENTAS v
             ${whereClause}
             ORDER BY v.IP, v.ID_TICKET, v.FECHA`,
            since ? [since] : []
        );

        if (!rows.length) {
            this.logger.info('No hay tickets nuevos para sincronizar');
            return { ok: true, processed: 0, skipped: 0 };
        }

        const tickets = new Map();
        const pluIds = new Set();
        for (const row of rows) {
            const scaleIp = String(row.IP ?? row.ip ?? '').trim();
            const rawTicketId = String(row.ID_TICKET ?? row.id_ticket ?? '').trim();
            if (!rawTicketId) continue;
            // Key includes IP so ticket #3 from scale 20 ≠ ticket #3 from scale 21
            const ticketId = scaleIp ? `${scaleIp}-${rawTicketId}` : rawTicketId;
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

    /**
     * Build the array of Firebird SQL operations needed to write a single product.
     * All ops are executed in one Python subprocess via firebirdBatchQuery — much faster than per-query subprocesses.
     */
    buildProductWriteOps(row, pluColumns, hasEqPlus, eqPlusColumns, hasNovedades, novedadesColumns, targets, pluId) {
        const ops = [];
        const numero = row.COD_LOCAL || String(pluId);
        const pluIdNum = Number.isNaN(Number(pluId)) ? pluId : Number(pluId);
        const sectionId = row.ID_SECCION;

        // 1. PLU upsert (UPDATE OR INSERT)
        const allowedPlu = pluColumns.filter((col) => Object.prototype.hasOwnProperty.call(row, col));
        if (allowedPlu.length > 0) {
            ops.push({
                sql: `UPDATE OR INSERT INTO PLU (${allowedPlu.map((c) => `"${c}"`).join(', ')}) VALUES (${allowedPlu.map(() => '?').join(', ')}) MATCHING (ID)`,
                params: allowedPlu.map((c) => firebirdValue(row[c])),
            });
        }

        // 2. EQ_PLUS assignments per target (UPDATE OR INSERT)
        if (hasEqPlus && eqPlusColumns.length > 0) {
            for (const ip of targets) {
                const eqRow = {
                    IP: ip,
                    ID_PLU: firebirdValue(pluIdNum),
                    NUMERO: String(numero),
                };
                if (eqPlusColumns.includes('ID_SECCION')) eqRow.ID_SECCION = firebirdValue(sectionId);
                if (eqPlusColumns.includes('MODIF')) eqRow.MODIF = 3;
                const allowedEq = eqPlusColumns.filter((c) => Object.prototype.hasOwnProperty.call(eqRow, c));
                if (allowedEq.length > 0) {
                    ops.push({
                        sql: `UPDATE OR INSERT INTO EQ_PLUS (${allowedEq.map((c) => `"${c}"`).join(', ')}) VALUES (${allowedEq.map(() => '?').join(', ')}) MATCHING (IP, ID_PLU)`,
                        params: allowedEq.map((c) => firebirdValue(eqRow[c])),
                    });
                }
            }
        }

        // 3. Mark EQUIPOS.NOVEDADES = 1
        if (targets.length > 0) {
            ops.push({
                sql: `UPDATE EQUIPOS SET NOVEDADES = 1 WHERE IP IN (${targets.map(() => '?').join(', ')})`,
                params: [...targets],
            });
        }

        // Note: NOVEDADES table entries are created automatically by Qendra's
        // SiModificoNumero trigger when PLU is updated. Writing them explicitly
        // here causes deadlocks with Qendra's COMM NO WAIT transactions.

        return ops;
    }

    async upsertFirebirdRow(firebirdConfig, tableName, keyColumn, row, columns) {
        const allowedColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!allowedColumns.length) return;
        const fields = allowedColumns.map((column) => `"${column}"`).join(', ');
        const placeholders = allowedColumns.map(() => '?').join(', ');
        const params = allowedColumns.map((column) => firebirdValue(row[column]));
        await firebirdQuery(
            firebirdConfig,
            `UPDATE OR INSERT INTO ${tableName} (${fields}) VALUES (${placeholders}) MATCHING (${keyColumn})`,
            params
        );
    }

    async upsertCompositeFirebirdRow(firebirdConfig, tableName, keyColumns, row, columns) {
        const allowedColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!allowedColumns.length) return;
        const fields = allowedColumns.map((column) => `"${column}"`).join(', ');
        const placeholders = allowedColumns.map(() => '?').join(', ');
        const params = allowedColumns.map((column) => firebirdValue(row[column]));
        const matchingClause = keyColumns.join(', ');
        await firebirdQuery(
            firebirdConfig,
            `UPDATE OR INSERT INTO ${tableName} (${fields}) VALUES (${placeholders}) MATCHING (${matchingClause})`,
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
