# MeatManager API

API de provisioning multi-tenant para MeatManager.

## Documentacion clave

- Flujo oficial de autenticacion/sincronizacion: [AUTH_SYNC_FLOW.md](/d:/Proyectos/web/MeatManager-API/AUTH_SYNC_FLOW.md)

## Setup

```bash
npm install
cp .env.example .env
# Editar .env con los datos de MySQL
# Poner el JSON de Firebase Admin SDK como firebase-service-account.json
npm run dev
```

## Variables de entorno (.env)

```
DB_HOST=35.225.156.199
DB_PORT=3306
DB_USER=root
DB_PASS=tu_password
MEATMANAGER_DB_NAME=meatmanager
OPERATIONAL_DB_NAME=meatmanager
FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
PORT=3001
```

## Firebase Admin SDK

1. Ir a Firebase Console → Configuración del proyecto → Cuentas de servicio
2. Generar nueva clave privada → descargar JSON
3. Renombrar a `firebase-service-account.json` y poner en la raíz del proyecto

⚠️ **NUNCA subir `firebase-service-account.json` ni `.env` a un repositorio.**

## Arquitectura actual

- Login: Firebase Auth
- Registro multi-tenant central: MySQL `meatmanager`
- Licencias, usuarios y permisos: MySQL `GestionClientes`
- Datos operativos: MySQL `meatmanager`

## Endpoints

### POST /provision
Header: `Authorization: Bearer <Firebase ID Token>`

Respuesta:
```json
{
  "ok": true,
  "tenantId": 1,
  "dbName": "meatmanager",
  "empresa": "Carnicería El Gaucho",
  "cuit": "20123456789",
  "isNew": false
}
```

### GET /health
```json
{ "ok": true, "ts": "2026-03-22T..." }
```

## Flujo actual

1. Crear usuario en `GestionClientes.client_users`
2. Sincronizar el usuario a Firebase Auth
3. Guardar `firebaseUid` de vuelta en MySQL
4. Al login, validar Firebase token
5. Resolver acceso real por estado de cliente + licencias + permisos desde MySQL
6. Resolver el tenant operativo compartido desde `meatmanager`
