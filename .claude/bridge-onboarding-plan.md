# Estado del rediseño del MeatManager Bridge (0.4.x)

Documento de contexto en `.claude/` (no se commitea al repo, se sincroniza por OneDrive).

**Última actualización:** sesión 2026-05-17 (segunda parte).
**Estado:** implementación cerrada en `dev`. Falta validación end-to-end + merge a `main` + release final.

---

## Contexto: el problema que disparó esto

En la primera parte de la sesión 2026-05-17 se atacó la latencia de ventas balanza→POS. Investigando, salieron tres problemas más profundos:

1. El bridge venía con `MYSQL_USER=root` + password del server embebida en `config-overrides.json` — cualquiera con acceso al `.exe` o a `%APPDATA%\MeatManager Bridge` obtenía acceso total a la BD productiva.
2. El cliente y la sucursal se identificaban por edición manual de archivos por un técnico. Propenso a error.
3. Existían `installation.json` y `devices/*.json` con el shape correcto del modelo deseado, pero el código que los consumía no estaba implementado.

Se decidió rediseñar el bridge a fondo en lugar de parchar el modelo viejo. Resultado: serie 0.4.x.

---

## Decisiones que se tomaron y se mantuvieron

- **Acceso a datos:** Bridge → API → MySQL. El bridge **ya no abre MySQL**. Toda lectura/escritura pasa por endpoints HTTP de la API con un `deviceToken`.
- **Onboarding por wizard:** primer arranque sin `installation.json` → wizard pide email/pass del admin del cliente, deja elegir sucursal, genera `deviceToken`.
- **Multi-balanza:** estructura preparada (`scaleId` en config, `installation.json` con `devices[]`). Se ejecuta con `BRIDGE_SCALE_ID` por instancia.
- **Release combinado:** todo (fixes de latencia previos + rediseño) en una sola tanda de versiones 0.4.x.

---

## Qué se implementó (resumen de fases vs. plan original)

| Fase planeada | Estado | Commits clave |
|---|---|---|
| 0 — Mapeo de queries y contrato API | ✅ implícita, se hizo durante la migración | (sin commit separado) |
| 1 — Backend onboarding (`/api/bridge/auth/login`, `/onboarding/complete`) | ✅ | `f441385`, `ad6025b`, `4540765`, `2e06fdd` |
| 2 — Endpoints runtime (`/products`, `/sales`, `/vendors`, `/settings`, `/heartbeat`) | ✅ | `f441385`, `d8168ef`, `dc682d3` (postman) |
| 3 — UI desktop del wizard y status | ✅ | `9e90dc8`, `91418c0`, `2ad767a`, `8866409`, `ded8dfa`, `42c7ba7` |
| 4 — Runtime del bridge contra API | ✅ | `c66aa10`, `d5dea77`, `84c7769`, `1fb58df` |
| 5 — Migración de clientes legacy | ✅ | `08417f0`, `98c386a` (reset completo) |

---

## Extras que aparecieron en el camino y se resolvieron

- **Puerto 4045 estaba bloqueado por `undici`** (Fetch spec, bad ports — es `lockd`). El polling del desktop fallaba con "bad port" en silencio mientras `curl` desde terminal funcionaba bien. Migrado a 4046 (`1fb58df`). Documentado en memoria como `feedback_fetch_bad_ports.md`.
- **Tolerancia a balanza apagada/desconectada:** antes el ciclo entero rompía. Ahora el bridge sigue funcionando, marca `scaleReachable: false` y reintenta (`84c7769`).
- **Reset completo de balanza** (auto en primer arranque + botón manual): para limpiar PLUs viejos al cambiar de balanza física (`98c386a`).
- **BOM UTF-8 en `config-overrides.json`** (de la primera parte de la sesión): PowerShell `Out-File` agregaba BOM, `JSON.parse` fallaba en silencio, el bridge caía a defaults (`1aa9c18`).
- **Icono tray/instalador NSIS:** generación de `.ico` multi-resolución (`8866409`); fix de icono que no aparecía en builds packageados (`ded8dfa`).
- **Bug del autoUpdater** mostrando "Error de actualización" cuando simplemente no había update (`42c7ba7`).
- **API: `FIREBASE_WEB_API_KEY`** agregada a env del API (`4540765`) — el login del bridge usa Firebase REST API para verificar la password del admin, requiere esta key.
- **API: paths sin doble prefijo `/api`** (`d5dea77`).
- **API: login con resolución uniforme** con el resto del API (`ad6025b`).
- **Postman collection completa** para los endpoints del bridge (`d8168ef`, `dc682d3`, `fcb71dd`).

