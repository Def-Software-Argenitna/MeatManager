const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { ScaleBridge } = require('../src/scale-bridge');

function makeBridge() {
    return new ScaleBridge({
        config: {
            scaleId: '1', deviceId: 'test', branchId: 1, tenantId: 1,
            logsDir: path.join(os.tmpdir(), 'mm-bridge-test-logs'),
            scale: { address: 20, barcodeConfig: {} },
        },
        logger: { info() {}, warn() {}, error() {} },
        state: {},
        stateStore: { save() {} },
        apiClient: {},
    });
}

test('getRecentSaturationCount cuenta eventos E3 y purga los viejos', () => {
    const bridge = makeBridge();
    assert.equal(bridge.getRecentSaturationCount(), 0);
    bridge.recordSaturationEvent();
    bridge.recordSaturationEvent();
    assert.equal(bridge.getRecentSaturationCount(), 2);
    // Inyecta un evento viejo (10 min atras) y verifica que se purga en ventana de 5 min
    bridge._saturationEvents.push(Date.now() - 10 * 60 * 1000);
    assert.equal(bridge.getRecentSaturationCount(5 * 60 * 1000), 2);
    // El viejo quedo descartado del array tras la purga
    assert.equal(bridge._saturationEvents.length, 2);
});

test('getRecentSaturationCount con ventana amplia incluye eventos viejos', () => {
    const bridge = makeBridge();
    bridge._saturationEvents.push(Date.now() - 10 * 60 * 1000);
    bridge.recordSaturationEvent();
    assert.equal(bridge.getRecentSaturationCount(30 * 60 * 1000), 2);
});
