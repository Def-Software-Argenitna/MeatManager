# MeatManager Cuora Direct Bridge

Bridge local para hablar directo con balanza **Systel CUORA MAX** por USB/COM, sin pasar por Qendra.

## Flujo

```text
MySQL (productos) -> Bridge -> CUORA MAX (funcion 4/61 segun firma)
MySQL (scale_users) -> Bridge -> CUORA MAX (funcion 38, vendedores 1..4)
CUORA MAX (funcion 72) -> Bridge -> MySQL (tabla scale_bridge_sales_item)
```

## Funciones de protocolo usadas

- `23`: ping/estado
- `2`: firma digital
- `10`: alta/actualizacion de sector
- `38`: alta/actualizacion de vendedor (slots 1..4)
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

## App de escritorio (tray + autostart + updater)

Esta version incluye scaffold de escritorio `MeatManager Bridge` con:

- icono en bandeja del sistema (tray),
- ventana de estado,
- arranque automatico con Windows,
- bridge ejecutandose en segundo plano,
- chequeo de updates desde GitHub Releases.

### Variables de auto-update (GitHub Releases)

Definir en entorno de la app desktop:

- `BRIDGE_UPDATE_OWNER` (usuario/organizacion GitHub)
- `BRIDGE_UPDATE_REPO` (repositorio)

Si no se definen, el bridge funciona normal pero sin update automatico.

### Comandos desktop

```bash
npm run start:desktop
```

Empaquetado de prueba:

```bash
npm run pack:desktop
```

Instalador Windows NSIS:

```bash
npm run dist:desktop
```

Notas:

- En modo desktop, el runtime del bridge se guarda en `%APPDATA%/MeatManager Bridge/runtime`.
- `public/branding/def-software-tray.png` y `def-software-tray-update.png` son los iconos base de tray.
- Si el repo tiene `repository.url` apuntando a GitHub, el updater usa ese destino por defecto.

## Releases desde GitHub (auto-update)

Hay workflow en:

- `.github/workflows/bridge-desktop-release.yml`

Publica instalador al pushear tags:

- `bridge-v0.1.0`
- `bridge-v0.1.1`

Para firma digital en Windows (opcional), configurar secrets del repo:

- `CSC_LINK` (certificado code-signing en base64 o URL)
- `CSC_KEY_PASSWORD`

Si no hay certificado, el instalador se publica sin firma (puede mostrar advertencia de editor desconocido en Windows).

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
