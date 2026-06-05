# MySQL de pruebas (`Def-MySQL-Test`) — clon refrescado de producción

**Fecha:** 2026-06-04
**Estado:** Diseño aprobado (pendiente revisión del spec)
**Autor:** Rodrigo Cortes (con Claude)

## Problema

Se necesita una copia del MySQL de producción (`Def-MySQL`) para:

1. **Probar features y correcciones** con datos reales, pudiendo escribir/romper sin riesgo.
2. **Servir de backup** de los datos reales de las apps.

La copia debe re-sincronizarse sola y ser accesible tanto desde clientes externos
como desde las apps/webs del propio server.

## Restricción descubierta

El master de producción **NO está configurado para replicación nativa**:

| Variable | Valor actual |
|---|---|
| `log_bin` | OFF |
| `server_id` | 0 |
| `gtid_mode` | OFF |
| `version` | 5.7.41-log |

Habilitar replicación nativa exigiría reconfigurar y **reiniciar** el MySQL de
producción, que es compartido por **todas** las apps (meatmanager, barmanager,
kioskmanager, tournamentmanager, GestionClientes) → caída breve de todo el stack.
Además una réplica nativa es de solo-lectura: escribir en ella para probar rompe
la replicación.

**Decisión:** se descarta la replicación nativa. Se usa un **clon refrescado por
dump periódico**, que es escribible, no toca producción y sirve a la vez de backup.

## Datos de dimensionamiento (al 2026-06-04)

- Datos reales totales: ~12 MB (meatmanager 4.9, GestionClientes 2.7, KioskManager
  2.4, TournamentManager 1.1, barmanager 0.8). `mysqldump` es instantáneo.
- Disco: 92 GB libres en `/`.
- RAM: 7.7 GB total, ~4.6 GB disponible. Se capa el buffer pool del clon a 256 MB.
- Red docker existente: `Def-Network` (bridge, `Def-MySQL` = `172.18.0.2`).
- Firewall GCP: ya existe regla `mysql` que abre `tcp:3306` a `0.0.0.0/0` sin
  target tag (aplica a toda la instancia).

## Decisiones de diseño (confirmadas con el usuario)

| Tema | Decisión |
|---|---|
| Modelo de copia | Clon refrescado vía `mysqldump` (no replicación nativa) |
| Bases a clonar | Todas las de apps, **descubiertas dinámicamente** en cada corrida (todas menos `mysql`, `sys`, `performance_schema`, `information_schema`). Una DB nueva en prod aparece sola en el clon |
| Frecuencia | Cron nocturno a las 04:00 |
| Acceso | Doble: puerto público `3307` + alcanzable por `Def-Network` |
| Firewall 3307 | Abierto a `0.0.0.0/0` (consistente con el 3306 actual) |
| Doble función | Los dumps con timestamp son también el backup |

## Arquitectura

### Contenedor

- Nombre: `Def-MySQL-Test`
- Imagen: `mysql/mysql-server:5.7` (igual que prod, compatibilidad total dump/restore)
- Volumen propio: `def-mysql-test-data` → `/var/lib/mysql` (aislado de prod)
- Red: conectado a `Def-Network` (host interno `Def-MySQL-Test:3306`)
- Puerto publicado: `0.0.0.0:3307 → 3306`
- Límite de RAM: `--innodb-buffer-pool-size=256M` (no competir con prod)
- `restart: unless-stopped`
- Healthcheck con `mysqladmin ping`
- Acceso con usuario **`root`** y clave **`pos38ric0S`** (definida en `.env`).

### Definición

`docker-compose.yml` en `/opt/mysql-test/` (consistente con `/opt/<app>/` de las
demás apps), declarando `Def-Network` como red externa.

### Estructura en disco del server

```
/opt/mysql-test/
├── docker-compose.yml
├── refresh.sh
├── refresh.log
└── backups/
    └── prod-YYYYMMDD-HHMMSS.sql.gz   (rotación: últimos 14 días)
```

## Mecanismo de refresh (`refresh.sh`)

Ejecutado por cron del host a las 04:00. Pasos:

1. **Descubrir las bases de apps de prod** dinámicamente:
   `SHOW DATABASES WHERE \`Database\` NOT IN ('mysql','sys','performance_schema','information_schema')`.
   Así, una DB nueva creada en prod se incluye sola en el próximo refresh (cero
   mantenimiento del script).
2. `mysqldump` de prod (`Def-MySQL`) de esa lista dinámica, con
   `--routines --triggers --events --single-transaction --databases`, a un archivo
   temporal comprimido en `backups/`.
3. **Validación:** si el dump falla o el archivo está vacío → aborta con exit ≠ 0,
   loguea el error y **NO toca el clon existente** (se conserva la última copia buena).
4. Si el dump es válido: lo carga en `Def-MySQL-Test` recreando esas bases
   (el dump trae `DROP DATABASE IF EXISTS` + `CREATE` gracias a `--databases`).
5. Re-asegura los grants del usuario `test` sobre las bases recargadas.
6. Rota los backups: conserva los últimos 14 archivos, borra los más viejos.
7. Loguea inicio/fin/resultado a `refresh.log`.

Diseño defensivo: el dump de prod es **solo lectura**; un fallo nunca degrada
producción ni destruye el último clon bueno.

### No se copia

Las bases internas (`mysql`, `sys`, `performance_schema`, `information_schema`)
**no** se clonan: contienen los usuarios/grants del propio contenedor de pruebas;
pisarlas lo rompería. Igual quedan respaldados todos los datos de apps.

## Acceso

- **Clientes externos:** `34.136.100.63:3307`, usuario `root`, clave `pos38ric0S`.
- **Apps/webs del server:** host `Def-MySQL-Test`, puerto `3306`, dentro de `Def-Network`.
- **Firewall:** nueva regla GCP `mysql-test` → `tcp:3307` desde `0.0.0.0/0`.

## Seguridad

- El `3307` queda expuesto a internet, protegido solo por usuario/clave (mismo
  nivel de exposición que el `3306`/`6379` actuales). Riesgo aceptado por el usuario.
- Acceso con `root` / `pos38ric0S` (clave fijada por el usuario; vive solo en `.env` del server, no en el repo).
- Recomendación a futuro (fuera de alcance): restringir las reglas `mysql`,
  `mysql-test`, `redis` a IPs conocidas.

## Lo que NO cambia

- **Producción intacta:** sin reinicios, sin cambios de configuración. Solo se le
  hace `mysqldump` (lectura) cada noche.
- No se modifica ninguna app ni web existente.

## Criterios de éxito

1. `Def-MySQL-Test` corriendo y healthy.
2. Conexión exitosa al `3307` desde cliente externo y al host `Def-MySQL-Test`
   desde un contenedor de `Def-Network`.
3. Todas las bases de apps de prod presentes en el clon con sus datos (descubiertas
   dinámicamente; una DB nueva en prod aparece en el siguiente refresh).
4. Escritura en el clon funciona (es escribible).
5. Cron nocturno configurado; `refresh.sh` corre a mano sin error y re-sincroniza.
6. Un dump fallido (simulado) no destruye el clon existente.
7. Backups con timestamp acumulándose en `/opt/mysql-test/backups/`.

## Fuera de alcance

- Replicación nativa en tiempo real.
- Restringir firewall por IP.
- Migrar/actualizar MySQL 5.7 (EOL) a una versión soportada.
- Backups off-site (los dumps viven en el mismo server).
