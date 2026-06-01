const http = require('http');
const fs = require('fs');
const config = require('./config');
const { Logger } = require('./logger');
const { loadState, resetState, saveState } = require('./state');
const { ApiClient } = require('./api-client');
const { ScaleBridge } = require('./scale-bridge');
const { CuoraClient } = require('./cuora-client');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });

const logger = new Logger({ logFile: config.logFile, level: config.logLevel, truncateOnStart: true });
const state = config.resetStateOnStart ? resetState(config.stateFile) : loadState(config.stateFile);
const stateStore = { save: (nextState) => saveState(config.stateFile, nextState) };

if (!config.isOnboarded) {
    logger.error('Bridge no onboardeado: faltan apiBaseUrl o deviceToken en installation.json', {
        installationFile: config.installationFile,
        apiBaseUrl: config.apiBaseUrl || null,
        hasDeviceToken: Boolean(config.deviceToken),
    });
    console.error('[BRIDGE] Falta onboarding. Corre el wizard del desktop o crea installation.json con { apiBaseUrl, deviceToken, deviceId, tenantId, clientId, branchId }');
    process.exit(2);
}

const apiClient = new ApiClient({
    baseUrl: config.apiBaseUrl,
    deviceToken: config.deviceToken,
    logger,
});

const bridge = new ScaleBridge({ config, logger, state, stateStore, apiClient });

let cycleRunning = false;
let pulseRunning = false;
let timer = null;
let salesPulseTimer = null;
let heartbeatTimer = null;
let server = null;
let schedulerActive = false;

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error('invalid_json'));
            }
        });
        req.on('error', reject);
    });
}

function runtimeSnapshot() {
    return {
        ok: true,
        running: cycleRunning || pulseRunning,
        cycleRunning,
        pulseRunning,
        mode: 'direct-usb-api',
        apiBaseUrl: config.apiBaseUrl,
        deviceId: config.deviceId,
        bridgeName: config.bridgeName,
        clientName: config.clientName,
        branchName: config.siteName,
        tenantId: config.tenantId,
        clientId: config.clientId,
        branchId: config.branchId,
        scaleId: config.scaleId,
        scalePort: config.scale.port,
        scaleAddress: config.scale.address,
        syncIntervalMs: config.syncIntervalMs,
        autoGeneralSyncEnabled: config.autoGeneralSyncEnabled,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        productSyncIntervalMs: config.productSyncIntervalMs,
        salesResyncSkewMinutes: config.salesResyncSkewMinutes,
        lastRunStatus: state.lastRunStatus,
        lastRunMessage: state.lastRunMessage,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
        scaleReachable: state.scaleReachable !== false,
        logFile: config.logFile,
    };
}

async function runCycle(reason = 'scheduled') {
    if (cycleRunning) return { ok: false, skipped: true };
    cycleRunning = true;
    logger.info('Iniciando ciclo de sincronizacion', { reason });
    try {
        const result = await bridge.runOnce({
            reason,
            skipSales: config.salesPulseEnabled && reason === 'interval',
        });
        logger.info('Ciclo de sincronizacion finalizado', { reason, result });
        return { ok: true, result };
    } catch (error) {
        state.lastRunAt = new Date().toISOString();
        state.lastRunStatus = 'error';
        state.lastRunMessage = error.message;
        state.lastError = error.message;
        stateStore.save(state);
        logger.error('Ciclo de sincronizacion con error', { reason, error: error.message });
        return { ok: false, error: error.message };
    } finally {
        cycleRunning = false;
    }
}

