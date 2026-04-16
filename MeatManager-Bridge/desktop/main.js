const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { fork } = require('child_process');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const { SerialPort } = require('serialport');

const APP_NAME = 'MeatManager Bridge';
const BRIDGE_PORT_BASE = Number.parseInt(process.env.BRIDGE_HTTP_PORT || '4045', 10);
const STATUS_POLL_MS = 4000;
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SCALE_MODEL = 'Systel Cuora Max';
const SUPPORTED_SCALE_MODELS = [DEFAULT_SCALE_MODEL];

const DEFAULT_API_BASE_URL = String(process.env.BRIDGE_API_BASE_URL || '').trim();
const DEFAULT_DB_CONFIG = {
    host: String(process.env.BRIDGE_MYSQL_HOST || '34.136.100.63').trim(),
    port: String(process.env.BRIDGE_MYSQL_PORT || '3306').trim(),
    database: String(process.env.BRIDGE_MYSQL_DATABASE || 'meatmanager').trim(),
    user: String(process.env.BRIDGE_MYSQL_USER || 'root').trim(),
    password: String(process.env.BRIDGE_MYSQL_PASSWORD || 'pos38ric0S'),
    ssl: String(process.env.BRIDGE_MYSQL_SSL || 'false').trim(),
};

const DEFAULT_BRIDGE_OVERRIDES = {
    SCALE_BAUD_RATE: '115200',
    SCALE_ADDRESS: '20',
    SYNC_INTERVAL_MS: '1000',
    PRODUCT_SYNC_INTERVAL_MS: '5000',
    SCALE_BARCODE_CONFIG_ENABLED: 'true',
    SCALE_BARCODE_WEIGHT_FORMAT: '20PPPPIIIIII',
    SCALE_BARCODE_UNIT_FORMAT: '21PPPPIIIIII',
    SCALE_BARCODE_TOTAL_FORMAT: '2220AAIIIIII',
};

let mainWindow = null;
let tray = null;
let statusTimer = null;
let updateTimer = null;
let isQuitting = false;
let updateAvailable = false;
let autoUpdater = null;

let installation = null;
let bridgeChildren = new Map();

let lastStatus = {
    bridgeProcess: { running: false, pid: null, restarts: 0, total: 0, runningCount: 0 },
    bridgeHttp: { reachable: false, running: false, lastRunStatus: null, lastError: null, lastRunAt: null },
    devices: [],
    updatedAt: new Date().toISOString(),
};

function runtimeDir() {
    return path.join(app.getPath('userData'), 'runtime');
}

function runtimeDataDir() {
    return path.join(runtimeDir(), 'data');
}

function installationFilePath() {
    return path.join(runtimeDataDir(), 'installation.json');
}

function devicesOverridesDir() {
    return path.join(runtimeDataDir(), 'devices');
}

function parseJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const normalized = raw.replace(/^\uFEFF/, '').trim();
        if (!normalized) return fallback;
        return JSON.parse(normalized);
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getLegacyOverrides() {
    return parseJsonFile(path.join(runtimeDataDir(), 'config-overrides.json'), {}) || {};
}

function isInstallationValid(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    if (Number.parseInt(candidate.onboardingVersion || '0', 10) < 1) return false;
    if (String(candidate.auth?.mode || '').trim() !== 'internal-admin') return false;
    if (!String(candidate.auth?.adminEmail || '').trim()) return false;
    if (!candidate.client || !Number.isFinite(Number(candidate.client.id))) return false;
    if (!candidate.branch || !Number.isFinite(Number(candidate.branch.id))) return false;
    if (!Array.isArray(candidate.devices) || candidate.devices.length === 0) return false;
    return candidate.devices.every((device) => String(device.port || '').trim());
}

