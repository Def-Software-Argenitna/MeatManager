# Plan — MeatManager Bridge: onboarding, auth y multi-balanza

Documento de contexto y plan de trabajo. Vive en `.claude/` para acceso desde cualquier dispositivo vía OneDrive. No se commitea al repo.

---

## Contexto: cómo llegamos acá (sesión 2026-05-17)

Arrancamos resolviendo dos problemas reportados del Bridge:

1. **Latencia entre venta en balanza y disponibilidad del ticket en POS.** Cuando se hace una venta en la balanza y se escanea el ticket dentro del minuto, el POS no reconoce los artículos. Esperando un rato más sí funciona.
2. **Cambio de puerto COM requería reinstalar el bridge.** Al cambiar de balanza (COM5 → COM3), el bridge entraba en loop. Solo se solucionó desinstalando y reinstalando.

Mientras se diagnosticaba (1), surgió un **tercer problema más profundo**: el bridge no pide credenciales al instalar — viene con `MYSQL_USER=root` + password del server embebida. Cualquier PC con el bridge instalado tiene acceso total a la BD productiva. Y la identificación del cliente y la sucursal se hace por edición manual de archivos por un técnico.

---

## Lo que YA está hecho (en `dev`, sin mergear)

Cuatro commits en `dev` que resuelven (1) y arreglan el bug de BOM:

| Commit | Qué hace |
|---|---|
| `d44bcb5` fix(bridge): serializar puerto serie y separar locks de ciclo/pulse | Cola FIFO en `CuoraClient.send` + flags `cycleRunning`/`pulseRunning` separados. El sales pulse de 2s ya no se saltea cuando el ciclo general está corriendo. |
| `6bca842` perf(bridge): skip de sync productos y vendedores via high-watermark | Query barata `MAX(updated_at) + COUNT(*)` antes del sync pesado. Si nada cambió, se saltea sin tocar serial. |
| `41609bc` fix(api): subir red de seguridad del lookup de ticket resumen a 15s | `retryUntil` 7500 → 15000 ms en el lookup del POS. |
| `1aa9c18` fix(bridge): tolerar BOM UTF-8 en config-overrides.json | Stripear BOM antes de `JSON.parse`. PowerShell `Out-File` lo agrega y el bridge fallaba en silencio cayendo a defaults. |
| `a708173` chore(bridge): alinear version a 0.3.19 | Bump 0.1.0 → 0.3.19 alineado con la release publicada anterior (v0.3.18). |
| `145dca1` chore(bridge): publicar release directo, no como draft | `publish.releaseType: release` en electron-builder. |
| `0a268a4` fix(ci): fijar Python 3.11 en build del bridge desktop | Workflow runner trae Python 3.12+ que no tiene distutils; node-gyp lo necesita. |

