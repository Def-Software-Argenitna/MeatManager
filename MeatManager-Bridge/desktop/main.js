const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'MeatManager Bridge';
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_HTTP_PORT || '4046', 10);
const STATUS_POLL_MS = 4000;
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000; // 6h
// El cliente opera en produccion (meatmanager.def-software.com). El demo
// (meatmanager.demo.def-software.com) es solo para QA antes de release. El
// instalador tiene que apuntar por default a produccion — si lo dejamos en
// demo, cualquier onboarding nuevo manda ventas y consulta catalogo del
// tenant equivocado.
const DEFAULT_API_BASE_URL = process.env.BRIDGE_API_BASE_URL || 'https://meatmanager.def-software.com/api';

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
// El bridge tarda ~600ms desde el fork hasta que ata el puerto HTTP local. El
// desktop polea cada 4s y el primer poll cae siempre en esa ventana, generando
// ECONNREFUSED ruidosos en desktop.log. Silenciamos las primeras N fallas de
// red despues de cada arranque/restart — si la conexion se restablece en ese
// rango, ni siquiera figuran. Si persisten mas alla del grace, recien ahi
// logeamos (porque ya no es startup, es un problema real).
const STARTUP_GRACE_POLLS = 4; // ~16s a STATUS_POLL_MS=4000
let startupGracePollsRemaining = 0;

// Watchdog de salud: el watchdog de 'exit' no cubre al hijo COLGADO (vivo pero
// con el event loop bloqueado). Visto en prod: un hipo del USB de la balanza
// dejo al hijo 3 horas sin responder — el puerto seguia LISTENING pero con el
// backlog TCP lleno las conexiones se rechazaban, y como el proceso nunca
// murio, nadie lo relanzo. Si /health falla N polls seguidos con el hijo vivo,
// lo matamos; el handler de 'exit' lo relanza solo.
const HEALTH_WATCHDOG_FAILS = 6; // ~24s a STATUS_POLL_MS=4000 (>> bind de ~2s)
let consecutiveHealthFailures = 0;

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
    // app.getAppPath() devuelve la raiz del proyecto en dev y la ruta dentro
    // de app.asar en prod (Electron maneja la VFS de asar transparentemente
    // en nativeImage.createFromPath y fs apis). Combinado con asarUnpack del
    // package.json, garantiza que el icono se encuentre en ambos modos.
    return path.join(app.getAppPath(), 'public', 'branding', fileName);
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
    if (!mainWindow || mainWindow.isDestroyed()) {
        logDesktop('sendStatusToRenderer: mainWindow null/destroyed');
        return;
    }
    mainWindow.webContents.send('bridge-status', lastStatus);
}

function desktopLogPath() {
    return path.join(runtimeDir(), 'logs', 'desktop.log');
}

function logDesktop(message) {
    try {
        const line = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(desktopLogPath(), line, 'utf8');
    } catch (_) { /* best effort */ }
}