function sanitizeInstallation(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const devices = Array.isArray(candidate.devices) ? candidate.devices : [];
    const cleanedDevices = devices
        .map((device, index) => ({
            id: String(device.id || `scale-${index + 1}`).trim() || `scale-${index + 1}`,
            name: String(device.name || `Balanza ${index + 1}`).trim() || `Balanza ${index + 1}`,
            model: SUPPORTED_SCALE_MODELS.includes(String(device.model || '').trim())
                ? String(device.model).trim()
                : DEFAULT_SCALE_MODEL,
            port: String(device.port || '').trim(),
            address: String(device.address || DEFAULT_BRIDGE_OVERRIDES.SCALE_ADDRESS).trim() || DEFAULT_BRIDGE_OVERRIDES.SCALE_ADDRESS,
            baudRate: String(device.baudRate || DEFAULT_BRIDGE_OVERRIDES.SCALE_BAUD_RATE).trim() || DEFAULT_BRIDGE_OVERRIDES.SCALE_BAUD_RATE,
            enabled: device.enabled !== false,
        }))
        .filter((device) => device.port);

    return {
        onboardingVersion: Number.parseInt(candidate.onboardingVersion || '0', 10) || 0,
        auth: {
            mode: String(candidate.auth?.mode || '').trim(),
            adminEmail: String(candidate.auth?.adminEmail || '').trim(),
            adminName: String(candidate.auth?.adminName || '').trim(),
            verifiedAt: String(candidate.auth?.verifiedAt || '').trim(),
        },
        apiBaseUrl: String(candidate.apiBaseUrl || DEFAULT_API_BASE_URL || '').trim(),
        client: {
            id: Number(candidate.client?.id || 0),
            name: String(candidate.client?.name || '').trim(),
        },
        branch: {
            id: Number(candidate.branch?.id || 0),
            name: String(candidate.branch?.name || '').trim(),
        },
        devices: cleanedDevices,
        configuredAt: candidate.configuredAt || new Date().toISOString(),
    };
}

function loadInstallation() {
    const parsed = sanitizeInstallation(parseJsonFile(installationFilePath(), null));
    if (isInstallationValid(parsed)) return parsed;

    return null;
}

function buildDeviceOverrides(deviceConfig) {
    const legacy = getLegacyOverrides();
    const db = {
        host: String(legacy.MYSQL_HOST || DEFAULT_DB_CONFIG.host),
        port: String(legacy.MYSQL_PORT || DEFAULT_DB_CONFIG.port),
        database: String(legacy.MYSQL_DATABASE || DEFAULT_DB_CONFIG.database),
        user: String(legacy.MYSQL_USER || DEFAULT_DB_CONFIG.user),
        password: String(legacy.MYSQL_PASSWORD ?? DEFAULT_DB_CONFIG.password),
        ssl: String(legacy.MYSQL_SSL || DEFAULT_DB_CONFIG.ssl),
    };
    return {
        ...DEFAULT_BRIDGE_OVERRIDES,
        BRIDGE_CLIENT_ID: String(installation.client.id),
        BRIDGE_BRANCH_ID: String(installation.branch.id),
        BRIDGE_NAME: `${APP_NAME} - ${deviceConfig.name}`,
        BRIDGE_DEVICE_ID: `CUORA-${installation.client.id}-${installation.branch.id}-${deviceConfig.id}`,
        SCALE_PORT: deviceConfig.port,
        SCALE_ADDRESS: String(deviceConfig.address || DEFAULT_BRIDGE_OVERRIDES.SCALE_ADDRESS),
        SCALE_BAUD_RATE: String(deviceConfig.baudRate || DEFAULT_BRIDGE_OVERRIDES.SCALE_BAUD_RATE),
        MYSQL_HOST: db.host,
        MYSQL_PORT: db.port,
        MYSQL_DATABASE: db.database,
        MYSQL_USER: db.user,
        MYSQL_PASSWORD: db.password,
        MYSQL_SSL: db.ssl,
    };
}

function writeDeviceOverridesFiles() {
    fs.mkdirSync(devicesOverridesDir(), { recursive: true });
    const files = [];
    installation.devices.forEach((device) => {
        const filePath = path.join(devicesOverridesDir(), `${device.id}.json`);
        writeJsonFile(filePath, buildDeviceOverrides(device));
        files.push(filePath);
    });
    return files;
}

