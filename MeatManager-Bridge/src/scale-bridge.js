const { query: mysqlQuery, execute: mysqlExecute } = require('./mysql');
const { hashObject, formatTicketBarcode, formatPrintedTicketBarcode } = require('./helpers');
const { CuoraClient } = require('./cuora-client');
const {
    buildPlu4Payload,
    buildPlu61Payload,
    buildPriceChange33Payload,
    buildVendor38Payload,
    buildCommerceHeader17Payload,
    buildDeletePluPayload,
    buildBarcodeConfigPayload,
    buildSales72Payload,
    buildSectorPayload,
    inferSaleType,
    normalizeAscii,
    parseSales72,
} = require('./cuora-protocol');

function asDateParts(valueDate, valueTime) {
    const [dd, mm, yy] = String(valueDate || '').split('/');
    const [hh = '00', mi = '00', ss = '00'] = String(valueTime || '').split(':');
    const year = Number.parseInt(yy, 10);
    const fullYear = Number.isFinite(year) ? 2000 + year : 2000;
    return new Date(fullYear, (Number.parseInt(mm, 10) || 1) - 1, Number.parseInt(dd, 10) || 1, Number.parseInt(hh, 10) || 0, Number.parseInt(mi, 10) || 0, Number.parseInt(ss, 10) || 0);
}

function deriveItemMetrics({ units, grams }) {
    const safeUnits = Number(units || 0);
    const safeGrams = Number(grams || 0);
    if (safeGrams > 0) {
        return {
            itemQuantity: Number((safeGrams / 1000).toFixed(3)),
            itemQuantityUnit: 'kg',
        };
    }
    return {
        itemQuantity: safeUnits,
        itemQuantityUnit: 'un',
    };
}

function normalizePriceFormat(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '6d' ? '6d' : '4d2d';
}

