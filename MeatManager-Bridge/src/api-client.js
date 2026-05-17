// HTTP client del bridge contra la API central.
// Reemplaza el acceso directo a MySQL (mysql.js, client-directory.js).

class ApiError extends Error {
    constructor(message, { status, body, code, retryable } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status ?? null;
        this.body = body ?? null;
        this.code = code ?? null;
        this.retryable = Boolean(retryable);
    }
}

function isRetryableStatus(status) {
    if (!Number.isFinite(status)) return true;
    if (status >= 500 && status < 600) return true;
    if (status === 408 || status === 429) return true;
    return false;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiClient {
    constructor({ baseUrl, deviceToken = null, logger = null, defaultTimeoutMs = 30000, maxAttempts = 3, retryBaseMs = 400 } = {}) {
        if (!baseUrl) throw new Error('ApiClient requiere baseUrl');
        this.baseUrl = String(baseUrl).replace(/\/+$/, '');
        this.deviceToken = deviceToken || null;
        this.logger = logger || null;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.retryBaseMs = Math.max(50, retryBaseMs);
    }

    setDeviceToken(token) {
        this.deviceToken = token || null;
    }

    buildHeaders({ json = true, authRequired = true, sessionToken = null } = {}) {
        const headers = {};
        if (json) headers['Content-Type'] = 'application/json';
        if (sessionToken) {
            // sessionToken se manda en body (onboarding), no en header.
        }
        if (authRequired) {
            if (!this.deviceToken) {
                const error = new Error('ApiClient: deviceToken requerido para esta llamada');
                error.code = 'NO_DEVICE_TOKEN';
                throw error;
            }
            headers.Authorization = `Bearer ${this.deviceToken}`;
        }
        return headers;
    }

    async request({ method, path, query = null, body = null, authRequired = true, timeoutMs = null, attempt = 0 }) {
        const fullPath = path.startsWith('/') ? path : `/${path}`;
        let url = `${this.baseUrl}${fullPath}`;
        if (query && typeof query === 'object') {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
                if (value == null) continue;
                if (Array.isArray(value)) {
                    if (value.length === 0) continue;
                    params.set(key, value.join(','));
                } else {
                    params.set(key, String(value));
                }
            }
            const qs = params.toString();
            if (qs) url += `?${qs}`;
        }

        const headers = this.buildHeaders({ json: body != null, authRequired });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || this.defaultTimeoutMs)));

        let response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body: body != null ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        } catch (networkError) {
            clearTimeout(timeout);
            const retryable = networkError?.name === 'AbortError' || /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND/i.test(String(networkError?.message || networkError));
            if (retryable && attempt + 1 < this.maxAttempts) {
                const delay = this.retryBaseMs * (2 ** attempt);
                this.logger?.warn?.('api-client retry red', { url, attempt: attempt + 1, delay, error: networkError?.message });
                await sleep(delay);
                return this.request({ method, path, query, body, authRequired, timeoutMs, attempt: attempt + 1 });
            }
            throw new ApiError(`Falla de red al llamar ${method} ${path}`, { retryable, code: networkError?.code || null });
        } finally {
            clearTimeout(timeout);
        }

        let parsed = null;
        const text = await response.text();
        if (text) {
            try { parsed = JSON.parse(text); } catch { parsed = text; }
        }

        if (!response.ok) {
            const retryable = isRetryableStatus(response.status);
            const message = parsed?.error || `HTTP ${response.status} ${method} ${path}`;
            if (retryable && attempt + 1 < this.maxAttempts) {
                const delay = this.retryBaseMs * (2 ** attempt);
                this.logger?.warn?.('api-client retry status', { url, status: response.status, attempt: attempt + 1, delay });
                await sleep(delay);
                return this.request({ method, path, query, body, authRequired, timeoutMs, attempt: attempt + 1 });
            }
            throw new ApiError(message, { status: response.status, body: parsed, retryable });
        }

        return parsed;
    }

    // ── Onboarding (sin deviceToken) ───────────────────────────────────────
    login(email, password) {
        return this.request({
            method: 'POST',
            path: '/api/bridge/auth/login',
            body: { email, password },
            authRequired: false,
        });
    }

    completeOnboarding({ sessionToken, branchId, hostname }) {
        return this.request({
            method: 'POST',
            path: '/api/bridge/onboarding/complete',
            body: { sessionToken, branchId, hostname },
            authRequired: false,
        });
    }

    // ── Runtime (con deviceToken) ──────────────────────────────────────────
    getSettings() {
        return this.request({ method: 'GET', path: '/api/bridge/settings' });
    }

    getVendors() {
        return this.request({ method: 'GET', path: '/api/bridge/vendors' });
    }

    getCatalog() {
        return this.request({ method: 'GET', path: '/api/bridge/catalog' });
    }

    getCatalogRemoved(scaleId) {
        return this.request({ method: 'GET', path: '/api/bridge/catalog/removed', query: { scaleId } });
    }

    getObservedPlus(scaleId) {
        return this.request({ method: 'GET', path: '/api/bridge/catalog/observed-plu', query: { scaleId } });
    }

    getSyncState(scaleId, productIds = null) {
        const query = { scaleId };
        if (Array.isArray(productIds) && productIds.length > 0) {
            query.productIds = productIds.join(',');
        }
        return this.request({ method: 'GET', path: '/api/bridge/sync-state/product-map', query });
    }

    putSyncState(scaleId, entries) {
        return this.request({
            method: 'PUT',
            path: '/api/bridge/sync-state/product-map',
            body: { scaleId, entries },
        });
    }

    deleteSyncState(scaleId, { productIds = null, pluCodes = null, resetAll = false } = {}) {
        return this.request({
            method: 'DELETE',
            path: '/api/bridge/sync-state/product-map',
            body: { scaleId, productIds, pluCodes, resetAll },
        });
    }

    postSales({ scaleId, scaleAddress, tickets }) {
        return this.request({
            method: 'POST',
            path: '/api/bridge/sales',
            body: { scaleId, scaleAddress, tickets },
            timeoutMs: 60000,
        });
    }

    postHeartbeat({ scales = [] } = {}) {
        return this.request({
            method: 'POST',
            path: '/api/bridge/heartbeat',
            body: { scales },
        });
    }
}

module.exports = { ApiClient, ApiError };
