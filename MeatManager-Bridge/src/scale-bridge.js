const fs = require('fs');
const path = require('path');
const { hashObject, formatTicketBarcode, formatPrintedTicketBarcode, defaultTotalBarcodeFormat, stampTotalBarcodeFormat } = require('./helpers');
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
    buildClock16Payload,
    parseClock28,
    parseEquipmentConfig39,
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

function normalizeToken(value) {
    return normalizeAscii(String(value || '')).toLowerCase().trim();
}

function nowIso() {
    return new Date().toISOString();
}

function elapsedMs(startedAt) {
    return startedAt ? Date.now() - startedAt : null;
}

class ScaleBridge {
    constructor({ config, logger, state, stateStore, apiClient }) {
        if (!apiClient) throw new Error('ScaleBridge requiere apiClient');
        this.config = config;
        this.logger = logger;
        this.state = state;
        this.stateStore = stateStore;
        this.api = apiClient;
        this.scaleId = String(config.scaleId || '1');
        this.scale = new CuoraClient({
            config: config.scale,
            logger,
        });
        this.scaleLatencyLogFile = path.join(config.logsDir, 'scale-ticket-latency.log');
        // Timestamps de eventos de saturacion (E3) recientes, para reportar en
        // el heartbeat. En memoria, ventana de 5 min.
        this._saturationEvents = [];
    }

    recordSaturationEvent() {
        this._saturationEvents.push(Date.now());
    }

    getRecentSaturationCount(windowMs = 5 * 60 * 1000) {
        const cutoff = Date.now() - windowMs;
        this._saturationEvents = this._saturationEvents.filter((ts) => ts >= cutoff);
        return this._saturationEvents.length;
    }

    logTicketLatency(event, meta = {}) {
        const entry = {
            ts: nowIso(),
            source: 'bridge',
            event,
            deviceId: this.config.deviceId,
            branchId: this.config.branchId,
            scaleId: this.scaleId,
            ...meta,
        };
        try {
            fs.mkdirSync(path.dirname(this.scaleLatencyLogFile), { recursive: true });
            fs.appendFileSync(this.scaleLatencyLogFile, `${JSON.stringify(entry)}\n`, 'utf8');
        } catch (error) {
            this.logger?.warn?.('No se pudo escribir log de latencia de tickets', {
                file: this.scaleLatencyLogFile,
                error: error.message,
            });
        }
    }

    buildTotalBarcodeFormat() {
        // Prioridad: el template que la balanza REPORTA tener (fn39, campo E_S)
        // — es la fuente de verdad de lo que imprime el papel — luego el
        // configurado, luego el derivado de la direccion. stampTotalBarcodeFormat
        // reproduce el render real del firmware (A -> 0): sin eso el estampado
        // lleva itemCount donde el papel imprime 00 y el escaneo no matchea.
        return stampTotalBarcodeFormat(
            this.state.scaleReportedBarcodeFormats?.total
            || this.config.scale.barcodeConfig?.saleTotalFormat
            || defaultTotalBarcodeFormat(this.config.scale.address)
        );
    }

    // fn39: lee la configuracion real del equipo y persiste los templates de
    // barcode que la balanza dice tener. Elimina la clase entera de bugs de
    // "asumimos un template que la balanza no tiene".
    async readScaleEquipmentConfig() {
        const response = await this.scale.send(39, '');
        if (!response.crc.ok) throw new Error('CRC invalido al leer configuracion del equipo (funcion 39)');
        const data = String(response.data || '');
        if (data.startsWith('E')) throw new Error(`Error balanza al leer configuracion (funcion 39): ${data}`);
        const parsed = parseEquipmentConfig39(data);
        if (!parsed) throw new Error('Respuesta de funcion 39 vacia o no parseable');

        const formats = {
            weight: parsed.barcodeWeightFormat,
            unit: parsed.barcodeUnitFormat,
            total: parsed.barcodeTotalFormat,
        };
        const changed = JSON.stringify(this.state.scaleReportedBarcodeFormats || null) !== JSON.stringify(formats);
        if (changed) {
            this.state.scaleReportedBarcodeFormats = formats;
            this.stateStore.save(this.state);
            this.logger.info('Templates de barcode reportados por la balanza (fn 39)', {
                ...formats,
                priceCommaPosition: parsed.priceCommaPosition,
            });
        }
        return parsed;
    }

    // fn28/fn16: el reloj de la balanza es la fuente de sale_at (identidad del
    // ticket y reportes); si deriva, ensucia los datos. Chequeamos cada 12h y
    // solo escribimos si el desvio supera el umbral.
    async syncScaleClock({ maxDriftMs = 60_000, checkIntervalMs = 12 * 60 * 60 * 1000 } = {}) {
        const lastCheck = this.state.lastClockSyncCheckAt ? new Date(this.state.lastClockSyncCheckAt).getTime() : 0;
        if (lastCheck && (Date.now() - lastCheck) < checkIntervalMs) {
            return { ok: true, skipped: true, reason: 'recent' };
        }

        const readResponse = await this.scale.send(28, '');
        if (!readResponse.crc.ok) throw new Error('CRC invalido al leer fecha/hora (funcion 28)');
        const scaleClock = parseClock28(readResponse.data);
        if (!scaleClock) throw new Error(`Respuesta de funcion 28 no parseable: ${String(readResponse.data || '').slice(0, 40)}`);

        const driftMs = scaleClock.getTime() - Date.now();
        this.state.lastClockSyncCheckAt = new Date().toISOString();

        if (Math.abs(driftMs) <= maxDriftMs) {
            this.stateStore.save(this.state);
            return { ok: true, skipped: true, reason: 'in_sync', driftMs };
        }

        const setResponse = await this.scale.send(16, buildClock16Payload(new Date()));
        if (!setResponse.crc.ok) throw new Error('CRC invalido al poner en hora (funcion 16)');
        if (String(setResponse.data || '').startsWith('E')) {
            throw new Error(`Error balanza al poner en hora (funcion 16): ${setResponse.data}`);
        }
        this.stateStore.save(this.state);
        this.logger.info('Reloj de balanza corregido', {
            driftMs,
            scaleClock: scaleClock.toISOString(),
        });
        return { ok: true, adjusted: true, driftMs };
    }

