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

function round6d(value) {
    const numeric = Number.parseFloat(value) || 0;
    const intPart = Math.floor(numeric);
    const decimal = numeric - intPart;
    if (decimal >= 0.5) return Math.ceil(numeric);
    return Math.floor(numeric);
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
    const rawPrice = Number.parseFloat(product.current_price) || 0;
    const priceFormat = String(options.priceFormat || '').trim().toLowerCase();
    const scaledPrice = Math.round(rawPrice * multiplier);
    const integerPrice = round6d(rawPrice);
    const safePrice = (() => {
        if (priceFormat === '6d') {
            return Math.max(0, Math.min(999999, integerPrice));
        }
        if (scaledPrice >= 0 && scaledPrice <= 999999) return scaledPrice;
        return Math.max(0, Math.min(999999, scaledPrice));
    })();
    const price = padNum(safePrice, 6);
    const pluRaw = Number.parseInt(product.plu || product.id, 10) || 0;
    const plu = padNum(Math.max(1, Math.min(pluRaw, 8000)), 4);
    
    if (plu === '0004' || plu === '0002') {
        console.log(`[DEBUG] PLU: ${plu}, rawPrice: ${rawPrice}, multiplier: ${multiplier}, priceFormat: ${priceFormat}, safePrice: ${safePrice}, Final encoded price string: ${price}`);
    }

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
    const parseIntField = (raw, { allowEmpty = true } = {}) => {
        const text = String(raw || '').trim();
        if (!text) return allowEmpty ? 0 : null;
        if (!/^\d+$/.test(text)) return null;
        return Number.parseInt(text, 10) || 0;
    };

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
        const units = parseIntField(unitsRaw);
        const grams = parseIntField(gramsRaw);
        const drainedGrams = parseIntField(drainedRaw);
        const amountTimes100 = parseIntField(amountRaw, { allowEmpty: false });
        const validNumeric = units !== null && grams !== null && drainedGrams !== null && amountTimes100 !== null;
        const validIdentity = ticketId.length > 0 && plu.length > 0;

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
            units,
            grams,
            drainedGrams,
            amountTimes100,
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
    round6d,
    buildSectorPayload,
    buildPlu61Payload,
    buildPlu4Payload,
    buildDeletePluPayload,
    buildBarcodeConfigPayload,
    buildSales72Payload,
    parseSales72,
};