function resolveGithubPublishTarget() {
    const envOwner = String(process.env.BRIDGE_UPDATE_OWNER || '').trim();
    const envRepo = String(process.env.BRIDGE_UPDATE_REPO || '').trim();
    if (envOwner && envRepo) return { owner: envOwner, repo: envRepo };

    try {
        const pkg = require(path.join(app.getAppPath(), 'package.json'));
        const repoUrl = String(pkg?.repository?.url || pkg?.repository || '').trim();
        const match = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }
    } catch {
        // ignore
    }
    return { owner: '', repo: '' };
}

function getIconPath(fileName) {
    const appBase = path.join(app.getAppPath(), 'public', 'branding');
    const devBase = path.join(__dirname, '..', 'public', 'branding');
    const first = app.isPackaged ? path.join(appBase, fileName) : path.join(devBase, fileName);
    if (fs.existsSync(first)) return first;
    return path.join(devBase, fileName);
}

function buildTrayIcon() {
    const fileName = updateAvailable ? 'def-software-tray-update.png' : 'def-software-tray.png';
    const pngPath = getIconPath(fileName);
    let icon = nativeImage.createFromPath(pngPath);
    if (icon.isEmpty()) {
        icon = nativeImage.createFromPath(getIconPath('def-software-512.png'));
    }
    if (!icon.isEmpty()) {
        icon = icon.resize({ width: 18, height: 18, quality: 'best' });
    }
    return icon;
}

function sendStatusToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('bridge-status', {
        ...lastStatus,
        onboardingRequired: !isInstallationValid(installation),
    });
}

function formatUpdateError(error) {
    const raw = String(error?.message || error || '').trim();
    if (!raw) return 'No se pudo verificar actualizaciones.';
    if (raw.includes('Unable to find latest version on GitHub')) {
        return 'No se encontro una release valida para auto-update. Usa tags semver (ej: v0.2.1) y release publicada.';
    }
    if (raw.includes('Cannot parse releases feed')) {
        return 'No se pudo leer el feed de releases de GitHub.';
    }
    const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean) || raw;
    return firstLine.length > 220 ? `${firstLine.slice(0, 220)}...` : firstLine;
}

