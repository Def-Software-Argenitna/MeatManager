const crypto = require('crypto');

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hashText(value, length = 12) {
    return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, length);
}

function hashObject(value, length = 12) {
    return hashText(JSON.stringify(value ?? {}), length);
}

function compactId(value) {
    return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'MM';
}

function padTicketId(value) {
    const text = normalizeText(value).replace(/[^A-Z0-9]/g, '');
    return text.slice(0, 12) || '0';
}

function computeEan13CheckDigit(base12) {
    const digits = String(base12 || '').replace(/\D/g, '').slice(0, 12).padEnd(12, '0');
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
        const digit = Number.parseInt(digits[i], 10) || 0;
        sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
}

function formatPrintedTicketBarcode({ format, itemCount, totalAmount }) {
    const pattern = String(format || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .slice(0, 12)
        .padEnd(12, '0');
    const itemDigits = String(Math.max(0, Number.parseInt(itemCount, 10) || 0)).padStart((pattern.match(/A/g) || []).length, '0');
    const totalDigits = String(Math.round((Number(totalAmount || 0) + Number.EPSILON) * 100)).padStart((pattern.match(/I/g) || []).length, '0');

    let itemOffset = 0;
    let totalOffset = 0;
    let body = '';
    for (const ch of pattern) {
        if (ch === 'A') {
            body += itemDigits[itemOffset] || '0';
            itemOffset += 1;
            continue;
        }
        if (ch === 'I') {
            body += totalDigits[totalOffset] || '0';
            totalOffset += 1;
            continue;
        }
        body += /\d/.test(ch) ? ch : '0';
    }
    const base12 = body.slice(0, 12).padEnd(12, '0');
    return `${base12}${computeEan13CheckDigit(base12)}`;
}

function formatTicketBarcode({ deviceId, ticketId, sourceDate, fingerprint }) {
    const prefix = 'MM';
    const device = compactId(deviceId);
    const ticket = padTicketId(ticketId);
    const stamp = sourceDate instanceof Date
        ? sourceDate.toISOString().replace(/[-:T.Z]/g, '').slice(2, 12)
        : normalizeText(sourceDate).replace(/[^0-9]/g, '').slice(0, 10);
    const checksum = hashText(`${deviceId}|${ticketId}|${sourceDate}|${fingerprint}`, 6).toUpperCase();
    return `${prefix}${device}${ticket}${stamp}${checksum}`.slice(0, 32);
}

function toNumber(value, fallback = 0) {
    const num = Number.parseFloat(value);
    return Number.isFinite(num) ? num : fallback;
}

function toDate(value) {
    if (value instanceof Date) return value;
    if (value === null || value === undefined || value === '') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = {
    normalizeText,
    hashText,
    hashObject,
    compactId,
    padTicketId,
    formatTicketBarcode,
    formatPrintedTicketBarcode,
    toNumber,
    toDate,
};
