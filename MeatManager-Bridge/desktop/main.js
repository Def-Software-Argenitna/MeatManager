const path = require('path');
const { fork } = require('child_process');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'MeatManager Bridge';
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_HTTP_PORT || '4045', 10);
const STATUS_POLL_MS = 4000;
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000; // 6h

let mainWindow = null;
let tray = null;
let bridgeProc = null;
let statusTimer = null;
let updateTimer = null;
let isQuitting = false;
let updateAvailable = false;
let lastStatus = {
    bridgeProcess: { running: false, pid: null, restarts: 0 },
    bridgeHttp: { reachable: false, running: false, lastRunStatus: null, lastError: null, lastRunAt: null },
    updatedAt: new Date().toISOString(),
};

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
                lastError: payload.lastError || null,
                lastRunAt: payload.lastRunAt || null,
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
                lastError: 'Bridge HTTP no disponible',
                lastRunAt: null,
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

function runtimeDir() {
    return path.join(app.getPath('userData'), 'runtime');
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
        if (!isQuitting) {
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
    mainWindow = new BrowserWindow({
        width: 920,
        height: 620,
        minWidth: 760,
        minHeight: 500,
        show: !process.argv.includes('--hidden'),
        title: APP_NAME,
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
    statusTimer = setInterval(fetchBridgeStatus, STATUS_POLL_MS);
}

function startUpdatePolling() {
    checkForUpdatesNow(false);
    updateTimer = setInterval(() => checkForUpdatesNow(false), UPDATE_POLL_MS);
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
}

async function bootstrap() {
    app.setName(APP_NAME);
    const hasLock = app.requestSingleInstanceLock();
    if (!hasLock) {
        app.quit();
        return;
    }

    app.on('second-instance', () => showMainWindow());

    await app.whenReady();
    configureAutoLaunch();
    configureAutoUpdate();
    createMainWindow();
    createTray();
    setupIpc();
    startBridgeProcess();
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
    stopBridgeProcess();
});

bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[desktop bootstrap error]', error);
    app.exit(1);
});
