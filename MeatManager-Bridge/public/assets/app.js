async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'request_failed');
    }
    return data;
}

function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
}

function setStatusCard(snapshot) {
    const status = document.getElementById('bridge-status');
    const summary = document.getElementById('bridge-summary');
    if (!status || !summary) return;

    status.className = 'status-pill';
    if (snapshot.lastRunStatus === 'ok') status.classList.add('good');
    if (snapshot.lastRunStatus === 'error') status.classList.add('bad');

    status.textContent = snapshot.running
        ? 'Sincronizando'
        : (snapshot.lastRunStatus || 'idle').toUpperCase();
    summary.textContent = [
        snapshot.bridgeName || snapshot.deviceId,
        snapshot.lastRunAt ? `Ultima ejecucion: ${new Date(snapshot.lastRunAt).toLocaleString()}` : 'Todavia sin ejecuciones',
        snapshot.lastError ? `Error: ${snapshot.lastError}` : 'Sin errores registrados',
    ].join(' | ');
}

function populateForm(values) {
    const form = document.getElementById('config-form');
    if (!form) return;
    Object.entries(values || {}).forEach(([key, value]) => {
        const field = form.elements.namedItem(key);
        if (field) field.value = value ?? '';
    });
}

function getFormPayload() {
    const form = document.getElementById('config-form');
    const formData = new FormData(form);
    const payload = {};
    for (const [key, value] of formData.entries()) {
        payload[key] = value;
    }
    return payload;
}

async function loadDashboard() {
    const [health, config, logs] = await Promise.all([
        fetchJson('/health'),
        fetchJson('/api/config'),
        fetchJson('/api/logs'),
    ]);

    setStatusCard(health);
    populateForm(config.values);
    setText('save-result', config.requiresRestartNote || '');
    setText('log-output', (logs.lines || []).join('\n') || 'Sin logs todavia.');
}

async function runDiagnostics(endpoint) {
    setText('diag-output', 'Ejecutando prueba...');
    try {
        const result = await fetchJson(endpoint, { method: 'POST' });
        setText('diag-output', JSON.stringify(result, null, 2));
    } catch (error) {
        setText('diag-output', `Error: ${error.message}`);
    }
}

async function saveConfig(event) {
    event.preventDefault();
    setText('save-result', 'Guardando...');
    try {
        const result = await fetchJson('/api/config', {
            method: 'POST',
            body: JSON.stringify(getFormPayload()),
        });
        setText('save-result', result.message || 'Configuracion guardada.');
    } catch (error) {
        setText('save-result', `Error: ${error.message}`);
    }
}

async function runSync() {
    setText('diag-output', 'Lanzando sincronizacion manual...');
    try {
        const result = await fetchJson('/api/run', { method: 'POST' });
        setText('diag-output', JSON.stringify(result, null, 2));
        await loadDashboard();
    } catch (error) {
        setText('diag-output', `Error: ${error.message}`);
    }
}

document.getElementById('config-form')?.addEventListener('submit', saveConfig);
document.getElementById('test-firebird')?.addEventListener('click', () => runDiagnostics('/api/test/firebird'));
document.getElementById('test-mysql')?.addEventListener('click', () => runDiagnostics('/api/test/mysql'));
document.getElementById('run-sync')?.addEventListener('click', runSync);
document.getElementById('refresh-all')?.addEventListener('click', loadDashboard);
document.getElementById('refresh-logs')?.addEventListener('click', async () => {
    try {
        const logs = await fetchJson('/api/logs');
        setText('log-output', (logs.lines || []).join('\n') || 'Sin logs todavia.');
    } catch (error) {
        setText('log-output', `Error: ${error.message}`);
    }
});

loadDashboard().catch((error) => {
    setText('diag-output', `No se pudo cargar el panel: ${error.message}`);
});
