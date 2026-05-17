const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'MeatManager Bridge';
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_HTTP_PORT || '4045', 10);
const STATUS_POLL_MS = 4000;
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_API_BASE_URL = process.env.BRIDGE_API_BASE_URL || 'https://meatmanager.demo.def-software.com/api';

let mainWindow = null;
let tray = null;
let bridgeProc = null;
let statusTimer = null;
let updateTimer = null;
let isQuitting = false;
let updateAvailable = false;
let onboardingActive = false;
let lastStatus = {
    bridgeProcess: { running: false, pid: null, restarts: 0 },
    bridgeHttp: { reachable: false, running: false, lastRunStatus: null, lastError: null, lastRunAt: null },
    updatedAt: new Date().toISOString(),
};

function runtimeDir() {
    return path.join(app.getPath('userData'), 'runtime');
}

function installationFilePath() {
    return path.join(runtimeDir(), 'data', 'installation.json');
}

function readInstallation() {
    const file = installationFilePath();
    if (!fs.existsSync(file)) return null;
    try {
        let raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        const parsed = JSON.parse(raw);
        if (!parsed?.apiBaseUrl || !parsed?.deviceToken) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeInstallation(payload) {
    const file = installationFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function configOverridesPath() {
    return path.join(runtimeDir(), 'data', 'config-overrides.json');
}

function readConfigOverrides() {
    const file = configOverridesPath();
    if (!fs.existsSync(file)) return {};
    try {
        let raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
}

function writeConfigOverrides(patch) {
    const file = configOverridesPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = readConfigOverrides();
    const next = { ...current, ...patch };
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

async function listSerialPorts() {
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { SerialPort } = require('serialport');
        const ports = await SerialPort.list();
        return ports.map((port) => ({
            path: port.path,
            manufacturer: port.manufacturer || null,
            friendlyName: port.friendlyName || null,
        }));
    } catch {
        return [];
    }
}

function getAppVersion() {
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const pkg = require(path.join(app.getAppPath(), 'package.json'));
        return String(pkg?.version || '');
    } catch {
        return '';
    }
}

function resolveGithubPublishTarget() {
    const envOwner = String(process.env.BRIDGE_UPDATE_OWNER || '').trim();
    const envRepo = String(process.env.BRIDGE_UPDATE_REPO || '').trim();
    if (envOwner && envRepo) return { owner: envOwner, repo: envRepo };

    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
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
    const devBase = path.join(__dirname, '..', 'public', 'branding');
    const prodBase = path.join(process.resourcesPath, 'public', 'branding');
    const candidate = app.isPackaged ? path.join(prodBase, fileName) : path.join(devBase, fileName);
    return candidate;
}

function buildTrayIcon() {
    const fileName = updateAvailable ? 'def-software-tray-update.png' : 'def-software-tray.png';
    const pngPath = getIconPath(fileName);
    let icon = nativeImage.createFromPath(pngPath);
    if (!icon.isEmpty()) {
        icon = icon.resize({ width: 18, height: 18, quality: 'best' });
    }
    return icon;
}

function sendStatusToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('bridge-status', lastStatus);
}

async function fetchBridgeStatus() {
    if (onboardingActive) return;
    try {
        const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        lastStatus = {
            ...lastStatus,
            bridgeHttp: {
                reachable: true,
                running: payload.running === true,
                lastRunStatus: payload.lastRunStatus || null,
                lastRunMessage: payload.lastRunMessage || null,
                lastError: payload.lastError || null,
                lastRunAt: payload.lastRunAt || null,
                scaleReachable: payload.scaleReachable !== false,
            },
            updatedAt: new Date().toISOString(),
        };
    } catch {
        lastStatus = {
            ...lastStatus,
            bridgeHttp: {
                reachable: false,
                running: false,
                lastRunStatus: null,
                lastRunMessage: null,
                lastError: 'Bridge HTTP no disponible',
                lastRunAt: null,
                scaleReachable: true,
            },
            updatedAt: new Date().toISOString(),
        };
    }
    sendStatusToRenderer();
}

function updateTrayMenu() {
    if (!tray) return;
    tray.setImage(buildTrayIcon());
    tray.setToolTip(
        updateAvailable
            ? `${APP_NAME} - Hay una actualización disponible`
            : APP_NAME
    );
    const menu = Menu.buildFromTemplate([
        { label: 'Abrir estado', click: () => showMainWindow() },
        { type: 'separator' },
        { label: 'Reiniciar bridge', click: () => restartBridgeProcess() },
        { label: 'Buscar actualizaciones', click: () => checkForUpdatesNow(true) },
        { type: 'separator' },
        { label: 'Salir', click: () => quitApp() },
    ]);
    tray.setContextMenu(menu);
}

function bridgeScriptPath() {
    return path.join(app.getAppPath(), 'src', 'index.js');
}

function startBridgeProcess() {
    if (bridgeProc && !bridgeProc.killed) return;
    const scriptPath = bridgeScriptPath();
    bridgeProc = fork(scriptPath, [], {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            BRIDGE_APP_DATA_DIR: runtimeDir(),
            HTTP_PORT: String(BRIDGE_PORT),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    lastStatus.bridgeProcess = {
        ...lastStatus.bridgeProcess,
        running: true,
        pid: bridgeProc.pid || null,
    };
    bridgeProc.on('exit', () => {
        lastStatus.bridgeProcess = {
            ...lastStatus.bridgeProcess,
            running: false,
            pid: null,
        };
        sendStatusToRenderer();
        if (!isQuitting && !onboardingActive) {
            setTimeout(() => {
                lastStatus.bridgeProcess = {
                    ...lastStatus.bridgeProcess,
                    restarts: Number(lastStatus.bridgeProcess.restarts || 0) + 1,
                };
                startBridgeProcess();
            }, 2000);
        }
    });
    sendStatusToRenderer();
}

function stopBridgeProcess() {
    if (!bridgeProc) return;
    try {
        bridgeProc.kill('SIGTERM');
    } catch {
        // ignore best effort
    }
    bridgeProc = null;
}

function restartBridgeProcess() {
    stopBridgeProcess();
    setTimeout(startBridgeProcess, 350);
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
    const windowIcon = nativeImage.createFromPath(getIconPath('def-software-512.png'));
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 780,
        minWidth: 820,
        minHeight: 640,
        show: !process.argv.includes('--hidden') || onboardingActive,
        title: APP_NAME,
        icon: windowIcon.isEmpty() ? undefined : windowIcon,
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
                message: 'Hay una actualización disponible. Se descargará automáticamente.',
            });
        }
    });

    autoUpdater.on('update-downloaded', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'downloaded',
                message: 'Actualización lista. Reiniciá desde la UI para aplicarla.',
            });
        }
    });
}