**Release publicada:** `v0.3.19` (https://github.com/Def-Software-Argenitna/MeatManager/releases/tag/v0.3.19) — pero NO va a mergear a main hasta que el proyecto de onboarding también esté listo. Release único combinado.

**Tag existente:** `bridge-v0.3.19` apuntando al commit `1aa9c18` en `dev`.

---

## Decisiones tomadas

- **Acceso a datos:** Bridge → API → MySQL. El bridge deja de abrir MySQL directo. Toda lectura/escritura pasa por endpoints HTTP de la API con un `deviceToken`. El bridge nunca más tiene credenciales de DB.
- **Release combinado:** los fixes de latencia + el onboarding van en un mismo release grande, no en releases separadas.
- **Multi-balanza:** se hace junto con el onboarding (el shape ya está en `installation.json` + `devices/*.json`).
- **Selección de sucursal:** tras el login del admin, si el cliente tiene más de una sucursal, se le ofrece elegir cuál. Las ventas de las balanzas de este bridge se asignan a esa sucursal.

---

## Lo que pide el modelo final

Flow de onboarding:

1. **Primer arranque del bridge** → si no hay `installation.json` válido, levantar UI de configuración.
2. **UI pide email + password del admin** del cliente (el mismo que usa para entrar a `meatmanager.def-software.com`).
3. **POST `/api/bridge/auth/login`** → API valida contra Firebase Auth + `GestionClientes.client_users` (rol admin del tenant). Responde `{ sessionToken, tenantId, branches: [{id, name, internalCode}, ...] }` con las sucursales activas del tenant.
4. **UI muestra dropdown de sucursales** si hay más de una; si hay sola, autoselecciona.
5. **POST `/api/bridge/onboarding/complete`** con `{ sessionToken, branchId, hostname }`. API registra el bridge en una tabla nueva (`bridge_devices` o similar) y devuelve `deviceToken` plain (one-time).
6. **Bridge guarda `installation.json`** con `{ tenantId, branchId, deviceToken, branchName, clientName }`.
7. **Después se configuran las balanzas:** UI de "Balanzas" para dar de alta cada una con COM, address, baudRate. Cada balanza vive en `devices/scale-<id>.json`.
8. **Runtime:** el bridge usa `deviceToken` en cada request HTTP a la API. La API valida y resuelve `tenant_id`/`branch_id` del token — el bridge no decide a qué tenant escribe.

---

## Plan de fases

**Fase 0 — Mapeo (medio día de pase, no toca código productivo)**
- Listar exhaustivamente todas las queries MySQL que hace el bridge hoy en `MeatManager-Bridge/src/scale-bridge.js`. Eso da la lista cerrada de endpoints HTTP que necesita la API.
- Diseñar el schema de la tabla `bridge_devices` con `id, tenant_id, branch_id, device_id, device_token_hash, hostname, last_seen_at, revoked_at`.
- Diseñar el contrato de los endpoints (request/response de cada uno).
- Entregable: documento `.claude/bridge-api-contract.md`.

**Fase 1 — Backend del onboarding** (en `MeatManager-API`)
- Migración SQL para la tabla nueva.
- `POST /api/bridge/auth/login` — email/password → `sessionToken` corto + `tenantId` + lista de sucursales activas. Valida que el user sea admin del tenant.
- `POST /api/bridge/onboarding/complete` — `sessionToken + branchId + hostname` → persiste el bridge, devuelve `deviceToken` (only-time plain). El hash se guarda en DB.
- Middleware nuevo `requireDeviceToken` para los endpoints runtime.

**Fase 2 — Endpoints runtime del bridge** (en `MeatManager-API`)
- `GET /api/bridge/products` — productos del tenant del bridge.
- `POST /api/bridge/sales` — bulk de ventas escaneadas.
- `GET /api/bridge/vendors` — vendedores activos.
- `GET /api/bridge/settings` — settings runtime (precio formato, sección mappings, header del ticket, marquesina, formato de barcode).
- `POST /api/bridge/heartbeat` — keep-alive con info de balanzas conectadas y último timestamp de cada cosa.
- Todos autenticados con `deviceToken` y filtrados por su `tenant_id`/`branch_id`.

**Fase 3 — UI desktop del bridge** (en `MeatManager-Bridge/desktop/renderer/`)
- Pantalla "Configurar conexión" con form email/password.
- Pantalla "Elegir sucursal" con dropdown.
- Pantalla "Balanzas" con alta/baja/edición de devices (COM, address, baud, nombre).
- La pantalla principal de estado se reorganiza para mostrar el cliente, sucursal y N balanzas con sus estados individuales.

**Fase 4 — Runtime del bridge** (en `MeatManager-Bridge/src/`)
- Reemplazar `mysql.js` por un cliente HTTP a la API.
- Reescribir `scale-bridge.js` para que use los endpoints HTTP.
- Soporte multi-balanza: instanciar N `CuoraClient` desde `devices/*.json`, cada uno con su mutex y su loop de pulse de ventas independiente.
- Detectar `installation.json` válido al arrancar; si falta o no autoriza, levantar UI de onboarding.

**Fase 5 — Migración de clientes existentes**
- Detectar `config-overrides.json` legacy con `MYSQL_USER` → mostrar UI de "Re-autorizar este bridge" que fuerza login del admin para generar `installation.json` y `deviceToken`. Una vez confirmado, eliminar el `config-overrides.json` legacy.
- Avisar a los clientes (al menos al de Mario Cesar/Carnicería Cesar) antes del release para que tengan a mano las credenciales del admin.

**Estimación:** fase 0 medio día, fases 1+2 dos a tres días, fase 3 dos días, fase 4 dos a tres días, fase 5 medio día. Total ~1.5-2 semanas de trabajo enfocado.

---

## Datos útiles para retomar

**Tenants disponibles:**
- Tenant 1 — "Carniceria Fase 2 Demo" (`clientId=1`). **Usar este para pruebas.** Sucursales activas: Centro (id=1), Norte (id=2). 3 productos cargados con precio > 0.
- Tenant 4 — "Carniceria y Frigorifico Cesar" (cliente real, `clientId=4`). **NO usar para pruebas.** Tiene actualmente el bridge en producción en sucursal id=5 ("Sucursal 2 - Pilar").

**Tabla de sucursales:** `GestionClientes.branches` con columnas `id, clientId, name, internalCode, address, isBillable, status, createdAt, updatedAt`. Filtrar por `status='ACTIVE'`.

**Tabla de admins por cliente:** `GestionClientes.client_users` con columnas `firebaseUid, email, role, status`. Filtrar por `role='admin'` y `status='ACTIVE'`.

**Archivos clave del bridge runtime (ya generados pero no consumidos):**
- `%APPDATA%\MeatManager Bridge\runtime\data\installation.json` — shape correcto del modelo deseado: `auth.adminEmail`, `client.id/name`, `branch.id/name`, `devices[]`, `onboardingVersion`, `configuredAt`. Vestigios del diseño previo.
- `%APPDATA%\MeatManager Bridge\runtime\data\devices\scale-<id>.json` — config completa por balanza incluyendo MYSQL creds (a sacar).
- `%APPDATA%\MeatManager Bridge\runtime\data\config-overrides.json` — el que el bridge SÍ lee hoy. Tiene `MYSQL_USER=root` + password. A eliminar en fase 5.

**Bug histórico encontrado:** el `config-overrides.json` se guardaba con BOM UTF-8 (PowerShell `Out-File` lo agrega por default). `JSON.parse` fallaba en silencio y el bridge caía a defaults sin avisar. Fix ya commiteado en `1aa9c18` para futuro, pero los archivos existentes en clientes ya pueden tener BOM — el fix los maneja.

---

## Próximo paso concreto

Cuando retomes: arrancar con **Fase 0**. Mapear las queries MySQL del bridge en `scale-bridge.js`. Generar `.claude/bridge-api-contract.md` con la lista de endpoints, sus parámetros y sus responses. Sin tocar código de producción todavía.
