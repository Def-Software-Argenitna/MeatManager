const { query: mysqlQuery, execute: mysqlExecute } = require('./mysql');
const { hashObject, formatTicketBarcode } = require('./helpers');
const { CuoraClient } = require('./cuora-client');
const {
    buildPlu4Payload,
    buildPlu61Payload,
    buildDeletePluPayload,
    buildBarcodeConfigPayload,
    buildSales72Payload,
    buildSectorPayload,
    inferSaleType,
    parseSales72,
} = require('./cuora-protocol');

function asDateParts(valueDate, valueTime) {
    const [dd, mm, yy] = String(valueDate || '').split('/');
    const [hh = '00', mi = '00', ss = '00'] = String(valueTime || '').split(':');
    const year = Number.parseInt(yy, 10);
    const fullYear = Number.isFinite(year) ? 2000 + year : 2000;
    return new Date(fullYear, (Number.parseInt(mm, 10) || 1) - 1, Number.parseInt(dd, 10) || 1, Number.parseInt(hh, 10) || 0, Number.parseInt(mi, 10) || 0, Number.parseInt(ss, 10) || 0);
}

class ScaleBridge {
    constructor({ config, logger, state, stateStore, mysqlPool }) {
        this.config = config;
        this.logger = logger;
        this.state = state;
        this.stateStore = stateStore;
        this.mysqlPool = mysqlPool;
        this.scale = new CuoraClient({
            config: config.scale,
            logger,
        });
    }

