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

// Formato por defecto del barcode "total" que imprime la balanza Systel CUORA:
// `22` (prefijo de total) + direccion de balanza (2 digitos) + `AA` (itemCount)
// + `IIIIII` (monto). La direccion va embebida en el barcode fisico, asi que el
// default DEBE derivarse de SCALE_ADDRESS y no ser una constante: si se hardcodea
// `22AAIIIIIIII` (sin direccion), el barcode que el bridge reproduce no coincide
// con el que la balanza imprime y el escaneo en el POS no encuentra el ticket.
// SCALE_ADDRESS lo escribe el wizard (Paso 3) y sobrevive al reset de overrides,
// por eso es la fuente confiable (a diferencia del auto-detect en runtime que se
// reintrodujo y revirtio por inestable).
// El campo "AA" va como `00` LITERAL y no como placeholder: el firmware CUORA
// MAX (S0060) no soporta `A` (articulos) y lo imprime como 0 — verificado con
// tickets fisicos de 2 y 4 articulos que dicen `2220 00 <total6>`. Usar `00`
// literal hace que el template enviado a la balanza (fn 8) y el barcode
// estampado en la DB sean identicos por construccion.
function defaultTotalBarcodeFormat(scaleAddress) {
    const parsed = Number.parseInt(scaleAddress, 10);
    const address = Number.isFinite(parsed) && parsed >= 1 && parsed <= 99 ? parsed : 20;
    return `22${String(address).padStart(2, '0')}00IIIIII`;
}

// El firmware CUORA MAX (S0060) NO soporta el placeholder `A` (articulos) en el
// barcode de total: lo imprime literalmente como `0`. Verificado contra tickets
// fisicos: con 2 y 4 articulos el papel dice `2220 00 <total6>`, nunca `2220 02`
// ni `2220 04`. Por eso, al REPRODUCIR el barcode impreso (estampado que se
// guarda en la DB y luego se busca al escanear), los `A` del template deben
// renderizarse como `0` — igual que hace la balanza. El template que se envia a
// la balanza (fn 8) se manda sin tocar.
function stampTotalBarcodeFormat(format) {
    return String(format || '').toUpperCase().replace(/A/g, '0');
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
    defaultTotalBarcodeFormat,
    stampTotalBarcodeFormat,
    toNumber,
    toDate,
};
