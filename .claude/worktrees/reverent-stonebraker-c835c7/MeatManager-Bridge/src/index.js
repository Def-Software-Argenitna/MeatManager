const http = require('http');
const fs = require('fs');
const config = require('./config');
const { Logger } = require('./logger');
const { loadState, resetState, saveState } = require('./state');
const { buildMySqlPool } = require('./mysql');
const { ScaleBridge } = require('./scale-bridge');
const { CuoraClient } = require('./cuora-client');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });

const logger = new Logger({ logFile: config.logFile, level: config.logLevel, truncateOnStart: true });
const state = config.resetStateOnStart ? resetState(config.stateFile) : loadState(config.stateFile);
const stateStore = { save: (nextState) => saveState(config.stateFile, nextState) };
const mysqlPool = buildMySqlPool(config.mysql);
const bridge = new ScaleBridge({ config, logger, state, stateStore, mysqlPool });

let running = false;
let timer = null;
let salesPulseTimer = null;
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
        running,
        mode: 'direct-usb',
        deviceId: config.deviceId,
        bridgeName: config.bridgeName,
        tenantId: config.tenantId,
        branchId: config.branchId,
        scalePort: config.scale.port,
        scaleAddress: config.scale.address,
        syncIntervalMs: config.syncIntervalMs,
        productSyncIntervalMs: config.productSyncIntervalMs,
        salesResyncSkewMinutes: config.salesResyncSkewMinutes,
        lastRunStatus: state.lastRunStatus,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
        logFile: config.logFile,
    };
}

async function runCycle(reason = 'scheduled') {
    if (running) return { ok: false, skipped: true };
    running = true;
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
        running = false;
    }
}

async function runSalesPulse(reason = 'sales-pulse', options = {}) {
    if (running) return { ok: false, skipped: true, busy: true };
    running = true;
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
            logger.info('Pulso de ventas: registros detectados y sincronizados', {
                reason,
                fetched: result.fetched,
                tickets: result.tickets,
            });
        }

        return { ok: true, result };
    } catch (error) {
        if (reason !== 'sales-pulse') {
            logger.warn('Error en pull de ventas', { reason, error: error.message });
        }
        return { ok: false, error: error.message };
    } finally {
        running = false;
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

        if (pathname === '/api/scale/sync-products' && req.method === 'POST') {
            try {
                const result = await bridge.syncProducts();
                return sendJson(res, 200, { ok: true, result });
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
        await mysqlPool.end().catch(() => {});
        process.exit(result.ok ? 0 : 1);
        return;
    }

    server = startHttpServer();
    await runCycle('startup');

    schedulerActive = true;
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
}

async function shutdown(signal) {
    logger.info(`Cerrando bridge por ${signal}`);
    schedulerActive = false;
    if (timer) clearTimeout(timer);
    if (salesPulseTimer) clearTimeout(salesPulseTimer);
    if (server) await new Promise((resolve) => server.close(resolve));
    await bridge.scale.close().catch(() => {});
    await mysqlPool.end().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (error) => {
    logger.error('No se pudo iniciar el bridge', { error: error.message });
    await bridge.scale.close().catch(() => {});
    await mysqlPool.end().catch(() => {});
    process.exit(1);
});
