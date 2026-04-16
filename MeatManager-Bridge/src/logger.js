const fs = require('fs');
const path = require('path');

const LEVELS = ['debug', 'info', 'warn', 'error'];

class Logger {
    constructor({ logFile, level = 'info', truncateOnStart = false }) {
        this.logFile = logFile;
        this.level = LEVELS.includes(level) ? level : 'info';
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        if (truncateOnStart) {
            fs.writeFileSync(this.logFile, '', 'utf8');
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