    async ping() {
        try {
            const response = await this.scale.send(23, '');
            return {
                ok: response.crc.ok && !String(response.data || '').startsWith('E'),
                fn: response.fn,
                data: response.data,
                crc: response.crc,
                status: String(response.data || '').slice(-1),
                scaleReachable: true,
            };
        } catch (error) {
            return {
                ok: false,
                error: error.message,
                scaleReachable: false,
            };
        }
    }

    async signature() {
        let response = null;
        try {
            for (let i = 0; i < 3; i += 1) {
                response = await this.scale.send(2, '');
                if (response?.fn === 2 && response?.crc?.ok) break;
            }
        } catch (error) {
            return {
                ok: false,
                fn: 2,
                data: '',
                crc: { ok: false },
                protocolVersion: 0,
                scaleReachable: false,
                error: error.message,
            };
        }
        if (!response || !response.crc?.ok) {
            return {
                ok: false,
                fn: 2,
                data: String(response?.data || ''),
                crc: response?.crc || { ok: false },
                protocolVersion: 0,
                scaleReachable: false,
                error: 'Sin respuesta valida tras 3 intentos',
            };
        }
        const match = String(response.data || '').match(/S(\d{4})/);
        const protocolVersion = match ? Number.parseInt(match[1], 10) : 0;
        const detectedAddress = Number(response.address) || null;
        return {
            ok: response.crc.ok && !String(response.data || '').startsWith('E'),
            fn: response.fn,
            data: response.data,
            crc: response.crc,
            protocolVersion,
            detectedAddress,
            scaleReachable: true,
        };
    }

    async loadRuntimeScaleConfig() {
        const settings = await this.api.getSettings();
        return {
            ticketHeader: settings?.ticketHeader || { line1: '', line2: '', line3: '' },
            sectionMappings: Array.isArray(settings?.sectionMappings) ? settings.sectionMappings : [],
            marqueeText: String(settings?.marqueeText || ''),
            priceFormat: settings?.priceFormat || '4d2d',
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
            return { id: 2, name: 'CARNICERIA' };
        }
        return {
            id: this.config.scale.sectionDefaultId,
            name: this.config.scale.sectionDefaultName,
        };
    }