function normalizeToken(value) {
    return normalizeAscii(String(value || '')).toLowerCase().trim();
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
            CREATE TABLE IF NOT EXISTS scale_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id BIGINT NOT NULL,
                slot_no TINYINT UNSIGNED NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY ux_scale_users_tenant_slot (tenant_id, slot_no),
                KEY ix_scale_users_tenant (tenant_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await mysqlExecute(this.mysqlPool, `
            CREATE TABLE IF NOT EXISTS scale_bridge_sales_item (
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
                UNIQUE KEY ux_scale_sale_line (device_id, ticket_id, line_no),
                KEY ix_scale_sale_date (device_id, sale_at),
                KEY ix_scale_sale_tenant (tenant_id, branch_id, sale_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_sales_item
                ADD COLUMN vendor_name VARCHAR(100) NULL AFTER vendor_code;
            `);
        } catch (error) {
            const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                || String(error?.message || '').toLowerCase().includes('duplicate column');
            if (!duplicate) throw error;
        }
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_sales_item
                ADD COLUMN ticket_barcode VARCHAR(64) NULL AFTER ticket_id;
            `);
        } catch (error) {
            const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                || String(error?.message || '').toLowerCase().includes('duplicate column');
            if (!duplicate) throw error;
        }
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_sales_item
                ADD COLUMN printed_ticket_barcode VARCHAR(32) NULL AFTER ticket_barcode;
            `);
        } catch (error) {
            const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                || String(error?.message || '').toLowerCase().includes('duplicate column');
            if (!duplicate) throw error;
        }
        for (const stmt of [
            "ALTER TABLE scale_bridge_sales_item ADD COLUMN ticket_total_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER amount",
            "ALTER TABLE scale_bridge_sales_item ADD COLUMN ticket_item_count INT NOT NULL DEFAULT 0 AFTER ticket_total_amount",
            "ALTER TABLE scale_bridge_sales_item ADD COLUMN item_quantity DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER ticket_item_count",
            "ALTER TABLE scale_bridge_sales_item ADD COLUMN item_quantity_unit VARCHAR(8) NOT NULL DEFAULT 'un' AFTER item_quantity",
        ]) {
            try {
                await mysqlExecute(this.mysqlPool, stmt);
            } catch (error) {
                const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                    || String(error?.message || '').toLowerCase().includes('duplicate column');
                if (!duplicate) throw error;
            }
        }

        await mysqlExecute(this.mysqlPool, `
            CREATE TABLE IF NOT EXISTS scale_bridge_ticket_map (
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
                UNIQUE KEY ux_scale_ticket_device (device_id, ticket_id),
                UNIQUE KEY ux_scale_ticket_barcode (ticket_barcode),
                KEY ix_scale_ticket_addr (tenant_id, scale_address, sale_at),
                KEY ix_scale_ticket_tenant_date (tenant_id, branch_id, sale_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_ticket_map
                ADD COLUMN vendor_name VARCHAR(100) NULL AFTER vendor_code;
            `);
        } catch (error) {
            const duplicate = error?.code === 'ER_DUP_FIELDNAME'
                || String(error?.message || '').toLowerCase().includes('duplicate column');
            if (!duplicate) throw error;
        }
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
        try {
            await mysqlExecute(this.mysqlPool, `
                ALTER TABLE scale_bridge_ticket_map
                ADD COLUMN printed_ticket_barcode VARCHAR(32) NULL AFTER ticket_barcode;
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

    async normalizeStoredSalesItems() {
        await mysqlExecute(
            this.mysqlPool,
            `UPDATE scale_bridge_sales_item s
             INNER JOIN scale_bridge_ticket_map t
                ON t.device_id = s.device_id
               AND t.tenant_id = s.tenant_id
               AND COALESCE(t.branch_id, 0) = COALESCE(s.branch_id, 0)
               AND t.ticket_id = s.ticket_id
             SET s.ticket_barcode = t.ticket_barcode,
                 s.printed_ticket_barcode = t.printed_ticket_barcode,
                 s.vendor_name = t.vendor_name,
                 s.ticket_total_amount = t.total_amount,
                 s.ticket_item_count = t.item_count,
                 s.synced_at = NOW()
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
            [
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
            ]
        );

        await mysqlExecute(
            this.mysqlPool,
            `UPDATE scale_bridge_sales_item s
             INNER JOIN (
                SELECT device_id,
                       tenant_id,
                       COALESCE(branch_id, 0) AS branch_id_key,
                       ticket_id,
                       ROUND(SUM(amount), 2) AS ticket_total_amount,
                       COUNT(*) AS ticket_item_count
                  FROM scale_bridge_sales_item
                 WHERE device_id = ?
                   AND tenant_id = ?
                   AND COALESCE(branch_id, 0) = COALESCE(?, 0)
                 GROUP BY device_id, tenant_id, COALESCE(branch_id, 0), ticket_id
             ) totals
                ON totals.device_id = s.device_id
               AND totals.tenant_id = s.tenant_id
               AND totals.branch_id_key = COALESCE(s.branch_id, 0)
               AND totals.ticket_id = s.ticket_id
             SET s.ticket_total_amount = totals.ticket_total_amount,
                 s.ticket_item_count = totals.ticket_item_count,
                 s.synced_at = NOW()
             WHERE s.device_id = ?
               AND s.tenant_id = ?
               AND COALESCE(s.branch_id, 0) = COALESCE(?, 0)
               AND (
                    ABS(COALESCE(s.ticket_total_amount, 0) - COALESCE(totals.ticket_total_amount, 0)) >= 0.01
                    OR COALESCE(s.ticket_item_count, 0) <> COALESCE(totals.ticket_item_count, 0)
               )`,
            [
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
            ]
        );

        await mysqlExecute(
            this.mysqlPool,
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
            [
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
            ]
        );

        await mysqlExecute(
            this.mysqlPool,
            `UPDATE scale_bridge_ticket_map t
             LEFT JOIN scale_users u
               ON u.tenant_id = t.tenant_id
              AND COALESCE(u.active, 1) = 1
              AND CAST(u.slot_no AS UNSIGNED) = CAST(t.vendor_code AS UNSIGNED)
             SET t.vendor_name = COALESCE(NULLIF(TRIM(u.display_name), ''), t.vendor_name)
             WHERE t.device_id = ?
               AND t.tenant_id = ?
               AND COALESCE(t.branch_id, 0) = COALESCE(?, 0)
               AND (
                    t.vendor_name IS NULL
                    OR t.vendor_name = ''
               )`,
            [
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
            ]
        );

        await mysqlExecute(
            this.mysqlPool,
            `UPDATE scale_bridge_sales_item s
             LEFT JOIN scale_users u
               ON u.tenant_id = s.tenant_id
              AND COALESCE(u.active, 1) = 1
              AND CAST(u.slot_no AS UNSIGNED) = CAST(s.vendor_code AS UNSIGNED)
             SET s.vendor_name = COALESCE(NULLIF(TRIM(u.display_name), ''), s.vendor_name),
                 s.synced_at = NOW()
             WHERE s.device_id = ?
               AND s.tenant_id = ?
               AND COALESCE(s.branch_id, 0) = COALESCE(?, 0)
               AND (
                    s.vendor_name IS NULL
                    OR s.vendor_name = ''
               )`,
            [
                this.config.deviceId,
                this.config.tenantId,
                this.config.branchId || null,
            ]
        );
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

    async getScaleSettings(keys = []) {
        const cleanKeys = [...new Set((keys || []).map((key) => String(key || '').trim()).filter(Boolean))];
        if (cleanKeys.length === 0) return {};
        const placeholders = cleanKeys.map(() => '?').join(', ');
        const rows = await mysqlQuery(
            this.mysqlPool,
            `SELECT \`key\`, value
             FROM settings
             WHERE tenant_id = ?
               AND \`key\` IN (${placeholders})`,
            [this.config.tenantId, ...cleanKeys]
        );
        return rows.reduce((acc, row) => {
            acc[String(row.key)] = row.value;
            return acc;
        }, {});
    }

    parseSectionMappings(rawValue) {
        try {
            const parsed = JSON.parse(String(rawValue || '[]'));
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((row) => ({
                    category: normalizeToken(row?.category),
                    sectionId: Math.max(1, Math.min(99, Number.parseInt(row?.sectionId, 10) || 2)),
                    sectionName: normalizeAscii(String(row?.sectionName || this.config.scale.sectionDefaultName || 'CARNICERIA'))
                        .toUpperCase()
                        .slice(0, 18) || 'CARNICERIA',
                }))
                .filter((row) => row.category);
        } catch {
            return [];
        }
    }

    parseMarqueeText(rawPayload, fallbackText = '') {
        const fallback = normalizeAscii(String(fallbackText || '')).slice(0, 80);
        if (!rawPayload) return fallback;
        try {
            const parsed = JSON.parse(String(rawPayload));
            if (!Array.isArray(parsed)) return fallback;
            const active = parsed.find((line) => (
                Number(line?.active ?? 1) === 1 && String(line?.text || '').trim().length > 0
            ));
            return normalizeAscii(String(active?.text || '')).slice(0, 80) || fallback;
        } catch {
            return fallback;
        }
    }

    parseTicketHeader(lines = {}) {
        return {
            line1: normalizeAscii(String(lines.line1 || '')).slice(0, 18),
            line2: normalizeAscii(String(lines.line2 || '')).slice(0, 34),
            line3: normalizeAscii(String(lines.line3 || '')).slice(0, 34),
        };
    }

    async loadRuntimeScaleConfig() {
        const rows = await this.getScaleSettings([
            'scale_ticket_header_line1',
            'scale_ticket_header_line2',
            'scale_ticket_header_line3',
            'scale_section_mappings',
            'scale_marquee_messages',
            'scale_marquee_text',
        ]);

        return {
            ticketHeader: this.parseTicketHeader({
                line1: rows.scale_ticket_header_line1,
                line2: rows.scale_ticket_header_line2,
                line3: rows.scale_ticket_header_line3,
            }),
            sectionMappings: this.parseSectionMappings(rows.scale_section_mappings),
            marqueeText: this.parseMarqueeText(rows.scale_marquee_messages, rows.scale_marquee_text),
        };
    }

    resolveSection(category, sectionMappings = []) {
        const text = normalizeToken(category);
        const mapped = (sectionMappings || []).find((row) => (
            row.category
            && text
            && (text === row.category || text.includes(row.category) || row.category.includes(text))
        ));
        if (mapped) {
            return {
                id: mapped.sectionId,
                name: mapped.sectionName,
            };
        }

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

    async applyMarqueeConfig(marqueeText) {
        const text = normalizeAscii(String(marqueeText || '')).slice(0, 80);
        if (!text) return { ok: true, skipped: true, reason: 'empty' };

        const fingerprint = hashObject({ marquee: text }, 20);
        if (this.state.marqueeConfigFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged' };
        }

        const response = await this.scale.send(6, text);
        if (!response.crc.ok) {
            throw new Error('CRC invalido al configurar marquesina (funcion 6)');
        }
        if (String(response.data || '').startsWith('E')) {
            throw new Error(`Error balanza al configurar marquesina (funcion 6): ${response.data}`);
        }

        this.state.marqueeConfigFingerprint = fingerprint;
        return { ok: true, updated: true, text };
    }

    async applyTicketHeaderConfig(ticketHeader = {}) {
        const line1 = normalizeAscii(String(ticketHeader.line1 || '')).slice(0, 18);
        const line2 = normalizeAscii(String(ticketHeader.line2 || '')).slice(0, 34);
        const fingerprint = hashObject({ line1, line2 }, 20);
        if (this.state.ticketHeaderFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged' };
        }

        const payload = buildCommerceHeader17Payload(line1, line2);
        const response = await this.scale.send(17, payload);
        if (!response.crc.ok) {
            throw new Error('CRC invalido al configurar encabezado de ticket (funcion 17)');
        }
        if (String(response.data || '').startsWith('E')) {
            throw new Error(`Error balanza al configurar encabezado de ticket (funcion 17): ${response.data}`);
        }

        this.state.ticketHeaderFingerprint = fingerprint;
        return { ok: true, updated: true, line1, line2 };
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

    async applyPriceFormatConfig(priceFormat) {
        const normalized = normalizePriceFormat(priceFormat);
        // En CUORA MAX V6 (fw S0060), CPr=0 trabaja en entero (6d) y CPr=2 en 4d2d.
        const payload = normalized === '6d' ? '0' : '2';
        const fingerprint = `${normalized}:${payload}`;
        if (this.state.priceFormatFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged' };
        }

        const response = await this.scale.send(42, payload);
        if (!response.crc.ok) {
            throw new Error('CRC invalido al configurar formato de precio (funcion 42)');
        }
        if (String(response.data || '').startsWith('E')) {
            throw new Error(`Error balanza al configurar formato de precio (funcion 42): ${response.data}`);
        }

        this.state.priceFormatFingerprint = fingerprint;
        return { ok: true, updated: true, normalized, payload };
    }

    async getPriceFormatSetting() {
        const rows = await mysqlQuery(
            this.mysqlPool,
            `SELECT value
             FROM settings
             WHERE tenant_id = ?
                             AND \`key\` = ?
             LIMIT 1`,
            [this.config.tenantId, 'precio_formato']
        );
        return normalizePriceFormat(rows[0]?.value);
    }

    async syncVendors() {
        const maxSlots = 4;
        const rows = await mysqlQuery(
            this.mysqlPool,
            `SELECT id, slot_no, display_name
             FROM scale_users
             WHERE tenant_id = ?
               AND COALESCE(active, 1) = 1
             ORDER BY slot_no ASC, id ASC
             LIMIT ?`,
            [this.config.tenantId, maxSlots]
        );

        const bySlot = [];
        for (let slot = 1; slot <= maxSlots; slot += 1) {
            const row = rows.find((entry) => Number(entry.slot_no) === slot) || null;
            const name = String(row?.display_name || `VENDEDOR ${slot}`).trim();
            bySlot.push({ slot, name });
        }

        const fingerprint = hashObject({
            tenantId: this.config.tenantId,
            vendors: bySlot,
        }, 20);

        if (this.state.vendorConfigFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged', synced: 0 };
        }

        let synced = 0;
        for (const vendor of bySlot) {
            const payload = buildVendor38Payload(vendor.slot, vendor.name);
            const response = await this.scale.send(38, payload);
            if (!response.crc.ok) {
                throw new Error(`CRC invalido al sincronizar vendedor ${vendor.slot}`);
            }
            if (String(response.data || '').startsWith('E')) {
                throw new Error(`Error balanza al sincronizar vendedor ${vendor.slot}: ${response.data}`);
            }
            synced += 1;
        }

        this.state.vendorConfigFingerprint = fingerprint;
        this.logger.info('Vendedores sincronizados en balanza', {
            synced,
            vendors: bySlot,
        });
        return { ok: true, synced };
    }

    async syncRuntimeSettings(runtimeScaleConfig = null) {
        const config = runtimeScaleConfig || await this.loadRuntimeScaleConfig().catch(() => ({
            ticketHeader: { line1: '', line2: '', line3: '' },
            sectionMappings: [],
            marqueeText: '',
        }));

        let forceProductRewrite = false;
        const priceFormat = await this.getPriceFormatSetting().catch(() => '4d2d');

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

        try {
            const marqueeResult = await this.applyMarqueeConfig(config.marqueeText);
            if (marqueeResult?.updated) {
                this.logger.info('Marquesina aplicada en balanza', { text: marqueeResult.text });
            }
        } catch (error) {
            this.logger.warn('No se pudo aplicar marquesina en balanza', { error: error.message });
        }

        try {
            const headerResult = await this.applyTicketHeaderConfig(config.ticketHeader);
            if (headerResult?.updated) {
                this.logger.info('Encabezado de ticket aplicado en balanza', {
                    line1: headerResult.line1,
                    line2: headerResult.line2,
                });
            }
        } catch (error) {
            this.logger.warn('No se pudo aplicar encabezado de ticket en balanza', { error: error.message });
        }

        try {
            const priceFormatResult = await this.applyPriceFormatConfig(priceFormat);
            if (priceFormatResult?.updated) {
                forceProductRewrite = true;
                this.logger.info('Formato de precio aplicado en balanza', {
                    priceFormat: priceFormatResult.normalized,
                    payload: priceFormatResult.payload,
                });
            }
        } catch (error) {
            this.logger.warn('No se pudo aplicar formato de precio en balanza', { error: error.message });
        }

        return {
            runtimeScaleConfig: config,
            priceFormat,
            forceProductRewrite,
        };
    }

    canonicalPluCode(value) {
        const raw = String(value || '').trim();
        if (!raw || !/^\d+$/.test(raw)) return '';
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return '';
        return String(parsed);
    }

    async cleanupOrphanPluCodes(expectedProducts = []) {
        const nowMs = Date.now();
        const cooldownMs = 12 * 60 * 60 * 1000; // 12h
        const cleanupCacheRaw = this.state.orphanPluCleanupCache && typeof this.state.orphanPluCleanupCache === 'object'
            ? this.state.orphanPluCleanupCache
            : {};
        const cleanupCache = { ...cleanupCacheRaw };

        const expected = new Set(
            (Array.isArray(expectedProducts) ? expectedProducts : [])
                .map((row) => this.canonicalPluCode(row.effective_plu_code || row.plu || row.id))
                .filter(Boolean)
        );

        // Si un PLU volvió a existir en MM, lo removemos del cache para no bloquear futuros eventos.
        for (const plu of Object.keys(cleanupCache)) {
            if (expected.has(plu)) delete cleanupCache[plu];
        }

        const observedRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT DISTINCT plu_code
             FROM (
                SELECT m.plu_code
                FROM scale_bridge_product_map m
                WHERE m.device_id = ?
                  AND m.tenant_id = ?
                UNION ALL
                SELECT s.plu_code
                FROM scale_bridge_sales_item s
                WHERE s.device_id = ?
                  AND s.tenant_id = ?
                  AND s.sale_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
             ) x
             WHERE TRIM(COALESCE(plu_code, '')) <> ''`,
            [this.config.deviceId, this.config.tenantId, this.config.deviceId, this.config.tenantId]
        );

        const orphanPluCodesRaw = [...new Set(
            observedRows
                .map((row) => this.canonicalPluCode(row.plu_code))
                .filter((plu) => plu && !expected.has(plu))
        )];

        const orphanPluCodes = orphanPluCodesRaw.filter((plu) => {
            const lastTs = Number(cleanupCache[plu] || 0);
            return !lastTs || (nowMs - lastTs) >= cooldownMs;
        });

        if (!orphanPluCodes.length) {
            this.state.orphanPluCleanupCache = cleanupCache;
            this.stateStore.save(this.state);
            return { ok: true, detected: 0, deleted: 0, failed: 0 };
        }

        let deleted = 0;
        let failed = 0;

        for (const plu of orphanPluCodes) {
            const pluNumber = Number.parseInt(plu, 10);
            // En CUORA V6, fn5 trabaja en 1..8000. Evitamos clamping silencioso.
            if (!Number.isFinite(pluNumber) || pluNumber < 1 || pluNumber > 8000) {
                this.logger.warn('PLU huérfano fuera de rango de borrado fn5, se omite', { plu });
                failed += 1;
                continue;
            }

            try {
                const deletePayload = buildDeletePluPayload(plu);
                const deleteResp = await this.scale.send(5, deletePayload);
                if (!deleteResp.crc.ok) {
                    throw new Error(`CRC invalido al borrar PLU huérfano ${plu}`);
                }
                if (String(deleteResp.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al borrar PLU huérfano ${plu}: ${deleteResp.data}`);
                }

                await mysqlExecute(
                    this.mysqlPool,
                    `DELETE FROM scale_bridge_product_map
                     WHERE device_id = ?
                       AND tenant_id = ?
                       AND (
                            TRIM(CAST(plu_code AS CHAR)) = ?
                            OR (TRIM(CAST(plu_code AS CHAR)) REGEXP '^[0-9]+$' AND CAST(TRIM(CAST(plu_code AS CHAR)) AS UNSIGNED) = ?)
                       )`,
                    [this.config.deviceId, this.config.tenantId, plu, pluNumber]
                );
                cleanupCache[plu] = nowMs;
                deleted += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo borrar un PLU huérfano en balanza', {
                    plu,
                    error: error.message,
                });
            }
        }

        this.logger.info('Limpieza automática de PLU huérfanos completada', {
            detected: orphanPluCodesRaw.length,
            attempted: orphanPluCodes.length,
            deleted,
            failed,
        });

        this.state.orphanPluCleanupCache = cleanupCache;
        this.stateStore.save(this.state);

        return {
            ok: true,
            detected: orphanPluCodesRaw.length,
            attempted: orphanPluCodes.length,
            deleted,
            failed,
        };
    }

    async syncProducts(options = {}) {
        const signature = await this.signature();
        const protocolVersion = Number(signature.protocolVersion || 0);
        const useLegacyPlu4 = protocolVersion === 0 || protocolVersion < 620;
        const priceFormat = options.priceFormat || await this.getPriceFormatSetting().catch(() => '4d2d');
        const runtimeScaleConfig = options.runtimeScaleConfig || await this.loadRuntimeScaleConfig().catch(() => ({
            ticketHeader: { line1: '', line2: '', line3: '' },
            sectionMappings: [],
            marqueeText: '',
        }));
        const effectiveLegacyPriceMultiplier = priceFormat === '6d'
            ? Math.max(1, Number(this.config.scale.priceFormat6dMultiplier || 10))
            : this.config.scale.legacyPriceMultiplier;
        let forceProductRewrite = Boolean(options.forceProductRewrite);
        const sectionMapFingerprint = hashObject(runtimeScaleConfig.sectionMappings || [], 20);
        if (this.state.sectionMapFingerprint !== sectionMapFingerprint) {
            forceProductRewrite = true;
            this.state.sectionMapFingerprint = sectionMapFingerprint;
        }
        this.logger.info('Firma digital de balanza detectada', {
            protocolVersion,
            protocolData: signature.data,
            useLegacyPlu4,
            priceFormat,
            effectiveLegacyPriceMultiplier,
        });

        let written = 0;
        let skipped = 0;
        let deleted = 0;
        let failed = 0;
        const touchedSections = new Map();

        const removedRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT m.product_id,
                    m.plu_code,
                    COALESCE(
                        NULLIF(
                            TRIM(CAST(p.plu AS CHAR)),
                            ''
                        ),
                        CAST(p.id AS CHAR)
                    ) AS expected_plu_code
             FROM scale_bridge_product_map m
             LEFT JOIN products p
                ON p.id = m.product_id
               AND p.tenant_id = m.tenant_id
             WHERE m.device_id = ?
               AND m.tenant_id = ?
                AND (
                    p.id IS NULL
                    OR COALESCE(p.current_price, 0) <= 0
                    OR COALESCE(
                        NULLIF(
                            TRIM(CAST(p.plu AS CHAR)),
                            ''
                        ),
                        CAST(p.id AS CHAR)
                    ) <> CAST(m.plu_code AS CHAR)
                )`,
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
                    expectedPlu: removed.expected_plu_code || null,
                    error: error.message,
                });
            }
        }

        const products = await mysqlQuery(
            this.mysqlPool,
            `SELECT id,
                    plu,
                    name,
                    category,
                    unit,
                    current_price,
                    updated_at,
                    COALESCE(NULLIF(TRIM(CAST(plu AS CHAR)), ''), CAST(id AS CHAR)) AS effective_plu_code
             FROM products
             WHERE tenant_id = ?
               AND COALESCE(current_price, 0) > 0
             ORDER BY updated_at ASC, id ASC`,
            [this.config.tenantId]
        );

        const orphanCleanup = await this.cleanupOrphanPluCodes(products);
        deleted += Number(orphanCleanup.deleted || 0);
        failed += Number(orphanCleanup.failed || 0);

        for (const product of products) {
            const pluCode = String(product.effective_plu_code || product.plu || product.id);
            const fingerprint = hashObject({
                pluCode,
                name: product.name,
                category: product.category,
                unit: product.unit,
                price: product.current_price,
                updatedAt: product.updated_at,
                protocolMode: useLegacyPlu4 ? 'v6-func4' : 'v7-func61',
                priceFormat,
                legacyPriceMultiplier: useLegacyPlu4 ? effectiveLegacyPriceMultiplier : null,
                priceFormat6dMultiplier: priceFormat === '6d' ? effectiveLegacyPriceMultiplier : null,
                legacyPriceEncoding: useLegacyPlu4 ? 'adaptive-v2' : null,
            });

            const mapRows = await mysqlQuery(
                this.mysqlPool,
                `SELECT fingerprint
                 FROM scale_bridge_product_map
                 WHERE device_id = ? AND tenant_id = ? AND product_id = ?
                 LIMIT 1`,
                [this.config.deviceId, this.config.tenantId, product.id]
            );
            if (!forceProductRewrite && mapRows[0] && mapRows[0].fingerprint === fingerprint) {
                skipped += 1;
                continue;
            }

            try {
                const section = this.resolveSection(product.category, runtimeScaleConfig.sectionMappings);
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
                        priceMultiplier: effectiveLegacyPriceMultiplier,
                        price6dMultiplier: effectiveLegacyPriceMultiplier,
                        priceFormat,
                    })
                    : buildPlu61Payload(product, {
                        sectionId: section.id,
                        saleType: inferSaleType(product.unit),
                        priceMultiplier: effectiveLegacyPriceMultiplier,
                        price6dMultiplier: effectiveLegacyPriceMultiplier,
                        priceFormat,
                    });
                const response = await this.scale.send(useLegacyPlu4 ? 4 : 61, payload);
                if (!response.crc.ok) {
                    throw new Error(`CRC invalido al enviar PLU ${pluCode}`);
                }
                if (String(response.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al enviar PLU ${pluCode} (fn ${useLegacyPlu4 ? 4 : 61}): ${response.data}`);
                }

                if (useLegacyPlu4 && priceFormat === '6d') {
                    // En CUORA MAX V6, reforzamos precio con fn33 para evitar desfasajes de visualizacion.
                    const priceValue = Math.max(0, Math.min(999999, Math.round(Number(product.current_price) || 0)));
                    const pricePayload = buildPriceChange33Payload(pluCode, priceValue, { version: '1' });
                    const priceResponse = await this.scale.send(33, pricePayload);
                    if (!priceResponse.crc.ok) {
                        throw new Error(`CRC invalido al ajustar precio PLU ${pluCode} (fn 33)`);
                    }
                    if (String(priceResponse.data || '').startsWith('E')) {
                        throw new Error(`Error balanza al ajustar precio PLU ${pluCode} (fn 33): ${priceResponse.data}`);
                    }
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
        const vendorRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT slot_no, display_name
             FROM scale_users
             WHERE tenant_id = ?
               AND COALESCE(active, 1) = 1
             ORDER BY slot_no ASC`,
            [this.config.tenantId]
        ).catch(() => []);
        const vendorByCode = new Map(
            vendorRows.map((row) => [
                String(Number.parseInt(row.slot_no, 10) || 0).padStart(2, '0'),
                String(row.display_name || '').trim(),
            ])
        );
        const resolveVendorName = (vendorCodeRaw) => {
            const parsed = Number.parseInt(String(vendorCodeRaw || '').trim(), 10);
            const code2 = String(Number.isFinite(parsed) ? parsed : 0).padStart(2, '0');
            if (vendorByCode.has(code2)) return vendorByCode.get(code2) || null;
            if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 4) return `VENDEDOR ${parsed}`;
            return null;
        };

        const countRawRecords = (payload) => String(payload || '')
            .replace(/F$/, '')
            .split(';')
            .map((part) => String(part || '').trim())
            .filter((part) => part.length > 0).length;

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

        const rawRecordCount = countRawRecords(responseData);
        if (rawRecordCount > rows.length) {
            this.logger.warn('Funcion 72 devolvio registros con formato no reconocido', {
                rawRecords: rawRecordCount,
                parsedRows: rows.length,
                preview: String(responseData || '').slice(0, 220),
            });
        }

        let inserted = 0;
        let latestSaleAt = null;
        const tickets = new Map();
        const indexedRows = [];
        for (const row of rows) {
            const saleAt = asDateParts(row.date, row.time);
            if (!latestSaleAt || saleAt > latestSaleAt) latestSaleAt = saleAt;

            const ticketId = String(row.ticketId || '').trim();
            if (!ticketId) continue;
            if (!tickets.has(ticketId)) {
                const vendorCode = String(row.vendor || '').trim();
                tickets.set(ticketId, {
                    ticketId,
                    vendorCode,
                    vendorName: resolveVendorName(vendorCode),
                    saleAt,
                    totalAmount: 0,
                    itemCount: 0,
                    lines: [],
                });
            }
            const ticket = tickets.get(ticketId);
            const lineNo = ticket.lines.length + 1;
            ticket.totalAmount += Number((row.amountTimes100 || 0) / 100);
            ticket.itemCount += 1;
            ticket.lines.push({
                line: lineNo,
                plu: row.plu,
                units: row.units,
                grams: row.grams,
                amountTimes100: row.amountTimes100,
            });
            if (!ticket.vendorCode && row.vendor) ticket.vendorCode = String(row.vendor).trim();
            if (!ticket.vendorName) {
                ticket.vendorName = resolveVendorName(ticket.vendorCode);
            }
            if (saleAt < ticket.saleAt) ticket.saleAt = saleAt;
            indexedRows.push({ row, lineNo, saleAt });
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
            const printedTicketBarcode = formatPrintedTicketBarcode({
                format: this.config.scale.barcodeConfig?.saleTotalFormat,
                itemCount: ticket.itemCount,
                totalAmount: Number(ticket.totalAmount.toFixed(2)) / Math.max(1, Number(this.config.scale.legacyPriceMultiplier || 1)),
            });
            ticket.ticketBarcode = ticketBarcode;
            ticket.printedTicketBarcode = printedTicketBarcode;

            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO scale_bridge_ticket_map
                 (device_id, tenant_id, branch_id, scale_address, ticket_id, ticket_barcode, printed_ticket_barcode, vendor_code, vendor_name, sale_at, total_amount, item_count, fingerprint, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    scale_address = VALUES(scale_address),
                    ticket_barcode = VALUES(ticket_barcode),
                    printed_ticket_barcode = VALUES(printed_ticket_barcode),
                    vendor_code = VALUES(vendor_code),
                    vendor_name = VALUES(vendor_name),
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
                    printedTicketBarcode,
                    ticket.vendorCode || null,
                    ticket.vendorName || null,
                    ticket.saleAt || new Date(),
                    Number(ticket.totalAmount.toFixed(2)),
                    ticket.itemCount,
                    fingerprint,
                ]
            );

            await mysqlExecute(
                this.mysqlPool,
                `UPDATE scale_bridge_sales_item
                 SET ticket_barcode = ?,
                     printed_ticket_barcode = ?,
                     vendor_name = ?,
                     synced_at = NOW()
                 WHERE device_id = ?
                   AND tenant_id = ?
                   AND ((branch_id IS NULL AND ? IS NULL) OR branch_id = ?)
                   AND ticket_id = ?`,
                [
                    ticketBarcode,
                    printedTicketBarcode,
                    ticket.vendorName || null,
                    this.config.deviceId,
                    this.config.tenantId,
                    this.config.branchId || null,
                    this.config.branchId || null,
                    ticket.ticketId,
                ]
            );
        }

        await this.normalizeStoredSalesItems();

        const barcodeByTicketId = new Map(
            [...tickets.values()].map((ticket) => [ticket.ticketId, ticket.ticketBarcode || null])
        );
        const printedBarcodeByTicketId = new Map(
            [...tickets.values()].map((ticket) => [ticket.ticketId, ticket.printedTicketBarcode || null])
        );

        const totalsByTicketId = new Map(
            [...tickets.values()].map((ticket) => [ticket.ticketId, {
                totalAmount: Number(ticket.totalAmount.toFixed(2)),
                itemCount: ticket.itemCount,
            }])
        );

        for (const entry of indexedRows) {
            const itemMetrics = deriveItemMetrics(entry.row);
            const ticketTotals = totalsByTicketId.get(String(entry.row.ticketId || '').trim()) || {
                totalAmount: 0,
                itemCount: 0,
            };
            await mysqlExecute(
                this.mysqlPool,
                `INSERT INTO scale_bridge_sales_item
                      (device_id, tenant_id, branch_id, ticket_id, ticket_barcode, printed_ticket_barcode, line_no, sale_at, vendor_code, vendor_name, plu_code, sector_code, units, grams, drained_grams, amount, ticket_total_amount, ticket_item_count, item_quantity, item_quantity_unit, raw_payload, synced_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    ticket_barcode = VALUES(ticket_barcode),
                          printed_ticket_barcode = VALUES(printed_ticket_barcode),
                    sale_at = VALUES(sale_at),
                    vendor_code = VALUES(vendor_code),
                    vendor_name = VALUES(vendor_name),
                    plu_code = VALUES(plu_code),
                    sector_code = VALUES(sector_code),
                    units = VALUES(units),
                    grams = VALUES(grams),
                    drained_grams = VALUES(drained_grams),
                    amount = VALUES(amount),
                    ticket_total_amount = VALUES(ticket_total_amount),
                    ticket_item_count = VALUES(ticket_item_count),
                    item_quantity = VALUES(item_quantity),
                    item_quantity_unit = VALUES(item_quantity_unit),
                    raw_payload = VALUES(raw_payload),
                    synced_at = VALUES(synced_at)`,
                [
                    this.config.deviceId,
                    this.config.tenantId,
                    this.config.branchId || null,
                    entry.row.ticketId,
                    barcodeByTicketId.get(String(entry.row.ticketId || '').trim()) || null,
                    printedBarcodeByTicketId.get(String(entry.row.ticketId || '').trim()) || null,
                    entry.lineNo,
                    entry.saleAt,
                    String(entry.row.vendor || '').slice(0, 8),
                    resolveVendorName(entry.row.vendor),
                    String(entry.row.plu || '').slice(0, 16),
                    String(entry.row.sector || '').slice(0, 8),
                    entry.row.units,
                    entry.row.grams,
                    entry.row.drainedGrams,
                    Number((entry.row.amountTimes100 || 0) / 100),
                    ticketTotals.totalAmount,
                    ticketTotals.itemCount,
                    itemMetrics.itemQuantity,
                    itemMetrics.itemQuantityUnit,
                    JSON.stringify(entry.row),
                ]
            );
            inserted += 1;
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

    async consolidatePluCatalogOnStartup() {
        const duplicatePluRows = await mysqlQuery(
            this.mysqlPool,
            `SELECT effective_plu_code, COUNT(*) AS qty
             FROM (
                SELECT COALESCE(
                    NULLIF(TRIM(CAST(plu AS CHAR)), ''),
                    CAST(id AS CHAR)
                ) AS effective_plu_code
                FROM products
                WHERE tenant_id = ?
                  AND COALESCE(current_price, 0) > 0
             ) x
             GROUP BY effective_plu_code
             HAVING COUNT(*) > 1
             ORDER BY effective_plu_code`,
            [this.config.tenantId]
        );

        if (duplicatePluRows.length > 0) {
            const sample = duplicatePluRows.slice(0, 10).map((row) => `${row.effective_plu_code}(${row.qty})`);
            throw new Error(`PLU duplicados detectados al iniciar: ${sample.join(', ')}`);
        }

        const deletedMapRows = await mysqlExecute(
            this.mysqlPool,
            `DELETE FROM scale_bridge_product_map
             WHERE device_id = ?
               AND tenant_id = ?`,
            [this.config.deviceId, this.config.tenantId]
        );

        const removedMappings = Number(deletedMapRows?.affectedRows || 0);
        this.logger.info('Consolidado general de PLU ejecutado al iniciar', {
            tenantId: this.config.tenantId,
            deviceId: this.config.deviceId,
            removedMappings,
        });

        this.state.startupPluConsolidatedAt = new Date().toISOString();
        this.stateStore.save(this.state);

        return { ok: true, removedMappings, forceProductRewrite: true };
    }

    async runOnce(options = {}) {
        const reason = String(options.reason || 'scheduled');
        await this.ensureSchema();
        await this.normalizeStoredSalesItems();
        const runtimeSettings = await this.syncRuntimeSettings();
        let startupPluConsolidation = { forceProductRewrite: false, removedMappings: 0 };
        if (reason === 'startup') {
            startupPluConsolidation = await this.consolidatePluCatalogOnStartup();
        }
        try {
            // Vendedores: verificar en cada ciclo para reflejar cambios en MM casi en tiempo real.
            await this.syncVendors();
        } catch (error) {
            this.logger.warn('No se pudieron sincronizar vendedores en balanza', { error: error.message });
        }
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
        const runtimeSectionFingerprint = hashObject(runtimeSettings.runtimeScaleConfig?.sectionMappings || [], 20);
        const sectionConfigChanged = this.state.sectionMapFingerprint !== runtimeSectionFingerprint;
        const shouldSyncProducts = !Number.isFinite(lastProductSyncTs)
            || runtimeSettings.forceProductRewrite
            || startupPluConsolidation.forceProductRewrite
            || sectionConfigChanged
            || (Date.now() - lastProductSyncTs) >= this.config.productSyncIntervalMs;
        if (shouldSyncProducts) {
            products = await this.syncProducts({
                runtimeScaleConfig: runtimeSettings.runtimeScaleConfig,
                priceFormat: runtimeSettings.priceFormat,
                forceProductRewrite: runtimeSettings.forceProductRewrite
                    || startupPluConsolidation.forceProductRewrite
                    || sectionConfigChanged,
            });
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
