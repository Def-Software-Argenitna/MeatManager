// ── DOM cache ─────────────────────────────────────────────────────────────
const views = {
    onboardingHeader: document.getElementById('view-onboarding-header'),
    login: document.getElementById('view-onboarding-login'),
    branch: document.getElementById('view-onboarding-branch'),
    scale: document.getElementById('view-onboarding-scale'),
    success: document.getElementById('view-onboarding-success'),
    statusHeader: document.getElementById('view-status-header'),
    statusGrid: document.getElementById('view-status-grid'),
    statusActions: document.getElementById('view-status-actions'),
    statusConfig: document.getElementById('view-status-config'),
};

const stepperEls = {
    1: document.getElementById('step-1'),
    2: document.getElementById('step-2'),
    3: document.getElementById('step-3'),
};

// ── Helpers ───────────────────────────────────────────────────────────────
function show(node) { if (node) node.classList.remove('hidden'); }
function hide(node) { if (node) node.classList.add('hidden'); }
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text == null ? '' : String(text);
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
    el.classList.remove('ok', 'warn');
    if (kind === 'ok') el.classList.add('ok');
    if (kind === 'warn') el.classList.add('warn');
}
function setStepper(activeStep) {
    [1, 2, 3].forEach((step) => {
        const el = stepperEls[step];
        if (!el) return;
        el.classList.remove('active', 'done');
        if (step < activeStep) el.classList.add('done');
        if (step === activeStep) el.classList.add('active');
    });
}
function setBtnLoading(button, label, isLoading) {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
        button.innerHTML = `<span class="btn-spinner"></span>${label || 'Procesando...'}`;
        button.disabled = true;
    } else {
        if (button.dataset.originalLabel) {
            button.innerHTML = button.dataset.originalLabel;
            delete button.dataset.originalLabel;
        }
        button.disabled = false;
    }
}
function formatRelative(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const deltaMs = Date.now() - date.getTime();
    if (deltaMs < 0) return 'recién';
    if (deltaMs < 5_000) return 'recién';
    if (deltaMs < 60_000) return `hace ${Math.round(deltaMs / 1000)} seg`;
    if (deltaMs < 3_600_000) return `hace ${Math.round(deltaMs / 60_000)} min`;
    if (deltaMs < 86_400_000) return `hace ${Math.round(deltaMs / 3_600_000)} h`;
    return date.toLocaleString('es-AR');
}
function formatDateTime(value) {
    if (!value) return '-';
    try { return new Date(value).toLocaleString('es-AR'); } catch { return String(value); }
}

// ── Onboarding state ──────────────────────────────────────────────────────
let pendingSession = null;
let cachedBaseUrl = '';

function showOnboardingLogin(defaultBaseUrl) {
    setStepper(1);
    show(views.onboardingHeader);
    show(views.login);
    hide(views.branch);
    hide(views.scale);
    hide(views.success);
    hide(views.statusHeader);
    hide(views.statusGrid);
    hide(views.statusActions);
    hide(views.statusConfig);
    const baseInput = document.getElementById('login-base-url');
    if (baseInput && !baseInput.value) baseInput.value = defaultBaseUrl || '';
}