function checkForUpdatesNow(manual = false) {
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
                message: `No se pudo buscar actualización: ${error.message}`,
            });
        }
    });
}

function startStatusPolling() {
    fetchBridgeStatus();
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(fetchBridgeStatus, STATUS_POLL_MS);
}

function startUpdatePolling() {
    checkForUpdatesNow(false);
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => checkForUpdatesNow(false), UPDATE_POLL_MS);
}

// ── Onboarding HTTP helpers ────────────────────────────────────────────────
function normalizeBaseUrl(value) {
    return String(value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
}

async function apiCall(baseUrl, path, { method = 'GET', body = null, headers = {} } = {}) {
    const url = `${normalizeBaseUrl(baseUrl)}${path}`;
    const init = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body != null) init.body = JSON.stringify(body);
    const response = await fetch(url, init);
    const text = await response.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    if (!response.ok) {
        const message = parsed?.error || `HTTP ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.body = parsed;
        throw err;
    }
    return parsed;
}

async function handleOnboardingLogin({ baseUrl, email, password }) {
    if (!email || !password) {
        throw new Error('Email y contraseña son requeridos');
    }
    return apiCall(baseUrl, '/bridge/auth/login', {
        method: 'POST',
        body: { email, password },
    });
}

async function handleOnboardingComplete({ baseUrl, sessionToken, branchId }) {
    const hostname = os.hostname() || 'desktop';
    const result = await apiCall(baseUrl, '/bridge/onboarding/complete', {
        method: 'POST',
        body: { sessionToken, branchId, hostname },
    });
    // Empezamos de cero con la config: cualquier override anterior (MYSQL_*
    // de instalaciones 0.3.x, SYNC_INTERVAL_MS de testing, barcode formats
    // mal copiados, etc.) se descarta. La balanza se vuelve a configurar
    // en el Paso 3 del wizard, escribiendo SCALE_PORT/ADDRESS limpios.
    try {
        const overridesFile = configOverridesPath();
        if (fs.existsSync(overridesFile)) fs.unlinkSync(overridesFile);
    } catch (_) { /* best effort */ }
    const installation = {
        apiBaseUrl: normalizeBaseUrl(baseUrl),
        deviceToken: result.deviceToken,
        deviceId: result.deviceId,
        tenantId: result.tenantId,
        clientId: result.clientId,
        clientName: result.clientName,
        taxId: result.taxId,
        branchId: result.branchId,
        branchName: result.branchName,
        branchInternalCode: result.branchInternalCode,
        hostname,
        onboardedAt: new Date().toISOString(),
    };
    writeInstallation(installation);
    onboardingActive = false;
    startBridgeProcess();
    startStatusPolling();
    return { ok: true, ...installation, deviceToken: undefined };
}

function setupIpc() {
    ipcMain.handle('status:get', async () => lastStatus);
    ipcMain.handle('status:restart-bridge', async () => {
        restartBridgeProcess();
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

    ipcMain.handle('onboarding:status', async () => {
        const installation = readInstallation();
        return {
            onboarded: Boolean(installation),
            installation: installation
                ? { ...installation, deviceToken: undefined }
                : null,
            defaultBaseUrl: DEFAULT_API_BASE_URL,
        };
    });
    ipcMain.handle('onboarding:login', async (_event, payload = {}) => {
        try {
            const result = await handleOnboardingLogin(payload || {});
            return { ok: true, ...result };
        } catch (error) {
            return { ok: false, error: error.message, status: error.status || null };
        }
    });
    ipcMain.handle('onboarding:complete', async (_event, payload = {}) => {
        try {
            const result = await handleOnboardingComplete(payload || {});
            return result;
        } catch (error) {
            return { ok: false, error: error.message, status: error.status || null };
        }
    });
    ipcMain.handle('onboarding:reset', async () => {
        const confirmResult = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Cancelar', 'Re-configurar'],
            defaultId: 0,
            cancelId: 0,
            title: 'Re-configurar bridge',
            message: '¿Re-configurar este bridge desde cero?',
            detail: 'Vas a tener que volver a loguearte y elegir sucursal. La configuración actual se elimina.',
        });
        if (confirmResult.response !== 1) return { ok: false, cancelled: true };

        stopBridgeProcess();
        try {
            const installFile = installationFilePath();
            if (fs.existsSync(installFile)) fs.unlinkSync(installFile);
            const overridesFile = configOverridesPath();
            if (fs.existsSync(overridesFile)) fs.unlinkSync(overridesFile);
        } catch (error) {
            return { ok: false, error: error.message };
        }
        onboardingActive = true;

        // Devolver el foco al renderer despues del dialog nativo. Sin esto,
        // los inputs del wizard quedan inaccesibles hasta que el usuario
        // clickee la ventana.
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.focus();
                mainWindow.webContents.focus();
            }
        } catch (_) { /* best effort */ }

        return { ok: true };
    });

    ipcMain.handle('window:focus', async () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.focus();
                mainWindow.webContents.focus();
            }
        } catch (_) { /* best effort */ }
        return { ok: true };
    });

    ipcMain.handle('scale:list-ports', async () => {
        const ports = await listSerialPorts();
        return { ok: true, ports };
    });

    ipcMain.handle('scale:save-config', async (_event, payload = {}) => {
        try {
            const port = String(payload?.port || '').trim();
            const addressRaw = Number.parseInt(payload?.address, 10);
            const address = Number.isFinite(addressRaw) && addressRaw >= 1 && addressRaw <= 99
                ? addressRaw
                : 20;
            if (!port) {
                return { ok: false, error: 'Tenés que elegir un puerto COM' };
            }
            writeConfigOverrides({
                SCALE_PORT: port,
                SCALE_ADDRESS: String(address),
            });
            return { ok: true, port, address };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    ipcMain.handle('scale:test', async () => {
        try {
            const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/scale/ping`, { method: 'POST' });
            if (!response.ok) {
                return { ok: false, error: `Bridge devolvio HTTP ${response.status}` };
            }
            const data = await response.json();
            return data;
        } catch (error) {
            return { ok: false, error: error.message || 'Bridge no esta corriendo' };
        }
    });

    ipcMain.handle('app:meta', async () => ({
        appVersion: getAppVersion(),
        platform: process.platform,
    }));
}

async function bootstrap() {
    app.setName(APP_NAME);
    // Necesario para que Windows muestre el icono correcto en la barra de
    // tareas y agrupe los procesos del bridge.
    try { app.setAppUserModelId('com.defsoftware.meatmanager.bridge'); } catch (_) { /* best effort */ }
    const hasLock = app.requestSingleInstanceLock();
    if (!hasLock) {
        app.quit();
        return;
    }

    app.on('second-instance', () => showMainWindow());

    await app.whenReady();
    configureAutoLaunch();
    configureAutoUpdate();

    onboardingActive = !readInstallation();

    createMainWindow();
    createTray();
    setupIpc();

    if (onboardingActive) {
        // No arrancamos el bridge ni el polling hasta que se complete el wizard.
        // El renderer detecta onboardingActive via IPC y muestra el flow.
        showMainWindow();
    } else {
        startBridgeProcess();
        startStatusPolling();
    }
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
    stopBridgeProcess();
});

bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[desktop bootstrap error]', error);
    app.exit(1);
});
