# Logistica API

Este archivo resume el contrato base para unificar:

- `MeatManager-web`
- `MeatManager-mobile`
- `MeatManager-API`

La regla es:

- `Firebase Auth` solo para login
- `MeatManager-API` como fuente de verdad para pedidos, asignaciones, estados y tracking
- `Redis` para ubicacion viva
- `MySQL` para persistencia e historial

## Auth

Todas las rutas usan:

```http
Authorization: Bearer <firebase-id-token>
```

La mobile y la web deben enviar el `idToken` de Firebase.

## Estados de reparto

Estados normalizados:

- `pending`
- `assigned`
- `on_route`
- `arrived`
- `delivered`
- `failed`
- `cancelled`

Notas:

- `ready` en datos viejos se normaliza a `assigned`
- `en_reparto` o `in_route` se normaliza a `on_route`

## Endpoints

### GET `/api/delivery/me`

Devuelve el perfil logístico del usuario autenticado.

Respuesta ejemplo:

```json
{
  "ok": true,
  "profile": {
    "id": 12,
    "firebaseUid": "abc123",
    "email": "repartidor@cliente.com",
    "name": "Juan Perez",
    "role": "employee",
    "clientId": 1,
    "branchId": null,
    "logisticsEnabled": true,
    "licenses": []
  }
}
```

Uso:

- mobile: bootstrap de sesión del repartidor
- web: validar acceso a logística

### GET `/api/delivery/orders`

Para repartidor devuelve pedidos asignados.

Para admin:

- sin `scope=all`: asignados al usuario actual
- con `scope=all`: todos los pedidos delivery del cliente

Query params:

- `scope=all`
- `status=assigned,on_route`
- `limit=100`

Respuesta ejemplo:

```json
{
  "ok": true,
  "count": 2,
  "scope": "assigned",
  "orders": [
    {
      "id": 45,
      "customerId": 10,
      "customerName": "Juan Gomez",
      "items": [],
      "total": 25000,
      "status": "assigned",
      "rawStatus": "ready",
      "deliveryDate": "2026-04-05T17:00:00.000Z",
      "deliveryType": "delivery",
      "address": "Calle 123",
      "latitude": -34.6,
      "longitude": -58.38,
      "source": "manual",
      "createdAt": "2026-04-05T14:00:00.000Z",
      "assignedAt": "2026-04-05T14:30:00.000Z",
      "statusUpdatedAt": "2026-04-05T14:30:00.000Z",
      "driver": {
        "name": "Juan Perez",
        "firebaseUid": "uid-driver-1",
        "email": "repartidor@cliente.com"
      }
    }
  ]
}
```

### POST `/api/logistics/orders/:id/assign`

Asigna un pedido a un repartidor. Solo admin.

Body ejemplo:

```json
{
  "driverUserId": 9,
  "driverFirebaseUid": "uid-driver-1",
  "driverEmail": "repartidor@cliente.com",
  "driverName": "Juan Perez",
  "status": "assigned"
}
```

Respuesta:

```json
{
  "ok": true,
  "order": {
    "id": 45,
    "status": "assigned"
  }
}
```

### POST `/api/delivery/orders/:id/status`

Actualiza el estado de un pedido.

Body ejemplo:

```json
{
  "status": "on_route",
  "lat": -34.6,
  "lng": -58.38,
  "accuracy": 12,
  "speed": 8.5,
  "heading": 140
}
```

Uso:

- mobile: marcar `on_route`, `arrived`, `delivered`, `failed`
- web: admin puede actualizar manualmente si hace falta

### POST `/api/delivery/location`

Guarda ubicacion viva del repartidor en Redis y además deja evento en MySQL.

Body ejemplo:

```json
{
  "lat": -34.6,
  "lng": -58.38,
  "accuracy": 12,
  "speed": 8.5,
  "heading": 140,
  "orderId": 45,
  "status": "on_route"
}
```

Respuesta ejemplo:

```json
{
  "ok": true,
  "ttlSeconds": 120,
  "location": {
    "firebaseUid": "uid-driver-1",
    "lat": -34.6,
    "lng": -58.38
  }
}
```

### GET `/api/logistics/drivers/live`

Devuelve repartidores vivos desde Redis con cantidad de pedidos activos.

Respuesta ejemplo:

```json
{
  "ok": true,
  "ttlSeconds": 120,
  "count": 1,
  "drivers": [
    {
      "firebaseUid": "uid-driver-1",
      "email": "repartidor@cliente.com",
      "repartidor": "Juan Perez",
      "lat": -34.6,
      "lng": -58.38,
      "accuracy": 12,
      "speed": 8.5,
      "heading": 140,
      "orderId": 45,
      "status": "on_route",
      "activeOrders": 1,
      "activeStatus": "on_route"
    }
  ]
}
```

## Reglas para la app mobile

- No leer `orders_delivery` desde Firestore
- No escribir `drivers_locations` en Firestore
- No marcar entregas en Firestore
- Toda la logística debe usar `MeatManager-API`

La mobile debe usar Firebase solo para:

- login
- obtener el `idToken`

Después todo pasa por la API propia.

## Flujo recomendado en mobile

1. Login con Firebase
2. Obtener `idToken`
3. `GET /api/delivery/me`
4. `GET /api/delivery/orders`
5. En reparto:
   - enviar `POST /api/delivery/location` cada 10-20 segundos o por distancia
6. Cambios de estado:
   - `POST /api/delivery/orders/:id/status`

## Frecuencia sugerida de GPS

- en movimiento: cada 10-20 segundos
- o cada 50-100 metros
- detenido: bajar frecuencia

No mandar ubicación cada segundo.

## Persistencia

- `Redis`: ubicacion viva del repartidor
- `MySQL`: historial de tracking y cambios de estado

Tablas nuevas relevantes:

- `delivery_tracking_events`

Columnas nuevas relevantes en `pedidos`:

- `assigned_driver_uid`
- `assigned_driver_email`
- `assigned_at`
- `status_updated_at`
- `latitude`
- `longitude`

## Estado actual del proyecto

Ya existe en `MeatManager-API`:

- `GET /api/delivery/me`
- `GET /api/delivery/orders`
- `POST /api/logistics/orders/:id/assign`
- `POST /api/delivery/orders/:id/status`
- `POST /api/delivery/location`
- `GET /api/logistics/drivers/live`

Todavía falta en `MeatManager-web`:

- sacar Firestore del módulo `Logistica`
- pasar el dashboard web a estos endpoints

Todavía falta en `MeatManager-mobile`:

- dejar de usar Firestore para asignaciones/entregas
- consumir estos endpoints