    async applyMarqueeConfig(marqueeText) {
        const text = normalizeAscii(String(marqueeText || '')).slice(0, 80);
        const payload = text || ' '.repeat(80);

        const fingerprint = hashObject({ marquee: payload }, 20);
        if (this.state.marqueeConfigFingerprint === fingerprint) {
            return { ok: true, skipped: true, reason: 'unchanged' };
        }

        const response = await this.scale.send(6, payload);
        if (!response.crc.ok) {
            throw new Error('CRC invalido al configurar marquesina (funcion 6)');
        }
        if (String(response.data || '').startsWith('E')) {
            throw new Error(`Error balanza al configurar marquesina (funcion 6): ${response.data}`);
        }

        this.state.marqueeConfigFingerprint = fingerprint;
        return { ok: true, updated: true, text, cleared: !text };
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
        const normalized = priceFormat === '6d' ? '6d' : '4d2d';
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

    async syncVendors() {
        const { vendors = [] } = await this.api.getVendors();
        const maxSlots = 4;

        const bySlot = [];
        for (let slot = 1; slot <= maxSlots; slot += 1) {
            const row = vendors.find((entry) => Number(entry.slot) === slot) || null;
            const name = String(row?.displayName || `VENDEDOR ${slot}`).trim();
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
        // Los nombres cambiaron: invalidamos el cache que usa pullSales para
        // etiquetar tickets, asi la proxima venta ya sale con el nombre nuevo
        // en vez de esperar el TTL de 60s.
        this._vendorCache = null;
        this.logger.info('Vendedores sincronizados en balanza', { synced, vendors: bySlot });
        return { ok: true, synced };
    }

    async syncRuntimeSettings(runtimeScaleConfig = null) {
        const config = runtimeScaleConfig || await this.loadRuntimeScaleConfig().catch(() => ({
            ticketHeader: { line1: '', line2: '', line3: '' },
            sectionMappings: [],
            marqueeText: '',
            priceFormat: '4d2d',
        }));

        let forceProductRewrite = false;
        const priceFormat = config.priceFormat || '4d2d';

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

        // Leemos la config REAL del equipo (fn39) — los templates de barcode que
        // la balanza dice tener son la fuente de verdad para estampar tickets,
        // incluso si algun push de fn8 fallo o el equipo venia configurado de antes.
        try {
            await this.readScaleEquipmentConfig();
        } catch (error) {
            this.logger.warn('No se pudo leer configuracion real del equipo (fn 39)', { error: error.message });
        }

        try {
            await this.syncScaleClock();
        } catch (error) {
            this.logger.warn('No se pudo verificar/poner en hora la balanza', { error: error.message });
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

    async loadSyncCatalogEntries() {
        const catalog = await this.api.getCatalog();
        const products = Array.isArray(catalog?.products) ? catalog.products : [];
        const promotions = Array.isArray(catalog?.promotions) ? catalog.promotions : [];

        const toEntry = (row) => ({
            id: row.sourceId,
            plu: row.plu,
            name: row.name,
            category: row.category,
            unit: row.unit,
            current_price: row.currentPrice,
            updated_at: row.updatedAt,
            effective_plu_code: row.effectivePluCode,
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            mapProductId: row.mapProductId,
        });

        const entries = [...products.map(toEntry), ...promotions.map(toEntry)]
            .filter((row) => Number.isFinite(row.mapProductId));

        this.logger.info('Catalogo a sincronizar hacia balanza', {
            products: products.length,
            promotions: promotions.length,
        });

        return { entries, pluDuplicates: Array.isArray(catalog?.pluDuplicates) ? catalog.pluDuplicates : [] };
    }

    async cleanupOrphanPluCodes(expectedProducts = []) {
        const nowMs = Date.now();
        const cooldownMs = 12 * 60 * 60 * 1000;
        const cleanupCacheRaw = this.state.orphanPluCleanupCache && typeof this.state.orphanPluCleanupCache === 'object'
            ? this.state.orphanPluCleanupCache
            : {};
        const cleanupCache = { ...cleanupCacheRaw };

        const expected = new Set(
            (Array.isArray(expectedProducts) ? expectedProducts : [])
                .map((row) => this.canonicalPluCode(row.effective_plu_code || row.plu || row.id))
                .filter(Boolean)
        );

        for (const plu of Object.keys(cleanupCache)) {
            if (expected.has(plu)) delete cleanupCache[plu];
        }

        const { observedPlus = [] } = await this.api.getObservedPlus(this.scaleId);
        const orphanPluCodesRaw = [...new Set(
            observedPlus
                .map((plu) => this.canonicalPluCode(plu))
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
        const deletedPluCodes = [];

        for (const plu of orphanPluCodes) {
            const pluNumber = Number.parseInt(plu, 10);
            if (!Number.isFinite(pluNumber) || pluNumber < 1 || pluNumber > 8000) {
                this.logger.warn('PLU huerfano fuera de rango de borrado fn5, se omite', { plu });
                failed += 1;
                continue;
            }

            try {
                const deletePayload = buildDeletePluPayload(plu);
                const deleteResp = await this.scale.send(5, deletePayload);
                if (!deleteResp.crc.ok) {
                    throw new Error(`CRC invalido al borrar PLU huerfano ${plu}`);
                }
                if (String(deleteResp.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al borrar PLU huerfano ${plu}: ${deleteResp.data}`);
                }

                cleanupCache[plu] = nowMs;
                deletedPluCodes.push(plu);
                deleted += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo borrar un PLU huerfano en balanza', {
                    plu,
                    error: error.message,
                });
            }
        }

        if (deletedPluCodes.length > 0) {
            try {
                await this.api.deleteSyncState(this.scaleId, { pluCodes: deletedPluCodes });
            } catch (error) {
                this.logger.warn('No se pudo limpiar sync state de PLUs huerfanos en API', {
                    error: error.message,
                });
            }
        }

        this.logger.info('Limpieza automatica de PLU huerfanos completada', {
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

    async resetScaleAll({ pluRange = [1, 8000], reason = 'manual' } = {}) {
        const [min, max] = pluRange;
        this.logger.info('Reset completo de balanza iniciado', { reason, min, max });
        let deleted = 0;
        let failed = 0;
        const startedAt = Date.now();

        for (let plu = min; plu <= max; plu += 1) {
            try {
                const payload = buildDeletePluPayload(String(plu));
                const response = await this.scale.send(5, payload);
                if (response.crc?.ok && !String(response.data || '').startsWith('E')) {
                    deleted += 1;
                }
            } catch (error) {
                failed += 1;
                if (failed > 50 && failed > (plu - min + 1) * 0.8) {
                    // Si mas del 80% falla en el inicio, la balanza esta caida.
                    this.logger.error('Reset abortado: la balanza no responde de manera sostenida', {
                        plu,
                        failed,
                        error: error.message,
                    });
                    throw new Error(`Reset abortado: balanza no responde (PLU ${plu}, ${failed} fallos)`);
                }
            }
            if ((plu - min + 1) % 500 === 0) {
                this.logger.info('Reset en progreso', {
                    plu,
                    processed: plu - min + 1,
                    total: max - min + 1,
                    deletedOk: deleted,
                    failed,
                    elapsedMs: Date.now() - startedAt,
                });
            }
        }

        // Limpio el sync-state server-side para que el proximo cycle reescriba todo.
        try {
            await this.api.deleteSyncState(this.scaleId, { resetAll: true });
        } catch (error) {
            this.logger.warn('No se pudo limpiar sync-state despues del reset', { error: error.message });
        }

        // Limpio cache de orphan PLU cooldown.
        this.state.orphanPluCleanupCache = {};
        // Forzo re-aplicar settings/vendedores/productos en proximo cycle.
        this.state.barcodeConfigFingerprint = null;
        this.state.marqueeConfigFingerprint = null;
        this.state.ticketHeaderFingerprint = null;
        this.state.priceFormatFingerprint = null;
        this.state.vendorConfigFingerprint = null;
        this.state.sectionMapFingerprint = null;
        this.state.lastProductSyncAt = null;
        this.state.firstScaleResetDoneAt = new Date().toISOString();
        this.stateStore.save(this.state);

        const elapsedMs = Date.now() - startedAt;
        this.logger.info('Reset completo de balanza terminado', {
            reason,
            processed: max - min + 1,
            deletedOk: deleted,
            failed,
            elapsedMs,
        });
        return { ok: true, processed: max - min + 1, deletedOk: deleted, failed, elapsedMs };
    }

    async syncProducts(options = {}) {
        const signature = await this.signature();
        if (signature.scaleReachable === false) {
            this.logger.warn('Balanza no responde a signature (fn 2), sincronizacion de productos omitida', {
                error: signature.error || null,
            });
            return {
                ok: true,
                scaleReachable: false,
                processed: 0,
                written: 0,
                skipped: 0,
                deleted: 0,
                failed: 0,
                error: signature.error || 'Balanza no responde',
            };
        }

        // El reset masivo de los 8000 PLUs (fn5 sobre cada slot) solo debe correr
        // cuando el usuario lo pide explicitamente desde el boton "Resetear balanza"
        // del desktop (POST /api/scale/reset → resetScaleAll). Hacerlo automatico
        // tenia dos costos:
        //   1) Cada reinicio del bridge se comia varios minutos del puerto serie,
        //      bloqueando lectura de ventas y la propagacion de cambios de precio.
        //   2) Si state.json se borraba (o RESET_STATE_ON_START quedaba en true),
        //      `firstScaleResetDoneAt` reaparecia como null y el ciclo se repetia
        //      en cada arranque.
        // Si la balanza es heredada o tiene PLUs huerfanos, cleanupOrphanPluCodes
        // los detecta y los borra incrementalmente, sin parar el flujo normal.
        const protocolVersion = Number(signature.protocolVersion || 0);
        const useLegacyPlu4 = protocolVersion === 0 || protocolVersion < 620;
        if (signature.detectedAddress) {
            this.state.detectedScaleAddress = signature.detectedAddress;
            this.stateStore.save(this.state);
        }
        const runtimeScaleConfig = options.runtimeScaleConfig || await this.loadRuntimeScaleConfig().catch(() => ({
            ticketHeader: { line1: '', line2: '', line3: '' },
            sectionMappings: [],
            marqueeText: '',
            priceFormat: '4d2d',
        }));
        const priceFormat = options.priceFormat || runtimeScaleConfig.priceFormat || '4d2d';
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

        // 1) Productos a borrar de la balanza (cambiaron PLU o ya no existen)
        const { removed = [] } = await this.api.getCatalogRemoved(this.scaleId).catch((error) => {
            this.logger.warn('No se pudo leer catalogo/removed', { error: error.message });
            return { removed: [] };
        });

        const successfullyDeletedProductIds = [];
        for (const row of removed) {
            try {
                const deletePayload = buildDeletePluPayload(row.pluCode);
                const deleteResp = await this.scale.send(5, deletePayload);
                if (!deleteResp.crc.ok) {
                    throw new Error(`CRC invalido al borrar PLU ${row.pluCode}`);
                }
                if (String(deleteResp.data || '').startsWith('E')) {
                    throw new Error(`Error balanza al borrar PLU ${row.pluCode}: ${deleteResp.data}`);
                }
                successfullyDeletedProductIds.push(row.mapProductId);
                deleted += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo eliminar un producto de la balanza', {
                    productId: row.mapProductId,
                    plu: row.pluCode,
                    expectedPlu: row.expectedPluCode || null,
                    error: error.message,
                });
            }
        }
        if (successfullyDeletedProductIds.length > 0) {
            try {
                await this.api.deleteSyncState(this.scaleId, { productIds: successfullyDeletedProductIds });
            } catch (error) {
                this.logger.warn('No se pudo limpiar sync-state luego del borrado en balanza', {
                    error: error.message,
                });
            }
        }

        // 2) Catalogo actual completo
        const { entries: products } = await this.loadSyncCatalogEntries();

        // 3) Orphan cleanup (incluye su propio batch DELETE)
        const orphanCleanup = await this.cleanupOrphanPluCodes(products);
        deleted += Number(orphanCleanup.deleted || 0);
        failed += Number(orphanCleanup.failed || 0);

        // 4) Fingerprints actuales — una sola llamada
        const { entries: fingerprintEntries = [] } = await this.api.getSyncState(this.scaleId).catch((error) => {
            this.logger.warn('No se pudo leer sync-state', { error: error.message });
            return { entries: [] };
        });
        const fingerprintByProductId = new Map(
            fingerprintEntries.map((entry) => [Number(entry.productId), String(entry.fingerprint || '')])
        );

        const upsertBatch = [];
        for (const product of products) {
            const pluCode = String(product.effective_plu_code || product.plu || product.id);
            const fingerprint = hashObject({
                sourceType: product.sourceType || 'product',
                sourceId: product.sourceId || product.id,
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

            const storedFingerprint = fingerprintByProductId.get(Number(product.mapProductId));
            if (!forceProductRewrite && storedFingerprint && storedFingerprint === fingerprint) {
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
                        maintainTotals: false,
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

                upsertBatch.push({ productId: Number(product.mapProductId), pluCode, fingerprint });
                written += 1;
            } catch (error) {
                failed += 1;
                this.logger.warn('No se pudo sincronizar un producto hacia balanza', {
                    productId: product.id,
                    sourceType: product.sourceType || 'product',
                    plu: pluCode,
                    error: error.message,
                });
            }
        }

        if (upsertBatch.length > 0) {
            try {
                await this.api.putSyncState(this.scaleId, upsertBatch);
            } catch (error) {
                this.logger.warn('No se pudo persistir el sync-state (batch PUT)', {
                    error: error.message,
                    pending: upsertBatch.length,
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

    // Cache corto de vendedores: pullSales corre cada ~0.5s en el pulso y un
    // round-trip al API por pulso solo para nombres de vendedor (que cambian
    // casi nunca) agrega 200-500ms de latencia de deteccion por ticket.
    async getVendorMapCached() {
        const ttlMs = 60_000;
        const now = Date.now();
        if (this._vendorCache && (now - this._vendorCache.at) < ttlMs) {
            return this._vendorCache.map;
        }
        const { vendors: vendorRows = [] } = await this.api.getVendors().catch(() => ({ vendors: [] }));
        const map = new Map(
            vendorRows.map((row) => [
                String(Number.parseInt(row.slot, 10) || 0).padStart(2, '0'),
                String(row.displayName || '').trim(),
            ])
        );
        // Si el API fallo (mapa vacio) reintentamos antes del TTL completo.
        this._vendorCache = { at: map.size > 0 ? now : (now - ttlMs + 5000), map };
        return map;
    }

    async pullSales({ fromDate, toDate, closeAfter = false, pulse = false }) {
        const pullStartedAt = Date.now();
        // En pulsos (2/seg) las trazas por-pulso inflarian el log de latencia
        // ~35MB/dia; solo trazamos pulls manuales/startup y eventos con tickets.
        const trace = !pulse;
        if (trace) {
            this.logTicketLatency('bridge_pull_sales_start', {
                fromDate: new Date(fromDate).toISOString(),
                toDate: new Date(toDate).toISOString(),
                closeAfter,
            });
        }
        const vendorByCode = await this.getVendorMapCached();
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

        const incrementalPayload = buildSales72Payload(fromDate, toDate);
        const now = new Date();
        const year = now.getFullYear();
        const yearFrom = new Date(year, 0, 1, 0, 0, 0);
        const yearTo = new Date(year, 11, 31, 23, 59, 59);
        const annualPayload = buildSales72Payload(yearFrom, yearTo);

        // Adaptativo: el firmware S0060 responde E7 a la consulta del DIA aunque
        // haya ventas de hoy (malinterpreta el filtro de fecha), pero la consulta
        // anual devuelve todo. Cuando detectamos ese patron (incremental vacio +
        // anual con datos) persistimos el flag y de ahi en mas consultamos anual
        // como PRIMARIA en cada pulso (es barata: la balanza transmite su memoria
        // completa igual). Sin esto, el rate-limit de fallbacks dejaba la unica
        // lectura util en 1/min y la deteccion de tickets subia hasta ~60s.
        const preferAnnual = this.state.fn72PreferAnnualPayload === true;
        const payload = preferAnnual ? annualPayload : incrementalPayload;
        const markIncrementalBroken = (context) => {
            if (this.state.fn72PreferAnnualPayload === true) return;
            this.state.fn72PreferAnnualPayload = true;
            this.stateStore.save(this.state);
            this.logger.info('fn72: el filtro de fecha del firmware no devuelve las ventas del dia; usando consulta anual como primaria', { context });
        };

        // Rate-limit de fallbacks en pulsos: si la PRIMARIA dice E7/vacio, la
        // cadena anual+vacio agrega lecturas seriales a cada pulso. En pulsos
        // solo probamos la cadena 1 vez por minuto; pulls manuales, startup y
        // backfill siguen haciendo la cadena completa siempre.
        const allowFallbacks = !pulse || (Date.now() - Number(this._lastFn72FallbackAt || 0)) >= 60_000;
        const markFallback = () => { this._lastFn72FallbackAt = Date.now(); };

        const scaleReadStartedAt = Date.now();
        if (trace) this.logTicketLatency('bridge_scale_fn72_start', { payload });
        let response = await this.scale.send(72, payload, { timeoutMs: 30000 });
        if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72)');
        let responseData = String(response.data || '');
        if (trace) {
            this.logTicketLatency('bridge_scale_fn72_done', {
                elapsedMs: elapsedMs(scaleReadStartedAt),
                responseChars: responseData.length,
                crcOk: response.crc.ok,
                fallback: 'none',
            });
        }
        let usedAnnualFallback = false;
        if (responseData.startsWith('E7') && allowFallbacks && payload !== annualPayload) {
            markFallback();
            usedAnnualFallback = true;
            this.logger.info('Funcion 72 sin datos en rango solicitado, intentando fallback anual', {
                from: new Date(fromDate).toISOString(),
                to: new Date(toDate).toISOString(),
                payload,
                annualPayload,
                response: responseData,
            });
            const annualReadStartedAt = Date.now();
            this.logTicketLatency('bridge_scale_fn72_start', { payload: annualPayload, fallback: 'annual' });
            response = await this.scale.send(72, annualPayload, { timeoutMs: 30000 });
            if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback anual)');
            responseData = String(response.data || '');
            this.logTicketLatency('bridge_scale_fn72_done', {
                elapsedMs: elapsedMs(annualReadStartedAt),
                responseChars: responseData.length,
                crcOk: response.crc.ok,
                fallback: 'annual',
            });

            if (responseData.startsWith('E7')) {
                this.logger.info('Funcion 72 fallback anual sin datos, intentando consulta sin parametros', {
                    annualPayload,
                    response: responseData,
                });
                const emptyReadStartedAt = Date.now();
                this.logTicketLatency('bridge_scale_fn72_start', { payload: '', fallback: 'empty' });
                response = await this.scale.send(72, '', { timeoutMs: 30000 });
                if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback vacio)');
                responseData = String(response.data || '');
                this.logTicketLatency('bridge_scale_fn72_done', {
                    elapsedMs: elapsedMs(emptyReadStartedAt),
                    responseChars: responseData.length,
                    crcOk: response.crc.ok,
                    fallback: 'empty',
                });
            }
        }
        if (responseData.startsWith('E7')) {
            if (trace || allowFallbacks) {
                this.logger.info('Funcion 72 sin datos', {
                    from: new Date(fromDate).toISOString(),
                    to: new Date(toDate).toISOString(),
                    payload,
                    response: responseData,
                });
                this.logTicketLatency('bridge_pull_sales_no_data', {
                    elapsedMs: elapsedMs(pullStartedAt),
                });
            }
            return { ok: true, fetched: 0, stored: 0, tickets: 0, noData: true };
        }
        if (responseData.startsWith('E')) {
            // E3 = "se desatendieron datos" = la balanza estaba ocupada (pesando/
            // imprimiendo) y no atendio el serial. Lo registramos como senal de
            // saturacion para reportarla en el heartbeat (monitor de estado).
            if (responseData.startsWith('E3')) this.recordSaturationEvent();
            this.logger.warn('Funcion 72 devolvio error', {
                from: new Date(fromDate).toISOString(),
                to: new Date(toDate).toISOString(),
                payload,
                response: responseData,
            });
            throw new Error(`Error al leer ventas: ${responseData}`);
        }

        const parseStartedAt = Date.now();
        let rows = parseSales72(responseData);
        if (rows.length === 0 && payload !== annualPayload && allowFallbacks) {
            markFallback();
            usedAnnualFallback = true;
            this.logger.info('Funcion 72 devolvio vacio en rango incremental, intentando fallback anual', {
                payload,
                annualPayload,
            });
            const annualEmptyReadStartedAt = Date.now();
            this.logTicketLatency('bridge_scale_fn72_start', { payload: annualPayload, fallback: 'annual_after_empty_parse' });
            response = await this.scale.send(72, annualPayload, { timeoutMs: 30000 });
            if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback anual-vacio)');
            responseData = String(response.data || '');
            this.logTicketLatency('bridge_scale_fn72_done', {
                elapsedMs: elapsedMs(annualEmptyReadStartedAt),
                responseChars: responseData.length,
                crcOk: response.crc.ok,
                fallback: 'annual_after_empty_parse',
            });
            if (responseData.startsWith('E7')) {
                const emptyEmptyReadStartedAt = Date.now();
                this.logTicketLatency('bridge_scale_fn72_start', { payload: '', fallback: 'empty_after_empty_parse' });
                response = await this.scale.send(72, '', { timeoutMs: 30000 });
                if (!response.crc.ok) throw new Error('CRC invalido al leer ventas (funcion 72 fallback vacio-vacio)');
                responseData = String(response.data || '');
                this.logTicketLatency('bridge_scale_fn72_done', {
                    elapsedMs: elapsedMs(emptyEmptyReadStartedAt),
                    responseChars: responseData.length,
                    crcOk: response.crc.ok,
                    fallback: 'empty_after_empty_parse',
                });
            }
            if (responseData.startsWith('E')) {
                throw new Error(`Error al leer ventas en fallback: ${responseData}`);
            }
            rows = parseSales72(responseData);
        }
        // El incremental fallo pero el anual trajo filas: el filtro de fecha de
        // este firmware no sirve. Persistimos para consultar anual directo.
        if (usedAnnualFallback && rows.length > 0) {
            markIncrementalBroken('annual_fallback_yielded_rows');
        }
        if (trace) {
            this.logTicketLatency('bridge_sales_parse_done', {
                elapsedMs: elapsedMs(parseStartedAt),
                rows: rows.length,
                responseChars: responseData.length,
            });
        }

        let rawRecordCount = countRawRecords(responseData);
        if (rawRecordCount > rows.length) {
            // Lectura parcial: el registro perdido suele ser el PRIMERO de la
            // respuesta = el ticket MAS NUEVO, justo el que estan por escanear.
            // Reintentamos una vez de inmediato en vez de esperar al proximo pulso.
            this.logger.warn('Funcion 72 devolvio registros con formato no reconocido, reintentando lectura', {
                rawRecords: rawRecordCount,
                parsedRows: rows.length,
                preview: String(responseData || '').slice(0, 220),
            });
            const retryResponse = await this.scale.send(72, payload, { timeoutMs: 30000 });
            if (retryResponse.crc.ok) {
                const retryData = String(retryResponse.data || '');
                if (!retryData.startsWith('E')) {
                    const retryRows = parseSales72(retryData);
                    if (retryRows.length > rows.length) {
                        rows = retryRows;
                        responseData = retryData;
                        rawRecordCount = countRawRecords(retryData);
                    }
                }
            }
        }
        const partialRead = rawRecordCount > rows.length;

        let latestSaleAt = null;
        const tickets = new Map();
        for (const row of rows) {
            const saleAt = asDateParts(row.date, row.time);
            if (!latestSaleAt || saleAt > latestSaleAt) latestSaleAt = saleAt;

            const ticketId = String(row.ticketId || '').trim();
            if (!ticketId) continue;
            const ticketKey = `${ticketId}|${saleAt.toISOString()}`;
            if (!tickets.has(ticketKey)) {
                const vendorCode = String(row.vendor || '').trim();
                tickets.set(ticketKey, {
                    ticketKey,
                    ticketId,
                    vendorCode,
                    vendorName: resolveVendorName(vendorCode),
                    saleAt,
                    totalAmount: 0,
                    itemCount: 0,
                    lines: [],
                });
            }
            const ticket = tickets.get(ticketKey);
            const lineNo = ticket.lines.length + 1;
            ticket.totalAmount += Number((row.amountTimes100 || 0) / 100);
            ticket.itemCount += 1;
            const itemMetrics = deriveItemMetrics(row);
            ticket.lines.push({
                lineNo,
                plu: String(row.plu || '').slice(0, 16),
                sector: String(row.sector || '').slice(0, 8),
                vendorCode: String(row.vendor || '').slice(0, 8),
                vendorName: resolveVendorName(row.vendor),
                units: row.units,
                grams: row.grams,
                drainedGrams: row.drainedGrams,
                amount: Number((row.amountTimes100 || 0) / 100),
                itemQuantity: itemMetrics.itemQuantity,
                itemQuantityUnit: itemMetrics.itemQuantityUnit,
                rawPayload: row,
                saleAt,
            });
            if (!ticket.vendorCode && row.vendor) ticket.vendorCode = String(row.vendor).trim();
            if (!ticket.vendorName) {
                ticket.vendorName = resolveVendorName(ticket.vendorCode);
            }
            if (saleAt < ticket.saleAt) ticket.saleAt = saleAt;
        }

        const ticketsPayload = [];
        for (const ticket of tickets.values()) {
            const fingerprint = hashObject({
                ticketId: ticket.ticketId,
                vendorCode: ticket.vendorCode,
                saleAt: ticket.saleAt ? ticket.saleAt.toISOString() : null,
                totalAmount: Number(ticket.totalAmount.toFixed(2)),
                itemCount: ticket.itemCount,
                lines: ticket.lines.map((line) => ({
                    line: line.lineNo,
                    plu: line.plu,
                    units: line.units,
                    grams: line.grams,
                    amountTimes100: Math.round((line.amount || 0) * 100),
                })),
            });
            const ticketBarcode = formatTicketBarcode({
                deviceId: `${this.config.deviceId}-scale-${this.scaleId}`,
                ticketId: ticket.ticketId,
                sourceDate: ticket.saleAt || new Date(),
                fingerprint,
            });
            const printedTicketBarcode = formatPrintedTicketBarcode({
                format: this.buildTotalBarcodeFormat(),
                itemCount: ticket.itemCount,
                totalAmount: Number(ticket.totalAmount.toFixed(2)) / Math.max(1, Number(this.config.scale.legacyPriceMultiplier || 1)),
            });

            ticketsPayload.push({
                ticketKey: ticket.ticketKey,
                ticketId: ticket.ticketId,
                vendorCode: ticket.vendorCode || null,
                vendorName: ticket.vendorName || null,
                saleAt: (ticket.saleAt || new Date()).toISOString(),
                totalAmount: Number(ticket.totalAmount.toFixed(2)),
                itemCount: ticket.itemCount,
                fingerprint,
                ticketBarcode,
                printedTicketBarcode,
                lines: ticket.lines.map((line) => ({
                    lineNo: line.lineNo,
                    plu: line.plu,
                    sector: line.sector,
                    vendorCode: line.vendorCode,
                    vendorName: line.vendorName,
                    units: line.units,
                    grams: line.grams,
                    drainedGrams: line.drainedGrams,
                    amount: line.amount,
                    itemQuantity: line.itemQuantity,
                    itemQuantityUnit: line.itemQuantityUnit,
                    saleAt: line.saleAt ? line.saleAt.toISOString() : undefined,
                    rawPayload: line.rawPayload,
                })),
            });
        }

        // Dedupe: balanzas con firmware viejo (Systel CUORA MAX S0060) ignoran
        // el filtro de fecha en fn 72 y devuelven *todas* las ventas en memoria
        // en cada pulso. Sin esto el bridge re-postea 100+ tickets ya conocidos
        // cada ~1.5s, ocupando el puerto serie y atrasando la deteccion del
        // ticket nuevo. Trackeamos {ticketId → fingerprint} en state.json y solo
        // mandamos al API tickets nuevos o modificados.
        const knownFingerprints = (this.state.knownTicketFingerprints && typeof this.state.knownTicketFingerprints === 'object')
            ? { ...this.state.knownTicketFingerprints }
            : {};

        const ticketsToSend = ticketsPayload.filter((ticket) => {
            const dedupeKey = ticket.ticketKey || `${ticket.ticketId}|${ticket.saleAt}`;
            const stored = knownFingerprints[dedupeKey];
            return !stored || stored !== ticket.fingerprint;
        });

        let stored = 0;
        if (ticketsToSend.length > 0) {
            const apiPostStartedAt = Date.now();
            this.logTicketLatency('bridge_api_post_sales_start', {
                tickets: ticketsToSend.length,
                ticketIds: ticketsToSend.map((ticket) => ticket.ticketId).slice(0, 20),
                ticketBarcodes: ticketsToSend.map((ticket) => ticket.ticketBarcode).slice(0, 20),
                printedTicketBarcodes: ticketsToSend.map((ticket) => ticket.printedTicketBarcode).slice(0, 20),
            });
            const apiResult = await this.api.postSales({
                scaleId: this.scaleId,
                scaleAddress: this.config.scale.address,
                tickets: ticketsToSend,
            });
            stored = Number(apiResult?.itemsUpserted || 0);
            this.logTicketLatency('bridge_api_post_sales_done', {
                elapsedMs: elapsedMs(apiPostStartedAt),
                tickets: ticketsToSend.length,
                stored,
                apiResult,
            });

            for (const ticket of ticketsToSend) {
                const dedupeKey = ticket.ticketKey || `${ticket.ticketId}|${ticket.saleAt}`;
                knownFingerprints[dedupeKey] = ticket.fingerprint;
            }
        }

        // Podamos: nos quedamos solo con ticketIds que la balanza todavia tiene
        // en memoria. Si la balanza purgo un ticket viejo, lo olvidamos tambien
        // (el API ya lo tiene almacenado). Esto evita que knownTicketFingerprints
        // crezca sin limite. OJO: con lectura parcial NO podamos — un ticket
        // ausente por truncamiento serial no fue purgado por la balanza, y
        // podarlo provoca que se re-postee al API en el proximo pulso.
        if (!partialRead) {
            const presentTicketIds = new Set(ticketsPayload.map((t) => t.ticketKey || `${t.ticketId}|${t.saleAt}`));
            const prunedFingerprints = {};
            for (const ticketId of presentTicketIds) {
                if (knownFingerprints[ticketId]) prunedFingerprints[ticketId] = knownFingerprints[ticketId];
            }
            const pruneChanged = Object.keys(prunedFingerprints).length
                !== Object.keys(this.state.knownTicketFingerprints || {}).length;
            this.state.knownTicketFingerprints = prunedFingerprints;
            // state.json se escribe sincronicamente; con pulsos cada ~0.5s solo
            // grabamos cuando algo cambio de verdad.
            if (ticketsToSend.length > 0 || pruneChanged) {
                this.stateStore.save(this.state);
            }
        } else if (ticketsToSend.length > 0) {
            this.state.knownTicketFingerprints = knownFingerprints;
            this.stateStore.save(this.state);
        }

        // Cierre tras lectura: vacia la memoria de ventas de la balanza para que
        // la proxima fn72 transmita solo lo nuevo (lecturas de ~0.3s en vez de
        // retransmitir todo el dia). Solo cuando llegaron tickets nuevos Y el API
        // confirmo haberlos guardado (ticketsToSend.length > 0 && stored > 0).
        // Con "rows.length > 0" el fn32 se disparaba en cada pulso de 2.5s
        // mientras la balanza tuviera ventas acumuladas, generando E3 y frenando
        // el pesaje. Con esta condicion solo limpia una vez por cliente: el
        // siguiente pulso encuentra la balanza vacia y fn32 no vuelve a correr
        // hasta la proxima venta nueva. NUNCA con lectura parcial: cerrar
        // perderia el registro que no pudimos parsear.
        if (closeAfter && ticketsToSend.length > 0 && stored > 0 && !partialRead) {
            const close = await this.scale.send(32, '', {
                timeoutMs: 60000,
                // fn32 responde "I" (inicio) y un ACK final: hay que esperar el ACK
                // dentro del mismo turno para que no se mezcle con la proxima lectura.
                expectAckAfterInit: true,
                ackTimeoutMs: 30000,
            });
            if (String(close.data || '').startsWith('E')) {
                this.logger.warn('La balanza devolvio error al cerrar ventas', { data: close.data });
            }
        }

        const result = {
            ok: true,
            fetched: rows.length,
            stored,
            tickets: tickets.size,
            newTickets: ticketsToSend.length,
            latestSaleAt: latestSaleAt ? latestSaleAt.toISOString() : null,
        };
        if (trace || ticketsToSend.length > 0) {
            this.logTicketLatency('bridge_pull_sales_done', {
                elapsedMs: elapsedMs(pullStartedAt),
                ...result,
            });
        }
        return result;
    }

    async consolidatePluCatalogOnStartup() {
        // En arranque solo validamos que el catalogo no tenga PLUs duplicados:
        // si los hay, no hay forma sana de sincronizar con la balanza (un slot
        // PLU representa un producto unico). Antes esta funcion ademas borraba
        // todo el sync-state del API en cada arranque, lo que forzaba al bridge
        // a reescribir el catalogo entero — esto bloqueaba el puerto serie por
        // minutos y atrasaba lectura de ventas y cambios de precio. Ahora los
        // fingerprints persisten entre reinicios y solo se reescribe lo que
        // realmente cambio (precio, nombre, categoria, etc.).
        const { pluDuplicates = [] } = await this.loadSyncCatalogEntries();

        if (pluDuplicates.length > 0) {
            const sample = pluDuplicates.slice(0, 10).map((row) => `${row.pluCode}(${row.count})`);
            throw new Error(`PLU duplicados detectados al iniciar: ${sample.join(', ')}`);
        }

        this.state.startupPluConsolidatedAt = new Date().toISOString();
        this.stateStore.save(this.state);

        return { ok: true, removedMappings: 0, forceProductRewrite: false };
    }

    async runOnce(options = {}) {
        const reason = String(options.reason || 'scheduled');
        const skipSales = options.skipSales === true;
        const runtimeSettings = await this.syncRuntimeSettings();
        let startupPluConsolidation = { forceProductRewrite: false, removedMappings: 0 };
        if (reason === 'startup') {
            startupPluConsolidation = await this.consolidatePluCatalogOnStartup();
        }
        try {
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

        let sales = { ok: true, fetched: 0, stored: 0, skipped: skipSales, error: null };
        if (!skipSales) {
            try {
                sales = await this.pullSales({
                    fromDate: from,
                    toDate: now,
                    closeAfter: this.config.closeSalesAfterPull,
                });

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

                if (sales.ok && Number(sales.fetched || 0) > 0) {
                    const latestMs = new Date(sales.latestSaleAt || Date.now()).getTime();
                    const nowMs = Date.now();
                    this.state.lastTicketSyncAt = new Date(Math.min(latestMs, nowMs)).toISOString();
                }
            } catch (error) {
                sales = { ok: false, fetched: 0, stored: 0, error: error.message };
                this.logger.warn('No se pudieron leer ventas de la balanza en este ciclo', { error: error.message });
            }
        }

        this.state.lastRunAt = new Date().toISOString();
        this.state.lastRunStatus = 'ok';
        this.state.scaleReachable = products.scaleReachable === false ? false : true;
        if (products.scaleReachable === false) {
            this.state.lastRunMessage = 'Balanza no responde (productos no sincronizados)';
            this.state.lastError = null;
        } else {
            this.state.lastRunMessage = `Productos:${products.written}/${products.deleted} Ventas:${sales.fetched}`;
            this.state.lastError = null;
        }
        if (!this.state.lastProductSyncAt) this.state.lastProductSyncAt = this.state.lastRunAt;
        if (!this.state.lastTicketSyncAt && sales.ok) this.state.lastTicketSyncAt = this.state.lastRunAt;
        this.stateStore.save(this.state);

        return { ok: true, products, sales };
    }
}

module.exports = { ScaleBridge };
