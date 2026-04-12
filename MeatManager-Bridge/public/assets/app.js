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
        snapshot.clientId ? `Cliente #${snapshot.clientId}` : 'Sin cliente',
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

function fillSelect(node, rows, { valueKey = 'id', labelBuilder, placeholder }) {
    if (!node) return;
    const options = [];
    if (placeholder) {
        options.push(`<option value="">${placeholder}</option>`);
    }
    for (const row of rows || []) {
        const value = row?.[valueKey] ?? '';
        const label = labelBuilder(row);
        options.push(`<option value="${String(value)}">${label}</option>`);
    }
    node.innerHTML = options.join('');
}

async function loadClients(selectedClientId) {
    const payload = await fetchJson('/api/clients');
    const select = document.getElementById('client-select');
    fillSelect(select, payload.clients || [], {
        valueKey: 'id',
        placeholder: 'Selecciona un cliente',
        labelBuilder: (row) => `${row.businessName} (#${row.id})`,
    });
    if (select && selectedClientId) {
        select.value = String(selectedClientId);
    }
}

async function loadBranches(clientId, selectedBranchId) {
    const select = document.getElementById('branch-select');
    if (!clientId) {
        fillSelect(select, [], {
            placeholder: 'Selecciona primero un cliente',
            labelBuilder: (row) => row.name,
        });
        return;
    }

    const payload = await fetchJson(`/api/branches?clientId=${encodeURIComponent(clientId)}`);
    fillSelect(select, payload.branches || [], {
        valueKey: 'id',
        placeholder: 'Sin sucursal / seleccionar luego',
        labelBuilder: (row) => `${row.name} (#${row.id})`,
    });
    if (select && selectedBranchId) {
        select.value = String(selectedBranchId);
    }
}

async function loadSelection() {
    const payload = await fetchJson('/api/selection');
    await loadClients(payload.selectedClientId);
    await loadBranches(payload.selectedClientId, payload.selectedBranchId);

    const lines = [];
    if (payload.selectedClient) {
        lines.push(`Cliente: ${payload.selectedClient.businessName} (#${payload.selectedClient.id})`);
        lines.push(`CUIT: ${payload.selectedClient.taxId || 'sin dato'}`);
        lines.push(`Estado: ${payload.selectedClient.status || 'sin dato'}`);
    } else {
        lines.push('Cliente: no seleccionado o no encontrado en GestionClientes');
    }

    if (payload.selectedBranch) {
        lines.push(`Sucursal: ${payload.selectedBranch.name} (#${payload.selectedBranch.id})`);
    } else {
        lines.push('Sucursal: sin sucursal activa seleccionada');
    }

    lines.push(`Tenant operativo: ${payload.tenantId || 'sin dato'}`);
    lines.push(`Branch operativo: ${payload.branchId || 'sin dato'}`);

    setText('selection-output', lines.join('\n'));
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
    await loadSelection();
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
    if (event) event.preventDefault();
    setText('save-result', 'Guardando...');
    try {
        const result = await fetchJson('/api/config', {
            method: 'POST',
            body: JSON.stringify(getFormPayload()),
        });
        setText('save-result', result.message || 'Configuracion guardada.');
        await loadDashboard();
    } catch (error) {
        setText('save-result', `Error: ${error.message}`);
    }
}

async function applyClientSelection() {
    const clientSelect = document.getElementById('client-select');
    const branchSelect = document.getElementById('branch-select');
    const form = document.getElementById('config-form');
    if (!clientSelect || !branchSelect || !form) return;

    form.elements.namedItem('BRIDGE_CLIENT_ID').value = clientSelect.value || '';
    form.elements.namedItem('MYSQL_TENANT_ID').value = clientSelect.value || '';
    form.elements.namedItem('BRIDGE_BRANCH_ID').value = branchSelect.value || '';
    form.elements.namedItem('MYSQL_BRANCH_ID').value = branchSelect.value || '';
    await saveConfig();
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
document.getElementById('test-clients-db')?.addEventListener('click', () => runDiagnostics('/api/test/clients-db'));
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

document.getElementById('client-select')?.addEventListener('change', async (event) => {
    const clientId = event.target.value;
    await loadBranches(clientId, '');
    await applyClientSelection();
});

document.getElementById('branch-select')?.addEventListener('change', applyClientSelection);

loadDashboard().catch((error) => {
    setText('diag-output', `No se pudo cargar el panel: ${error.message}`);
});
