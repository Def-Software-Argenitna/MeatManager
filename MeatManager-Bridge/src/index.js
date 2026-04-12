const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Logger } = require('./logger');
const { loadState, saveState } = require('./state');
const { buildMySqlPool } = require('./mysql');
const { QendraBridge } = require('./bridge');
const { attach } = require('./firebird');
const {
    loadOverrides,
    saveOverrides,
    pickEditable,
    buildEditableConfigView,
} = require('./config-store');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });
const publicDir = path.join(config.rootDir, 'public');

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
let server = null;

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
            } catch (error) {
                reject(new Error('invalid_json'));
            }
        });
        req.on('error', reject);
    });
}

function getRuntimeSnapshot() {
    return {
        ok: true,
        running,
        deviceId: config.deviceId,
        bridgeName: config.bridgeName,
        siteName: config.siteName,
        tenantId: config.tenantId,
        branchId: config.branchId,
        syncIntervalMs: config.syncIntervalMs,
        lastRunStatus: state.lastRunStatus,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
        logFile: config.logFile,
        stateFile: config.stateFile,
        overridesFile: config.overridesFile,
    };
}

function tailLogLines(filePath, limit = 100) {
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit);
}

function serveStaticFile(res, filePath) {
    if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = ({
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    })[ext] || 'text/plain; charset=utf-8';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
}

async function testMySqlConnection() {
    const pool = buildMySqlPool(config.mysql);
    try {
        const [rows] = await pool.query('SELECT NOW() AS now_ts, DATABASE() AS db_name');
        return {
            ok: true,
            now: rows?.[0]?.now_ts || null,
            database: rows?.[0]?.db_name || config.mysql.database,
        };
    } finally {
        await pool.end().catch(() => {});
    }
}

async function testFirebirdConnection() {
    const connection = await attach(config.firebird);
    try {
        const rows = await new Promise((resolve, reject) => {
            connection.db.query('SELECT CURRENT_TIMESTAMP AS NOW_TS FROM RDB$DATABASE', (error, result) => {
                if (error) return reject(error);
                resolve(result || []);
            });
        });
        return {
            ok: true,
            mode: connection.mode,
            now: rows?.[0]?.NOW_TS || rows?.[0]?.now_ts || null,
            database: config.firebird.dbFile,
        };
    } finally {
        try {
            connection.db.detach();
        } catch {
            // noop
        }
    }
}

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
        const pathname = url.pathname;

        if (pathname === '/' || pathname === '/index.html') {
            serveStaticFile(res, path.join(publicDir, 'index.html'));
            return;
        }

        if (pathname.startsWith('/assets/')) {
            const localPath = path.join(publicDir, pathname.replace(/^\//, ''));
            serveStaticFile(res, localPath);
            return;
        }

        if (pathname === '/health') {
            sendJson(res, 200, getRuntimeSnapshot());
            return;
        }

        if (pathname === '/state') {
            sendJson(res, 200, state);
            return;
        }

        if (pathname === '/api/config' && req.method === 'GET') {
            sendJson(res, 200, {
                ok: true,
                values: buildEditableConfigView(config),
                source: loadOverrides(config.overridesFile),
                requiresRestartNote: 'Los cambios se guardan en config-overrides.json y aplican al reiniciar el bridge.',
            });
            return;
        }

        if (pathname === '/api/config' && req.method === 'POST') {
            try {
                const body = await readBody(req);
                const nextOverrides = pickEditable(body || {});
                saveOverrides(config.overridesFile, nextOverrides);
                logger.info('Configuracion guardada desde la UI', { keys: Object.keys(nextOverrides) });
                sendJson(res, 200, {
                    ok: true,
                    saved: nextOverrides,
                    restartRequired: true,
                    message: 'Configuracion guardada. Reinicia el bridge para aplicarla.',
                });
            } catch (error) {
                sendJson(res, 400, { ok: false, error: error.message });
            }
            return;
        }

        if (pathname === '/api/logs' && req.method === 'GET') {
            sendJson(res, 200, {
                ok: true,
                lines: tailLogLines(config.logFile, 120),
            });
            return;
        }

        if (pathname === '/api/test/mysql' && req.method === 'POST') {
            try {
                const result = await testMySqlConnection();
                sendJson(res, 200, result);
            } catch (error) {
                sendJson(res, 500, { ok: false, error: error.message });
            }
            return;
        }

        if (pathname === '/api/test/firebird' && req.method === 'POST') {
            try {
                const result = await testFirebirdConnection();
                sendJson(res, 200, result);
            } catch (error) {
                sendJson(res, 500, { ok: false, error: error.message });
            }
            return;
        }

        if ((pathname === '/run' || pathname === '/api/run') && req.method === 'POST') {
            const result = await runCycle('http');
            sendJson(res, result.ok ? 200 : 500, result);
            return;
        }

        sendJson(res, 404, { ok: false, error: 'not_found' });
    });

    server.listen(config.httpPort, '127.0.0.1', () => {
        logger.info(`Panel local escuchando en http://127.0.0.1:${config.httpPort}`);
    });

    return server;
}

async function main() {
    server = startHttpServer();

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
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
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
