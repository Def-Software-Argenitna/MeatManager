const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { ScaleBridge } = require('../src/scale-bridge');

// Registro fn72: ticketId^DD/MM/YY^HH:MM:SS^vendedor^plu^sector^unidades^gramos^escurrido^importeX100
const REC_T1 = '000000001^09/06/26^10:00:00^01^0005^02^0000^00500^00000^000001102500';
const REC_T2 = '000000002^09/06/26^10:05:00^01^0006^02^0000^01000^00000^000002000000';
const TRUNCATED = '06/26^10:05:00^01^0006^02'; // registro partido (tokens < 10)

function makeBridge({ sendQueue, state = {} }) {
    const calls = [];
    const posts = [];
    const saves = [];
    const bridge = new ScaleBridge({
        config: {
            scaleId: '1',
            deviceId: 'test-device',
            branchId: 1,
            tenantId: 1,
            logsDir: path.join(os.tmpdir(), 'mm-bridge-test-logs'),
            scale: {
                address: 20,
                legacyPriceMultiplier: 100,
                barcodeConfig: { saleTotalFormat: '222000IIIIII' },
            },
        },
        logger: { info() {}, warn() {}, error() {} },
        state,
        stateStore: { save: (s) => saves.push(JSON.parse(JSON.stringify(s))) },
        apiClient: {
            getVendors: async () => ({ vendors: [] }),
            postSales: async (payload) => {
                posts.push(payload);
                return { itemsUpserted: payload.tickets.length };
            },
        },
    });
    bridge.scale = {
        send: async (fn, payload, options = {}) => {
            calls.push({ fn, payload, options });
            const next = sendQueue.shift();
            if (!next) throw new Error('test: sendQueue agotada');
            return { fn, crc: { ok: true }, data: next };
        },
        close: async () => {},
    };
    bridge.logTicketLatency = () => {};
    return { bridge, calls, posts, saves };
}

const range = { fromDate: new Date('2026-06-09T10:00:00'), toDate: new Date('2026-06-09T23:00:00') };

test('pulso con E7 y fallback reciente: una sola lectura serial', async () => {
    const { bridge, calls } = makeBridge({ sendQueue: ['E7'] });
    bridge._lastFn72FallbackAt = Date.now();
    const result = await bridge.pullSales({ ...range, pulse: true });
    assert.equal(result.noData, true);
    assert.equal(calls.length, 1);
});

test('pulso con E7 sin fallback reciente: corre la cadena completa una vez', async () => {
    const { bridge, calls } = makeBridge({ sendQueue: ['E7', 'E7', 'E7'] });
    const result = await bridge.pullSales({ ...range, pulse: true });
    assert.equal(result.noData, true);
    assert.equal(calls.length, 3); // incremental + anual + vacio
    // y el siguiente pulso vuelve a 1 sola lectura
    const second = makeBridge({ sendQueue: ['E7'] });
    second.bridge._lastFn72FallbackAt = bridge._lastFn72FallbackAt;
    await second.bridge.pullSales({ ...range, pulse: true });
    assert.equal(second.calls.length, 1);
});

test('pull manual (sin pulse) conserva la cadena de fallbacks completa', async () => {
    const { bridge, calls } = makeBridge({ sendQueue: ['E7', 'E7', 'E7'] });
    const result = await bridge.pullSales({ ...range });
    assert.equal(result.noData, true);
    assert.equal(calls.length, 3);
});

test('ticket nuevo se postea y el pulso siguiente no lo re-postea', async () => {
    const state = {};
    const first = makeBridge({ sendQueue: [`${REC_T1}F`], state });
    const r1 = await first.bridge.pullSales({ ...range, pulse: true });
    assert.equal(r1.newTickets, 1);
    assert.equal(first.posts.length, 1);
    assert.equal(first.posts[0].tickets[0].printedTicketBarcode.slice(0, 6), '222000');

    const second = makeBridge({ sendQueue: [`${REC_T1}F`], state });
    const r2 = await second.bridge.pullSales({ ...range, pulse: true });
    assert.equal(r2.newTickets, 0);
    assert.equal(second.posts.length, 0);
});

test('lectura parcial: reintenta de inmediato y usa la lectura completa', async () => {
    const { bridge, calls, posts } = makeBridge({
        sendQueue: [
            `${TRUNCATED};${REC_T1}F`,        // 2 registros crudos, 1 parseable
            `${REC_T2};${REC_T1}F`,           // reintento completo
        ],
    });
    const result = await bridge.pullSales({ ...range, pulse: true });
    assert.equal(calls.length, 2); // lectura + reintento inmediato
    assert.equal(result.fetched, 2);
    assert.equal(result.newTickets, 2);
    assert.equal(posts.length, 1);
});

