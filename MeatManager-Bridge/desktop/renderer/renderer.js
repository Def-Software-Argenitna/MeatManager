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

window.bridgeDesktop.onStatus(renderStatus);
window.bridgeDesktop.onUpdateEvent((payload) => {
    setUpdatePill(payload?.status, payload?.message);
});

window.bridgeDesktop.getStatus().then(renderStatus);
