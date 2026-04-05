# MeatManager

Suite de gestion para carnicerias con:

- `MeatManager-web`: panel web principal
- `MeatManager-API`: API Node/Firebase/MySQL/Redis
- `MeatManager-mobile`: app movil de reparto con React Native + Expo
- `deploy/`: despliegue cloud para `main` y `dev`

## Estructura

```text
MeatManager/
├── MeatManager-web/
├── MeatManager-API/
├── MeatManager-mobile/
└── deploy/
```

## Modulos

### Web

Frontend principal hecho con React + Vite.

- README: [MeatManager-web/README.md](/Users/rodrigocortes/Documents/GitHub/MeatManager/MeatManager-web/README.md)
- comando dev:

```bash
cd MeatManager-web
npm install
npm run dev
```

### API

Backend Node para autenticacion, multi-tenant, permisos y tracking.

- Firebase Auth para login
- MySQL para datos operativos y control de clientes
- Redis para ubicacion online de repartidores

- README: [MeatManager-API/README.md](/Users/rodrigocortes/Documents/GitHub/MeatManager/MeatManager-API/README.md)
- comando dev:

```bash
cd MeatManager-API
npm install
cp .env.example .env
npm run dev
```

### Mobile

App de entregas hecha con React Native + Expo para Android e iOS.

- login con Firebase Auth
- pedidos asignados desde Firestore
- tracking de ubicacion hacia la API

- README: [MeatManager-mobile/README.md](/Users/rodrigocortes/Documents/GitHub/MeatManager/MeatManager-mobile/README.md)
- comando dev:

```bash
cd MeatManager-mobile
npm install
npx expo start --lan --clear
```

### Deploy

Configuracion para publicar:

- `main` -> `meatmanager.def-software.com`
- `dev` -> `meatmanager.demo.def-software.com`

- README: [deploy/README.md](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/README.md)

## Flujo general

1. La web y la app movil autentican con Firebase.
2. La API valida tokens Firebase y resuelve tenant, permisos y licencias.
3. La ubicacion de repartidores se reporta desde mobile a la API.
4. La API persiste presencia y ultima ubicacion en Redis.
5. `dev` y `main` se despliegan por GitHub Actions en un runner self-hosted.

## Entornos

- `dev`: ambiente demo y pruebas
- `main`: ambiente productivo

## Notas importantes

- No subir `.env` ni credenciales de Firebase Admin.
- La raiz del repo ahora tiene este README para que GitHub muestre una portada clara del proyecto.
- Cada modulo mantiene su propio README con detalles operativos.
