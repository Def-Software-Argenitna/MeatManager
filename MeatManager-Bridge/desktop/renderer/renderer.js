// ── Vista state ───────────────────────────────────────────────────────────
const views = {
    onboardingHeader: document.getElementById('view-onboarding'),
    login: document.getElementById('view-onboarding-login'),
    branch: document.getElementById('view-onboarding-branch'),
    success: document.getElementById('view-onboarding-success'),
    statusHeader: document.getElementById('view-status-header'),
    statusGrid: document.getElementById('view-status-grid'),
    statusActions: document.getElementById('view-status-actions'),
};

function show(node) { if (node) node.classList.remove('hidden'); }
function hide(node) { if (node) node.classList.add('hidden'); }
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
function showAlert(id, message, kind = 'err') {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.classList.remove('hidden');
    el.textContent = message;
    el.classList.toggle('ok', kind === 'ok');
}

function showOnboardingLogin(defaultBaseUrl) {
    show(views.onboardingHeader);
    show(views.login);
    hide(views.branch);
    hide(views.success);
    hide(views.statusHeader);
    hide(views.statusGrid);
    hide(views.statusActions);
    const baseInput = document.getElementById('login-base-url');
    if (baseInput && !baseInput.value) baseInput.value = defaultBaseUrl || '';
}

function showOnboardingBranch({ branches, clientName, taxId }) {
    show(views.onboardingHeader);
    hide(views.login);
    show(views.branch);
    hide(views.success);
    setText('onboarding-client-name',
        clientName ? `Cliente: ${clientName}${taxId ? ` · CUIT ${taxId}` : ''}` : '');
    const select = document.getElementById('branch-select');
    select.innerHTML = '';
    for (const branch of branches || []) {
        const option = document.createElement('option');
        option.value = String(branch.id);
        option.textContent = `${branch.name}${branch.internalCode ? ` (${branch.internalCode})` : ''}`;
        select.appendChild(option);
    }
}

function showOnboardingSuccess(installation) {
    hide(views.login);
    hide(views.branch);
    show(views.onboardingHeader);
    show(views.success);
    setText('onboarding-success-msg',
        `Bridge configurado correctamente. Cliente: ${installation.clientName || '-'} / Sucursal: ${installation.branchName || '-'}. Arrancando sincronización...`);
    setTimeout(() => showStatusView(installation), 1500);
}

function showStatusView(installation) {
    hide(views.onboardingHeader);
    hide(views.login);
    hide(views.branch);
    hide(views.success);
    show(views.statusHeader);
    show(views.statusGrid);
    show(views.statusActions);
    if (installation) {
        setText('status-tenant-line',
            `Cliente: ${installation.clientName || '-'} · Sucursal: ${installation.branchName || '-'} · Device: ${installation.deviceId || '-'}`);
    }
}

// ── Status rendering ──────────────────────────────────────────────────────
function setUpdatePill(status, message) {
    const updatePillEl = document.getElementById('update-pill');
    if (!updatePillEl) return;
    if (status === 'available' || status === 'downloaded') {
        updatePillEl.innerHTML = '<span class="dot warn"></span><span>Actualización disponible</span>';
    } else if (status === 'error') {
        updatePillEl.innerHTML = '<span class="dot bad"></span><span>Error de actualización</span>';
    } else {
        updatePillEl.innerHTML = '<span class="dot ok"></span><span>Sin novedades</span>';
    }
    const eventEl = document.getElementById('event');
    if (message && eventEl) eventEl.textContent = message;
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
    const processNodeEl = document.getElementById('bridge-process');
    const bridgeHttpEl = document.getElementById('bridge-http');
    const lastRunAtEl = document.getElementById('last-run-at');
    const lastErrorEl = document.getElementById('last-error');
    if (!processNodeEl) return;

    const procRunning = status?.bridgeProcess?.running === true;
    const procPid = status?.bridgeProcess?.pid ? ` (PID ${status.bridgeProcess.pid})` : '';
    processNodeEl.textContent = procRunning ? `Activo${procPid}` : 'Detenido';

    const apiReachable = status?.bridgeHttp?.reachable === true;
    bridgeHttpEl.textContent = apiReachable ? 'Conectada' : 'Sin conexión';
    bridgeHttpEl.style.color = apiReachable ? '#22c55e' : '#ef4444';

    lastRunAtEl.textContent = formatDate(status?.bridgeHttp?.lastRunAt || status?.updatedAt);
    lastErrorEl.textContent = status?.bridgeHttp?.lastError || status?.bridgeHttp?.lastRunStatus || 'Sin errores';
}

