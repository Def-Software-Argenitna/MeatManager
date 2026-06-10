const { SerialPort } = require('serialport');
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout');
const { encodeFrame, decodeFrame } = require('./cuora-protocol');

class CuoraClient {
    constructor({ config, logger }) {
        this.config = config;
        this.logger = logger;
        this.port = null;
        this.parser = null;
        this.pending = null;
        this.sendQueue = Promise.resolve();
    }

    async open() {
        if (this.port?.isOpen) return;
        this.port = new SerialPort({
            path: this.config.port,
            baudRate: this.config.baudRate,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
        });

        this.parser = this.port.pipe(new InterByteTimeoutParser({ interval: this.config.frameGapMs }));
        this.parser.on('data', (data) => this.onFrame(data));
        this.port.on('error', (error) => {
            this.logger.error('Error de puerto serie', { error: error.message });
            if (this.pending) {
                const reject = this.pending.reject;
                this.pending = null;
                reject(error);
            }
        });

        await new Promise((resolve, reject) => {
            this.port.open((error) => (error ? reject(error) : resolve()));
        });
        this.logger.info('Puerto serie abierto', { port: this.config.port, baudRate: this.config.baudRate });
    }

    async close() {
        if (!this.port?.isOpen) return;
        await new Promise((resolve) => this.port.close(() => resolve()));
    }

    onFrame(data) {
        if (!this.pending) return;
        const pending = this.pending;
        pending.buffer = Buffer.concat([pending.buffer || Buffer.alloc(0), Buffer.from(data)]);
        try {
            const decoded = decodeFrame(pending.buffer);
            if (!decoded.crc.ok) {
                // Puede llegar fragmentada; esperamos mas bytes hasta timeout.
                return;
            }
            this.pending = null;
            pending.resolve(decoded);
        } catch (error) {
            if (String(error.message || '').includes('longitud insuficiente')) {
                return;
            }
            this.pending = null;
            pending.reject(error);
        }
    }

    waitFrame(fn, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.pending) {
                    this.pending = null;
                    reject(new Error(`Timeout esperando respuesta de funcion ${fn}`));
                }
            }, timeoutMs);

            this.pending = {
                buffer: Buffer.alloc(0),
                resolve: (payload) => {
                    clearTimeout(timeout);
                    resolve(payload);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            };
        });
    }

    send(fn, data = '', options = {}) {
        // Serializa los send concurrentes sobre el puerto serie: el ciclo general
        // y el sales pulse pueden invocarlo en paralelo y la cola garantiza que
        // ninguno tire "ya existe una solicitud pendiente".
        const runner = async () => {
            const address = Number(options.address ?? this.config.address);
            await this.open();

            const frame = encodeFrame(address, fn, data);
            const responsePromise = this.waitFrame(fn, options.timeoutMs || this.config.responseTimeoutMs);

            await new Promise((resolve, reject) => {
                this.port.write(frame, (error) => (error ? reject(error) : resolve()));
            });
            await new Promise((resolve, reject) => {
                this.port.drain((error) => (error ? reject(error) : resolve()));
            });

            let response = await responsePromise;

            // Algunas funciones (fn32, cierre de ventas) responden DOS tramas:
            // una "I" inmediata (inicio de actividad) y el ACK final cuando
            // termina. Si liberamos la cola tras la "I", el ACK tardio se mezcla
            // con la respuesta del siguiente comando y corrompe esa lectura.
            // Esperamos el ACK dentro del mismo turno de cola.
            if (options.expectAckAfterInit && String(response.data || '').trim() === 'I') {
                try {
                    response = await this.waitFrame(fn, options.ackTimeoutMs || 30000);
                } catch (error) {
                    this.logger.warn('No llego el ACK final tras la trama de inicio', {
                        fn,
                        error: error.message,
                    });
                }
            }

            await new Promise((resolve) => setTimeout(resolve, this.config.interCommandDelayMs));
            return response;
        };

        const next = this.sendQueue.then(runner, runner);
        this.sendQueue = next.catch(() => {});
        return next;
    }

    static async listPorts() {
        return SerialPort.list();
    }
}

module.exports = { CuoraClient };
