# MeatManager Mobile Admin

Proyecto nuevo para una app de celulares orientada a administradores de clientes MeatManager.

## Qué reutiliza del repo actual

- Firebase Auth del proyecto `meat-manager-clientes`
- API multi-tenant de `MeatManager-API`
- Tablas ya existentes: `settings`, `ventas`, `caja_movimientos`
- Registro de sucursales guardado en `settings.registered_branches`

## Qué ya queda armado

- Login mobile con Firebase + `/api/firebase-users/me`
- Navegación base con tres módulos:
  - Inicio
  - Sucursales
  - Informes
- Capa de servicios desacoplada para alternar entre datos mock y datos reales
- UI inicial de administrador pensada para seguir cajas, ventas y expansión futura por sucursal

## Limitaciones reales detectadas en este repo

La app web ya maneja sucursales y exporta snapshots locales con resumen de stock, ventas y caja desde [Sucursales.jsx](../MeatManager-web/src/pages/Sucursales.jsx), pero ese resumen no está persistido hoy en MySQL ni expuesto por la API.

En la API actual:

- `ventas` no tiene `branch_id` o `branch_code`
- `caja_movimientos` no tiene `branch_id` o `branch_code`
- `branch_stock_snapshots` en MySQL solo guarda:
  - `branch_code`
  - `branch_name`
  - `snapshot_at`
  - `imported_at`
- `/api/firebase-users/me` no devuelve `branchId`

Por eso este starter ya puede mostrar:

- resumen ejecutivo del tenant completo
- directorio de sucursales
- informes generales de ventas

Y deja marcado dónde falta ampliar backend para que el móvil muestre:

- saldo de caja por sucursal
- movimientos por sucursal
- ventas por sucursal
- sucursales asignadas a cada usuario

## Sugerencia de siguiente ampliación de backend

1. Agregar `branch_code` o `branch_id` en `ventas` y `caja_movimientos`.
2. Extender `branch_stock_snapshots` para guardar `summary` y opcionalmente `stock` JSON.
3. Incluir `branchId` en `/api/firebase-users/me`.
4. Crear endpoints agregados:
   - `GET /api/mobile/dashboard`
   - `GET /api/mobile/branches`
   - `GET /api/mobile/branches/:branchCode/cash`
   - `GET /api/mobile/reports/sales`

## Variables de entorno

Copiar `.env.example` a `.env` y ajustar:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:3001
EXPO_PUBLIC_USE_MOBILE_MOCKS=true
```

## Instalación

Este entorno no tenía `node` ni `npx`, así que no pude instalar ni ejecutar el proyecto acá.

Cuando lo abras en una máquina con Node:

```bash
cd MeatManager-mobile-admin
npm install
npm run start
```

## Estructura

- `src/context/AuthContext.tsx`: sesión mobile
- `src/services/auth.ts`: login Firebase + backend
- `src/services/dashboard.ts`: composición de datos reales/mocks
- `src/navigation/screens/*`: pantallas base del MVP
- `src/config/*`: Firebase y variables públicas
