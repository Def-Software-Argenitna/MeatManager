const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Logger } = require('./logger');
const { loadState, saveState } = require('./state');
const { buildMySqlPool } = require('./mysql');
const { QendraBridge } = require('./bridge');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });

const logger = new Logger({ logFile: config.logFile, level: config.logLevel });
const state = loadState(config.stateFile);
const stateStore = {
    save(nextState) {
        saveState(config.stateFile, nextState);
    },
};
const mysqlPool = buildMySqlPool(config.mysql);
const bridge = new QendraBridge({
    config,
    logger,
    state,
    stateStore,
    mysqlPool,
});

let running = false;
let timer = null;

async function runCycle(reason = 'scheduled') {
    if (running) {
        logger.warn('Ciclo de sincronizacion omitido porque ya existe uno en ejecucion', { reason });
        return { ok: false, skipped: true };
    }

    running = true;
    logger.info('Iniciando ciclo de sincronizacion', { reason });
    try {
        const result = await bridge.runOnce();
        logger.info('Ciclo de sincronizacion finalizado', { reason, result });
        return { ok: true, result };
    } catch (error) {
        logger.error('Ciclo de sincronizacion con error', { reason, error: error.message });
        return { ok: false, error: error.message };
    } finally {
        running = false;
    }
}

function startHttpServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                running,
                deviceId: config.deviceId,
                lastRunStatus: state.lastRunStatus,
                lastRunAt: state.lastRunAt,
                lastError: state.lastError,
            }));
            return;
        }

        if (url.pathname === '/state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(state));
            return;
        }

        if (url.pathname === '/run' && req.method === 'POST') {
            const result = await runCycle('http');
            res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    });

    server.listen(config.httpPort, '127.0.0.1', () => {
        logger.info(`Health server escuchando en http://127.0.0.1:${config.httpPort}`);
    });

    return server;
}

async function main() {
    startHttpServer();

    if (config.once) {
        const result = await runCycle('once');
        await mysqlPool.end().catch(() => {});
        process.exit(result.ok ? 0 : 1);
        return;
    }

    await runCycle('startup');
    timer = setInterval(() => {
        runCycle('interval');
    }, config.syncIntervalMs);
}

async function shutdown(signal) {
    logger.info(`Cerrando bridge por ${signal}`);
    if (timer) clearInterval(timer);
    await mysqlPool.end().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async (error) => {
    logger.error('No se pudo iniciar el bridge', { error: error.message });
    await mysqlPool.end().catch(() => {});
    process.exit(1);
});