test('lectura parcial persistente: no poda fingerprints (evita re-posts)', async () => {
    const state = { knownTicketFingerprints: { '000000002': 'fp-conocido' } };
    const { bridge } = makeBridge({
        sendQueue: [
            `${TRUNCATED};${REC_T1}F`,        // parcial: ticket 2 ausente por truncamiento
            `${TRUNCATED};${REC_T1}F`,        // reintento tambien parcial
        ],
    });
    await bridge.pullSales({ ...range, pulse: true });
    // El fingerprint del ticket ausente por truncamiento NO se podo:
    assert.equal(state.knownTicketFingerprints['000000002'], 'fp-conocido');
});

test('sin cambios no se reescribe state.json', async () => {
    const state = {};
    const first = makeBridge({ sendQueue: [`${REC_T1}F`], state });
    await first.bridge.pullSales({ ...range, pulse: true });
    assert.ok(first.saves.length >= 1);

    const second = makeBridge({ sendQueue: [`${REC_T1}F`], state });
    await second.bridge.pullSales({ ...range, pulse: true });
    assert.equal(second.saves.length, 0);
});

test('cache de vendedores: un solo getVendors en pulsos consecutivos', async () => {
    let vendorCalls = 0;
    const { bridge } = makeBridge({ sendQueue: ['E7', 'E7'] });
    bridge.api.getVendors = async () => { vendorCalls += 1; return { vendors: [{ slot: 1, displayName: 'DIEGO' }] }; };
    bridge._lastFn72FallbackAt = Date.now();
    await bridge.pullSales({ ...range, pulse: true });
    await bridge.pullSales({ ...range, pulse: true });
    assert.equal(vendorCalls, 1);
});

test('closeAfter: cierra ventas (fn32 con espera de ACK) tras POST exitoso', async () => {
    const { bridge, calls, posts } = makeBridge({ sendQueue: [`${REC_T1}F`, 'OK'] });
    const result = await bridge.pullSales({ ...range, pulse: true, closeAfter: true });
    assert.equal(result.newTickets, 1);
    assert.equal(posts.length, 1);
    const closeCall = calls.find((c) => c.fn === 32);
    assert.ok(closeCall, 'debe enviar fn32');
    assert.equal(closeCall.options.expectAckAfterInit, true);
    // El cierre va DESPUES del POST (si el POST falla, no se cierra y no se pierde nada)
    assert.ok(calls.findIndex((c) => c.fn === 32) > 0);
});

test('closeAfter: NO cierra con lectura parcial (perderia el registro no parseado)', async () => {
    const { bridge, calls } = makeBridge({
        sendQueue: [
            `${TRUNCATED};${REC_T1}F`,    // lectura parcial
            `${TRUNCATED};${REC_T1}F`,    // reintento tambien parcial
        ],
    });
    await bridge.pullSales({ ...range, pulse: true, closeAfter: true });
    assert.equal(calls.some((c) => c.fn === 32), false);
});

test('closeAfter: NO cierra cuando no hubo filas', async () => {
    const { bridge, calls } = makeBridge({ sendQueue: ['E7'] });
    bridge._lastFn72FallbackAt = Date.now();
    await bridge.pullSales({ ...range, pulse: true, closeAfter: true });
    assert.equal(calls.some((c) => c.fn === 32), false);
});

test('estampado prioriza el template reportado por la balanza (fn39) con A->0', async () => {
    const state = { scaleReportedBarcodeFormats: { weight: null, unit: null, total: '2201AAIIIIII' } };
    const { bridge, posts } = makeBridge({ sendQueue: [`${REC_T1}F`], state });
    await bridge.pullSales({ ...range, pulse: true });
    // REC_T1: total $11.025 -> 2201 00 011025 + check = papel real del template 2201
    assert.equal(posts[0].tickets[0].printedTicketBarcode, '2201000110258');
});

test('syncVendors invalida el cache: el ticket siguiente sale con el nombre nuevo', async () => {
    // 4 respuestas fn38 (un slot por vendedor) + 1 lectura fn72 con un ticket
    const { bridge, posts } = makeBridge({ sendQueue: ['OK', 'OK', 'OK', 'OK', `${REC_T1}F`] });
    let name = 'DIEGO';
    bridge.api.getVendors = async () => ({ vendors: [{ slot: 1, displayName: name }] });

    // Pulso inicial llena el cache con el nombre viejo
    bridge._vendorCache = { at: Date.now(), map: new Map([['01', 'DIEGO']]) };

    // El sistema renombra al vendedor y manda la demanda (heartbeat -> syncVendors)
    name = 'GERMAN';
    const syncResult = await bridge.syncVendors();
    assert.equal(syncResult.synced, 4);
    assert.equal(bridge._vendorCache, null);

    // El proximo ticket ya sale etiquetado con el nombre nuevo
    await bridge.pullSales({ ...range, pulse: true });
    assert.equal(posts[0].tickets[0].vendorName, 'GERMAN');
});