---

## Arquitectura final del bridge 0.4.1

**Archivos runtime en `%APPDATA%\MeatManager Bridge\runtime\data\`:**
- `installation.json` — escrito por el wizard. Contiene `apiBaseUrl`, `deviceToken`, `deviceId`, `tenantId`, `clientId`, `branchId`, `clientName`, `branchName`. Es la fuente de verdad de identidad y auth del bridge.
- `config-overrides.json` — legacy. Sigue existiendo para parámetros de scale (port, baud, etc.) y env override en dev. Ya no debe tener credenciales MySQL.
- `state.json` — estado runtime (watermarks, timestamps, fingerprints).
- `devices/scale-*.json` — config por balanza (legacy del modelo viejo, pendiente revisar si se sigue usando).

**Bridge runtime:**
- Gate `config.isOnboarded` al arrancar: si falta `apiBaseUrl` o `deviceToken`, el proceso sale con exit code 2 y un mensaje claro. El desktop levanta el wizard.
- `ApiClient` reemplaza completamente `mysql.js` y `client-directory.js` (eliminados de las deps: `package.json` ya no tiene `mysql2` ni `bcrypt`).
- HTTP local en **puerto 4046** (no 4045, por bad-port de undici).
- `scaleId` configurable por env para multi-instancia.

**Endpoints del API (`MeatManager-API/server.js`):**
- `POST /bridge/auth/login` — email/pass del admin → `sessionToken` + tenant + sucursales.
- `POST /bridge/onboarding/complete` — completa onboarding con `branchId` → devuelve `deviceToken`.
- `GET /bridge/products`, `POST /bridge/sales`, `GET /bridge/vendors`, `GET /bridge/settings`, `POST /bridge/heartbeat` — runtime, autenticados con `Bearer deviceToken`.

**Versión publicada:** `bridge-v0.3.19` en GitHub Releases. La 0.4.1 todavía no se taggeó (queda pendiente como último paso).

---

## Qué falta para cerrar

1. **Validación end-to-end con una PC real con balanza:**
   - Instalar 0.4.1 (corriendo el `.exe` build local o subiendo una release `bridge-v0.4.1-rc1`).
   - Pasar por el wizard completo (login admin, selección de sucursal).
   - Conectar la balanza física, validar sync de productos, ventas y heartbeats.
   - Probar el reset completo cuando se cambia de balanza.
2. **Merge `dev` → `main`** vía PR.
3. **Bump y tag definitivo:** si la 0.4.1 ya está en `package.json` y el código está en `dev`, taggear `bridge-v0.4.1` desde `main` después del merge. El workflow publica el release automático (ya configurado para no quedar draft).
4. **Comunicar a clientes con bridge instalado actualmente** (al menos Carnicería Cesar / tenant 4) que se viene una actualización mayor que va a pedirles re-onboarding con email/pass del admin. El reset y la limpieza de `config-overrides.json` legacy se hacen solos al onboardear.

---

## Datos útiles para retomar

**Tenants:**
- Tenant 1 — "Carnicería Fase 2 Demo" (`clientId=1`). 2 sucursales activas: Centro (id=1), Norte (id=2). Para pruebas.
- Tenant 4 — "Carnicería y Frigorífico Cesar" (cliente real). Tiene el bridge 0.3.x en producción (sucursal "Sucursal 2 - Pilar", branchId=5). NO usar para pruebas.

**Tablas:**
- `GestionClientes.branches` — sucursales (`id, clientId, name, status, ...`).
- `GestionClientes.client_users` — admins/empleados con `firebaseUid, email, role`.

**Postman:** ya hay collection y environment para los endpoints del bridge — chequear `MeatManager-API/postman/` o donde estén. baseUrl apunta a `meatmanager.demo.def-software.com`.

**Env vars críticas del API:** `FIREBASE_WEB_API_KEY` debe estar en `api-dev.env` / `api-main.env` del server self-hosted. El workflow CI ya la appendea (commit `4540765`), pero verificarlo si algo no funciona en el login del bridge.

**Puerto local del bridge:** 4046 (no 4045 — bad port). Si el desktop muestra "bridge no disponible" verificar primero que el puerto correcto está siendo polleado.
