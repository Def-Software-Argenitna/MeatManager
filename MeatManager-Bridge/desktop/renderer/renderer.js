const processNodeEl = document.getElementById('bridge-process');
const bridgeHttpEl = document.getElementById('bridge-http');
const lastRunAtEl = document.getElementById('last-run-at');
const lastErrorEl = document.getElementById('last-error');
const devicesSummaryEl = document.getElementById('devices-summary');
const eventEl = document.getElementById('event');
const updatePillEl = document.getElementById('update-pill');

const statusCard = document.getElementById('status-card');
const actionsCard = document.getElementById('actions-card');
const onboardingCard = document.getElementById('onboarding-card');

const btnRestart = document.getElementById('btn-restart');
const btnCheckUpdates = document.getElementById('btn-check-updates');
const btnInstallUpdate = document.getElementById('btn-install-update');
const btnOpenLogs = document.getElementById('btn-open-logs');

const obIdentifier = document.getElementById('ob-identifier');
const obPassword = document.getElementById('ob-password');
const obLogin = document.getElementById('ob-login');
const obFeedbackEl = document.getElementById('ob-feedback');
const obAfterLogin = document.getElementById('ob-after-login');
const obClient = document.getElementById('ob-client');
const obBranch = document.getElementById('ob-branch');
const obModel = document.getElementById('ob-model');
const obDetectPorts = document.getElementById('ob-detect-ports');
const obAddScale = document.getElementById('ob-add-scale');
const obDevices = document.getElementById('ob-devices');
const obSave = document.getElementById('ob-save');

let onboardingRequired = false;
let onboardingToken = '';
let onboardingAdmin = null;
let onboardingClients = [];
let onboardingBranches = [];
let onboardingPorts = [];
let onboardingDevices = [];
let supportedModels = ['Systel Cuora Max'];
let onboardingBusy = false;

function setOnboardingFeedback(message, tone = 'info') {
    if (!obFeedbackEl) return;
    obFeedbackEl.textContent = message || '';
    if (tone === 'ok') {
        obFeedbackEl.style.color = '#22c55e';
        return;
    }
    if (tone === 'error') {
        obFeedbackEl.style.color = '#ef4444';
        return;
    }
    obFeedbackEl.style.color = '#9fb0d1';
}