function httpJsonRequest(urlOrOptions, { method = 'GET', headers = {}, body = null, timeout = 5000 } = {}) {
    return new Promise((resolve, reject) => {
        const requestOptions = typeof urlOrOptions === 'string'
            ? (() => {
                const u = new URL(urlOrOptions);
                return {
                    protocol: u.protocol,
                    hostname: u.hostname,
                    port: u.port,
                    path: `${u.pathname}${u.search}`,
                };
            })()
            : urlOrOptions;

        const transport = String(requestOptions?.protocol || '').startsWith('https') ? https : http;

        const req = transport.request(
            {
                ...requestOptions,
                method,
                timeout,
                headers,
            },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    const status = Number(res.statusCode || 0);
                    const parsed = (() => {
                        try {
                            return data ? JSON.parse(data) : {};
                        } catch {
                            return {};
                        }
                    })();
                    if (status < 200 || status >= 300) {
                        const err = new Error(parsed?.error || `HTTP ${status}`);
                        err.statusCode = status;
                        reject(err);
                        return;
                    }
                    resolve(parsed);
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

async function fetchBridgeStatus() {
    if (!isInstallationValid(installation) || bridgeChildren.size === 0) {
        lastStatus = {
            ...lastStatus,
            bridgeProcess: {
                ...lastStatus.bridgeProcess,
                running: false,
                pid: null,
                total: 0,
                runningCount: 0,
            },
            bridgeHttp: {
                reachable: false,
                running: false,
                lastRunStatus: null,
                lastError: 'Configuracion inicial pendiente',
                lastRunAt: null,
            },
            devices: [],
            updatedAt: new Date().toISOString(),
        };
        sendStatusToRenderer();
        return;
    }

    const checks = await Promise.all(
        [...bridgeChildren.values()].map(async (entry) => {
            const processAlive = entry.proc && entry.proc.exitCode == null && !entry.proc.killed;
            const base = {
                id: entry.device.id,
                name: entry.device.name,
                port: entry.device.port,
                model: entry.device.model,
                httpPort: entry.httpPort,
                pid: processAlive ? entry.proc.pid : null,
                processAlive,
                reachable: false,
                lastRunStatus: null,
                lastError: null,
                lastRunAt: null,
            };
            if (!processAlive) return base;
            try {
                const payload = await httpJsonRequest({
                    hostname: '127.0.0.1',
                    port: entry.httpPort,
                    path: '/health',
                }, { timeout: 2500 });
                return {
                    ...base,
                    reachable: true,
                    lastRunStatus: payload.lastRunStatus || null,
                    lastError: payload.lastError || null,
                    lastRunAt: payload.lastRunAt || null,
                };
            } catch (error) {
                return {
                    ...base,
                    reachable: false,
                    lastError: error.message || 'Bridge HTTP no disponible',
                };
            }
        })
    );

    const runningCount = checks.filter((row) => row.processAlive).length;
    const reachableCount = checks.filter((row) => row.reachable).length;
    const firstPid = checks.find((row) => row.processAlive)?.pid || null;
    const latestRunAt = checks.map((row) => row.lastRunAt).filter(Boolean).sort().at(-1) || null;
    const firstError = checks.find((row) => row.lastError)?.lastError || null;

    lastStatus = {
        ...lastStatus,
        bridgeProcess: {
            ...lastStatus.bridgeProcess,
            running: runningCount > 0,
            pid: firstPid,
            total: checks.length,
            runningCount,
        },
        bridgeHttp: {
            reachable: reachableCount > 0,
            running: reachableCount === checks.length && checks.length > 0,
            lastRunStatus: reachableCount === checks.length ? 'ok' : (reachableCount > 0 ? 'partial' : null),
            lastError: firstError || (reachableCount > 0 ? null : 'Bridge HTTP no disponible'),
            lastRunAt: latestRunAt,
        },
        devices: checks,
        updatedAt: new Date().toISOString(),
    };

    sendStatusToRenderer();
}

function updateTrayMenu() {
    if (!tray) return;
    tray.setImage(buildTrayIcon());
    tray.setToolTip(
        updateAvailable
            ? `${APP_NAME} - Hay una actualizacion disponible`
            : APP_NAME
    );
    const menu = Menu.buildFromTemplate([
        { label: 'Abrir estado', click: () => showMainWindow() },
        { type: 'separator' },
        { label: 'Reiniciar bridge', click: () => restartBridgeProcesses() },
        { label: 'Buscar actualizaciones', click: () => checkForUpdatesNow(true) },
        { type: 'separator' },
        { label: 'Salir', click: () => quitApp() },
    ]);
    tray.setContextMenu(menu);
}

function bridgeScriptPath() {
    if (app.isPackaged) {
        const asarPath = path.join(app.getAppPath(), 'src', 'index.js');
        if (fs.existsSync(asarPath)) return asarPath;
        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'index.js');
        if (fs.existsSync(unpackedPath)) return unpackedPath;
    }
    return path.join(app.getAppPath(), 'src', 'index.js');
}

function stopBridgeProcesses() {
    for (const entry of bridgeChildren.values()) {
        try {
            entry.proc.kill('SIGTERM');
        } catch {
            // ignore
        }
    }
    bridgeChildren = new Map();
}

function startSingleBridge(device, index) {
    const scriptPath = bridgeScriptPath();
    if (!fs.existsSync(scriptPath)) return;

    const httpPort = BRIDGE_PORT_BASE + index;
    const overridesFile = path.join(devicesOverridesDir(), `${device.id}.json`);
    const proc = fork(scriptPath, [], {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            BRIDGE_APP_DATA_DIR: runtimeDir(),
            BRIDGE_OVERRIDES_FILE: overridesFile,
            HTTP_PORT: String(httpPort),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    bridgeChildren.set(device.id, { proc, httpPort, device });

    proc.on('exit', () => {
        bridgeChildren.delete(device.id);
        if (!isQuitting && isInstallationValid(installation)) {
            setTimeout(() => {
                const current = installation.devices.find((d) => d.id === device.id && d.enabled !== false);
                if (!current) return;
                const idx = installation.devices.filter((d) => d.enabled !== false).findIndex((d) => d.id === device.id);
                if (idx < 0) return;
                lastStatus.bridgeProcess.restarts = Number(lastStatus.bridgeProcess.restarts || 0) + 1;
                startSingleBridge(current, idx);
            }, 2000);
        }
    });
}

function startBridgeProcesses() {
    stopBridgeProcesses();
    if (!isInstallationValid(installation)) {
        fetchBridgeStatus();
        return;
    }

    writeDeviceOverridesFiles();
    const enabledDevices = installation.devices.filter((device) => device.enabled !== false);
    enabledDevices.forEach((device, index) => startSingleBridge(device, index));
    fetchBridgeStatus();
}

function restartBridgeProcesses() {
    startBridgeProcesses();
}

function showMainWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function hideMainWindow() {
    if (!mainWindow) return;
    mainWindow.hide();
}

function quitApp() {
    isQuitting = true;
    app.quit();
}

function createMainWindow() {
    const windowIcon = getIconPath('app.ico');
    mainWindow = new BrowserWindow({
        width: 940,
        height: 680,
        minWidth: 820,
        minHeight: 560,
        show: !process.argv.includes('--hidden'),
        title: APP_NAME,
        icon: windowIcon,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            hideMainWindow();
        }
    });
}

function createTray() {
    tray = new Tray(buildTrayIcon());
    tray.on('double-click', showMainWindow);
    updateTrayMenu();
}

function configureAutoLaunch() {
    app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden'],
    });
}

function configureAutoUpdate() {
    try {
        ({ autoUpdater } = require('electron-updater'));
    } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'error',
                message: `Auto-update no disponible: ${formatUpdateError(error)}`,
            });
        }
        return;
    }

    const { owner, repo } = resolveGithubPublishTarget();
    if (!owner || !repo) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ provider: 'github', owner, repo, private: false });

    autoUpdater.on('update-available', () => {
        updateAvailable = true;
        updateTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'available',
                message: 'Hay una actualizacion disponible. Se descargara automaticamente.',
            });
        }
    });

    autoUpdater.on('update-downloaded', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'downloaded',
                message: 'Actualizacion lista. Reinicia desde la UI para aplicarla.',
            });
        }
    });
}

