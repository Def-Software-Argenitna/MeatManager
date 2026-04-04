const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

// ── Borrado físico de la carpeta IndexedDB y reinicio de la app ─────────────
ipcMain.handle('nuke-indexeddb', async () => {
    try {
        const userData = app.getPath('userData');
        const indexedDbPath = path.join(userData, 'IndexedDB');
        if (fs.existsSync(indexedDbPath)) {
            fs.rmSync(indexedDbPath, { recursive: true, force: true });
        }
        // También limpiar localStorage/sessionStorage si hay archivos
        const localStoragePath = path.join(userData, 'Local Storage');
        if (fs.existsSync(localStoragePath)) {
            fs.rmSync(localStoragePath, { recursive: true, force: true });
        }
        // Reiniciar la app
        app.relaunch();
        app.exit(0);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// ── Fijar userData ANTES de todo: mismo path para portable e instalado ─────
const fixedUserData = path.join(app.getPath('appData'), 'MeatManager PRO');
app.setPath('userData', fixedUserData);

// ── Migración automática: copiar datos del path viejo ("meatmanager") al nuevo ─
(function migrateOldUserData() {
    const oldPath = path.join(app.getPath('appData'), 'meatmanager');
    const newPath = fixedUserData;
    if (fs.existsSync(oldPath) && !fs.existsSync(path.join(newPath, 'IndexedDB'))) {
        try {
            fs.cpSync(oldPath, newPath, { recursive: true });
        } catch (_) {}
    }
})();
const TelegramBot = require('node-telegram-bot-api');
const os = require('os');
const crypto = require('crypto');

// ── Hardware fingerprint: UUID de placa madre (wmic) + fallback cpu/host ───
async function getMachineHwid() {
    return new Promise((resolve) => {
        exec('wmic csproduct get UUID', (err, stdout) => {
            if (!err && stdout) {
                const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && l !== 'UUID');
                const uuid = lines[0] || '';
                // UUID válido y no el placeholder genérico de algunas VMs
                if (uuid && uuid !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' && uuid.length >= 30) {
                    const hwid = uuid.replace(/-/g, '').substring(0, 16).toUpperCase();
                    return resolve(hwid);
                }
            }
            // Fallback: hash de hostname + CPU + platform
            const cpus = os.cpus();
            const raw = [
                os.hostname(),
                os.platform(),
                os.arch(),
                cpus[0]?.model || '',
                cpus.length.toString(),
            ].join('|');
            const hwid = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16).toUpperCase();
            resolve(hwid);
        });
    });
}

ipcMain.handle('get-machine-id', () => getMachineHwid());

// ── Inyectar rutas de QENDRA al PATH antes de cargar node-firebird ──────────
// node-firebird carga fbclient.dll via LoadLibrary en el momento del require(),
// así que el PATH debe estar seteado ANTES de este require.
const QENDRA_DLL_PATHS = [
    'C:\\Qendra',
    'C:\\Soluciones\\Systel\\Qendra_PC',
    'C:\\Soluciones\\Systel',
    'C:\\Systel',
];
(function injectDllPaths() {
    const fs = require('fs');
    for (const p of QENDRA_DLL_PATHS) {
        if (fs.existsSync(p) && !(process.env.PATH || '').includes(p)) {
            process.env.PATH = p + ';' + (process.env.PATH || '');
        }
    }
})();

const Firebird = require('node-firebird');

const QENDRA_DB_FILE = 'C:\\Qendra\\qendra.fdb';

// Config embedded (sin servidor — Firebird Embedded, un solo proceso a la vez)
const QENDRA_DB_EMBEDDED = {
    database: QENDRA_DB_FILE,
    user: 'SYSDBA',
    password: 'masterkey',
    lowercase_keys: false,
    charset: 'NONE',
};

// Config TCP (con servidor Firebird corriendo en puerto 3050)
const QENDRA_DB_TCP = {
    host: '127.0.0.1',
    port: 3050,
    database: QENDRA_DB_FILE,
    user: 'SYSDBA',
    password: 'masterkey',
    lowercase_keys: false,
    charset: 'NONE',
};

// Nombres de servicio Firebird más comunes en Windows
const FIREBIRD_SERVICES = [
    'FirebirdServerDefaultInstance',
    'FirebirdGuardianDefaultInstance',
    'FirebirdServer',
    'FirebirdGuardian',
];

// Intenta conectar primero en modo embedded (sin host), luego en TCP
function firebirdAttachWithRetry(resolve, query) {
    // 1er intento: embedded (sin host ni puerto)
    Firebird.attach(QENDRA_DB_EMBEDDED, async (err, db) => {
        if (!err) {
            return query(db, resolve);
        }

        // Si el archivo está bloqueado por QENDRA (embedded solo permite 1 proceso)
        const isLocked = err.message && (
            err.message.includes('lock') ||
            err.message.includes('335544467') || // error code Firebird "file in use"
            err.message.includes('database file appears corrupt') ||
            err.message.includes('I/O error')
        );
        if (isLocked) {
            return resolve({
                ok: false,
                error: 'La base de datos está siendo usada por QENDRA.',
                hint: 'close_qendra',
            });
        }

        // 2do intento: TCP (servidor Firebird corriendo)
        Firebird.attach(QENDRA_DB_TCP, async (err2, db2) => {
            if (!err2) return query(db2, resolve);

            const isRefused = err2.message && (
                err2.message.includes('ECONNREFUSED') ||
                err2.message.includes('connection refused')
            );
            if (isRefused) {
                // Intentar arrancar el servicio Firebird
                const started = await new Promise(r => {
                    let idx = 0;
                    const tryNext = () => {
                        if (idx >= FIREBIRD_SERVICES.length) return r(false);
                        const svc = FIREBIRD_SERVICES[idx++];
                        exec(`net start "${svc}"`, (e) => { if (!e) return r(svc); tryNext(); });
                    };
                    tryNext();
                });
                if (started) {
                    await new Promise(r => setTimeout(r, 2000));
                    Firebird.attach(QENDRA_DB_TCP, (err3, db3) => {
                        if (err3) return resolve({ ok: false, error: `Servicio ${started} iniciado pero no conecta: ${err3.message}`, autoStarted: started });
                        query(db3, (val) => resolve({ ...val, autoStarted: started }));
                    });
                } else {
                    return resolve({
                        ok: false,
                        error: `Embedded: ${err.message} | TCP: ${err2.message}`,
                        hint: 'no_firebird',
                    });
                }
            } else {
                return resolve({ ok: false, error: err2.message });
            }
        });
    });
}

// ── Qendra: verificar existencia del archivo .fdb ──────────────────────
ipcMain.handle('qendra-db-exists', () => {
    const fs = require('fs');
    return fs.existsSync('C:\\Qendra\\qendra.fdb');
});

// ── Qendra: sincronizar ventas (últimos N días) ─────────────────────────────
ipcMain.handle('qendra-sync-ventas', async (event, dias = 30) => {
    return new Promise((resolve) => {
        firebirdAttachWithRetry(resolve, (db, res) => {
            // Diagnóstico: total rows + rango de fechas
            db.query('SELECT COUNT(*) AS TOTAL, MIN(FECHA) AS FECHA_MIN, MAX(FECHA) AS FECHA_MAX FROM VENTAS', (errDiag, diagRows) => {
                const diag = diagRows && diagRows[0] ? diagRows[0] : {};
                const totalRows = diag.TOTAL || 0;

                if (totalRows === 0) {
                    db.detach();
                    return res({ ok: true, tickets: [], items: [], diag: { totalRows: 0, fechaMin: null, fechaMax: null } });
                }

                const filtro = dias === 0
                    ? ''
                    : `WHERE v.FECHA >= DATEADD(-${parseInt(dias)} DAY TO CURRENT_TIMESTAMP)`;

                // Sin NOMBRE_VENDEDOR (tiene acentos → transliterate error)
                // CAST a DOUBLE PRECISION para evitar overflow en SUM
                const sql = `
                    SELECT
                        v.ID_TICKET,
                        MIN(v.FECHA) AS FECHA,
                        CAST(SUM(CAST(v.IMPORTE AS DOUBLE PRECISION)) AS DOUBLE PRECISION) AS TOTAL,
                        CAST(SUM(CAST(v.PESO    AS DOUBLE PRECISION)) AS DOUBLE PRECISION) / 1000.0 AS KG_TOTAL,
                        COUNT(*) AS ITEMS
                    FROM VENTAS v
                    ${filtro}
                    GROUP BY v.ID_TICKET
                    ORDER BY MIN(v.FECHA) DESC`;

                db.query(sql, (err2, tickets) => {
                    if (err2) {
                        db.detach();
                        return res({ ok: false, error: err2.message });
                    }

                    // Items: solo columnas numéricas + ID_PLU (sin DESCRIPCION de PLU)
                    const sql2 = `
                        SELECT
                            v.ID_TICKET,
                            v.FECHA,
                            v.ID_PLU,
                            CAST(v.PESO    AS DOUBLE PRECISION) / 1000.0 AS PESO_KG,
                            CAST(v.IMPORTE AS DOUBLE PRECISION)           AS IMPORTE
                        FROM VENTAS v
                        ${filtro}
                        ORDER BY v.ID_TICKET, v.FECHA`;

                    db.query(sql2, (err3, items) => {
                        db.detach();
                        if (err3) return res({ ok: false, error: err3.message });
                        res({
                            ok: true,
                            tickets,
                            items,
                            diag: {
                                totalRows,
                                fechaMin: diag.FECHA_MIN,
                                fechaMax: diag.FECHA_MAX,
                            }
                        });
                    });
                });
            });
        });
    });
});

// ── Qendra Firebird: visor de tickets de hoy ──────────────────────────────
ipcMain.handle('qendra-get-today-tickets', async (event, horas = 8) => {
    return new Promise((resolve) => {
        firebirdAttachWithRetry(resolve, (db, res) => {
            const h = Math.abs(parseInt(horas)) || 8;
            // Sin strings con posibles acentos; CAST a DOUBLE para evitar overflow
            const sql = `
                SELECT
                    v.ID_TICKET,
                    MIN(v.FECHA) AS FECHA,
                    CAST(SUM(CAST(v.IMPORTE AS DOUBLE PRECISION)) AS DOUBLE PRECISION) AS TOTAL,
                    CAST(SUM(CAST(v.PESO    AS DOUBLE PRECISION)) AS DOUBLE PRECISION) / 1000.0 AS KG_TOTAL,
                    COUNT(*) AS CANT_ITEMS
                FROM VENTAS v
                WHERE v.FECHA >= DATEADD(-${h} HOUR TO CURRENT_TIMESTAMP)
                GROUP BY v.ID_TICKET
                ORDER BY MIN(v.FECHA) DESC`;
            db.query(sql, (err2, tickets) => {
                if (err2) {
                    db.detach();
                    return res({ ok: false, error: err2.message });
                }
                // Items: solo numéricos + ID_PLU; sin DESCRIPCION (posibles acentos)
                const sql2 = `
                    SELECT
                        v.ID_TICKET,
                        v.ID_PLU,
                        CAST(v.PESO    AS DOUBLE PRECISION) / 1000.0 AS PESO_KG,
                        CAST(v.IMPORTE AS DOUBLE PRECISION)           AS IMPORTE
                    FROM VENTAS v
                    WHERE v.FECHA >= DATEADD(-${h} HOUR TO CURRENT_TIMESTAMP)
                    ORDER BY v.ID_TICKET, v.PESO DESC`;
                db.query(sql2, (err3, items) => {
                    db.detach();
                    if (err3) return res({ ok: false, error: err3.message });
                    res({ ok: true, tickets, items });
                });
            });
        });
    });
});

// ── Qendra Firebird: diagnóstico de instalación ───────────────────────────
ipcMain.handle('qendra-check-firebird', async () => {
    const fs = require('fs');
    const result = { services: [], paths: [], port3050: false, dbExists: false };

    // 1. Verificar si el archivo .fdb existe
    result.dbExists = fs.existsSync('C:\\Qendra\\qendra.fdb');

    // 2. Verificar carpetas de instalación de Firebird Y DLLs embebidos de QENDRA
    const fbPaths = [
        'C:\\Program Files\\Firebird',
        'C:\\Program Files (x86)\\Firebird',
        'C:\\Firebird',
        'C:\\Program Files\\Firebird\\Firebird_3_0',
        'C:\\Program Files\\Firebird\\Firebird_2_5',
        ...QENDRA_DLL_PATHS,
    ];
    for (const p of fbPaths) {
        if (!fs.existsSync(p)) continue;
        // Buscar fbclient.dll o fbembed.dll dentro de la carpeta
        const dlls = ['fbclient.dll', 'fbembed.dll', 'gds32.dll'];
        const found = dlls.filter(d => fs.existsSync(p + '\\' + d));
        result.paths.push({ path: p, dlls: found });
    }

    // 3. Verificar servicios de Windows con sc query
    await Promise.all(FIREBIRD_SERVICES.map(svc => new Promise(r => {
        exec(`sc query "${svc}" 2>nul`, (err, stdout) => {
            if (!err && stdout) {
                const running = stdout.includes('RUNNING');
                result.services.push({ name: svc, running });
            }
            r();
        });
    })));

    // 4. Verificar si el puerto 3050 está escuchando
    await new Promise(r => {
        exec('netstat -ano | findstr ":3050"', (err, stdout) => {
            if (!err && stdout && stdout.includes('3050')) result.port3050 = true;
            r();
        });
    });

    return result;
});

// ── Qendra Firebird: listar tablas ──────────────────────────────────────────
ipcMain.handle('qendra-list-tables', async () => {
    return new Promise((resolve) => {
        firebirdAttachWithRetry(resolve, (db, res) => {
            db.query(
                "SELECT TRIM(RDB$RELATION_NAME) AS TABLA FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 ORDER BY RDB$RELATION_NAME",
                (err2, rows) => {
                    db.detach();
                    if (err2) return res({ ok: false, error: err2.message });
                    res({ ok: true, tables: rows.map(r => r.TABLA) });
                }
            );
        });
    });
});

// ── Qendra Firebird: importar PLUs ──────────────────────────────────────────
ipcMain.handle('qendra-import-plus', async (event, tableName) => {
    return new Promise((resolve) => {
        const table = tableName || 'PLU';

        // Con charset NONE + BLOB OCTETS, Firebird 2.5 devuelve bytes crudos
        // sin validar el charset declarado en la columna (ASCII con datos WIN1252).
        const cfgTcp = { ...QENDRA_DB_TCP, charset: 'NONE' };
        const cfgEmb = { ...QENDRA_DB_EMBEDDED, charset: 'NONE' };

        // Lee cualquier campo: Buffer → latin1, función BLOB → stream → latin1, string → string
        const readField = (val) => new Promise((rs) => {
            if (val === null || val === undefined) return rs('');
            if (Buffer.isBuffer(val)) return rs(val.toString('latin1'));
            if (typeof val === 'string') return rs(val);
            if (typeof val === 'function') {
                // BLOB field: llamar la función para obtener el stream
                val((err, name, emitter) => {
                    if (err || !emitter) return rs('');
                    const chunks = [];
                    emitter.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                    emitter.on('end', () => rs(Buffer.concat(chunks).toString('latin1')));
                    emitter.on('error', () => rs(''));
                });
            } else {
                rs(String(val));
            }
        });

        const runQuery = (db) => {
            // 1. Detectar columna de descripción en SECCIONES via tabla del sistema
            const sysSql = `SELECT TRIM(RDB$FIELD_NAME) AS COL_NAME FROM RDB$RELATION_FIELDS
                            WHERE TRIM(RDB$RELATION_NAME) = 'SECCIONES' AND RDB$SYSTEM_FLAG = 0
                            ORDER BY RDB$FIELD_POSITION`;
            db.query(sysSql, (errSys, sysRows) => {
                let secColName = null;
                if (!errSys && sysRows && sysRows.length > 0) {
                    const keys = sysRows.map(r => (r.COL_NAME || '').trim());
                    const candidates = ['DESCRIPCION', 'NOMBRE', 'DESC', 'NOMBRE_SECCION', 'DESCRIP'];
                    secColName = candidates.find(c => keys.includes(c))
                        || keys.find(k => k !== 'ID') || null;
                }

                const fetchPLU = (seccionMap) => {
                    // VARCHAR CHARACTER SET OCTETS: bytes crudos como Buffer en Node.
                    // Eliminamos MODIFBY/ULTIMA_MODIF que causaban el error original.
                    const sql = `
                        SELECT p.ID, p.ID_SECCION,
                               CAST(p.DESCRIPCION AS VARCHAR(250) CHARACTER SET OCTETS) AS DESCRIPCION,
                               p.PRECIO, p.PRECIO2, p.TARA, p.VENCIMIENTO
                        FROM ${table} p
                        WHERE p.PRECIO > 0
                        ORDER BY p.ID`;
                    db.query(sql, async (err2, rows) => {
                        if (err2) { db.detach(); return resolve({ ok: false, error: err2.message, tried: table }); }
                        try {
                            const rowsConSeccion = await Promise.all(rows.map(async (r) => ({
                                ID: r.ID,
                                ID_SECCION: r.ID_SECCION,
                                DESCRIPCION: await readField(r.DESCRIPCION),
                                PRECIO: r.PRECIO,
                                PRECIO2: r.PRECIO2,
                                TARA: r.TARA,
                                VENCIMIENTO: r.VENCIMIENTO,
                                SECCION: seccionMap[r.ID_SECCION] || '',
                            })));
                            db.detach();
                            resolve({ ok: true, rows: rowsConSeccion, table });
                        } catch (e) {
                            db.detach();
                            resolve({ ok: false, error: e.message, tried: table });
                        }
                    });
                };

                if (secColName) {
                    db.query(`SELECT ID, CAST(${secColName} AS VARCHAR(250) CHARACTER SET OCTETS) AS NOMBRE_SEC FROM SECCIONES`, async (errS2, secRows) => {
                        const seccionMap = {};
                        if (!errS2 && secRows) {
                            await Promise.all(secRows.map(async (s) => {
                                seccionMap[s.ID] = await readField(s.NOMBRE_SEC);
                            }));
                        }
                        fetchPLU(seccionMap);
                    });
                } else {
                    fetchPLU({});
                }
            });
        };

        // TCP primero, fallback embedded
        Firebird.attach(cfgTcp, (err, db) => {
            if (!err) return runQuery(db);
            Firebird.attach(cfgEmb, (err2, db2) => {
                if (!err2) return runQuery(db2);
                resolve({ ok: false, error: `TCP: ${err.message} | Embedded: ${err2.message}` });
            });
        });
    });
});
// ───────────────────────────────────────────────────────────────────────────

// ── Qendra Firebird: actualizar precio de un PLU ────────────────────────────
ipcMain.handle('qendra-update-precio', async (event, plu, precio) => {
    return new Promise((resolve) => {
        const sql = 'UPDATE PLU SET PRECIO = ? WHERE ID = ?';
        const params = [parseFloat(precio), parseInt(plu)];
        const runUpdate = (db) => {
            db.query(sql, params, (err) => {
                db.detach();
                if (err) return resolve({ ok: false, error: err.message });
                resolve({ ok: true });
            });
        };
        Firebird.attach(QENDRA_DB_TCP, (err, db) => {
            if (!err) return runUpdate(db);
            Firebird.attach(QENDRA_DB_EMBEDDED, (err2, db2) => {
                if (!err2) return runUpdate(db2);
                resolve({ ok: false, error: `TCP: ${err.message} | Embedded: ${err2.message}` });
            });
        });
    });
});
// ───────────────────────────────────────────────────────────────────────────


let aiProcess = null;
let tgBot = null;

// Handle Telegram Bot IPC
ipcMain.on('start-tg-bot', async (event, { token, model }) => {
    if (tgBot) {
        console.log("Stopping previous bot instance...");
        await tgBot.stopPolling();
        tgBot = null;
    }
    try {
        tgBot = new TelegramBot(token, { polling: true });
        console.log("Telegram Bot started in Main process.");

        tgBot.on('message', (msg) => {
            if (!msg.text) return;
            const chatId = msg.chat.id;
            const text = msg.text;
            event.sender.send('tg-message', { chatId, text });
        });
    } catch (err) {
        console.error("TG Bot Start Error:", err);
    }
});

ipcMain.on('stop-tg-bot', () => {
    if (tgBot) {
        tgBot.stopPolling();
        tgBot = null;
    }
});

ipcMain.on('send-tg-reply', (event, { chatId, text }) => {
    if (tgBot) tgBot.sendMessage(chatId, text);
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

/**
 * Start the AI Engine (Ollama)
 */
function checkAndStartAI(window) {
    // 1. Check if Ollama is already running system-wide
    exec('tasklist', (err, stdout) => {
        if (stdout.toLowerCase().includes('ollama.exe')) {
            console.log("Ollama is already running.");
            window.webContents.send('ai-status', { status: 'ready', message: 'Cerebro conectado (Ext)' });
            return;
        }

        // 2. Try to start local/portable Ollama if bundled
        // In dev, we might just assume it needs to be started manually or by the system
        // But for "Magic", we'd look in resources/bin/ollama.exe
        const localOllamaPath = path.join(process.resourcesPath, 'bin', 'ollama.exe');

        console.log("Starting Local AI Engine...");
        window.webContents.send('ai-status', { status: 'starting', message: 'Iniciando Cerebro Local...' });

        // For now, we attempt to run 'ollama serve' assuming it's in the PATH or bundled
        aiProcess = spawn('ollama', ['serve']);

        aiProcess.on('error', (err) => {
            console.error("Failed to start AI:", err);
            window.webContents.send('ai-status', { status: 'error', message: 'Error al iniciar IA' });
        });

        aiProcess.stdout.on('data', (data) => {
            if (data.toString().includes('Listening')) {
                window.webContents.send('ai-status', { status: 'ready', message: 'Cerebro En línea' });
            }
        });
    });
}

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        icon: path.join(__dirname, '../public/pwa-512x512.png') // Use existing icon
    });

    // Load the index.html of the app.
    // In development, we load the Vite dev server.
    // In production, we load the built index.html.
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        // Use the Vite dev server URL (default 5173 unless overridden).
        const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
        mainWindow.loadURL(devServerUrl);
        // Open the DevTools.
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Ctrl+Shift+I abre DevTools en cualquier modo (debug en producción)
    const { globalShortcut } = require('electron');
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        mainWindow.webContents.toggleDevTools();
    });

    // ── Web Serial API: permisos y selección de puerto ──────────────────────
    mainWindow.webContents.session.setPermissionCheckHandler((wc, permission) => {
        if (permission === 'serial') return true;
        return null;
    });

    mainWindow.webContents.session.setDevicePermissionHandler((details) => {
        if (details.deviceType === 'serial') return true;
        return false;
    });

    mainWindow.webContents.session.on('select-serial-port', (event, portList, wc, callback) => {
        event.preventDefault();

        const send = (type, msg) => mainWindow.webContents.send('scale-diagnostic', { type, msg });

        if (portList.length === 0) {
            send('error', 'No se encontraron dispositivos USB con drivers de balanza instalados.');
            send('info',  'Verificá: cable USB conectado, balanza encendida, driver del fabricante instalado.');
            callback('');
            return;
        }

        const names = portList.map(p => p.displayName || p.portName || p.portId);
        send('info', `Se encontraron ${portList.length} puerto(s) COM disponible(s): ${names.join(' | ')}`);

        if (portList.length === 1) {
            send('success', `Balanza detectada: "${names[0]}" — seleccionada automáticamente.`);
            callback(portList[0].portId);
            return;
        }

        // Más de un puerto: mostrar diálogo de selección
        send('info', 'Se encontraron varios puertos. Mostrando selector para elegir cuál es la balanza...');
        const buttons = [...names, 'Cancelar'];

        dialog.showMessageBox(mainWindow, {
            type: 'question',
            title: 'Seleccioná el puerto de la balanza',
            message: 'Se encontraron varios puertos COM. ¿Cuál corresponde a la balanza?',
            buttons,
            cancelId: buttons.length - 1,
        }).then(({ response }) => {
            if (response === buttons.length - 1) {
                send('warn', 'Selección cancelada por el usuario.');
                callback('');
            } else {
                send('success', `Puerto seleccionado: "${buttons[response]}"`);
                callback(portList[response].portId);
            }
        });
    });
    // ────────────────────────────────────────────────────────────────────────

    // Start AI Magic
    mainWindow.webContents.on('did-finish-load', () => {
        checkAndStartAI(mainWindow);
    });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (aiProcess) aiProcess.kill();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
