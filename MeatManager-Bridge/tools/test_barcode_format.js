const test = require('node:test');
const assert = require('node:assert/strict');
const {
    defaultTotalBarcodeFormat,
    formatPrintedTicketBarcode,
} = require('../src/helpers');

test('defaultTotalBarcodeFormat deriva 22 + direccion(2) + AAIIIIII', () => {
    assert.equal(defaultTotalBarcodeFormat(20), '2220AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat(1), '2201AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat(7), '2207AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat('20'), '2220AAIIIIII');
});

test('defaultTotalBarcodeFormat siempre produce patron de 12 chars', () => {
    for (const addr of [1, 5, 20, 99]) {
        assert.equal(defaultTotalBarcodeFormat(addr).length, 12);
    }
});

test('defaultTotalBarcodeFormat cae a direccion 20 ante valores invalidos', () => {
    assert.equal(defaultTotalBarcodeFormat(0), '2220AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat(null), '2220AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat(undefined), '2220AAIIIIII');
    assert.equal(defaultTotalBarcodeFormat(150), '2220AAIIIIII');
});

test('barcode impreso con formato derivado de direccion 20 arranca en 2220, no 2201', () => {
    // Ticket real del tenant 4: 1 item, total $18233 (la balanza divide por legacyPriceMultiplier=100)
    const format = defaultTotalBarcodeFormat(20);
    const barcode = formatPrintedTicketBarcode({ format, itemCount: 1, totalAmount: 18233.00 / 100 });
    assert.equal(barcode.slice(0, 4), '2220');
    assert.equal(barcode.length, 13); // 12 + digito verificador EAN13
    // itemCount va en posiciones 4-5 (AA), total en 6 digitos
    assert.equal(barcode, '2220010182338');
});

test('el itemCount sigue presente (no se lo come la direccion) para multiples items', () => {
    const format = defaultTotalBarcodeFormat(20);
    const b4 = formatPrintedTicketBarcode({ format, itemCount: 4, totalAmount: 54623.00 / 100 });
    assert.equal(b4.slice(0, 6), '222004'); // 2220 + "04" items
});
