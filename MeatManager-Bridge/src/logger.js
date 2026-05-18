const fs = require('fs');
const path = require('path');

const LEVELS = ['debug', 'info', 'warn', 'error'];

class Logger {
    constructor({ logFile, level = 'info' }) {
        this.logFile = logFile;
        this.level = LEVELS.includes(level) ? level : 'info';
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        // Rotar al iniciar: bridge.log → bridge.log.prev, y empezar fresco.
        // Asi el log no crece infinito y siempre podemos ver el run actual +
        // el anterior (en .prev) para troubleshooting.
        try {
            if (fs.existsSync(logFile)) {
                const prev = `${logFile}.prev`;
                try { fs.unlinkSync(prev); } catch (_) { /* no previo */ }
                try { fs.renameSync(logFile, prev); } catch (_) { /* sino lo truncamos */ }
            }
            fs.writeFileSync(logFile, '', 'utf8');
        } catch (_) {
            // Si no podemos rotar, seguimos appendeando. Mejor eso que crashear.
        }
    }

    shouldLog(level) {
        return LEVELS.indexOf(level) >= LEVELS.indexOf(this.level);
    }

    write(level, message, meta = {}) {
        if (!this.shouldLog(level)) return;
        const entry = {
            ts: new Date().toISOString(),
            level,
            message,
            ...meta,
        };
        const line = JSON.stringify(entry);
        // eslint-disable-next-line no-console
        console.log(`[${entry.ts}] ${level.toUpperCase()} ${message}`);
        fs.appendFileSync(this.logFile, `${line}\n`, 'utf8');
    }

    debug(message, meta) { this.write('debug', message, meta); }
    info(message, meta) { this.write('info', message, meta); }
    warn(message, meta) { this.write('warn', message, meta); }
    error(message, meta) { this.write('error', message, meta); }
}

module.exports = { Logger };
