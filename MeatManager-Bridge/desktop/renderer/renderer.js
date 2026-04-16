const processNodeEl = document.getElementById('bridge-process');
const bridgeHttpEl = document.getElementById('bridge-http');
const lastRunAtEl = document.getElementById('last-run-at');
const lastErrorEl = document.getElementById('last-error');
const eventEl = document.getElementById('event');
const updatePillEl = document.getElementById('update-pill');

const btnRestart = document.getElementById('btn-restart');
const btnCheckUpdates = document.getElementById('btn-check-updates');
const btnInstallUpdate = document.getElementById('btn-install-update');
const btnOpenLogs = document.getElementById('btn-open-logs');
const btnToggleConfig = document.getElementById('btn-toggle-config');
const btnRefreshPorts = document.getElementById('btn-refresh-ports');
const btnSaveConfig = document.getElementById('btn-save-config');
const configPanel = document.getElementById('config-panel');

const cfgClientId = document.getElementById('cfg-client-id');
const cfgBranchId = document.getElementById('cfg-branch-id');
const cfgScalePort = document.getElementById('cfg-scale-port');
const cfgMysqlHost = document.getElementById('cfg-mysql-host');
const cfgMysqlPort = document.getElementById('cfg-mysql-port');
const cfgMysqlDb = document.getElementById('cfg-mysql-db');
const cfgMysqlUser = document.getElementById('cfg-mysql-user');
const cfgMysqlPassword = document.getElementById('cfg-mysql-password');
const cfgSyncInterval = document.getElementById('cfg-sync-interval');

function setUpdatePill(status, message) {
    if (status === 'available' || status === 'downloaded') {
        updatePillEl.innerHTML = '<span class="dot warn"></span><span>Actualización disponible</span>';
    } else if (status === 'error') {
        updatePillEl.innerHTML = '<span class="dot bad"></span><span>Error de actualización</span>';
    } else {
        updatePillEl.innerHTML = '<span class="dot ok"></span><span>Sin novedades</span>';
    }
    if (message) eventEl.textContent = message;
}

function formatDate(value) {
    if (!value) return '-';
    try {
        return new Date(value).toLocaleString('es-AR');
    } catch {
        return value;
    }
}

function renderStatus(status) {
    const procRunning = status?.bridgeProcess?.running === true;
    const procPid = status?.bridgeProcess?.pid ? ` (PID ${status.bridgeProcess.pid})` : '';
    processNodeEl.textContent = procRunning ? `Activo${procPid}` : 'Detenido';

    const apiReachable = status?.bridgeHttp?.reachable === true;
    bridgeHttpEl.textContent = apiReachable ? 'Conectada' : 'Sin conexión';
    bridgeHttpEl.style.color = apiReachable ? '#22c55e' : '#ef4444';

    lastRunAtEl.textContent = formatDate(status?.bridgeHttp?.lastRunAt || status?.updatedAt);
    lastErrorEl.textContent = status?.bridgeHttp?.lastError || status?.bridgeHttp?.lastRunStatus || 'Sin errores';
}

function setPorts(ports = [], selectedPort = '') {
    const options = Array.isArray(ports) ? ports : [];
    cfgScalePort.innerHTML = '';
    const fallback = document.createElement('option');
    fallback.value = '';
    fallback.textContent = options.length ? 'Seleccionar puerto...' : 'Sin puertos detectados';
    cfgScalePort.appendChild(fallback);
    options.forEach((port) => {
        const value = String(port?.path || port?.comName || '').trim();
        if (!value) return;
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        cfgScalePort.appendChild(opt);
    });
    if (selectedPort) {
        cfgScalePort.value = selectedPort;
    }
}

async function loadConfigForm() {
    const payload = await window.bridgeDesktop.getConfig();
    const values = payload?.values || {};
    cfgClientId.value = values.BRIDGE_CLIENT_ID || '';
    cfgBranchId.value = values.BRIDGE_BRANCH_ID || '';
    cfgMysqlHost.value = values.MYSQL_HOST || '';
    cfgMysqlPort.value = values.MYSQL_PORT || '';
    cfgMysqlDb.value = values.MYSQL_DATABASE || '';
    cfgMysqlUser.value = values.MYSQL_USER || '';
    cfgMysqlPassword.value = values.MYSQL_PASSWORD || '';
    cfgSyncInterval.value = values.SYNC_INTERVAL_MS || '1000';
    await refreshPorts(values.SCALE_PORT || '');
}

async function refreshPorts(selectedPort = '') {
    const result = await window.bridgeDesktop.listScalePorts();
    if (!result?.ok) {
        setPorts([], selectedPort);
        eventEl.textContent = `No se pudieron detectar puertos: ${result?.error || 'error'}`;
        return;
    }
    setPorts(result?.ports || [], selectedPort);
}

btnRestart.addEventListener('click', async () => {
    await window.bridgeDesktop.restartBridge();
    eventEl.textContent = 'Bridge reiniciado.';
});

btnCheckUpdates.addEventListener('click', async () => {
    await window.bridgeDesktop.checkUpdates();
    eventEl.textContent = 'Buscando actualizaciones...';
});

btnInstallUpdate.addEventListener('click', async () => {
    eventEl.textContent = 'Aplicando actualización y reiniciando...';
    await window.bridgeDesktop.installUpdateNow();
});

btnOpenLogs.addEventListener('click', async () => {
    await window.bridgeDesktop.openLogDir();
});

btnToggleConfig.addEventListener('click', async () => {
    const willOpen = configPanel.classList.contains('hidden');
    configPanel.classList.toggle('hidden', !willOpen);
    if (willOpen) {
        await loadConfigForm();
    }
});

btnRefreshPorts.addEventListener('click', async () => {
    await refreshPorts(cfgScalePort.value);
    eventEl.textContent = 'Puertos actualizados.';
});

btnSaveConfig.addEventListener('click', async () => {
    const values = {
        BRIDGE_CLIENT_ID: cfgClientId.value,
        BRIDGE_BRANCH_ID: cfgBranchId.value,
        SCALE_PORT: cfgScalePort.value,
        MYSQL_HOST: cfgMysqlHost.value,
        MYSQL_PORT: cfgMysqlPort.value,
        MYSQL_DATABASE: cfgMysqlDb.value,
        MYSQL_USER: cfgMysqlUser.value,
        MYSQL_PASSWORD: cfgMysqlPassword.value,
        SYNC_INTERVAL_MS: cfgSyncInterval.value,
    };
    await window.bridgeDesktop.saveConfig(values);
    eventEl.textContent = 'Configuracion guardada. Reiniciando bridge...';
});

window.bridgeDesktop.onStatus(renderStatus);
window.bridgeDesktop.onUpdateEvent((payload) => {
    setUpdatePill(payload?.status, payload?.message);
});

window.bridgeDesktop.getStatus().then(renderStatus);
