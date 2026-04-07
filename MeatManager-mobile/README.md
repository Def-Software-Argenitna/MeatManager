# MeatManager Mobile

App movil de reparto para MeatManager, hecha con React Native + Expo y pensada para Android e iOS.

## Flujo cubierto

- login simple del repartidor por nombre
- escucha en tiempo real de pedidos asignados desde Firestore
- tracking de ubicacion del repartidor
- accion rapida para abrir GPS
- llamada al cliente
- marcado de pedido como entregado

## Instalacion

```bash
cd MeatManager-mobile
npm install
npm run start
```

Luego podés abrirla con Expo Go o correr:

```bash
npm run android
npm run ios
```

## Firebase

La app toma por defecto la misma configuracion Firebase de la web en [`src/config/env.ts`](./src/config/env.ts).

Si querés manejarlo por variables, usá:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

## API

La app ahora reporta ubicacion a la API usando token Firebase y la variable:

```bash
EXPO_PUBLIC_API_URL=http://35.225.156.199:3001
```

Ya te la dejé cargada en [`.env`](/Users/rodrigocortes/Documents/GitHub/MeatManager/MeatManager-mobile/.env).

Si cambiás de servidor, actualizá ese valor y reiniciá Expo.

## Colecciones usadas

- `orders_delivery`

## Observaciones

- La app sigue el mismo esquema del `DeliveryPortal` web.
- El login ya usa Firebase Auth.
- La ubicacion online ya no depende de Firestore: se envía a la API para persistencia en Redis.
- El tracking hoy queda en primer plano. El siguiente paso natural es fondo/background tracking.

