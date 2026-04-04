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

## Colecciones usadas

- `orders_delivery`
- `drivers_locations`

## Observaciones

- La app sigue el mismo esquema del `DeliveryPortal` web.
- El tracking hoy queda en primer plano. Si después querés, el siguiente paso natural es fondo/background tracking y autenticacion real de usuarios.
