function normalizeAscii(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim();
}

function padText(value, length) {
    const normalized = normalizeAscii(value);
    return normalized.slice(0, length).padEnd(length, ' ');
}

function padNum(value, length) {
    const n = Number.parseInt(value ?? 0, 10);
    if (!Number.isFinite(n) || n < 0) return ''.padStart(length, '0');
    return String(n).slice(0, length).padStart(length, '0');
}

function xorChecksum(buffer) {
    let crc = 0;
    for (const byte of buffer) crc ^= byte;
    return crc & 0xFF;
}

function encodeFrame(address, fn, data = '') {
    const payload = Buffer.from(String(data || ''), 'ascii');
    const head = Buffer.from([Number(address) & 0xFF, Number(fn) & 0xFF]);
    const body = Buffer.concat([head, payload]);
    const crc = xorChecksum(body);
    return Buffer.concat([body, Buffer.from([crc])]);
}

function decodeFrame(raw) {
    if (!raw || raw.length < 3) {
        throw new Error('Trama invalida: longitud insuficiente');
    }
    const frame = Buffer.from(raw);
    const address = frame[0];
    const fn = frame[1];
    const receivedCrc = frame[frame.length - 1];
    const dataBytes = frame.subarray(2, frame.length - 1);
    const expectedCrc = xorChecksum(frame.subarray(0, frame.length - 1));
    return {
        address,
        fn,
        data: dataBytes.toString('ascii'),
        raw: frame,
        crc: {
            expected: expectedCrc,
            received: receivedCrc,
            ok: expectedCrc === receivedCrc,
        },
    };
}

function inferSaleType(unit) {
    const normalized = normalizeAscii(unit).toLowerCase();
    if (['kg', 'kilo', 'kilos', 'gr', 'gramo', 'gramos'].includes(normalized)) return 'P';
    return 'U';
}

function buildSectorPayload(sectionId, sectionName) {
    return `${padNum(sectionId, 2)}${padText(sectionName, 18)}`;
}

function buildPlu61Payload(product, options = {}) {
    const sectionId = options.sectionId || 2;
    const saleType = options.saleType || inferSaleType(product.unit);
    const price = padNum(product.current_price, 6);
    const plu = padNum(product.plu || product.id, 6);
    const name = padText(product.name || `PLU ${plu}`, 18);
    const eanCfg = padText('20PPPPIIIIII', 12);

    return [
        plu,
        name,
        price, '000000',
        price, '000000',
        '000000', '000000',
        '000000', '000000',
        '000000', '000000',
        plu,
        padNum(sectionId, 2),
        '0000',
        saleType,
        '0000',
        '0000',
        'N',
        ''.padEnd(30, ' '),
        '0001',
        '0001',
        '0000', '0000', '0000', '0000', '0000',
        '0000', '0000', '0000', '0000', '0000',
        '0000',
        '0000',
        '0000',
        '000000000000',
        '0',
        eanCfg,
        'N',
        ''.padEnd(100, ' '),
    ].join('');
}

function buildPlu4Payload(product, options = {}) {
    const sectionId = options.sectionId || 2;
    const saleType = options.saleType || inferSaleType(product.unit);
    const multiplier = Number.parseInt(options.priceMultiplier ?? 100, 10) || 100;
    const scaledPrice = Math.round((Number.parseFloat(product.current_price) || 0) * multiplier);
    const safePrice = Math.max(0, Math.min(999999, scaledPrice));
    const price = padNum(safePrice, 6);
    const pluRaw = Number.parseInt(product.plu || product.id, 10) || 0;
    const plu = padNum(Math.max(1, Math.min(pluRaw, 8000)), 4);
    const code = padNum(Math.max(1, Math.min(pluRaw, 99997)), 5);
    const name = padText(product.name || `PLU ${plu}`, 18);
    const ingredients = padText(options.ingredients || '', 100);
    const hasIngredients = ingredients.trim() ? 'S' : 'N';
    const maintainTotals = options.maintainTotals ? 'M' : 'N';

    return [
        plu,
        '1',
        name,
        price,
        price,
        code,
        padNum(sectionId, 2),
        '0000',
        saleType,
        '000000',
        maintainTotals,
        hasIngredients,
        ingredients,
    ].join('');
}

function buildDeletePluPayload(pluValue) {
    const pluRaw = Number.parseInt(pluValue, 10) || 0;
    const plu = Math.max(1, Math.min(pluRaw, 8000));
    return padNum(plu, 4);
}

function buildBarcodeConfigPayload(type, format) {
    const barcodeType = String(type || '').toUpperCase().trim().slice(0, 1);
    const allowedType = ['S', 'P', 'U'].includes(barcodeType) ? barcodeType : 'S';
    const normalizedFormat = String(format || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .slice(0, 12)
        .padEnd(12, '0');
    return `${allowedType}${normalizedFormat}`;
}

function buildSales72Payload(dateFrom, dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('Fechas invalidas para funcion 72');
    }
    const y2 = (d) => String(d.getFullYear() % 100).padStart(2, '0');
    const dd = (d) => String(d.getDate()).padStart(2, '0');
    const mm = (d) => String(d.getMonth() + 1).padStart(2, '0');
    return `${dd(from)}${mm(from)}${y2(from)}${dd(to)}${mm(to)}${y2(to)}`;
}

function parseSales72(data) {
    const text = String(data || '');
    if (!text) return [];
    const clean = text.endsWith('F') ? text.slice(0, -1) : text;
    const records = clean
        .split(';')
        .map((part) => String(part || '').trim())
        .filter((part) => part.length > 0);
    const rows = [];
    for (const record of records) {
        const tokens = record.split('^');
        if (tokens.length < 10) continue;
        const ticketId = String(tokens[0] || '').trim();
        const date = String(tokens[1] || '').trim();
        const time = String(tokens[2] || '').trim();
        const vendor = String(tokens[3] || '').trim();
        const plu = String(tokens[4] || '').trim();
        const sector = String(tokens[5] || '').trim();
        const unitsRaw = String(tokens[6] || '').trim();
        const gramsRaw = String(tokens[7] || '').trim();
        const drainedRaw = String(tokens[8] || '').trim();
        const amountRaw = String(tokens[9] || '').trim();

        const validDate = /^\d{2}\/\d{2}\/\d{2}$/.test(date);
        const validTime = /^\d{2}:\d{2}:\d{2}$/.test(time);
        const validNumeric = /^\d+$/.test(unitsRaw) && /^\d+$/.test(gramsRaw) && /^\d+$/.test(drainedRaw) && /^\d+$/.test(amountRaw);
        const validIdentity = ticketId.length > 0 && vendor.length > 0 && plu.length > 0;

        if (!validDate || !validTime || !validNumeric || !validIdentity) {
            continue;
        }

        rows.push({
            ticketId,
            date,
            time,
            vendor,
            plu,
            sector,
            units: Number.parseInt(unitsRaw, 10) || 0,
            grams: Number.parseInt(gramsRaw, 10) || 0,
            drainedGrams: Number.parseInt(drainedRaw, 10) || 0,
            amountTimes100: Number.parseInt(amountRaw, 10) || 0,
        });
    }
    return rows;
}

module.exports = {
    normalizeAscii,
    padText,
    padNum,
    encodeFrame,
    decodeFrame,
    inferSaleType,
    buildSectorPayload,
    buildPlu61Payload,
    buildPlu4Payload,
    buildDeletePluPayload,
    buildBarcodeConfigPayload,
    buildSales72Payload,
    parseSales72,
};