function showOnboardingBranch({ branches, clientName, taxId }) {
    setStepper(2);
    show(views.onboardingHeader);
    hide(views.login);
    show(views.branch);
    hide(views.scale);
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

async function showOnboardingScale() {
    setStepper(3);
    show(views.onboardingHeader);
    hide(views.login);
    hide(views.branch);
    show(views.scale);
    hide(views.success);
    await refreshScalePorts();
}

async function refreshScalePorts() {
    const select = document.getElementById('scale-port');
    const help = document.getElementById('scale-ports-help');
    select.innerHTML = '<option value="">Detectando puertos...</option>';
    select.disabled = true;
    const { ports } = await window.bridgeDesktop.scale.listPorts();
    select.innerHTML = '';
    if (!Array.isArray(ports) || ports.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No detectamos puertos COM disponibles';
        select.appendChild(opt);
        help.textContent = 'Conectá la balanza por USB y tocá "Refrescar". Si igual no aparece, podés saltar y configurar el puerto manualmente después.';
        select.disabled = false;
        return;
    }
    for (const port of ports) {
        const opt = document.createElement('option');
        opt.value = port.path;
        const friendly = port.friendlyName || port.manufacturer || '';
        opt.textContent = friendly ? `${port.path} — ${friendly}` : port.path;
        select.appendChild(opt);
    }
    select.disabled = false;
    help.textContent = `Detectamos ${ports.length} puerto${ports.length === 1 ? '' : 's'}. Elegí el que corresponde a la balanza.`;
}

function showOnboardingSuccess(installation) {
    hide(views.login);
    hide(views.branch);
    hide(views.scale);
    show(views.onboardingHeader);
    show(views.success);
    setText('onboarding-success-msg',
        `Listo. Cliente: ${installation.clientName || '-'} / Sucursal: ${installation.branchName || '-'}. Arrancando el bridge...`);
    setTimeout(() => showStatusView(installation), 1400);
}

async function showStatusView(installation) {
    hide(views.onboardingHeader);
    hide(views.login);
    hide(views.branch);
    hide(views.scale);
    hide(views.success);
    show(views.statusHeader);
    show(views.statusGrid);
    show(views.statusActions);
    show(views.statusConfig);

    if (installation) {
        setText('status-tenant-line',
            `${installation.clientName || 'Cliente'} · ${installation.branchName || 'Sucursal'}`);
        setText('cfg-client', installation.clientName || '-');
        const branchLabel = installation.branchName + (installation.branchInternalCode ? ` (${installation.branchInternalCode})` : '');
        setText('cfg-branch', branchLabel);
        setText('cfg-device-id', installation.deviceId || '-');
        setText('cfg-api-url', installation.apiBaseUrl || '-');
        setText('cfg-tax-id', installation.taxId || '-');
        setText('cfg-onboarded-at', formatDateTime(installation.onboardedAt));
    }

    const meta = await window.bridgeDesktop.getAppMeta();
    if (meta?.appVersion) {
        setText('status-app-version', `v${meta.appVersion}`);
        setText('footer-meta', `MeatManager Bridge v${meta.appVersion} · ${meta.platform || ''}`);
    }
}

// ── Form handlers ─────────────────────────────────────────────────────────
document.getElementById('login-password-toggle').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const btn = document.getElementById('login-password-toggle');
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Ocultar';
    } else {
        input.type = 'password';
        btn.textContent = 'Mostrar';
    }
});

function mapLoginError(message, status) {
    if (!message) return 'No se pudo iniciar sesión';
    const lower = String(message).toLowerCase();
    if (lower.includes('contraseña') || lower.includes('email o')) return 'Email o contraseña inválidos. Verificá las credenciales.';
    if (lower.includes('admin')) return 'Esa cuenta no es administrador del cliente. Pedí al admin que te dé acceso.';
    if (lower.includes('cliente') && lower.includes('no')) return 'El email no está vinculado a ningún cliente en MeatManager.';
    if (lower.includes('sucursales activas')) return 'El cliente no tiene sucursales activas. Pedí que activen una desde MeatManager.';
    if (lower.includes('firebase')) return 'No pudimos contactar al servidor de autenticación. Verificá tu conexión.';
    if (status === 502 || status === 503) return 'El servidor no está disponible en este momento. Volvé a probar en un rato.';
    return message;
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showAlert('login-error', '');
    const baseUrl = document.getElementById('login-base-url').value.trim();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
        showAlert('login-error', 'Completá email y contraseña.');
        return;
    }
    const submit = document.getElementById('login-submit');
    setBtnLoading(submit, 'Verificando...', true);
    try {
        const result = await window.bridgeDesktop.onboarding.login({ baseUrl, email, password });
        if (!result?.ok) {
            showAlert('login-error', mapLoginError(result?.error, result?.status));
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
        setBtnLoading(submit, '', false);
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
        showAlert('branch-error', 'La sesión expiró. Iniciá sesión de nuevo.');
        showOnboardingLogin(cachedBaseUrl);
        return;
    }
    const branchId = Number(document.getElementById('branch-select').value);
    const submit = document.getElementById('branch-submit');
    setBtnLoading(submit, 'Confirmando...', true);
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
        pendingSession = { ...pendingSession, installation: result };
        await showOnboardingScale();
    } catch (error) {
        showAlert('branch-error', error?.message || 'Error inesperado');
    } finally {
        setBtnLoading(submit, '', false);
    }
});