function checkForUpdatesNow(manual = false) {
    if (!autoUpdater) {
        if (manual && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'error',
                message: 'Auto-update no inicializado.',
            });
        }
        return;
    }

    const { owner, repo } = resolveGithubPublishTarget();
    if (!owner || !repo) {
        if (manual && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'error',
                message: 'Auto-update no configurado (faltan BRIDGE_UPDATE_OWNER/BRIDGE_UPDATE_REPO).',
            });
        }
        return;
    }
    autoUpdater.checkForUpdates().catch((error) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'error',
                message: `No se pudo buscar actualizacion: ${formatUpdateError(error)}`,
            });
        }
    });
}

async function listAvailableSerialPorts() {
    try {
        const ports = await SerialPort.list();
        return ports
            .map((port) => ({
                path: String(port.path || port.comName || '').trim(),
                manufacturer: port.manufacturer || null,
                serialNumber: port.serialNumber || null,
            }))
            .filter((port) => port.path)
            .sort((a, b) => a.path.localeCompare(b.path));
    } catch (error) {
        return [];
    }
}

async function onboardingLogin({ apiBaseUrl, identifier, password }) {
    const base = String(apiBaseUrl || '').trim().replace(/\/$/, '');
    if (!base) throw new Error('Ingresa la URL de API');
    if (!identifier || !password) throw new Error('Completa email/usuario y contrasena');

    return httpJsonRequest(`${base}/api/internal-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { identifier, password },
        timeout: 10000,
    });
}

async function onboardingFetchClients({ apiBaseUrl, token, search = '' }) {
    const base = String(apiBaseUrl || '').trim().replace(/\/$/, '');
    if (!base || !token) throw new Error('Sesion admin invalida');
    const query = search ? `?search=${encodeURIComponent(String(search).trim())}` : '';
    return httpJsonRequest(`${base}/api/internal-admin/clients${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
    });
}

async function onboardingFetchBranches({ apiBaseUrl, token, clientId }) {
    const base = String(apiBaseUrl || '').trim().replace(/\/$/, '');
    const numericClientId = Number.parseInt(clientId, 10);
    if (!base || !token || !Number.isFinite(numericClientId) || numericClientId <= 0) {
        throw new Error('Datos invalidos para sucursales');
    }
    return httpJsonRequest(`${base}/api/internal-admin/clients/${numericClientId}/branches`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
    });
}

