# MeatManager Cuora Direct Bridge

Bridge local para hablar directo con balanza **Systel CUORA MAX** por USB/COM, sin pasar por Qendra.

## Flujo

```text
MySQL (productos) -> Bridge -> CUORA MAX (funcion 4/61 segun firma)
CUORA MAX (funcion 72) -> Bridge -> MySQL (tabla scale_bridge_sales_item)
```

## Funciones de protocolo usadas

- `23`: ping/estado
- `2`: firma digital
- `10`: alta/actualizacion de sector
- `4`: envio de PLU legacy (CUORA MAX V6)
- `5`: baja de PLU en balanza
- `8`: configuracion de codigo de barras (peso/unidad/suma)
- `61`: envio de PLU extendido
- `25`: finalizar sincronizacion y liberar equipo
- `72`: reporte de ventas por fecha
- `32`: cierre de ventas (opcional)

## Requisitos

- Node.js 22+
- Puerto COM visible de la balanza (ejemplo `COM3`)
- Credenciales de MySQL cloud

## Configuracion

Editar `.env`:

- `SCALE_PORT=COM3`
- `SCALE_BAUD_RATE=115200`
- `SCALE_ADDRESS=20`
- `BRIDGE_CLIENT_ID=4`
- `BRIDGE_BRANCH_ID=5`
- `MYSQL_*`
- `SYNC_INTERVAL_MS=5000` (ciclo general)
- `PRODUCT_SYNC_INTERVAL_MS=30000` (precio/descripcion/bajas)
- `SALES_RESYNC_SKEW_MINUTES=2` (relectura segura de ventas)
- `SCALE_PRICE_FORMAT_6D_MULTIPLIER=1` (si `precio_formato=6d` y no usas decimales, envia precio entero a CUORA V6)
- `SCALE_BARCODE_*` (formato de codigos impresos por la balanza)

## Ejecucion

```bash
npm install
npm start
```

Ejecucion unica:

```bash
npm run once
```

## Endpoints locales

- `GET /health`
- `GET /state`
- `GET /api/scale/ports`
- `POST /api/scale/ping`
- `POST /api/scale/signature`
- `POST /api/scale/sync-products`
- `POST /api/scale/pull-sales`
- `POST /api/run`

## Persistencia MySQL (auto)

El bridge crea/usa:

- `scale_bridge_product_map`
- `scale_bridge_sales_item`

En `scale_bridge_sales_item` cada fila representa un item de un ticket e incluye:

- `ticket_id`: numero de venta
- `line_no`: numero de item dentro de esa venta
- `item_quantity` + `item_quantity_unit`: cantidad legible (`kg` o `un`)
- `amount`: importe del item
- `ticket_total_amount`: importe total del ticket repetido en cada linea
- `ticket_item_count`: cantidad total de items del ticket
- `ticket_barcode`: codigo general del ticket
- `printed_ticket_barcode`: codigo EAN impreso por la balanza para tickets de total (ejemplo `2220020090753`)