function setUpdatePill(status, message) {
    if (status === 'available' || status === 'downloaded') {
        updatePillEl.innerHTML = '<span class="dot warn"></span><span>Actualizacion disponible</span>';
    } else if (status === 'error') {
        updatePillEl.innerHTML = '<span class="dot bad"></span><span>Error de actualizacion</span>';
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

function setOnboardingMode(enabled) {
    onboardingRequired = enabled;
    onboardingCard.classList.toggle('hidden', !enabled);
    actionsCard.classList.toggle('hidden', enabled);
    if (!enabled) {
        setOnboardingFeedback('');
    }
}

function renderStatus(status) {
    const procRunning = status?.bridgeProcess?.running === true;
    const runningCount = Number(status?.bridgeProcess?.runningCount || 0);
    const total = Number(status?.bridgeProcess?.total || 0);

    if (procRunning && total > 1) {
        processNodeEl.textContent = `Activo (${runningCount}/${total} balanzas)`;
    } else {
        const procPid = status?.bridgeProcess?.pid ? ` (PID ${status.bridgeProcess.pid})` : '';
        processNodeEl.textContent = procRunning ? `Activo${procPid}` : 'Detenido';
    }

    const apiReachable = status?.bridgeHttp?.reachable === true;
    bridgeHttpEl.textContent = apiReachable ? 'Conectada' : 'Sin conexion';
    bridgeHttpEl.style.color = apiReachable ? '#22c55e' : '#ef4444';

    lastRunAtEl.textContent = formatDate(status?.bridgeHttp?.lastRunAt || status?.updatedAt);
    lastErrorEl.textContent = status?.bridgeHttp?.lastError || status?.bridgeHttp?.lastRunStatus || 'Sin errores';

    const devices = Array.isArray(status?.devices) ? status.devices : [];
    devicesSummaryEl.textContent = devices.length
        ? devices.map((d) => `${d.name} (${d.port}) ${d.reachable ? 'OK' : 'Sin respuesta'}`).join(' | ')
        : '';

    setOnboardingMode(status?.onboardingRequired === true);
}

function clearSelect(selectEl, placeholder) {
    selectEl.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    selectEl.appendChild(opt);
}

function fillClientSelect(clients) {
    clearSelect(obClient, 'Seleccionar cliente...');
    clients.forEach((client) => {
        const opt = document.createElement('option');
        opt.value = String(client.id);
        opt.textContent = client.businessName || `Cliente ${client.id}`;
        obClient.appendChild(opt);
    });
}

function fillBranchSelect(branches) {
    clearSelect(obBranch, 'Seleccionar sucursal...');
    branches.forEach((branch) => {
        const opt = document.createElement('option');
        opt.value = String(branch.id);
        opt.textContent = branch.name || `Sucursal ${branch.id}`;
        obBranch.appendChild(opt);
    });
}

function fillModelSelect(models) {
    clearSelect(obModel, 'Seleccionar modelo...');
    models.forEach((model) => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        obModel.appendChild(opt);
    });
    if (models.length) obModel.value = models[0];
}

function portsOptionsHtml(selected) {
    const options = ['<option value="">Seleccionar puerto...</option>'];
    onboardingPorts.forEach((port) => {
        const value = String(port.path || '').trim();
        if (!value) return;
        options.push(`<option value="${value}" ${selected === value ? 'selected' : ''}>${value}</option>`);
    });
    return options.join('');
}

function renderOnboardingDevices() {
    obDevices.innerHTML = '';
    onboardingDevices.forEach((device, index) => {
        const row = document.createElement('div');
        row.className = 'device-row';
        row.innerHTML = `
            <div class="device-head">
              <strong>Balanza ${index + 1}</strong>
              <button data-remove="${index}" class="danger">Quitar</button>
            </div>
            <div class="device-grid">
              <div class="field"><label>Nombre</label><input data-field="name" data-index="${index}" value="${device.name}" /></div>
              <div class="field"><label>Modelo</label><input data-field="model" data-index="${index}" value="${device.model}" readonly /></div>
              <div class="field"><label>Puerto COM</label><select data-field="port" data-index="${index}">${portsOptionsHtml(device.port)}</select></div>
              <div class="field"><label>Direccion balanza</label><input data-field="address" data-index="${index}" value="${device.address}" /></div>
            </div>
        `;
        obDevices.appendChild(row);
    });

    obDevices.querySelectorAll('button[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-remove'));
            onboardingDevices = onboardingDevices.filter((_, i) => i !== idx);
            renderOnboardingDevices();
        });
    });

    obDevices.querySelectorAll('[data-field]').forEach((input) => {
        input.addEventListener('change', () => {
            const idx = Number(input.getAttribute('data-index'));
            const field = input.getAttribute('data-field');
            if (!onboardingDevices[idx]) return;
            onboardingDevices[idx][field] = String(input.value || '').trim();
        });
    });
}

async function detectPorts() {
    const result = await window.bridgeDesktop.onboardingPorts();
    if (!result?.ok) {
        setOnboardingFeedback(result?.error || 'No se pudieron leer puertos', 'error');
        return;
    }
    onboardingPorts = Array.isArray(result.ports) ? result.ports : [];
    renderOnboardingDevices();
    setOnboardingFeedback(onboardingPorts.length
        ? `Puertos detectados: ${onboardingPorts.map((p) => p.path).join(', ')}`
        : 'No se detectaron puertos COM.');
}

async function loadOnboardingInitialState() {
    const payload = await window.bridgeDesktop.getOnboarding();
    supportedModels = Array.isArray(payload?.supportedModels) && payload.supportedModels.length
        ? payload.supportedModels
        : ['Systel Cuora Max'];
    fillModelSelect(supportedModels);
    if (!payload?.defaultApiBaseUrl) {
        setOnboardingFeedback('No se detecto URL API del sistema. Contacta soporte.', 'error');
    }

    if (payload?.required) {
        setOnboardingMode(true);
        obAfterLogin.classList.add('hidden');
        await detectPorts();
    }
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
    eventEl.textContent = 'Aplicando actualizacion y reiniciando...';
    await window.bridgeDesktop.installUpdateNow();
});

btnOpenLogs.addEventListener('click', async () => {
    await window.bridgeDesktop.openLogDir();
});