function saveInstallation(payload) {
    const next = sanitizeInstallation({
        ...payload,
        onboardingVersion: 1,
        auth: {
            mode: 'internal-admin',
            adminEmail: String(payload?.auth?.adminEmail || '').trim(),
            adminName: String(payload?.auth?.adminName || '').trim(),
            verifiedAt: new Date().toISOString(),
        },
    });
    if (!isInstallationValid(next)) {
        throw new Error('Configuracion incompleta');
    }
    installation = next;
    writeJsonFile(installationFilePath(), installation);
    startBridgeProcesses();
    return installation;
}

function startStatusPolling() {
    fetchBridgeStatus();
    statusTimer = setInterval(fetchBridgeStatus, STATUS_POLL_MS);
}

function startUpdatePolling() {
    checkForUpdatesNow(false);
    updateTimer = setInterval(() => checkForUpdatesNow(false), UPDATE_POLL_MS);
}

function setupIpc() {
    ipcMain.handle('status:get', async () => ({ ...lastStatus, onboardingRequired: !isInstallationValid(installation) }));
    ipcMain.handle('status:restart-bridge', async () => {
        restartBridgeProcesses();
        return { ok: true };
    });

    ipcMain.handle('update:check', async () => {
        checkForUpdatesNow(true);
        return { ok: true };
    });
    ipcMain.handle('update:install-now', async () => {
        autoUpdater.quitAndInstall();
        return { ok: true };
    });
    ipcMain.handle('app:open-log-dir', async () => {
        const target = path.join(runtimeDir(), 'logs');
        await shell.openPath(target);
        return { ok: true };
    });

    ipcMain.handle('onboarding:get', async () => ({
        ok: true,
        required: !isInstallationValid(installation),
        installation,
        supportedModels: SUPPORTED_SCALE_MODELS,
        defaultApiBaseUrl: DEFAULT_API_BASE_URL,
    }));

    ipcMain.handle('onboarding:ports', async () => ({ ok: true, ports: await listAvailableSerialPorts() }));

    ipcMain.handle('onboarding:login', async (_, payload = {}) => {
        try {
            const result = await onboardingLogin(payload);
            return { ok: true, ...result };
        } catch (error) {
            return { ok: false, error: error.message || 'No se pudo iniciar sesion' };
        }
    });

    ipcMain.handle('onboarding:clients', async (_, payload = {}) => {
        try {
            const result = await onboardingFetchClients(payload);
            return { ok: true, ...result };
        } catch (error) {
            return { ok: false, error: error.message || 'No se pudieron leer clientes' };
        }
    });

    ipcMain.handle('onboarding:branches', async (_, payload = {}) => {
        try {
            const result = await onboardingFetchBranches(payload);
            return { ok: true, ...result };
        } catch (error) {
            return { ok: false, error: error.message || 'No se pudieron leer sucursales' };
        }
    });

    ipcMain.handle('onboarding:save', async (_, payload = {}) => {
        try {
            const saved = saveInstallation(payload);
            return { ok: true, installation: saved };
        } catch (error) {
            return { ok: false, error: error.message || 'No se pudo guardar configuracion' };
        }
    });
}

async function bootstrap() {
    app.setName(APP_NAME);
    app.setAppUserModelId('com.defsoftware.meatmanager.bridge');
    const hasLock = app.requestSingleInstanceLock();
    if (!hasLock) {
        app.quit();
        return;
    }

    app.on('second-instance', () => showMainWindow());

    await app.whenReady();
    installation = loadInstallation();

    configureAutoLaunch();
    configureAutoUpdate();
    createMainWindow();
    createTray();
    setupIpc();
    startBridgeProcesses();
    startStatusPolling();
    startUpdatePolling();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        else showMainWindow();
    });
}

app.on('before-quit', () => {
    isQuitting = true;
    if (statusTimer) clearInterval(statusTimer);
    if (updateTimer) clearInterval(updateTimer);
    stopBridgeProcesses();
});

bootstrap().catch((error) => {
    console.error('[desktop bootstrap error]', error);
    app.exit(1);
});


