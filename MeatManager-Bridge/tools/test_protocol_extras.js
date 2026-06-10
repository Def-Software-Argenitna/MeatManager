const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildClock16Payload,
    parseClock28,
    parseEquipmentConfig39,
} = require('../src/cuora-protocol');

test('buildClock16Payload arma HHMMSSDDMMAA', () => {
    const d = new Date(2026, 5, 10, 9, 5, 3); // 10/06/26 09:05:03
    assert.equal(buildClock16Payload(d), '090503100626');
});

test('parseClock28 lee "HH:MM:SS DD/MM/AA"', () => {
    const d = parseClock28('09:05:03 10/06/26');
    assert.ok(d instanceof Date);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 5);
    assert.equal(d.getDate(), 10);
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 5);
    assert.equal(d.getSeconds(), 3);
    assert.equal(parseClock28('basura'), null);
    assert.equal(parseClock28(''), null);
});

test('parseEquipmentConfig39 extrae templates de barcode y Cpr', () => {
    const sample = 'Ton=1;Gris=0;Pap=0;Apa=1;Vel=3;Cpr=2;Cadm=12345;Ccon=00000;Sinc=0'
        + ';E_P=20PPPPIIIIII;E_U=21PPPPIIIIII;E_S=2220AAIIIIII;Cim=1'
        + ';Pub=OFERTA; ASADO 2X1 HOY;Enc1=NOMBRE DEL NEGOCIO;Enc2=Direccion - Telefono';
    const parsed = parseEquipmentConfig39(sample);
    assert.equal(parsed.barcodeWeightFormat, '20PPPPIIIIII');
    assert.equal(parsed.barcodeUnitFormat, '21PPPPIIIIII');
    assert.equal(parsed.barcodeTotalFormat, '2220AAIIIIII');
    assert.equal(parsed.priceCommaPosition, 2);
});

test('parseEquipmentConfig39 tolera Pub con punto y coma (texto libre)', () => {
    // El ';' dentro de Pub no debe romper el parseo de los campos estructurados
    const sample = 'Cpr=0;E_S=220100IIIIII;Cim=1;Pub=PROMO;2X1;TODO;EL;DIA;Enc1=X';
    const parsed = parseEquipmentConfig39(sample);
    assert.equal(parsed.barcodeTotalFormat, '220100IIIIII');
    assert.equal(parsed.priceCommaPosition, 0);
});

test('parseEquipmentConfig39 descarta templates invalidos', () => {
    const parsed = parseEquipmentConfig39('Cpr=2;E_S=;E_P=XX;Pub=hola');
    assert.equal(parsed.barcodeTotalFormat, null);
    assert.equal(parsed.barcodeWeightFormat, null);
    assert.equal(parseEquipmentConfig39(''), null);
});
