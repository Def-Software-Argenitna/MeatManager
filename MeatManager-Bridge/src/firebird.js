const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const Firebird = require('node-firebird');

const rootDir = path.resolve(__dirname, '..');
const helperScript = path.join(rootDir, 'tools', 'firebird_helper.py');
const TABLE_CACHE_TTL_MS = 60 * 1000;
const COLUMN_CACHE_TTL_MS = 60 * 1000;

const tableCache = new Map();
const columnCache = new Map();

const QENDRA_DLL_PATHS = [
    'C:\\Qendra',
    'C:\\Soluciones\\Systel\\Qendra_PC',
    'C:\\Soluciones\\Systel',
    'C:\\Systel',
];

function injectDllPaths() {
    for (const dllPath of QENDRA_DLL_PATHS) {
        if (fs.existsSync(dllPath) && !(process.env.PATH || '').includes(dllPath)) {
            process.env.PATH = `${dllPath};${process.env.PATH || ''}`;
        }
    }
}

function buildConfigs(config) {
    const base = {
        database: config.dbFile,
        user: config.user,
        password: config.password,
        lowercase_keys: false,
        charset: 'NONE',
    };

    return {
        embedded: { ...base },
        tcp: { ...base, host: config.host, port: config.port },
    };
}

function resolveHelperPython(config) {
    return config?.pythonPath || path.join(rootDir, 'tools', 'python32', 'runtime', 'python.exe');
}

function hasPythonHelper(config) {
    return fs.existsSync(resolveHelperPython(config)) && fs.existsSync(helperScript);
}

function runPythonHelper(config, payload) {
    return new Promise((resolve, reject) => {
        const pythonPath = resolveHelperPython(config);
        const child = execFile(
            pythonPath,
            [helperScript],
            {
                cwd: rootDir,
                windowsHide: true,
                env: {
                    ...process.env,
                    PATH: `${path.dirname(config.dbFile)};${process.env.PATH || ''}`,
                },
                maxBuffer: 10 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                if (error) {
                    const details = [stdout, stderr].filter(Boolean).join(' ').trim();
                    reject(new Error(details || error.message));
                    return;
                }

                try {
                    const response = JSON.parse(stdout || '{}');
                    if (!response.ok) {
                        reject(new Error(response.error || 'Error desconocido al consultar Firebird'));
                        return;
                    }
                    resolve(response);
                } catch (parseError) {
                    reject(new Error(`Respuesta invalida del helper Firebird: ${stdout || stderr || parseError.message}`));
                }
            }
        );

        child.stdin.end(JSON.stringify({ config, ...payload }));
    });
}

function attachLegacy(config) {
    injectDllPaths();
    const { tcp, embedded } = buildConfigs(config);

    return new Promise((resolve, reject) => {
        Firebird.attach(tcp, (tcpErr, tcpDb) => {
            if (!tcpErr) return resolve({ db: tcpDb, mode: 'tcp' });

            Firebird.attach(embedded, (embeddedErr, embeddedDb) => {
                if (!embeddedErr) return resolve({ db: embeddedDb, mode: 'embedded' });
                reject(new Error(`TCP: ${tcpErr.message} | Embedded: ${embeddedErr.message}`));
            });
        });
    });
}

async function attach(config) {
    if (hasPythonHelper(config)) {
        await runPythonHelper(config, { action: 'ping' });
        return { db: null, mode: 'python-helper' };
    }
    return attachLegacy(config);
}

async function query(config, sql, params = []) {
    if (hasPythonHelper(config)) {
        const response = await runPythonHelper(config, {
            action: 'query',
            sql,
            params,
        });
        return response.rows || [];
    }

    return new Promise(async (resolve, reject) => {
        let connection;
        try {
            connection = await attachLegacy(config);
        } catch (error) {
            return reject(error);
        }

        connection.db.query(sql, params, (error, rows) => {
            try {
                connection.db.detach();
            } catch {
                // noop
            }
            if (error) return reject(error);
            resolve(rows || []);
        });
    });
}

async function getTables(config) {
    const cacheKey = String(config?.dbFile || '').toLowerCase();
    const cached = tableCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TABLE_CACHE_TTL_MS) {
        return cached.value;
    }

    const rows = await query(
        config,
        "SELECT TRIM(RDB$RELATION_NAME) AS TABLE_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 ORDER BY RDB$RELATION_NAME"
    );
    const value = rows.map((row) => String(row.TABLE_NAME || row.table_name || '').trim()).filter(Boolean);
    tableCache.set(cacheKey, { ts: Date.now(), value });
    return value;
}

async function tableExists(config, tableName) {
    const tables = await getTables(config);
    return tables.includes(String(tableName || '').trim().toUpperCase());
}

async function getColumns(config, tableName) {
    const normalizedTable = String(tableName || '').trim().toUpperCase();
    const cacheKey = `${String(config?.dbFile || '').toLowerCase()}::${normalizedTable}`;
    const cached = columnCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < COLUMN_CACHE_TTL_MS) {
        return cached.value;
    }

    const rows = await query(
        config,
        `SELECT TRIM(RDB$FIELD_NAME) AS COLUMN_NAME
         FROM RDB$RELATION_FIELDS
         WHERE TRIM(RDB$RELATION_NAME) = ?
         ORDER BY RDB$FIELD_POSITION`,
        [normalizedTable]
    );
    const value = rows.map((row) => String(row.COLUMN_NAME || '').trim()).filter(Boolean);
    columnCache.set(cacheKey, { ts: Date.now(), value });
    return value;
}

function firstMatchingColumn(columns, candidates) {
    const normalized = columns.map((col) => col.toUpperCase());
    for (const candidate of candidates) {
        const index = normalized.indexOf(candidate.toUpperCase());
        if (index >= 0) return columns[index];
    }
    return null;
}

function buildInsertSql(tableName, columns, row) {
    const available = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
    if (available.length === 0) {
        return null;
    }

    const fields = available.map((column) => `"${column}"`).join(', ');
    const placeholders = available.map(() => '?').join(', ');
    const params = available.map((column) => row[column]);
    return {
        sql: `INSERT INTO ${tableName} (${fields}) VALUES (${placeholders})`,
        params,
    };
}

module.exports = {
    attach,
    query,
    getTables,
    tableExists,
    getColumns,
    firstMatchingColumn,
    buildInsertSql,
};
