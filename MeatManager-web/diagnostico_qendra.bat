@echo off
echo Diagnostico QENDRA - MeatManager
echo ==================================

:: Buscar node.exe en rutas comunes de la app instalada
set NODE_EXE=
if exist "%LOCALAPPDATA%\Programs\MeatManager\resources\app\node_modules\.bin\node.exe" (
    set NODE_EXE=%LOCALAPPDATA%\Programs\MeatManager\resources\app\node_modules\.bin\node.exe
)

:: Intentar con node del sistema
where node >nul 2>&1
if %errorlevel%==0 (
    set NODE_EXE=node
)

if "%NODE_EXE%"=="" (
    echo ERROR: No se encontro node.exe. Abri MeatManager y usa el diagnostico desde la app.
    pause
    exit /b 1
)

:: Buscar node-firebird en la app instalada
set FB_PATH=%LOCALAPPDATA%\Programs\MeatManager\resources\app\node_modules\node-firebird

if not exist "%FB_PATH%" (
    :: Probar dist_electron
    set FB_PATH=%~dp0dist_electron\win-unpacked\resources\app\node_modules\node-firebird
)

echo Node: %NODE_EXE%
echo node-firebird: %FB_PATH%
echo.

%NODE_EXE% -e "
const Firebird = require('%FB_PATH:\=/%');
const opts = { host: '127.0.0.1', port: 3050, database: 'C:/Qendra/qendra.fdb', user: 'SYSDBA', password: 'masterkey', lowercase_keys: false, charset: 'NONE' };
console.log('Intentando TCP...');
Firebird.attach(opts, (err, db) => {
  if(err) {
    console.log('TCP fallo: ' + err.message);
    console.log('Intentando embedded...');
    const opts2 = { database: 'C:/Qendra/qendra.fdb', user: 'SYSDBA', password: 'masterkey', lowercase_keys: false, charset: 'NONE' };
    Firebird.attach(opts2, (err2, db2) => {
      if(err2) { console.log('Embedded fallo: ' + err2.message); return; }
      runQuery(db2);
    });
    return;
  }
  runQuery(db);
});

function runQuery(db) {
  console.log('CONECTADO OK');
  db.query('SELECT FIRST 10 p.ID, CAST(p.DESCRIPCION AS VARCHAR(250) CHARACTER SET OCTETS) AS DESC_, p.PRECIO FROM PLU p ORDER BY p.ID', [], (err, rows) => {
    if(err) { console.log('ERROR: ' + err.message); db.detach(); return; }
    rows.forEach(r => {
      const desc = r.DESC_ ? (Buffer.isBuffer(r.DESC_) ? r.DESC_.toString('latin1') : String(r.DESC_)) : '';
      console.log('PLU ' + r.ID + ' | ' + desc + ' | PRECIO: ' + r.PRECIO);
    });
    db.detach();
  });
}
" 2>&1

echo.
pause
