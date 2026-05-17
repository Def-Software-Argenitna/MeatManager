# Auth Sync Flow

Modelo oficial actual de MeatManager:

- Autenticacion: Firebase Auth
- Autorizacion comercial: MySQL `GestionClientes`
- Datos operativos: MySQL por tenant `mm_<cuit>`

## Fuente de verdad

MySQL `GestionClientes` controla:

- `clients`
- `client_users`
- `client_licenses`
- `licenses`
- `client_user_permissions`

Firebase controla:

- email
- password
- reset de contraseña
- sesiones
- ID tokens

Campo de vinculacion:

- `client_users.firebaseUid`

## Flujo oficial

1. Se crea el usuario en `GestionClientes.client_users`.
2. Se asignan licencias en `client_licenses`.
3. Se asignan permisos UI en `client_user_permissions`.
4. Se crea o actualiza el usuario en Firebase Auth.
5. El `uid` generado por Firebase se guarda en `client_users.firebaseUid`.
6. El usuario inicia sesion en web con Firebase.
7. La API valida el Firebase ID token.
8. La API busca al usuario en `GestionClientes` por `firebaseUid`.
9. La API valida:
   - `client_users.status = ACTIVE`
   - `clients.status in ('ACTIVE', 'GRACE')`
   - al menos una licencia efectiva con `appliesToWebapp = 1`
10. Si pasa todo eso, la API habilita acceso al tenant y devuelve permisos/licencias.

## Reglas de licencias

Una licencia aplica si:

- es global: `userId IS NULL` y `branchId IS NULL`
- o coincide el `userId`
- y si tiene `branchId`, tambien debe coincidir la sucursal
- y la licencia base tiene `appliesToWebapp = 1`

La API filtra solo licencias:

- `client_licenses.status = 'ACTIVE'`
- `licenses.status = 'ACTIVE'`

## Alta de usuario

Alta correcta:

1. insertar en `client_users`
2. insertar permisos en `client_user_permissions` si es `employee`
3. insertar o actualizar asignaciones en `client_licenses`
4. encolar sync en `auth_sync_queue`
5. crear usuario en Firebase
6. guardar `firebaseUid`
7. marcar `isSynced = 1`

## Baja o desactivacion

1. marcar `client_users.status = 'INACTIVE'`
2. encolar sync
3. deshabilitar usuario en Firebase
4. conservar `firebaseUid` para trazabilidad

No se recomienda borrado duro en Firebase como flujo normal.

## Cambio de usuario

Cambios que deben sincronizarse a Firebase:

- email
- display name
- password
- disabled/enabled

Cambios que quedan en MySQL:

- licencias
- sucursal
- permisos UI
- estado comercial del cliente

## Permisos UI

Los permisos de navegacion viven en:

- `client_user_permissions`

Convencion actual:

- `admin`: acceso total en frontend
- `employee`: usa solo los `path` guardados para ese `userId`

Ejemplo:

```sql
INSERT INTO client_user_permissions (userId, path)
VALUES
  (5, '/'),
  (5, '/ventas'),
  (5, '/clientes');
```

## Reconciliacion de usuarios existentes

Script disponible:

```bash
npm run reconcile:firebase-users
```

Hace esto:

- busca usuarios en `client_users`
- intenta encontrar el mismo email en Firebase
- si existe, guarda `firebaseUid`
- marca `isSynced = 1`

## Cuentas de prueba actuales

Admin:

- `prueba.web.sync@cliente.com`
- `PruebaMM2026!`

Employee:

- `empleado.web.sync@cliente.com`
- `EmpleadoMM2026!`

## Endpoints implicados

- `POST /api/provision`
- `GET /api/firebase-users`
- `GET /api/firebase-users/me`
- `POST /api/firebase-users`
- `PATCH /api/firebase-users/:id`
- `DELETE /api/firebase-users/:id`
- `POST /api/users/:id/permissions`

Todos requieren:

- `Authorization: Bearer <Firebase ID Token>`

## Notas operativas

- `featureFlags` se leen desde `licenses.featureFlags`
- `client_user_permissions` y `auth_sync_queue` deben existir en `GestionClientes`
- el backend ya no usa `/api/auth/login`
- el backend ya no usa `tenant_accounts`
- el flujo correcto es Firebase para login y MySQL para autorizacion
