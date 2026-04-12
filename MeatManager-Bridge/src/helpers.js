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

function decodeFirebirdText(value) {
    if (value === null || value === undefined) return '';
    if (Buffer.isBuffer(value)) return value.toString('latin1');
    if (typeof value === 'function') return '';
    return String(value);
}

module.exports = {
    normalizeText,
    hashText,
    hashObject,
    compactId,
    padTicketId,
    formatTicketBarcode,
    toNumber,
    toDate,
    decodeFirebirdText,
};
