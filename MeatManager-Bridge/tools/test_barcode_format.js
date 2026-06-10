const test = require('node:test');
const assert = require('node:assert/strict');
const {
    defaultTotalBarcodeFormat,
    stampTotalBarcodeFormat,
    formatPrintedTicketBarcode,
} = require('../src/helpers');

test('defaultTotalBarcodeFormat deriva 22 + direccion(2) + 00 literal + IIIIII', () => {
    assert.equal(defaultTotalBarcodeFormat(20), '222000IIIIII');
    assert.equal(defaultTotalBarcodeFormat(1), '220100IIIIII');
    assert.equal(defaultTotalBarcodeFormat(7), '220700IIIIII');
    assert.equal(defaultTotalBarcodeFormat('20'), '222000IIIIII');
});

test('defaultTotalBarcodeFormat siempre produce patron de 12 chars', () => {
    for (const addr of [1, 5, 20, 99]) {
        assert.equal(defaultTotalBarcodeFormat(addr).length, 12);
    }
});

test('defaultTotalBarcodeFormat cae a direccion 20 ante valores invalidos', () => {
    assert.equal(defaultTotalBarcodeFormat(0), '222000IIIIII');
    assert.equal(defaultTotalBarcodeFormat(null), '222000IIIIII');
    assert.equal(defaultTotalBarcodeFormat(undefined), '222000IIIIII');
    assert.equal(defaultTotalBarcodeFormat(150), '222000IIIIII');
});

test('stampTotalBarcodeFormat renderiza A como 0 (igual que el firmware)', () => {
    assert.equal(stampTotalBarcodeFormat('2220AAIIIIII'), '222000IIIIII');
    assert.equal(stampTotalBarcodeFormat('2201AAIIIIII'), '220100IIIIII');
    assert.equal(stampTotalBarcodeFormat('22AAIIIIIIII'), '2200IIIIIIII');
    assert.equal(stampTotalBarcodeFormat('222000IIIIII'), '222000IIIIII');
});

// Fixtures de tickets FISICOS reales (fotos del cliente, tenant 4, balanza
// direccion 20, legacyPriceMultiplier=100 -> totalAmount arg = pesos/100).
// La balanza imprime template literal con A->0; el itemCount NO va en el papel.
test('reproduce ticket fisico 14/Abr: 2 articulos, $61.012, template 2220AAIIIIII', () => {
    const format = stampTotalBarcodeFormat(defaultTotalBarcodeFormat(20));
    const barcode = formatPrintedTicketBarcode({ format, itemCount: 2, totalAmount: 61012 / 100 });
    assert.equal(barcode, '2220000610124');
});

test('reproduce ticket fisico 12/Abr: 4 articulos, $85.945, template 2220AAIIIIII', () => {
    const format = stampTotalBarcodeFormat(defaultTotalBarcodeFormat(20));
    const barcode = formatPrintedTicketBarcode({ format, itemCount: 4, totalAmount: 85945 / 100 });
    assert.equal(barcode, '2220000859455');
});

test('reproduce ticket fisico 09/Jun: 1 articulo, $11.025, template 2201AAIIIIII (override)', () => {
    const format = stampTotalBarcodeFormat('2201AAIIIIII');
    const barcode = formatPrintedTicketBarcode({ format, itemCount: 1, totalAmount: 11025 / 100 });
    assert.equal(barcode, '2201000110258');
});

test('el itemCount NO altera el barcode estampado (firmware imprime 00 siempre)', () => {
    const format = stampTotalBarcodeFormat(defaultTotalBarcodeFormat(20));
    const b1 = formatPrintedTicketBarcode({ format, itemCount: 1, totalAmount: 110.25 });
    const b9 = formatPrintedTicketBarcode({ format, itemCount: 9, totalAmount: 110.25 });
    assert.equal(b1, b9);
    assert.equal(b1.slice(0, 6), '222000');
});
