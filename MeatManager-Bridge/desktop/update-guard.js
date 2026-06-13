// Guarda de actualizaciones con rollback automatico.
//
// Objetivo: el bridge SIEMPRE debe quedar corriendo en una version sana. Si un
// auto-update entrega una version que no se sostiene (crashea, reinicia en
// loop, o no alcanza salud), volvemos sola a la ultima version buena conocida y
// nos quedamos ahi hasta revision manual (queda registrado en el log).
//
// Maquina de estados persistida en updater-guard.json:
//   { knownGoodVersion, pending: { version, startedAt, bootCount } | null,
//     lastRollback: { from, to, at, reason } | null }
//
// - knownGoodVersion: ultima version que demostro estar sana.
// - pending: hay un update aplicado en probacion (todavia no promovido).
//
// La DECISION de arranque (onBoot) es pura sobre el estado en disco y por eso
// es testeable sin Electron. La descarga/instalacion del rollback vive aparte.

const fs = require('fs');
const path = require('path');

const PROBATION_MS = 5 * 60 * 1000;   // ventana para confirmar que la version nueva esta sana
const MAX_BOOT_COUNT = 3;             // si la version nueva arranco mas de esto sin promover, reinicia demasiado -> rollback
const MIN_HEALTHY_SAMPLES = 8;        // muestras de /health OK seguidas (~32s a 4s/poll) para considerarla sana

function guardStatePath(dataDir) {
    return path.join(dataDir, 'updater-guard.json');
}

function readGuardState(dataDir) {
    try {
        let raw = fs.readFileSync(guardStatePath(dataDir), 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
}

function writeGuardState(dataDir, state) {
    const file = guardStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    return state;
}

// Se llama justo antes de aplicar un update (quitAndInstall). Marca la version
// entrante como "en probacion". knownGoodVersion ya debe estar seteado con la
// version actual (estable) por ensureKnownGood en el arranque previo.
function markPending(dataDir, version) {
    const state = readGuardState(dataDir);
    state.pending = { version: String(version || ''), startedAt: new Date().toISOString(), bootCount: 0 };
    return writeGuardState(dataDir, state);
}

// Decision de arranque. Devuelve { action, state, reason }.
//   action: 'normal'    -> nada que hacer, operar normal
//           'probation' -> estamos corriendo una version en probacion; verificar salud
//           'rollback'  -> la version pending no es viable; volver a knownGoodVersion
function onBoot(dataDir, currentVersion) {
    const state = readGuardState(dataDir);
    const cur = String(currentVersion || '');

    // Primera vez: adoptamos la version actual como buena conocida.
    if (!state.knownGoodVersion) {
        state.knownGoodVersion = cur;
        writeGuardState(dataDir, state);
        return { action: 'normal', state, reason: 'init-known-good' };
    }

    if (!state.pending) {
        return { action: 'normal', state, reason: 'no-pending' };
    }

    // Estamos corriendo la version que esta en probacion.
    if (cur === state.pending.version) {
        state.pending.bootCount = Number(state.pending.bootCount || 0) + 1;
        writeGuardState(dataDir, state);
        if (state.pending.bootCount > MAX_BOOT_COUNT) {
            return { action: 'rollback', state, reason: `reinicia-demasiado (bootCount=${state.pending.bootCount})` };
        }
        return { action: 'probation', state, reason: `boot ${state.pending.bootCount}/${MAX_BOOT_COUNT}` };
    }

    // Estamos en la version buena conocida: el update no se aplico, o ya hubo
    // rollback. Limpiamos el pending y seguimos normal.
    if (cur === state.knownGoodVersion) {
        delete state.pending;
        writeGuardState(dataDir, state);
        return { action: 'normal', state, reason: 'corriendo-known-good' };
    }

    // Version inesperada (ni pending ni known-good): la adoptamos como nueva
    // buena conocida y limpiamos. Evita quedar pegado en un estado raro.
    state.knownGoodVersion = cur;
    delete state.pending;
    writeGuardState(dataDir, state);
    return { action: 'normal', state, reason: 'version-inesperada-adoptada' };
}

// La version en probacion demostro salud: la promovemos a buena conocida.
function promote(dataDir, version) {
    const state = readGuardState(dataDir);
    state.knownGoodVersion = String(version || state.knownGoodVersion || '');
    delete state.pending;
    return writeGuardState(dataDir, state);
}

function recordRollback(dataDir, { from, to, reason }) {
    const state = readGuardState(dataDir);
    state.lastRollback = { from, to, at: new Date().toISOString(), reason };
    // No limpiamos pending aca: lo limpia onBoot cuando arranque la version
    // restaurada (cur === knownGoodVersion). Asi, si el rollback falla a mitad,
    // el pending sigue y se reintenta.
    return writeGuardState(dataDir, state);
}

// URL del instalador oneClick de una version publicada en GitHub Releases.
function installerUrl(owner, repo, version) {
    return `https://github.com/${owner}/${repo}/releases/download/bridge-v${version}/MeatManager-Bridge-${version}-Setup.exe`;
}

module.exports = {
    PROBATION_MS,
    MAX_BOOT_COUNT,
    MIN_HEALTHY_SAMPLES,
    guardStatePath,
    readGuardState,
    writeGuardState,
    markPending,
    onBoot,
    promote,
    recordRollback,
    installerUrl,
};
