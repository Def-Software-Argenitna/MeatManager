# MeatManager Bridge

Bridge local entre Firebird/Qendra y MySQL cloud para sincronizar artículos/PLUs y tickets de balanza.

## Arquitectura

```text
MeatManager Web (MySQL cloud)
        ^
        | HTTPS / API
        v
Bridge local en la PC de la balanza
        ^
        | Firebird local (qendra.fdb)
        v
Qendra / impresora / balanza
```

La web no toca Firebird directo. El bridge corre en la misma PC que Qendra y hace de intermediario.

## Stack

- Node.js 22+
- `node-firebird`
- `mysql2`
- `dotenv`

## Qué sincroniza

- MySQL -> Firebird:
  - `products` hacia `PLU`
  - marca `EQUIPOS.NOVEDADES = 1` si existe
  - escribe en `NOVEDADES` y `BARCODE_TICKETS` si las tablas existen
- Firebird -> MySQL:
  - tickets desde `VENTAS`
  - items hacia `ventas_items`
  - movimientos hacia `stock`

## Idempotencia

- Productos:
  - huella por `product_id` + `plu` + nombre + precio
  - tabla `qendra_bridge_product_map`
- Tickets:
  - huella por `ID_TICKET` + fecha + total + items
  - tabla `qendra_bridge_ticket_map`

## Ticket barcode

- El bridge genera un barcode compacto de hasta 32 caracteres.
- Guarda el valor en:
  - `ventas.receipt_code`
  - `ventas.ticket_barcode`
  - `qendra_bridge_ticket_map.ticket_barcode`
- `ventas.qendra_ticket_id` conserva el ID de origen de Firebird.

## Instalación

1. Instalar dependencias:

```bash
cd MeatManager-Bridge
npm install
```

2. Copiar `.env.example` a `.env` y ajustar credenciales.
3. Ejecutar el SQL base de `sql/mysql/001_qendra_bridge_schema.sql` en la nube.
4. Iniciar el bridge:

```bash
npm start
```

## Variables de entorno

- `BRIDGE_DEVICE_ID`
- `BRIDGE_NAME`
- `BRIDGE_SITE_NAME`
- `MYSQL_TENANT_ID`
- `MYSQL_BRANCH_ID`
- `FIREBIRD_DB_FILE`
- `FIREBIRD_HOST`
- `FIREBIRD_PORT`
- `FIREBIRD_USER`
- `FIREBIRD_PASSWORD`
- `FIREBIRD_DEFAULT_SECTION_ID`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_SSL`
- `SYNC_INTERVAL_MS`
- `TICKET_LOOKBACK_DAYS`
- `PRODUCT_LOOKBACK_HOURS`
- `HTTP_PORT`
- `STATE_FILE`
- `LOG_FILE`

## Endpoints locales

- `GET /health`
- `GET /state`
- `POST /run`

## Supuestos

- `PLU.ID` existe y se usa como clave en Firebird.
- `VENTAS.ID_TICKET`, `VENTAS.FECHA`, `VENTAS.ID_PLU`, `VENTAS.PESO`, `VENTAS.IMPORTE` existen.
- Qendra sigue siendo el responsable de empujar los PLUs a la balanza.
- El bridge no modifica la comunicación física con la impresora/balanza.

## Pruebas rápidas

- Ejecutar una vez:

```bash
npm run once
```

- Ver health:

```bash
curl http://127.0.0.1:4045/health
```

## Riesgos

- Si Firebird tiene una estructura distinta, el bridge usa detección dinámica y fallback seguro.
- Si MySQL cae, el bridge sigue reintentando en el siguiente ciclo.
- Si la tabla `BARCODE_TICKETS` no existe, el bridge sigue funcionando y solo guarda el barcode en MySQL.
