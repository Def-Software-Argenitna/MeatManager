# Monitor de estado del Bridge — Diseño

**Fecha:** 2026-06-11
**Estado:** Aprobado (diseño), pendiente de plan de implementación

## Problema

Hoy no hay forma de saber, desde la web, si el MeatManager Bridge de un local está
instalado, corriendo, sincronizando bien, en qué versión, y si está actualizado.
La pantalla Config Balanza solo muestra un banner estático ("Se requiere MeatManager
Bridge instalado y en ejecución…") sin reflejar el estado real. Diagnosticar requiere
acceso remoto a la PC (AnyDesk/SSH), como se vivió durante la estabilización del bridge.

## Objetivo

Dos vistas alimentadas por la misma señal:
1. **Dueño del local** — tarjeta en Config Balanza: semáforo de estado, versión, si está
   al día, si la balanza responde, hace cuánto se leyó la última venta.
2. **DEF Software (soporte)** — panel en AdminPanel con todos los bridges de todos los
   clientes: versión, online/offline, última sync, y acciones remotas.

Fuera de alcance (YAGNI por ahora): alertas proactivas por mail/notificación, histórico
de estado, métricas de latencia detalladas.

## Arquitectura y flujo de datos

No se agrega infraestructura nueva. Se reutiliza el canal existente:

```
Bridge (cada 5s)                 API                          Web
─────────────────                ───                          ───
sendHeartbeat()  ──POST────────► /api/bridge/heartbeat        ConfigBalanza (tarjeta)
  + bloque `agent`               persiste en bridge_devices   GET /api/scale/bridge/status
  {version, syncState}           (lastSeenAt + agent fields)
                                                               AdminPanel (panel global)
                                 getLatestBridgeVersion()      GET /api/admin/bridges
                                 (GitHub latest, cache 10m)
                                                               acciones → POST .../command
                                                               (ya existe)
```

- El estado "vive" en la fila de `bridge_devices` del dispositivo, actualizado en cada
  heartbeat. La web hace **polling** (~15s) a los endpoints de lectura. No hay websockets.
- "Online" se deriva de la antigüedad del último heartbeat, no de un flag persistido.

## Componente 1 — Bridge (qué reporta)

**`src/index.js` → `sendHeartbeat()`**: el body del POST incluye un objeto `agent`:

| Campo | Origen | Significado |
|---|---|---|
| `version` | env `BRIDGE_APP_VERSION` (lo pasa el desktop) | versión que corre |
| `lastRunStatus` | `state.lastRunStatus` | `ok` / `error` / `idle` |
| `lastTicketSyncAt` | `state.lastTicketSyncAt` | última venta leída de la balanza |
| `scaleReachable` | `state.scaleReachable` | si la balanza física responde |
| `lastError` | `state.lastError` | último error (string, recortado) |
| `recentE3Count` | contador rodante nuevo en `pullSales` | saturación del puerto serie en los últimos ~5 min |

**`src/api-client.js` → `postHeartbeat`**: acepta y reenvía el objeto `agent` además de `scales`.

**`desktop/main.js`**: en el `fork` del proceso hijo, agregar `BRIDGE_APP_VERSION: app.getVersion()`
al env (junto a los `BRIDGE_APP_DATA_DIR` / `HTTP_PORT` que ya pasa). El hijo corre con
`ELECTRON_RUN_AS_NODE` y no tiene acceso a `app.getVersion()`, por eso se inyecta por env.

**`recentE3Count`**: el bridge mantiene una lista de timestamps de respuestas `E3` de fn72
(la balanza "desatendió" el comando = saturación), purgando los > 5 min. El heartbeat
reporta el largo de esa lista. Liviano, en memoria, no se persiste.

## Componente 2 — API

**Migración (`bridge_devices`, en CLIENTS_DB):** agregar con patrón `ensureColumn` contra
el pool de control:
- `app_version VARCHAR(20) NULL`
- `last_run_status VARCHAR(16) NULL`
- `last_ticket_sync_at DATETIME NULL`
- `scale_reachable TINYINT(1) NULL`
- `last_error VARCHAR(255) NULL`
- `recent_e3_count INT NULL`
- `agent_reported_at DATETIME NULL`

**`/api/bridge/heartbeat`** (ya existe, `verifyBridgeDeviceToken`): parsear `req.body.agent`
y persistir esos campos en la fila del device (`agent_reported_at = NOW()`). El parseo es
defensivo: bridges viejos que no mandan `agent` siguen funcionando (campos quedan NULL).

**`getLatestBridgeVersion()`** (nueva): consulta
`https://api.github.com/repos/<owner>/<repo>/releases/latest`, extrae `tag_name`
(formato `bridge-vX.Y.Z`), cachea en memoria con TTL 10 min. Owner/repo del mismo lugar que
`resolveGithubPublishTarget` usa el bridge. Si falla (red/rate-limit), devuelve `null` →
la web muestra "no se pudo verificar la versión", sin romper.

**`GET /api/scale/bridge/status`** (nuevo, `verifyFirebaseToken`): resuelve el tenant del
usuario, devuelve el/los bridge(s) de ese tenant con estado computado (ver Componente 4).

**`GET /api/admin/bridges`** (nuevo, `verifyFirebaseToken` + guard admin DEF Software, el
mismo que protege AdminPanel): devuelve todos los bridges de todos los tenants con el mismo
estado computado + datos de cliente/sucursal.

**`POST /api/scale/bridge/command`**: ya existe (restart / restart_app / apply_update).

## Componente 3 — Cálculo de estado (compartido server-side)

Una función `computeBridgeHealth(deviceRow, latestVersion, now)` que devuelve:
```
{
  online: boolean,            // (now - lastSeenAt) < 30s  ← lastSeenAt SIEMPRE se actualiza
  status: 'ok'|'warn'|'down'|'unknown',
  version: string|null,
  isUpToDate: boolean|null,   // null si no se pudo verificar latest
  scaleReachable: boolean|null,
  lastTicketSyncAt: iso|null,
  reasons: string[]           // p.ej. ['balanza no responde','desactualizado']
}
```
Reglas (usan `lastSeenAt` para vivacidad y los campos `agent` para detalle):
- `unknown`: device ACTIVE que nunca reportó (`lastSeenAt` NULL).
- `down`: sin heartbeat > 30s.
- `warn`: online pero (balanza no responde) OR (desactualizado) OR (recentE3Count > 0)
  OR (lastRunStatus === 'error'). Si el bridge es viejo y no manda `agent`, solo puede
  caer en `warn` por desactualizado (versión desconocida ⇒ se trata como desactualizado).
- `ok`: online y nada de lo anterior.

Umbral online = 30s (heartbeat cada 5s → 6 latidos perdidos). Configurable por env.
`agent_reported_at` se usa solo para marcar si los campos de detalle (sync/scale/error)
son frescos; la vivacidad online/down siempre se calcula con `lastSeenAt`.

## Componente 4 — Web

**`ConfiguracionBalanza.jsx` (dueño):** reemplazar el banner estático por una tarjeta de
estado que consume `GET /api/scale/bridge/status` (polling 15s):
- Semáforo + texto: "Balanza conectada y al día ✓" / "Atención: …" / "Bridge desconectado".
- Línea de detalle: versión, última venta hace X, balanza responde sí/no.
- Si hay actualización disponible y el usuario es admin: botón "Actualizar bridge".
- Botón "Reiniciar bridge" (admin). Ambos → `POST /api/scale/bridge/command`.
- Mantener el texto de ayuda si el bridge nunca se reportó (estado `unknown`).

**`AdminPanel.jsx` (DEF Software):** sección/tab nueva "Bridges" con tabla desde
`GET /api/admin/bridges` (polling 15s): cliente, sucursal, versión, semáforo, última sync,
online/offline, columna de acciones (reiniciar / actualizar). Ordenable; los que están en
`warn`/`down` se destacan arriba.

**Util apiClient:** agregar los wrappers `getBridgeStatus()`, `getAdminBridges()`,
`sendBridgeCommand(type)`.

## Manejo de errores

- Heartbeat sin `agent` (bridge viejo): campos NULL, estado se computa con lo disponible
  (online por `lastSeenAt`, versión "desconocida").
- GitHub inaccesible: `isUpToDate = null`, la web muestra "versión no verificada".
- Comando remoto a un bridge offline: se encola igual (seq en settings); se ejecuta cuando
  el bridge vuelve. La web aclara "se aplicará cuando el bridge reconecte".
- Endpoint admin con usuario no-DEF: 403.

## Testing

- **Bridge:** unit test de que `sendHeartbeat` arma el bloque `agent` con los campos
  esperados desde un `state` dado; test del contador rodante de E3 (purga > 5 min).
- **API:** test de `getLatestBridgeVersion` (parseo de `tag_name` + comparación semver,
  incluyendo cache y fallo de red → null); test de `computeBridgeHealth` cubriendo los
  cuatro estados y los umbrales.
- **Web:** smoke manual contra el cliente real (Tailscale) — tarjeta refleja online/al-día,
  y el botón de acción dispara el comando.

## Archivos afectados

- Bridge: `src/index.js`, `src/api-client.js`, `src/scale-bridge.js` (contador E3),
  `desktop/main.js`, `tools/test_*.js`.
- API: `server.js` (migración, heartbeat, getLatestBridgeVersion, 2 endpoints GET,
  computeBridgeHealth) + su test.
- Web: `src/pages/ConfiguracionBalanza.jsx`, `src/pages/AdminPanel.jsx`,
  `src/utils/apiClient.js`.

## Decisiones tomadas

- **Última versión vía GitHub `latest` (enfoque A)**, cache 10 min. Migrar a override
  manual (híbrido) queda como opción futura si se quiere rollout gradual.
- **Polling 15s** desde la web en vez de websockets — simple y suficiente.
- **Sin alertas proactivas** en esta iteración.
- Acciones remotas reutilizan el endpoint de comandos ya existente (v0.4.17).