    async ensureSchema() {
        await mysqlExecute(this.mysqlPool, `
            CREATE TABLE IF NOT EXISTS scale_bridge_product_map (
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await mysqlExecute(this.mysqlPool, `
            CREATE TABLE IF NOT EXISTS scale_bridge_sales_item (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                device_id VARCHAR(64) NOT NULL,
                tenant_id BIGINT NOT NULL,
                branch_id BIGINT NULL,
                ticket_id VARCHAR(32) NOT NULL,
                line_no INT NOT NULL,
                sale_at DATETIME NOT NULL,
                vendor_code VARCHAR(8) NOT NULL,
                plu_code VARCHAR(16) NOT NULL,
                sector_code VARCHAR(8) NOT NULL,
                units INT NOT NULL DEFAULT 0,
                grams INT NOT NULL DEFAULT 0,
                drained_grams INT NOT NULL DEFAULT 0,
                amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                raw_payload JSON NULL,
                synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY ux_scale_sale_line (device_id, ticket_id, line_no),
                KEY ix_scale_sale_date (device_id, sale_at),
                KEY ix_scale_sale_tenant (tenant_id, branch_id, sale_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await mysqlExecute(this.mysqlPool, `
            CREATE TABLE IF NOT EXISTS scale_bridge_ticket_map (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                device_id VARCHAR(64) NOT NULL,
                tenant_id BIGINT NOT NULL,
                branch_id BIGINT NULL,
                scale_address INT NULL,
                ticket_id VARCHAR(32) NOT NULL,
                ticket_barcode VARCHAR(64) NOT NULL,
                vendor_code VARCHAR(16) NULL,
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
                UNIQUE KEY ux_scale_ticket_device (device_id, ticket_id),
                UNIQUE KEY ux_scale_ticket_barcode (ticket_barcode),
                KEY ix_scale_ticket_addr (tenant_id, scale_address, sale_at),
                KEY ix_scale_ticket_tenant_date (tenant_id, branch_id, sale_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_ticket_map
                ADD COLUMN scale_address INT NULL AFTER branch_id;
            `);
        } catch (error) {
            const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                || String(error?.message || '').toLowerCase().includes('duplicate column');
            if (!duplicate) throw error;
        }
        for (const stmt of [
            "ALTER TABLE scale_bridge_ticket_map ADD COLUMN ticket_status VARCHAR(16) NOT NULL DEFAULT 'open' AFTER item_count",
            "ALTER TABLE scale_bridge_ticket_map ADD COLUMN charged_sale_id BIGINT NULL AFTER ticket_status",
            "ALTER TABLE scale_bridge_ticket_map ADD COLUMN charged_at DATETIME NULL AFTER charged_sale_id",
            "ALTER TABLE scale_bridge_ticket_map ADD COLUMN voided_sale_id BIGINT NULL AFTER charged_at",
            "ALTER TABLE scale_bridge_ticket_map ADD COLUMN voided_at DATETIME NULL AFTER voided_sale_id",
        ]) {
            try {
                await mysqlExecute(this.mysqlPool, stmt);
            } catch (error) {
                const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                    || String(error?.message || '').toLowerCase().includes('duplicate column');
                if (!duplicate) throw error;
            }
        }
    }

    async ping() {
        const response = await this.scale.send(23, '');
        return {
            ok: response.crc.ok && !String(response.data || '').startsWith('E'),
            fn: response.fn,
            data: response.data,
            crc: response.crc,
            status: String(response.data || '').slice(-1),
        };
    }

    async signature() {
        let response = null;
        for (let i = 0; i < 3; i += 1) {
            response = await this.scale.send(2, '');
            if (response?.fn === 2 && response?.crc?.ok) break;
        }
        const match = String(response?.data || '').match(/S(\d{4})/);
        const protocolVersion = match ? Number.parseInt(match[1], 10) : 0;
        return {
            ok: response.crc.ok && !String(response.data || '').startsWith('E'),
            fn: response.fn,
            data: response.data,
            crc: response.crc,
            protocolVersion,
        };
    }

    resolveSection(category) {
        const text = String(category || '').toLowerCase();
        const meat = ['carne', 'carniceria', 'vaca', 'vacuno', 'res', 'cerdo', 'pollo', 'ave', 'cordero'];
        if (meat.some((item) => text.includes(item))) {
            return {
                id: 2,
                name: 'CARNICERIA',
            };
        }
        return {
            id: this.config.scale.sectionDefaultId,
            name: this.config.scale.sectionDefaultName,
        };
    }

    async applyBarcodeConfig() {
        const cfg = this.config.scale.barcodeConfig || {};
        if (!cfg.enabled) return { ok: true, skipped: true, reason: 'disabled' };

        const fingerprint = hashObject({
            weight: cfg.saleByWeightFormat,
            unit: cfg.saleByUnitFormat,
            total: cfg.saleTotalFormat,
        }, 20);

        if (this.state.barcodeConfigFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged' };
        }

        const commands = [
            { type: 'P', format: cfg.saleByWeightFormat },
            { type: 'U', format: cfg.saleByUnitFormat },
            { type: 'S', format: cfg.saleTotalFormat },
        ];

        for (const cmd of commands) {
            const payload = buildBarcodeConfigPayload(cmd.type, cmd.format);
            const response = await this.scale.send(8, payload);
            if (!response.crc.ok) {
                throw new Error(`CRC invalido al configurar barcode ${cmd.type}`);
            }
            if (String(response.data || '').startsWith('E')) {
                throw new Error(`Error balanza al configurar barcode ${cmd.type}: ${response.data}`);
            }
        }

        this.state.barcodeConfigFingerprint = fingerprint;
        return { ok: true, updated: true };
    }

    async syncProducts() {
        const signature = await this.signature();
        const protocolVersion = Number(signature.protocolVersion || 0);
        const useLegacyPlu4 = protocolVersion === 0 || protocolVersion < 620;
        this.logger.info('Firma digital de balanza detectada', {
            protocolVersion,
            protocolData: signature.data,
            useLegacyPlu4,
        });

        try {
            const barcodeResult = await this.applyBarcodeConfig();
            if (barcodeResult?.updated) {
                this.logger.info('Configuracion de barcode aplicada en balanza', {
                    weight: this.config.scale.barcodeConfig.saleByWeightFormat,
                    unit: this.config.scale.barcodeConfig.saleByUnitFormat,
                    total: this.config.scale.barcodeConfig.saleTotalFormat,
                });
            }
        } catch (error) {
            this.logger.warn('No se pudo aplicar configuracion de barcode en balanza', { error: error.message });
        }

        let written = 0;
        let skipped = 0;
        let deleted = 0;
        let failed = 0;
        const touchedSections = new Map();

        const removedRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT m.product_id, m.plu_code
             FROM scale_bridge_product_map m
             LEFT JOIN products p
                ON p.id = m.product_id
               AND p.tenant_id = m.tenant_id
             WHERE m.device_id = ?
               AND m.tenant_id = ?
               AND (p.id IS NULL OR COALESCE(p.current_price, 0) <= 0)`,
            [this.config.deviceId, this.config.tenantId]
        );

        for (const removed of removedRows) {
            try {
                const deletePayload = buildDeletePluPayload(removed.plu_code);
                const deleteResp = await this.scale.send(5, deletePayload);
                if (!deleteResp.crc.ok) {
                    throw new Error(`CRC invalido al borrar PLU ${removed.plu_code}`);
                }
                if (String(deleteResp.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al borrar PLU ${removed.plu_code}: ${deleteResp.data}`);
                }
                await mysqlExecute(
                    this.mysqlPool,
                    `DELETE FROM scale_bridge_product_map
                     WHERE device_id = ? AND tenant_id = ? AND product_id = ?`,
                    [this.config.deviceId, this.config.tenantId, removed.product_id]
                );
                deleted += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo eliminar un producto de la balanza', {
                    productId: removed.product_id,
                    plu: removed.plu_code,
                    error: error.message,
                });
            }
        }

        const products = await mysqlQuery(
            this.mysqlPool,
            `SELECT id, plu, name, category, unit, current_price, updated_at
             FROM products
             WHERE tenant_id = ?
               AND COALESCE(current_price, 0) > 0
             ORDER BY updated_at ASC, id ASC`,
            [this.config.tenantId]
        );

        for (const product of products) {
            const pluCode = String(product.plu || product.id);
            const fingerprint = hashObject({
                pluCode,
                name: product.name,
                category: product.category,
                unit: product.unit,
                price: product.current_price,
                updatedAt: product.updated_at,
                protocolMode: useLegacyPlu4 ? 'v6-func4' : 'v7-func61',
                legacyPriceMultiplier: useLegacyPlu4 ? this.config.scale.legacyPriceMultiplier : null,
            });

            const mapRows = await mysqlQuery(
                this.mysqlPool,
                `SELECT fingerprint
                 FROM scale_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND product_id = ?
                 LIMIT 1`,
                [this.config.deviceId, this.config.tenantId, product.id]
            );
            if (mapRows[0] && mapRows[0].fingerprint === fingerprint) {
                skipped += 1;
                continue;
            }

            try {
                const section = this.resolveSection(product.category);
                const sectionKey = `${section.id}:${section.name}`;
                if (!touchedSections.has(sectionKey)) {
                    const sectorPayload = buildSectorPayload(section.id, section.name);
                    const sectionResp = await this.scale.send(10, sectorPayload);
                    if (String(sectionResp.data || '').startsWith('E')) {
                        throw new Error(`Error al enviar seccion ${section.id}: ${sectionResp.data}`);
                    }
                    touchedSections.set(sectionKey, true);
                }

                const payload = useLegacyPlu4
                    ? buildPlu4Payload(product, {
                        sectionId: section.id,
                        saleType: inferSaleType(product.unit),
                        maintainTotals: Boolean(mapRows[0]),
                        priceMultiplier: this.config.scale.legacyPriceMultiplier,
                    })
                    : buildPlu61Payload(product, {
                        sectionId: section.id,
                        saleType: inferSaleType(product.unit),
                    });
                const response = await this.scale.send(useLegacyPlu4 ? 4 : 61, payload);
                if (!response.crc.ok) {
                    throw new Error(`CRC invalido al enviar PLU ${pluCode}`);
                }
                if (String(response.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al enviar PLU ${pluCode} (fn ${useLegacyPlu4 ? 4 : 61}): ${response.data}`);
                }

                await mysqlExecute(
                    this.mysqlPool,
                    `INSERT INTO scale_bridge_product_map (device_id, tenant_id, product_id, plu_code, fingerprint, synced_at)
                 VALUES (?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    plu_code = VALUES(plu_code),
                    fingerprint = VALUES(fingerprint),
                    synced_at = VALUES(synced_at)`,
                    [this.config.deviceId, this.config.tenantId, product.id, pluCode, fingerprint]
                );
                written += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo sincronizar un producto hacia balanza', {
                    productId: product.id,
                    plu: pluCode,
                    error: error.message,
                });
            }
        }

        if (written > 0 || deleted > 0) {
            const finalize = await this.scale.send(25, '');
            if (String(finalize.data || '').startsWith('E')) {
                this.logger.warn('La balanza devolvio error al finalizar sincronizacion', { data: finalize.data });
            }
        }

        return {
            ok: true,
            processed: products.length,
            written,
            skipped,
            deleted,
            failed,
            protocolVersion,
            protocolMode: useLegacyPlu4 ? 'v6-func4' : 'v7-func61',
        };
    }

    async pullSales({ fromDate, toDate, closeAfter = false }) {
        const payload = buildSales72Payload(fromDate, toDate);
        const now = new Date();
        const year = now.getFullYear();
        const yearFrom = new Date(year, 0, 1, 0, 0, 0);
        const yearTo = new Date(year, 11, 31, 23, 59, 59);
        const annualPayload = buildSales72Payload(yearFrom, yearTo);

        let response = await this.scale.send(72, payload, { timeoutMs: 30000 });
        if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72)');
        let responseData = String(response.data || '');
        if (responseData.startsWith('E7')) {
            // En algunos firmwares la consulta por día devuelve E7 aunque existan ventas.
            // Fallback: rango anual y luego consulta sin parámetros.
            this.logger.info('Funcion 72 sin datos en rango solicitado, intentando fallback anual', {
                from: new Date(fromDate).toISOString(),
                to: new Date(toDate).toISOString(),
                payload,
                annualPayload,
                response: responseData,
            });
            response = await this.scale.send(72, annualPayload, { timeoutMs: 30000 });
            if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback anual)');
            responseData = String(response.data || '');

            if (responseData.startsWith('E7')) {
                this.logger.info('Funcion 72 fallback anual sin datos, intentando consulta sin parámetros', {
                    annualPayload,
                    response: responseData,
                });
                response = await this.scale.send(72, '', { timeoutMs: 30000 });
                if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback vacio)');
                responseData = String(response.data || '');
            }
        }
        if (responseData.startsWith('E7')) {
            this.logger.info('Funcion 72 sin datos', {
                from: new Date(fromDate).toISOString(),
                to: new Date(toDate).toISOString(),
                payload,
                response: responseData,
            });
            return { ok: true, fetched: 0, stored: 0, tickets: 0, noData: true };
        }
        if (responseData.startsWith('E')) {
            this.logger.warn('Funcion 72 devolvio error', {
                from: new Date(fromDate).toISOString(),
                to: new Date(toDate).toISOString(),
                payload,
                response: responseData,
            });
            throw new Error(`Error al leer ventas: ${responseData}`);
        }

        let rows = parseSales72(responseData);
        if (rows.length === 0 && payload !== annualPayload) {
            this.logger.info('Funcion 72 devolvio vacio en rango incremental, intentando fallback anual', {
                payload,
                annualPayload,
            });
            response = await this.scale.send(72, annualPayload, { timeoutMs: 30000 });
            if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback anual-vacio)');
            responseData = String(response.data || '');
            if (responseData.startsWith('E7')) {
                response = await this.scale.send(72, '', { timeoutMs: 30000 });
                if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback vacio-vacio)');
                responseData = String(response.data || '');
            }
            if (responseData.startsWith('E')) {
                throw new Error(`Error al leer ventas en fallback: ${responseData}`);
            }
            rows = parseSales72(responseData);
        }
        let inserted = 0;
        let latestSaleAt = null;
        let index = 0;
        const tickets = new Map();
        for (const row of rows) {
            index += 1;
            const saleAt = asDateParts(row.date, row.time);
            if (!latestSaleAt || saleAt > latestSaleAt) latestSaleAt = saleAt;
            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO scale_bridge_sales_item
                 (device_id, tenant_id, branch_id, ticket_id, line_no, sale_at, vendor_code, plu_code, sector_code, units, grams, drained_grams, amount, raw_payload, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    sale_at = VALUES(sale_at),
                    vendor_code = VALUES(vendor_code),
                    plu_code = VALUES(plu_code),
                    sector_code = VALUES(sector_code),
                    units = VALUES(units),
                    grams = VALUES(grams),
                    drained_grams = VALUES(drained_grams),
                    amount = VALUES(amount),
                    raw_payload = VALUES(raw_payload),
                    synced_at = VALUES(synced_at)`,
                [
                    this.config.deviceId,
                    this.config.tenantId,
                    this.config.branchId || null,
                    row.ticketId,
                    index,
                    saleAt,
                    String(row.vendor || '').slice(0, 8),
                    String(row.plu || '').slice(0, 16),
                    String(row.sector || '').slice(0, 8),
                    row.units,
                    row.grams,
                    row.drainedGrams,
                    Number((row.amountTimes100 || 0) / 100),
                    JSON.stringify(row),
                ]
            );
            inserted += 1;

            const ticketId = String(row.ticketId || '').trim();
            if (!ticketId) continue;
            if (!tickets.has(ticketId)) {
                tickets.set(ticketId, {
                    ticketId,
                    vendorCode: String(row.vendor || '').trim(),
                    saleAt,
                    totalAmount: 0,
                    itemCount: 0,
                    lines: [],
                });
            }
            const ticket = tickets.get(ticketId);
            ticket.totalAmount += Number((row.amountTimes100 || 0) / 100);
            ticket.itemCount += 1;
            ticket.lines.push({
                line: index,
                plu: row.plu,
                units: row.units,
                grams: row.grams,
                amountTimes100: row.amountTimes100,
            });
            if (!ticket.vendorCode && row.vendor) ticket.vendorCode = String(row.vendor).trim();
            if (saleAt < ticket.saleAt) ticket.saleAt = saleAt;
        }

        for (const ticket of tickets.values()) {
            const fingerprint = hashObject({
                ticketId: ticket.ticketId,
                vendorCode: ticket.vendorCode,
                saleAt: ticket.saleAt ? ticket.saleAt.toISOString() : null,
                totalAmount: Number(ticket.totalAmount.toFixed(2)),
                itemCount: ticket.itemCount,
                lines: ticket.lines,
            });
            const ticketBarcode = formatTicketBarcode({
                deviceId: this.config.deviceId,
                ticketId: ticket.ticketId,
                sourceDate: ticket.saleAt || new Date(),
                fingerprint,
            });

            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO scale_bridge_ticket_map
                 (device_id, tenant_id, branch_id, scale_address, ticket_id, ticket_barcode, vendor_code, sale_at, total_amount, item_count, fingerprint, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    scale_address = VALUES(scale_address),
                    ticket_barcode = VALUES(ticket_barcode),
                    vendor_code = VALUES(vendor_code),
                    sale_at = VALUES(sale_at),
                    total_amount = VALUES(total_amount),
                    item_count = VALUES(item_count),
                    fingerprint = VALUES(fingerprint),
                    synced_at = VALUES(synced_at)`,
                [
                    this.config.deviceId,
                    this.config.tenantId,
                    this.config.branchId || null,
                    this.config.scale.address || null,
                    ticket.ticketId,
                    ticketBarcode,
                    ticket.vendorCode || null,
                    ticket.saleAt || new Date(),
                    Number(ticket.totalAmount.toFixed(2)),
                    ticket.itemCount,
                    fingerprint,
                ]
            );
        }

        if (closeAfter && rows.length > 0) {
            const close = await this.scale.send(32, '', { timeoutMs: 60000 });
            if (String(close.data || '').startsWith('E')) {
                this.logger.warn('La balanza devolvio error al cerrar ventas', { data: close.data });
            }
        }

        return {
            ok: true,
            fetched: rows.length,
            stored: inserted,
            tickets: tickets.size,
            latestSaleAt: latestSaleAt ? latestSaleAt.toISOString() : null,
        };
    }

    async runOnce() {
        await this.ensureSchema();
        const now = new Date();
        const from = new Date(now);
        const skewMs = Math.max(0, Number(this.config.salesResyncSkewMinutes || 0)) * 60 * 1000;
        if (this.state.lastTicketSyncAt) {
            const last = new Date(this.state.lastTicketSyncAt);
            if (!Number.isNaN(last.getTime())) {
                from.setTime(last.getTime() - skewMs);
            } else {
                from.setDate(from.getDate() - this.config.salesLookbackDays);
            }
        } else {
            from.setDate(from.getDate() - this.config.salesLookbackDays);
        }

        let products = { ok: true, processed: 0, written: 0, skipped: 0, deleted: 0, failed: 0, deferred: true };
        const lastProductSyncTs = this.state.lastProductSyncAt ? new Date(this.state.lastProductSyncAt).getTime() : NaN;
        const shouldSyncProducts = !Number.isFinite(lastProductSyncTs)
            || (Date.now() - lastProductSyncTs) >= this.config.productSyncIntervalMs;
        if (shouldSyncProducts) {
            products = await this.syncProducts();
            this.state.lastProductSyncAt = new Date().toISOString();
        }

        let sales = { ok: false, fetched: 0, stored: 0, error: null };
        try {
            sales = await this.pullSales({
                fromDate: from,
                toDate: now,
                closeAfter: this.config.closeSalesAfterPull,
            });

            // Si no hubo datos en la ventana incremental, intentamos un backfill
            // para recuperar ventas demoradas sin depender de intervención manual.
            if (sales.ok && Number(sales.fetched || 0) === 0) {
                const lastBackfillTs = this.state.lastSalesBackfillAt ? new Date(this.state.lastSalesBackfillAt).getTime() : NaN;
                const shouldBackfill = !Number.isFinite(lastBackfillTs) || (Date.now() - lastBackfillTs) >= 60_000;
                if (shouldBackfill) {
                    const backfillFrom = new Date(now);
                    backfillFrom.setDate(backfillFrom.getDate() - this.config.salesLookbackDays);
                    this.logger.info('Sin ventas en ventana incremental, ejecutando backfill de ventas', {
                        from: backfillFrom.toISOString(),
                        to: now.toISOString(),
                    });
                    const backfill = await this.pullSales({
                        fromDate: backfillFrom,
                        toDate: now,
                        closeAfter: this.config.closeSalesAfterPull,
                    });
                    this.state.lastSalesBackfillAt = new Date().toISOString();
                    if (Number(backfill.fetched || 0) > 0) {
                        this.logger.info('Backfill de ventas recupero registros', {
                            fetched: backfill.fetched,
                            tickets: backfill.tickets,
                        });
                        sales = { ...backfill, backfill: true };
                    }
                }
            }

            // El cursor avanza solo cuando realmente ingresan ventas.
            if (sales.ok && Number(sales.fetched || 0) > 0) {
                this.state.lastTicketSyncAt = sales.latestSaleAt || new Date().toISOString();
            }
        } catch (error) {
            sales = { ok: false, fetched: 0, stored: 0, error: error.message };
            this.logger.warn('No se pudieron leer ventas de la balanza en este ciclo', { error: error.message });
        }

        this.state.lastRunAt = new Date().toISOString();
        this.state.lastRunStatus = 'ok';
        this.state.lastRunMessage = `Productos:${products.written}/${products.deleted} Ventas:${sales.fetched}`;
        this.state.lastError = null;
        if (!this.state.lastProductSyncAt) this.state.lastProductSyncAt = this.state.lastRunAt;
        if (!this.state.lastTicketSyncAt && sales.ok) this.state.lastTicketSyncAt = this.state.lastRunAt;
        this.stateStore.save(this.state);

        return { ok: true, products, sales };
    }
}

module.exports = { ScaleBridge };