document.getElementById('scale-refresh-ports').addEventListener('click', refreshScalePorts);

async function finalizeOnboarding({ withScaleConfig }) {
    const submit = document.getElementById('scale-submit');
    const skip = document.getElementById('scale-skip');
    showAlert('scale-error', '');
    if (withScaleConfig) {
        const port = document.getElementById('scale-port').value;
        const address = Number(document.getElementById('scale-address').value);
        if (!port) {
            showAlert('scale-error', 'Elegí un puerto COM o tocá "Saltar y configurar después".');
            return;
        }
        if (!Number.isFinite(address) || address < 1 || address > 99) {
            showAlert('scale-error', 'Dirección de balanza inválida (debe ser entre 1 y 99).');
            return;
        }
        setBtnLoading(submit, 'Guardando...', true);
        const saved = await window.bridgeDesktop.scale.saveConfig({ port, address });
        setBtnLoading(submit, '', false);
        if (!saved?.ok) {
            showAlert('scale-error', saved?.error || 'No se pudo guardar la configuración de la balanza');
            return;
        }
    } else {
        setBtnLoading(skip, 'Saltando...', true);
    }
    showOnboardingSuccess(pendingSession?.installation || {});
    setBtnLoading(skip, '', false);
}

document.getElementById('scale-form').addEventListener('submit', (event) => {
    event.preventDefault();
    finalizeOnboarding({ withScaleConfig: true });
});

document.getElementById('scale-skip').addEventListener('click', () => {
    finalizeOnboarding({ withScaleConfig: false });
});

// ── Status rendering ──────────────────────────────────────────────────────
function setHealthBadge(level, text) {
    const badge = document.getElementById('health-badge');
    if (!badge) return;
    badge.classList.remove('ok', 'warn', 'bad');
    badge.classList.add(level);
    setText('health-text', text);
}

function setTile(id, level, valueText, tinyText = '') {
    const tile = document.getElementById(`tile-${id}`);
    if (!tile) return;
    tile.classList.remove('ok', 'warn', 'bad');
    tile.classList.add(level);
    if (id === 'process') {
        setText('bridge-process', valueText);
        setText('bridge-process-tiny', tinyText);
    } else if (id === 'api') {
        setText('bridge-http', valueText);
        setText('bridge-http-tiny', tinyText);
    } else if (id === 'scale') {
        setText('scale-status', valueText);
        setText('scale-status-tiny', tinyText);
    } else if (id === 'error') {
        setText('last-error', valueText);
        setText('last-run-at', tinyText);
    }
}

function setUpdatePill(status, message) {
    const updatePillEl = document.getElementById('update-pill');
    if (!updatePillEl) return;
    let html = '';
    if (status === 'available' || status === 'downloaded') {
        html = '<span class="dot warn"></span><span>Actualización disponible</span>';
        document.getElementById('btn-install-update').classList.remove('hidden');
    } else if (status === 'error') {
        html = '<span class="dot bad"></span><span>Error de actualización</span>';
    } else {
        html = '<span class="dot ok"></span><span>Sin novedades</span>';
    }
    updatePillEl.innerHTML = html;
    const eventEl = document.getElementById('event');
    if (message && eventEl) eventEl.textContent = message;
}