async function runSalesPulse(reason = 'sales-pulse', options = {}) {
    if (pulseRunning) return { ok: false, skipped: true, busy: true };
    pulseRunning = true;
    try {
        const now = options.toDate ? new Date(options.toDate) : new Date();
        const from = options.fromDate ? new Date(options.fromDate) : (() => {
            const initial = new Date(now);
            const skewMs = Math.max(0, Number(config.salesResyncSkewMinutes || 0)) * 60 * 1000;
            if (state.lastTicketSyncAt) {
                const last = new Date(state.lastTicketSyncAt);
                if (!Number.isNaN(last.getTime())) {
                    initial.setTime(last.getTime() - skewMs);
                    return initial;
                }
            }
            initial.setDate(initial.getDate() - config.salesLookbackDays);
            return initial;
        })();

        const result = await bridge.pullSales({
            fromDate: from,
            toDate: now,
            closeAfter: options.closeAfter === true,
        });

        if (result.ok && Number(result.fetched || 0) > 0) {
            state.lastTicketSyncAt = result.latestSaleAt || new Date().toISOString();
            stateStore.save(state);
            if (Number(result.newTickets || 0) > 0) {
                logger.info('Pulso de ventas: tickets nuevos sincronizados', {
                    reason,
                    fetched: result.fetched,
                    tickets: result.tickets,
                    newTickets: result.newTickets,
                });
            }
        }

        return { ok: true, result };
    } catch (error) {
        if (reason !== 'sales-pulse') {
            logger.warn('Error en pull de ventas', { reason, error: error.message });
        }
        return { ok: false, error: error.message };
    } finally {
        pulseRunning = false;
    }
}

async function runProductSync(reason = 'on-demand') {
    if (cycleRunning) return { ok: false, skipped: true, busy: true };
    cycleRunning = true;
    logger.info('Iniciando sincronizacion de productos/configuracion por demanda', { reason });
    try {
        const runtimeSettings = await bridge.syncRuntimeSettings();
        await bridge.syncVendors().catch((error) => {
            logger.warn('No se pudieron sincronizar vendedores en balanza por demanda', { error: error.message });
        });
        const result = await bridge.syncProducts({
            runtimeScaleConfig: runtimeSettings.runtimeScaleConfig,
            priceFormat: runtimeSettings.priceFormat,
            forceProductRewrite: runtimeSettings.forceProductRewrite,
        });
        state.lastProductSyncAt = new Date().toISOString();
        stateStore.save(state);
        logger.info('Sincronizacion de productos/configuracion por demanda finalizada', { reason, result });
        return { ok: true, result };
    } catch (error) {
        state.lastRunAt = new Date().toISOString();
        state.lastRunStatus = 'error';
        state.lastRunMessage = error.message;
        state.lastError = error.message;
        stateStore.save(state);
        logger.error('Sincronizacion de productos/configuracion por demanda con error', { reason, error: error.message });
        return { ok: false, error: error.message };
    } finally {
        cycleRunning = false;
    }
}

async function processHeartbeatCommands(payload) {
    const commands = Array.isArray(payload?.commands) ? payload.commands : [];
    for (const command of commands) {
        if (command?.type !== 'sync_products') continue;
        const seq = Number(command.seq || 0) || 0;
        if (!seq || Number(state.lastProductSyncCommandSeq || 0) >= seq) continue;

        const result = await runProductSync(`heartbeat-command:${seq}`);
        if (result.ok) {
            state.lastProductSyncCommandSeq = seq;
            stateStore.save(state);
        }
    }
}

async function sendHeartbeat() {
    try {
        const payload = await apiClient.postHeartbeat({
            scales: [{
                scaleId: config.scaleId,
                port: config.scale.port,
                address: config.scale.address,
                lastPingOk: state.lastRunStatus === 'ok',
            }],
        });
        await processHeartbeatCommands(payload);
    } catch (error) {
        logger.warn('No se pudo enviar heartbeat', { error: error.message });
    }
}