obLogin.addEventListener('click', async () => {
    if (onboardingBusy) return;
    onboardingBusy = true;
    obLogin.disabled = true;
    setOnboardingFeedback('Validando credenciales de admin...');
    const payload = {
        identifier: obIdentifier.value,
        password: obPassword.value,
    };
    try {
        const login = await window.bridgeDesktop.onboardingLogin(payload);
        if (!login?.ok) {
            setOnboardingFeedback(login?.error || 'No se pudo iniciar sesion', 'error');
            return;
        }
        onboardingToken = login.token;
        onboardingAdmin = login.admin || null;

        const clients = await window.bridgeDesktop.onboardingClients({
            token: onboardingToken,
        });
        if (!clients?.ok) {
            setOnboardingFeedback(clients?.error || 'No se pudieron leer clientes', 'error');
            return;
        }

        onboardingClients = Array.isArray(clients.clients) ? clients.clients : [];
        fillClientSelect(onboardingClients);
        obAfterLogin.classList.remove('hidden');
        setOnboardingFeedback(`Sesion iniciada como ${login?.admin?.email || 'admin'}.`, 'ok');
    } catch (error) {
        setOnboardingFeedback(error?.message || 'No se pudo iniciar sesion', 'error');
    } finally {
        onboardingBusy = false;
        obLogin.disabled = false;
    }
});

obClient.addEventListener('change', async () => {
    const clientId = Number(obClient.value || 0);
    if (!clientId) {
        fillBranchSelect([]);
        return;
    }

    const branches = await window.bridgeDesktop.onboardingBranches({
        token: onboardingToken,
        clientId,
    });
    if (!branches?.ok) {
        setOnboardingFeedback(branches?.error || 'No se pudieron leer sucursales', 'error');
        fillBranchSelect([]);
        return;
    }
    onboardingBranches = Array.isArray(branches.branches) ? branches.branches : [];
    fillBranchSelect(onboardingBranches);
    setOnboardingFeedback(`Sucursales cargadas: ${onboardingBranches.length}.`);
});

obDetectPorts.addEventListener('click', detectPorts);

obAddScale.addEventListener('click', () => {
    onboardingDevices.push({
        id: `scale-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: `Balanza ${onboardingDevices.length + 1}`,
        model: obModel.value || supportedModels[0] || 'Systel Cuora Max',
        port: onboardingPorts[onboardingDevices.length]?.path || '',
        address: '20',
        baudRate: '115200',
        enabled: true,
    });
    renderOnboardingDevices();
});

obSave.addEventListener('click', async () => {
    const clientId = Number(obClient.value || 0);
    const branchId = Number(obBranch.value || 0);
    if (!clientId || !branchId) {
        setOnboardingFeedback('Selecciona cliente y sucursal.', 'error');
        return;
    }
    if (!onboardingDevices.length) {
        setOnboardingFeedback('Agrega al menos una balanza.', 'error');
        return;
    }
    const invalidPort = onboardingDevices.find((device) => !String(device.port || '').trim());
    if (invalidPort) {
        setOnboardingFeedback(`Falta puerto COM en ${invalidPort.name}.`, 'error');
        return;
    }

    const uniquePorts = new Set(onboardingDevices.map((device) => device.port));
    if (uniquePorts.size !== onboardingDevices.length) {
        setOnboardingFeedback('No se puede repetir el mismo puerto COM en dos balanzas.', 'error');
        return;
    }

    const client = onboardingClients.find((row) => Number(row.id) === clientId);
    const branch = onboardingBranches.find((row) => Number(row.id) === branchId);

    const save = await window.bridgeDesktop.onboardingSave({
        auth: {
            adminEmail: onboardingAdmin?.email || '',
            adminName: [onboardingAdmin?.name, onboardingAdmin?.lastname].filter(Boolean).join(' ').trim(),
        },
        client: { id: clientId, name: client?.businessName || `Cliente ${clientId}` },
        branch: { id: branchId, name: branch?.name || `Sucursal ${branchId}` },
        devices: onboardingDevices.map((device, index) => ({
            id: device.id || `scale-${index + 1}`,
            name: device.name || `Balanza ${index + 1}`,
            model: device.model || 'Systel Cuora Max',
            port: device.port,
            address: device.address || '20',
            baudRate: device.baudRate || '115200',
            enabled: true,
        })),
    });

    if (!save?.ok) {
        setOnboardingFeedback(save?.error || 'No se pudo guardar configuracion', 'error');
        return;
    }

    setOnboardingFeedback('Vinculacion guardada. Iniciando sincronizacion...', 'ok');
    eventEl.textContent = 'Vinculacion guardada. Iniciando sincronizacion...';
    setOnboardingMode(false);
});

window.bridgeDesktop.onStatus(renderStatus);
window.bridgeDesktop.onUpdateEvent((payload) => {
    setUpdatePill(payload?.status, payload?.message);
});

window.bridgeDesktop.getStatus().then(renderStatus);
loadOnboardingInitialState();