function renderStatus(status) {
    const procRunning = status?.bridgeProcess?.running === true;
    const procPid = status?.bridgeProcess?.pid ? `PID ${status.bridgeProcess.pid}` : '';
    setTile('process',
        procRunning ? 'ok' : 'bad',
        procRunning ? 'Activo' : 'Detenido',
        procPid);

    const apiReachable = status?.bridgeHttp?.reachable === true;
    setTile('api',
        apiReachable ? 'ok' : 'warn',
        apiReachable ? 'Conectada' : 'Sin conexión',
        apiReachable ? '' : 'El proceso del bridge no responde en el puerto local.');

    const scaleReachable = status?.bridgeHttp?.scaleReachable !== false;
    if (!apiReachable) {
        setTile('scale', 'warn', 'Pendiente', 'Esperando bridge');
    } else if (scaleReachable) {
        setTile('scale', 'ok', 'Conectada', 'Respondiendo al protocolo CUORA');
    } else {
        setTile('scale', 'warn', 'No responde', 'Verificá que esté encendida y conectada por USB');
    }

    const lastError = status?.bridgeHttp?.lastError;
    const lastRunStatus = status?.bridgeHttp?.lastRunStatus;
    const lastRunMessage = status?.bridgeHttp?.lastRunMessage;
    const lastRunAt = status?.bridgeHttp?.lastRunAt;
    if (lastError && lastError !== 'Bridge HTTP no disponible') {
        setTile('error', 'bad', lastError, formatDateTime(lastRunAt));
    } else if (lastRunStatus === 'ok' && lastRunMessage) {
        const level = scaleReachable ? 'ok' : 'warn';
        setTile('error', level, lastRunMessage, formatRelative(lastRunAt) || formatDateTime(lastRunAt));
    } else if (lastRunStatus === 'ok') {
        setTile('error', 'ok', 'Sincronizando OK', formatRelative(lastRunAt) || formatDateTime(lastRunAt));
    } else {
        setTile('error', 'warn', 'Esperando primer ciclo', formatDateTime(lastRunAt) || '-');
    }

    if (!procRunning) setHealthBadge('bad', 'Bridge detenido');
    else if (!apiReachable) setHealthBadge('warn', 'Bridge arrancando');
    else if (lastError && lastError !== 'Bridge HTTP no disponible') setHealthBadge('warn', 'Sincronización con incidencias');
    else if (!scaleReachable) setHealthBadge('warn', 'Balanza desconectada');
    else if (lastRunStatus === 'ok') setHealthBadge('ok', 'Todo en orden');
    else setHealthBadge('warn', 'Verificando...');

    const lastSyncText = lastRunAt ? formatRelative(lastRunAt) : 'Sin sincronizaciones aún';
    setText('last-sync-text', `Última sync: ${lastSyncText}`);
    const lastSyncPill = document.getElementById('last-sync-pill');
    const dot = lastSyncPill?.querySelector('.dot');
    if (dot) {
        dot.classList.remove('ok', 'warn', 'bad');
        dot.classList.add(lastRunStatus === 'ok' ? 'ok' : (lastRunAt ? 'warn' : 'bad'));
    }
}

// ── Status actions ────────────────────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', async () => {
    const btn = document.getElementById('btn-restart');
    setBtnLoading(btn, 'Reiniciando...', true);
    await window.bridgeDesktop.restartBridge();
    setBtnLoading(btn, '', false);
    document.getElementById('event').textContent = 'Bridge reiniciado.';
});

document.getElementById('btn-test-scale').addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-scale');
    setBtnLoading(btn, 'Pingueando...', true);
    const result = await window.bridgeDesktop.scale.test();
    setBtnLoading(btn, '', false);
    const ev = document.getElementById('event');
    if (result?.ok) {
        ev.textContent = `✓ Balanza responde (fn ${result.fn || '-'}, status ${result.status || '-'}).`;
    } else {
        ev.textContent = `✗ No se pudo pinguear la balanza: ${result?.error || 'sin detalles'}`;
    }
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
    // El handler IPC abre un dialog nativo y devuelve cancelled:true si el
    // usuario no confirma. Asi evitamos confirm() del renderer (que rompia
    // el foco de los inputs del wizard despues de cerrar).
    const result = await window.bridgeDesktop.onboarding.reset();
    if (result?.cancelled) return;
    if (!result?.ok) return;
    pendingSession = null;
    cachedBaseUrl = '';
    const onboardingState = await window.bridgeDesktop.onboarding.status();
    showOnboardingLogin(onboardingState.defaultBaseUrl);
    await window.bridgeDesktop.requestWindowFocus();
    setTimeout(() => {
        const emailInput = document.getElementById('login-email');
        if (emailInput) emailInput.focus();
    }, 50);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
window.bridgeDesktop.onStatus(renderStatus);
window.bridgeDesktop.onUpdateEvent((payload) => {
    setUpdatePill(payload?.status, payload?.message);
});

(async () => {
    const onboardingState = await window.bridgeDesktop.onboarding.status();
    if (onboardingState?.onboarded) {
        await showStatusView(onboardingState.installation);
        window.bridgeDesktop.getStatus().then(renderStatus);
    } else {
        cachedBaseUrl = onboardingState?.defaultBaseUrl || '';
        showOnboardingLogin(cachedBaseUrl);
    }
})();