function startHttpServer() {
    const srv = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
        const pathname = url.pathname;

        if (pathname === '/health') return sendJson(res, 200, runtimeSnapshot());
        if (pathname === '/state') return sendJson(res, 200, state);

        if (pathname === '/api/scale/ports' && req.method === 'GET') {
            try {
                const ports = await CuoraClient.listPorts();
                return sendJson(res, 200, { ok: true, ports });
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        if (pathname === '/api/scale/ping' && req.method === 'POST') {
            try {
                const result = await bridge.ping();
                return sendJson(res, 200, result);
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        if (pathname === '/api/scale/signature' && req.method === 'POST') {
            try {
                const result = await bridge.signature();
                return sendJson(res, 200, result);
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        if ((pathname === '/run' || pathname === '/api/run') && req.method === 'POST') {
            const result = await runCycle('http');
            return sendJson(res, result.ok ? 200 : 500, result);
        }

        if (pathname === '/api/scale/reset' && req.method === 'POST') {
            try {
                const result = await bridge.resetScaleAll({ reason: 'manual' });
                return sendJson(res, 200, result);
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        if (pathname === '/api/scale/sync-products' && req.method === 'POST') {
            try {
                const result = await runProductSync('http-sync-products');
                return sendJson(res, result.ok ? 200 : (result.skipped ? 202 : 500), result);
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        if (pathname === '/api/scale/pull-sales' && req.method === 'POST') {
            try {
                const body = await readBody(req);
                const now = new Date();
                const from = body.fromDate ? new Date(body.fromDate) : new Date(Date.now() - (config.salesLookbackDays * 24 * 60 * 60 * 1000));
                const to = body.toDate ? new Date(body.toDate) : now;
                const closeAfter = body.closeAfter === true;
                const pull = await runSalesPulse('http-pull', {
                    fromDate: from,
                    toDate: to,
                    closeAfter,
                });
                const status = pull.ok ? 200 : (pull.skipped ? 202 : 500);
                return sendJson(res, status, pull);
            } catch (error) {
                return sendJson(res, 500, { ok: false, error: error.message });
            }
        }

        return sendJson(res, 404, { ok: false, error: 'not_found' });
    });

    srv.listen(config.httpPort, '127.0.0.1', () => {
        logger.info(`Bridge directo escuchando en http://127.0.0.1:${config.httpPort}`);
    });
    return srv;
}

async function main() {
    if (config.once) {
        const result = await runCycle('once');
        process.exit(result.ok ? 0 : 1);
        return;
    }

    server = startHttpServer();
    await runCycle('startup');

    schedulerActive = true;
    if (config.autoGeneralSyncEnabled) {
        const scheduleNext = (delayMs = config.syncIntervalMs) => {
            if (!schedulerActive) return;
            const nextDelay = Math.max(2000, Number(delayMs) || 2000);
            timer = setTimeout(async () => {
                timer = null;
                await runCycle('interval');
                scheduleNext(config.syncIntervalMs);
            }, nextDelay);
        };
        scheduleNext(config.syncIntervalMs);
    } else {
        logger.info('Sincronizacion general automatica deshabilitada; ventas quedan en pulso y productos/configuracion por demanda', {
            salesPulseEnabled: config.salesPulseEnabled,
            salesPulseIntervalMs: config.salesPulseIntervalMs,
            syncProductsEndpoint: `http://127.0.0.1:${config.httpPort}/api/scale/sync-products`,
        });
    }

    if (config.salesPulseEnabled) {
        const scheduleSalesPulse = (delayMs = config.salesPulseIntervalMs) => {
            if (!schedulerActive) return;
            const nextDelay = Math.max(1000, Number(delayMs) || 1000);
            salesPulseTimer = setTimeout(async () => {
                salesPulseTimer = null;
                await runSalesPulse('sales-pulse');
                scheduleSalesPulse(config.salesPulseIntervalMs);
            }, nextDelay);
        };
        scheduleSalesPulse(config.salesPulseIntervalMs);
    }

    // Heartbeat liviano al API; tambien trae comandos pendientes para la balanza.
    const heartbeatIntervalMs = Math.max(5000, Number(config.heartbeatIntervalMs || 10000));
    const scheduleHeartbeat = () => {
        if (!schedulerActive) return;
        heartbeatTimer = setTimeout(async () => {
            heartbeatTimer = null;
            await sendHeartbeat();
            scheduleHeartbeat();
        }, heartbeatIntervalMs);
    };
    scheduleHeartbeat();
}

async function shutdown(signal) {
    logger.info(`Cerrando bridge por ${signal}`);
    schedulerActive = false;
    if (timer) clearTimeout(timer);
    if (salesPulseTimer) clearTimeout(salesPulseTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (server) await new Promise((resolve) => server.close(resolve));
    await bridge.scale.close().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (error) => {
    logger.error('No se pudo iniciar el bridge', { error: error.message });
    await bridge.scale.close().catch(() => {});
    process.exit(1);
});