async function fetchBridgeStatus() {
    if (onboardingActive) return;
    try {
        const url = `http://127.0.0.1:${BRIDGE_PORT}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        let response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        consecutiveHealthFailures = 0;
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
                fetchError: null,
            },
            updatedAt: new Date().toISOString(),
        };
    } catch (error) {
        const causeCode = error?.cause?.code || null;
        const detail = `${error?.name || 'Error'}: ${error?.message || String(error)}${error?.cause ? ` | cause=${causeCode || error.cause?.message || error.cause}` : ''}`;
        // Silenciamos ECONNREFUSED durante el grace period inicial — es la race
        // normal entre el desktop levantando el polling y el bridge atando el
        // puerto. Solo logeamos si persiste (problema real) o si es otro error.
        const isStartupRace = causeCode === 'ECONNREFUSED' && startupGracePollsRemaining > 0;
        if (isStartupRace) {
            startupGracePollsRemaining -= 1;
        } else {
            logDesktop(`fetchBridgeStatus FAILED → ${detail}`);
        }
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
                fetchError: detail,
            },
            updatedAt: new Date().toISOString(),
        };

        consecutiveHealthFailures += 1;
        if (consecutiveHealthFailures >= HEALTH_WATCHDOG_FAILS && !onboardingActive && !isQuitting) {
            consecutiveHealthFailures = 0;
            const pid = bridgeProc?.pid || null;
            logDesktop(`health watchdog: /health no responde hace ${HEALTH_WATCHDOG_FAILS} polls (hijo pid=${pid}) — kill + relanzar`);
            // No dependemos del handler de 'exit': si el hijo ya murio antes
            // (kill externo/crash), ese evento ya se consumio y no se re-emite,
            // asi que kill() solo seria un no-op y nadie relanzaria. Matamos
            // best-effort, limpiamos la referencia y forkeamos nosotros.
            const dead = bridgeProc;
            bridgeProc = null;
            if (dead) {
                try { dead.removeAllListeners('exit'); } catch (_) { /* noop */ }
                try { dead.kill('SIGKILL'); } catch (_) { /* noop */ }
            }
            setTimeout(() => {
                lastStatus.bridgeProcess = {
                    ...lastStatus.bridgeProcess,
                    restarts: Number(lastStatus.bridgeProcess.restarts || 0) + 1,
                };
                startBridgeProcess();
            }, 2000);
        }
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
    // Cada vez que (re)arrancamos el bridge hay una ventana ~600ms-2s donde el
    // puerto HTTP local no esta atado. Reseteamos el grace para no llenar
    // desktop.log con ECONNREFUSED esperables.
    startupGracePollsRemaining = STARTUP_GRACE_POLLS;
    consecutiveHealthFailures = 0;
    const scriptPath = bridgeScriptPath();
    bridgeProc = fork(scriptPath, [], {
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            BRIDGE_APP_DATA_DIR: runtimeDir(),
            HTTP_PORT: String(BRIDGE_PORT),
            // El hijo corre con ELECTRON_RUN_AS_NODE y no tiene app.getVersion();
            // le inyectamos la version para que la reporte en el heartbeat.
            BRIDGE_APP_VERSION: app.getVersion(),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    lastStatus.bridgeProcess = {
        ...lastStatus.bridgeProcess,
        running: true,
        pid: bridgeProc.pid || null,
    };
    // Canal de control remoto: el hijo recibe comandos del API via heartbeat
    // (sistema -> bridge) y nos los reenvia por IPC. Permite operar el equipo
    // sin acceso fisico: aplicar updates y reiniciar la app completa.
    bridgeProc.on('message', (message) => {
        if (message?.type !== 'bridge-command') return;
        const command = String(message.command || '');
        logDesktop(`comando remoto recibido del hijo: ${command}`);
        if (command === 'apply_update') {
            checkForUpdatesNow(false);
        } else if (command === 'restart_app') {
            app.relaunch({ args: process.argv.slice(1).includes('--hidden') ? ['--hidden'] : [] });
            quitApp();
        }
    });
    bridgeProc.on('exit', (code, signal) => {
        logDesktop(`bridge hijo termino (code=${code} signal=${signal})`);
        // CRITICO: limpiar la referencia. Sin esto, startBridgeProcess() ve
        // `bridgeProc && !bridgeProc.killed` (killed solo se setea si NOSOTROS
        // llamamos .kill()) y retorna sin forkear — el "relanzamiento" era un
        // no-op silencioso para crashes reales o kills externos. Visto en prod:
        // el bridge quedaba muerto para siempre tras un crash del hijo.
        bridgeProc = null;
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

    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'downloaded',
                message: `Actualización ${info?.version || ''} descargada. Se aplicará automáticamente en unos segundos...`,
            });
        }
        // Auto-aplicar: este equipo corre desatendido en el mostrador — nadie
        // va a "reiniciar desde la UI". Sin esto, las updates se descargaban y
        // quedaban pendientes para siempre (visto en prod: el cliente seguia en
        // 0.4.11 con 4 releases descargados sin aplicar). El bridge tarda ~10s
        // en volver y el pulso de ventas re-lee lo que se haya perdido.
        if (onboardingActive) return;
        logDesktop(`update ${info?.version || '?'} descargada — aplicando automaticamente (quitAndInstall)`);
        setTimeout(() => {
            isQuitting = true;
            try {
                autoUpdater.quitAndInstall(true, true);
            } catch (error) {
                isQuitting = false;
                logDesktop(`quitAndInstall fallo: ${error?.message || error}`);
            }
        }, 5000);
    });

    autoUpdater.on('update-not-available', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-event', {
                status: 'not-available',
                message: 'Bridge actualizado a la ultima version disponible.',
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
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const message = String(error?.message || '');
        // "No published versions on GitHub" no es realmente un error — pasa
        // cuando estamos en una version prerelease y no hay stable mas nueva.
        const benign = /no published versions/i.test(message);
        mainWindow.webContents.send('update-event', {
            status: benign ? 'not-available' : 'error',
            message: benign
                ? 'No hay actualizaciones disponibles en este momento.'
                : `No se pudo buscar actualización: ${message}`,
        });
    });
}

function startStatusPolling() {
    logDesktop(`startStatusPolling called (interval=${STATUS_POLL_MS}ms, bridgePort=${BRIDGE_PORT})`);
    // Reset del grace period: cualquier ECONNREFUSED en las primeras N pollings
    // queda silenciado (es la race normal del bridge atando el puerto HTTP).
    startupGracePollsRemaining = STARTUP_GRACE_POLLS;
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

    ipcMain.handle('scale:reset', async () => {
        const confirmResult = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Cancelar', 'Resetear balanza'],
            defaultId: 0,
            cancelId: 0,
            title: 'Resetear balanza completa',
            message: '¿Borrar TODOS los PLUs de la balanza y re-sincronizar desde cero?',
            detail: 'Se itera fn5 sobre PLU 1..8000. Puede tardar varios minutos. Útil cuando se cambia la balanza por una usada o quedaron PLUs huerfanos. Despues del reset el siguiente ciclo va a re-sincronizar todo el catalogo desde MeatManager.',
        });
        if (confirmResult.response !== 1) return { ok: false, cancelled: true };

        try {
            const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/scale/reset`, {
                method: 'POST',
                signal: AbortSignal.timeout(20 * 60 * 1000),
            });
            if (!response.ok) {
                return { ok: false, error: `Bridge devolvio HTTP ${response.status}` };
            }
            return await response.json();
        } catch (error) {
            return { ok: false, error: error.message || 'Reset falló' };
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
