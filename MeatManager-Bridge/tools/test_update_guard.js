const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../desktop/update-guard');

function tmpDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-guard-'));
    return d;
}

test('primer arranque adopta la version actual como buena conocida', () => {
    const d = tmpDir();
    const r = guard.onBoot(d, '0.4.19');
    assert.equal(r.action, 'normal');
    assert.equal(guard.readGuardState(d).knownGoodVersion, '0.4.19');
});

test('sin pending, arranque normal', () => {
    const d = tmpDir();
    guard.onBoot(d, '0.4.19'); // setea known-good
    const r = guard.onBoot(d, '0.4.19');
    assert.equal(r.action, 'normal');
    assert.equal(r.reason, 'no-pending');
});

test('update aplicado: la version nueva entra en probacion', () => {
    const d = tmpDir();
    guard.onBoot(d, '0.4.19');           // known-good = 0.4.19
    guard.markPending(d, '0.4.20');      // se aplico update a 0.4.20
    const r = guard.onBoot(d, '0.4.20'); // arrancamos en 0.4.20
    assert.equal(r.action, 'probation');
    assert.equal(guard.readGuardState(d).pending.bootCount, 1);
});

test('promote tras probacion sana: known-good pasa a la nueva, sin pending', () => {
    const d = tmpDir();
    guard.onBoot(d, '0.4.19');
    guard.markPending(d, '0.4.20');
    guard.onBoot(d, '0.4.20');
    guard.promote(d, '0.4.20');
    const s = guard.readGuardState(d);
    assert.equal(s.knownGoodVersion, '0.4.20');
    assert.equal(s.pending, undefined);
});

test('la version nueva reinicia en loop: tras MAX_BOOT_COUNT dispara rollback', () => {
    const d = tmpDir();
    guard.onBoot(d, '0.4.19');
    guard.markPending(d, '0.4.20');
    let r;
    for (let i = 0; i < guard.MAX_BOOT_COUNT; i += 1) {
        r = guard.onBoot(d, '0.4.20');
        assert.equal(r.action, 'probation');
    }
    // El arranque que supera MAX_BOOT_COUNT pide rollback
    r = guard.onBoot(d, '0.4.20');
    assert.equal(r.action, 'rollback');
});

test('arrancar en la known-good con pending = update no aplicado/rollback hecho: limpia pending', () => {
    const d = tmpDir();
    guard.onBoot(d, '0.4.19');
    guard.markPending(d, '0.4.20');
    const r = guard.onBoot(d, '0.4.19'); // seguimos en la vieja
    assert.equal(r.action, 'normal');
    assert.equal(guard.readGuardState(d).pending, undefined);
});

test('installerUrl arma la URL del Setup oneClick por tag', () => {
    assert.equal(
        guard.installerUrl('Def-Software-Argenitna', 'MeatManager', '0.4.19'),
        'https://github.com/Def-Software-Argenitna/MeatManager/releases/download/bridge-v0.4.19/MeatManager-Bridge-0.4.19-Setup.exe'
    );
});