// ── Onboarding flow ──────────────────────────────────────────────────────
let pendingSession = null;
let cachedBaseUrl = '';

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showAlert('login-error', '');
    const baseUrl = document.getElementById('login-base-url').value.trim();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submit = document.getElementById('login-submit');
    submit.disabled = true;
    try {
        const result = await window.bridgeDesktop.onboarding.login({ baseUrl, email, password });
        if (!result?.ok) {
            showAlert('login-error', result?.error || 'No se pudo iniciar sesión');
            return;
        }
        pendingSession = {
            sessionToken: result.sessionToken,
            clientId: result.clientId,
            clientName: result.clientName,
            taxId: result.taxId,
        };
        cachedBaseUrl = baseUrl;
        showOnboardingBranch({
            branches: result.branches || [],
            clientName: result.clientName,
            taxId: result.taxId,
        });
    } catch (error) {
        showAlert('login-error', error?.message || 'Error inesperado');
    } finally {
        submit.disabled = false;
    }
});

document.getElementById('branch-back').addEventListener('click', () => {
    pendingSession = null;
    showOnboardingLogin(cachedBaseUrl);
});

document.getElementById('branch-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showAlert('branch-error', '');
    if (!pendingSession) {
        showAlert('branch-error', 'Sesión expirada. Iniciá sesión de nuevo.');
        showOnboardingLogin(cachedBaseUrl);
        return;
    }
    const branchId = Number(document.getElementById('branch-select').value);
    const submit = document.getElementById('branch-submit');
    submit.disabled = true;
    try {
        const result = await window.bridgeDesktop.onboarding.complete({
            baseUrl: cachedBaseUrl,
            sessionToken: pendingSession.sessionToken,
            branchId,
        });
        if (!result?.ok) {
            showAlert('branch-error', result?.error || 'No se pudo completar el onboarding');
            return;
        }
        showOnboardingSuccess(result);
    } catch (error) {
        showAlert('branch-error', error?.message || 'Error inesperado');
    } finally {
        submit.disabled = false;
    }
});

// ── Status actions (post-onboarding) ──────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', async () => {
    await window.bridgeDesktop.restartBridge();
    document.getElementById('event').textContent = 'Bridge reiniciado.';
});

document.getElementById('btn-check-updates').addEventListener('click', async () => {
    await window.bridgeDesktop.checkUpdates();
    document.getElementById('event').textContent = 'Buscando actualizaciones...';
});

document.getElementById('btn-install-update').addEventListener('click', async () => {
    document.getElementById('event').textContent = 'Aplicando actualización y reiniciando...';
    await window.bridgeDesktop.installUpdateNow();
});

document.getElementById('btn-open-logs').addEventListener('click', async () => {
    await window.bridgeDesktop.openLogDir();
});

document.getElementById('btn-reset-install').addEventListener('click', async () => {
    const confirmed = confirm('¿Re-configurar este bridge desde cero? Vas a tener que volver a loguearte y elegir sucursal.');
    if (!confirmed) return;
    const result = await window.bridgeDesktop.onboarding.reset();
    if (result?.ok) {
        pendingSession = null;
        cachedBaseUrl = '';
        const onboardingState = await window.bridgeDesktop.onboarding.status();
        showOnboardingLogin(onboardingState.defaultBaseUrl);
    }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
window.bridgeDesktop.onStatus(renderStatus);
window.bridgeDesktop.onUpdateEvent((payload) => {
    setUpdatePill(payload?.status, payload?.message);
});

(async () => {
    const onboardingState = await window.bridgeDesktop.onboarding.status();
    if (onboardingState?.onboarded) {
        showStatusView(onboardingState.installation);
        window.bridgeDesktop.getStatus().then(renderStatus);
    } else {
        cachedBaseUrl = onboardingState?.defaultBaseUrl || '';
        showOnboardingLogin(cachedBaseUrl);
    }
})();
