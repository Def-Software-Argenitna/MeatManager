/**
 * Web Serial Scale Service for MeatManager
 * Supports common Argentine scales (Systel, Kretz, Moretti)
 */

export const SCALE_PROTOCOLS = {
    SYSTEL_STANDARD: 'systel_standard', // Continuous: " 00.500\r"
    SYSTEL_CUORA: 'systel_cuora',       // Request/Response: STX/ETX
    KRETZ: 'kretz',
    SIMULATED: 'simulated'
};

class SerialScaleService {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.keepReading = false;
        this.protocol = SCALE_PROTOCOLS.SYSTEL_STANDARD; // Default
    }

    isSupported() {
        return 'serial' in navigator;
    }

    async requestPort() {
        try {
            this.port = await navigator.serial.requestPort();
            return true;
        } catch (err) {
            // NotFoundError = user closed the dialog without selecting a port, not a real error
            if (err.name !== 'NotFoundError') {
                console.error('Serial port error', err);
            }
            return false;
        }
    }

    isConnected() {
        // Port is open if writer exists (writer is only set after successful open)
        return !!(this.port && this.writer);
    }

    async connect(baudRate = 115200) {
        if (!this.port) return false;

        // Already open — don't try to open again
        if (this.isConnected()) return true;

        try {
            await this.port.open({
                baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none'
            });
            this.writer = this.port.writable.getWriter();
            return true;
        } catch (err) {
            console.error('Error opening port', err);
            return false;
        }
    }

    async disconnect() {
        this.keepReading = false;
        if (this.reader) {
            await this.reader.cancel();
            this.reader.releaseLock();
            this.reader = null;
        }
        if (this.writer) {
            this.writer.releaseLock();
            this.writer = null;
        }
        if (this.port) {
            await this.port.close();
        }
        this.port = null;
    }

    /**
     * Sends a command to the scale.
     * Systel Cuora protocol: STX (0x02) + Command + ETX (0x03) + LRC
     * LRC = XOR of all bytes in the DATA field (between STX and ETX, not including them)
     */
    async sendCommand(commandStr) {
        if (!this.writer) return;

        const STX = 0x02;
        const ETX = 0x03;

        // Convert string to bytes
        const encoder = new TextEncoder();
        const cmdBytes = encoder.encode(commandStr);

        // Calculate LRC = XOR of all DATA bytes
        let lrc = 0;
        for (const b of cmdBytes) {
            lrc ^= b;
        }

        // Build packet: STX + CMD + ETX + LRC
        const packet = new Uint8Array(cmdBytes.length + 3);
        packet[0] = STX;
        packet.set(cmdBytes, 1);
        packet[cmdBytes.length + 1] = ETX;
        packet[cmdBytes.length + 2] = lrc;

        console.log(`📤 Comando serial: ${commandStr} | Bytes: [${Array.from(packet).join(', ')}] | LRC: 0x${lrc.toString(16).padStart(2, '0')}`);
        await this.writer.write(packet);
    }

    /**
     * Reads weight from the scale.
     */
    async readWeight() {
        if (this.protocol === SCALE_PROTOCOLS.SIMULATED) {
            return parseFloat((Math.random() * 2 + 0.5).toFixed(3));
        }

        if (!this.port || !this.port.readable) return null;
        // Guard: if the stream is already locked (e.g. downloadArticles running), bail out
        if (this.port.readable.locked) return null;

        if (this.protocol === SCALE_PROTOCOLS.SYSTEL_CUORA) {
            await this.sendCommand('P');
        }

        const reader = this.port.readable.getReader();
        let buffer = new Uint8Array(0);
        const timeout = 2000;
        const startTime = Date.now();

        try {
            while (Date.now() - startTime < timeout) {
                const { value, done } = await reader.read();
                if (done) break;

                const newBuffer = new Uint8Array(buffer.length + value.length);
                newBuffer.set(buffer);
                newBuffer.set(value, buffer.length);
                buffer = newBuffer;

                const weight = this.parseBuffer(buffer);
                if (weight !== null) return weight;
            }
        } catch (err) {
            console.error('Scale read error:', err);
        } finally {
            reader.releaseLock();
        }
        return null;
    }

    /**
     * Downloads the PLU list from the scale.
     * @param {function} onLog - Callback (type: 'info'|'raw'|'ok'|'warn'|'error', msg: string) for live UI logging.
     */
    async downloadArticles(onLog = () => {}) {
        if (!this.port || !this.port.readable || this.protocol !== SCALE_PROTOCOLS.SYSTEL_CUORA) return null;
        // Guard: release any existing reader lock before acquiring a new one
        if (this.port.readable.locked) {
            onLog('warn', 'Puerto ocupado por otra lectura. Esperá un momento y reintentá.');
            return null;
        }

        // Phase 1: listen first (3s) — many Cuora models transmit when triggered from keypad
        onLog('info', '⏳ Esperando datos de la balanza (iniciá transmisión desde la balanza si podés)...');
        const reader = this.port.readable.getReader();
        let buffer = new Uint8Array(0);
        let totalBytesReceived = 0;

        // Quick 3-second listen before sending any command
        const listenDeadline = Date.now() + 3000;
        try {
            while (Date.now() < listenDeadline) {
                const { value, done } = await Promise.race([
                    reader.read(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('read_timeout')), 500))
                ]).catch(() => ({ value: null, done: false }));
                if (done) break;
                if (value && value.length > 0) {
                    totalBytesReceived += value.length;
                    const hex = Array.from(value).map(b => '0x' + b.toString(16).padStart(2,'0')).join(' ');
                    onLog('raw', `[LISTEN] ${value.length}B → ${hex}`);
                    const nb = new Uint8Array(buffer.length + value.length);
                    nb.set(buffer); nb.set(value, buffer.length);
                    buffer = nb;
                }
            }
        } catch {
            // Ignore passive-read failures and continue with active command probe.
        }

        // Phase 2: if nothing received, send 'L' command and try again
        if (totalBytesReceived === 0) {
            onLog('info', '📤 Sin respuesta pasiva → enviando comando L...');
            try { reader.releaseLock(); } catch {
                // Ignore release failures.
            }
            await this.sendCommand('L');
            await new Promise(r => setTimeout(r, 500));
            onLog('info', '⏳ Esperando respuesta al comando L...');
        } else {
            onLog('ok', `✔ Balanza inició transmisión (${totalBytesReceived} bytes). Procesando...`);
        }

        // Phase 3: main read loop
        const reader2 = totalBytesReceived === 0 ? this.port.readable.getReader() : null;
        const activeReader = reader2 || reader;

        const timeout = 20000;
        const startTime = Date.now();
        const noDataTimeout = 3000;
        let lastDataTime = Date.now();
        const decoder = new TextDecoder();
        const articles = [];

        try {
            while (Date.now() - startTime < timeout) {
                try {
                    const { value, done } = await Promise.race([
                        activeReader.read(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('read_timeout')), 500)
                        )
                    ]);

                    if (done) break;

                    if (value && value.length > 0) {
                        lastDataTime = Date.now();
                        totalBytesReceived += value.length;

                        const hexDump = Array.from(value).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                        const asciiDump = Array.from(value).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
                        onLog('raw', `[${value.length}B] HEX: ${hexDump}  |  ASCII: "${asciiDump}"`);

                        const newBuffer = new Uint8Array(buffer.length + value.length);
                        newBuffer.set(buffer);
                        newBuffer.set(value, buffer.length);
                        buffer = newBuffer;

                        let stxIdx = buffer.indexOf(0x02);
                        let etxIdx = buffer.indexOf(0x03);

                        if (stxIdx === -1) {
                            onLog('warn', `Sin STX(0x02). Buffer: ${Array.from(buffer.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2,'0')).join(' ')}`);
                        }

                        while (stxIdx !== -1 && etxIdx !== -1 && etxIdx > stxIdx) {
                            const data = buffer.slice(stxIdx + 1, etxIdx);
                            const line = decoder.decode(data);

                            if (line.includes('END') || line.trim() === '') {
                                onLog('ok', '✅ Fin de lista recibido (END)');
                                await new Promise(r => setTimeout(r, 500));
                                try { activeReader.releaseLock(); } catch {
                                    // Ignore release failures.
                                }
                                return articles;
                            }

                            const article = this.parseArticleLine(line);
                            if (article) {
                                articles.push(article);
                                onLog('ok', `📦 PLU ${article.plu} — ${article.name} — $${article.price}`);
                            } else {
                                onLog('warn', `Línea no parseada: "${line}"`);
                            }

                            buffer = buffer.slice(etxIdx + 1);
                            stxIdx = buffer.indexOf(0x02);
                            etxIdx = buffer.indexOf(0x03);
                        }
                    }

                    if (articles.length > 0 && Date.now() - lastDataTime > noDataTimeout) {
                        onLog('ok', '✅ Transmisión completada (sin datos por 3s)');
                        break;
                    }
                } catch (err) {
                    if (err.message === 'read_timeout') {
                        if (articles.length > 0 && Date.now() - lastDataTime > noDataTimeout) {
                            onLog('ok', '✅ Transmisión completada');
                            break;
                        }
                        continue;
                    }
                    throw err;
                }
            }
        } catch (err) {
            onLog('error', `❌ Error: ${err.message}`);
        } finally {
            try {
                activeReader.releaseLock();
            } catch {
                // Already released
            }
        }

        if (totalBytesReceived === 0) {
            onLog('error', '🚫 Balanza SIN respuesta. Chequeá: baudRate, cable, modo transmisión, puerto COM.');
        } else if (articles.length === 0) {
            onLog('warn', `⚠️ Balanza respondió (${totalBytesReceived} bytes) pero no se parsearon artículos. Revisá los RAW arriba.`);
        } else {
            onLog('ok', `📊 Total: ${articles.length} artículos | ${totalBytesReceived} bytes recibidos`);
        }
        return articles;
    }

    parseArticleLine(line) {
        // Cuora Max format varies, but usually: PLU,NAME,PRICE,UNIT
        const parts = line.split(',');
        if (parts.length >= 3) {
            return {
                plu: parts[0].trim(),
                name: parts[1].trim(),
                price: parseFloat(parts[2].trim()),
                unit: parts[3] === '1' ? 'un' : 'kg'
            };
        }
        return null;
    }

    parseBuffer(buffer) {
        const decoder = new TextDecoder();

        if (this.protocol === SCALE_PROTOCOLS.SYSTEL_CUORA) {
            const stxIdx = buffer.indexOf(0x02);
            const etxIdx = buffer.indexOf(0x03);

            if (stxIdx !== -1 && etxIdx !== -1 && etxIdx > stxIdx) {
                const data = buffer.slice(stxIdx + 1, etxIdx);
                const str = decoder.decode(data);
                return this.cleanWeightString(str);
            }
        } else {
            const str = decoder.decode(buffer);
            if (str.includes('\r') || str.includes('\n')) {
                return this.cleanWeightString(str);
            }
        }
        return null;
    }

    cleanWeightString(str) {
        const cleaned = str.replace(/[^0-9.]/g, '');
        const weight = parseFloat(cleaned);
        return isNaN(weight) ? null : weight;
    }

    setProtocol(protocol) {
        this.protocol = protocol;
    }
}

export const scaleService = new SerialScaleService();
