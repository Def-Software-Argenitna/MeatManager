# MySQL de pruebas (`Def-MySQL-Test`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar un contenedor MySQL (`Def-MySQL-Test`) que sea un clon escribible de producción, re-sincronizado cada noche vía `mysqldump`, accesible por el puerto público 3307 y desde `Def-Network`, sirviendo además de backup.

**Architecture:** Contenedor `mysql/mysql-server:5.7` con volumen propio, conectado a `Def-Network`, publicando 3307. Un script `refresh.sh` corre por cron nocturno: descubre dinámicamente las bases de apps de prod, las dumpea (solo lectura sobre prod), valida, y recarga el clon. Los dumps con timestamp son el backup (rotación 14). Producción no se reinicia ni se reconfigura.

**Tech Stack:** Docker / docker-compose, MySQL 5.7, bash, cron, gcloud (firewall + ssh/scp). Server: GCE `def-server` (us-central1-b), IP `34.136.100.63`.

**Spec:** `docs/superpowers/specs/2026-06-04-mysql-test-clone-design.md`

**Convención de ejecución:** los comandos `gcloud ...` se corren desde la PC local (PowerShell). Los comandos marcados *(en server)* van dentro de `gcloud compute ssh def-server --zone us-central1-b --command "..."` o de una sesión SSH interactiva.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `infra/mysql-test/docker-compose.yml` (repo → `/opt/mysql-test/docker-compose.yml` en server) | Definición del contenedor `Def-MySQL-Test` |
| `infra/mysql-test/refresh.sh` (repo → `/opt/mysql-test/refresh.sh` en server) | Script de dump+recarga+rotación |
| `/opt/mysql-test/.env` (**solo server**, nunca al repo) | Clave de root del clon: `MYSQL_ROOT_PASSWORD=pos38ric0S` |
| `/opt/mysql-test/backups/` (server) | Dumps con timestamp (backup + fuente de recarga) |
| `infra/mysql-test/.gitignore` (repo) | Ignora `.env` y `backups/` por las dudas |
| Regla firewall GCP `mysql-test` | Abre `tcp:3307` |
| Crontab de root (server) | Dispara `refresh.sh` a las 04:00 |

---

### Task 1: Crear los archivos de infra en el repo

**Files:**
- Create: `infra/mysql-test/docker-compose.yml`
- Create: `infra/mysql-test/refresh.sh`
- Create: `infra/mysql-test/.gitignore`

- [ ] **Step 1: Crear `infra/mysql-test/docker-compose.yml`**

```yaml
services:
  mysql-test:
    image: mysql/mysql-server:5.7
    container_name: Def-MySQL-Test
    restart: unless-stopped
    env_file: .env
    environment:
      MYSQL_ROOT_HOST: '%'
    command:
      - mysqld
      - --innodb-buffer-pool-size=256M
    ports:
      - "3307:3306"
    volumes:
      - def-mysql-test-data:/var/lib/mysql
    networks:
      - Def-Network
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -p\"$$MYSQL_ROOT_PASSWORD\" --silent"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s

volumes:
  def-mysql-test-data:

networks:
  Def-Network:
    external: true
```

- [ ] **Step 2: Crear `infra/mysql-test/refresh.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Refresca el MySQL de pruebas (Def-MySQL-Test) desde produccion (Def-MySQL).
# - mysqldump de prod = SOLO LECTURA sobre produccion.
# - Si el dump falla o sale vacio, ABORTA sin tocar el clon existente.
# - El dump con timestamp queda como backup (rotacion).

PROD_CONTAINER="Def-MySQL"
TEST_CONTAINER="Def-MySQL-Test"
BASE_DIR="/opt/mysql-test"
BACKUP_DIR="$BASE_DIR/backups"
LOG_FILE="$BASE_DIR/refresh.log"
KEEP=14

# Nota: el root password del clon NO se sourcea aca; se expande dentro de cada
# contenedor via su propia env var MYSQL_ROOT_PASSWORD (definida por el .env del
# compose). El script solo orquesta docker exec.

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/prod-$TS.sql.gz"
TMP_DUMP="$DUMP_FILE.partial"

log "=== Refresh iniciado ==="

# 1. Descubrir bases de apps en prod (excluye internas). El password de prod
#    se expande DENTRO del contenedor de prod (su propia env var).
DBS="$(docker exec "$PROD_CONTAINER" sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SHOW DATABASES WHERE \`Database\` NOT IN (\"mysql\",\"sys\",\"performance_schema\",\"information_schema\")"' \
  2>/dev/null)"

if [ -z "$DBS" ]; then
  log "ERROR: no se descubrieron bases en prod. Aborta, clon intacto."
  exit 1
fi
log "Bases a clonar: $(echo "$DBS" | tr '\n' ' ')"

# 2. Dump de prod (solo lectura) -> temporal comprimido
DBS_ONE_LINE="$(echo "$DBS" | tr '\n' ' ')"
if ! docker exec "$PROD_CONTAINER" sh -c \
  "mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction --routines --triggers --events --databases $DBS_ONE_LINE" \
  2>/dev/null | gzip > "$TMP_DUMP"; then
  log "ERROR: mysqldump fallo. Aborta, clon intacto."
  rm -f "$TMP_DUMP"
  exit 1
fi

# 3. Validar que el dump tenga contenido real
if [ ! -s "$TMP_DUMP" ] || [ "$(gzip -dc "$TMP_DUMP" 2>/dev/null | head -c 200 | wc -c)" -lt 20 ]; then
  log "ERROR: dump vacio o invalido. Aborta, clon intacto."
  rm -f "$TMP_DUMP"
  exit 1
fi
mv "$TMP_DUMP" "$DUMP_FILE"
log "Dump OK: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# 4. Recargar el clon. mysqldump 5.7 con --databases emite CREATE DATABASE IF
#    NOT EXISTS + USE, pero NO DROP. Prependeamos DROP de cada base descubierta
#    para reemplazo limpio (refleja datos borrados en prod).
DROP_SQL=""
for db in $DBS; do
  DROP_SQL="$DROP_SQL DROP DATABASE IF EXISTS \`$db\`;"
done
if ! { echo "$DROP_SQL"; gzip -dc "$DUMP_FILE"; } | docker exec -i "$TEST_CONTAINER" sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' 2>/dev/null; then
  log "ERROR: la recarga en el clon fallo. Revisar $TEST_CONTAINER."
  exit 1
fi
log "Clon recargado."

# 5. Rotar backups: conservar ultimos KEEP
ls -1t "$BACKUP_DIR"/prod-*.sql.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
log "Rotacion OK (conserva $KEEP). Backups actuales: $(ls -1 "$BACKUP_DIR"/prod-*.sql.gz 2>/dev/null | wc -l)"

log "=== Refresh finalizado OK ==="
```

- [ ] **Step 3: Crear `infra/mysql-test/.gitignore`**

```gitignore
.env
backups/
refresh.log
```

- [ ] **Step 4: Verificar que los archivos existen localmente**

Run (PowerShell): `Get-ChildItem infra/mysql-test`
Expected: lista `docker-compose.yml`, `refresh.sh`, `.gitignore`.

---

### Task 2: Preparar el directorio y secretos en el server

**Files:**
- Create (server): `/opt/mysql-test/` y `/opt/mysql-test/.env`

- [ ] **Step 1: Crear el directorio en el server**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "sudo mkdir -p /opt/mysql-test/backups && sudo chown -R `$USER:`$USER /opt/mysql-test && ls -ld /opt/mysql-test"
```
Expected: directorio creado, propiedad del usuario SSH.

- [ ] **Step 2: Crear `.env` con la clave de root (NO se versiona en el repo)**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "printf 'MYSQL_ROOT_PASSWORD=pos38ric0S\n' > /opt/mysql-test/.env ; chmod 600 /opt/mysql-test/.env ; echo 'env creado'"
```
Expected: `env creado`. Acceso: usuario `root`, clave `pos38ric0S`.

- [ ] **Step 3: Verificar el contenido del `.env`**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "cat /opt/mysql-test/.env"
```
Expected: `MYSQL_ROOT_PASSWORD=pos38ric0S`.

---

### Task 3: Subir los archivos de infra al server

**Files:**
- Copy: `infra/mysql-test/docker-compose.yml` → `/opt/mysql-test/`
- Copy: `infra/mysql-test/refresh.sh` → `/opt/mysql-test/`

- [ ] **Step 1: SCP de los dos archivos**

Run (PowerShell):
```powershell
gcloud compute scp infra/mysql-test/docker-compose.yml infra/mysql-test/refresh.sh def-server:/opt/mysql-test/ --zone us-central1-b
```
Expected: transfiere 2 archivos sin error.

- [ ] **Step 2: Dar permiso de ejecución al script y verificar**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "chmod +x /opt/mysql-test/refresh.sh && ls -l /opt/mysql-test"
```
Expected: `docker-compose.yml`, `refresh.sh` (con `x`), `.env`, `backups/`.

---

### Task 4: Levantar el contenedor y verificar que está healthy

**Files:** ninguno nuevo.

- [ ] **Step 1: Levantar el stack**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "cd /opt/mysql-test && docker compose up -d"
```
Expected: crea volumen `def-mysql-test-data` y contenedor `Def-MySQL-Test` (la red `Def-Network` ya existe, external).

- [ ] **Step 2: Esperar y verificar estado healthy**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "sleep 45 && docker ps --filter name=Def-MySQL-Test --format '{{.Names}} {{.Status}} {{.Ports}}'"
```
Expected: `Def-MySQL-Test Up ... (healthy) 0.0.0.0:3307->3306/tcp`.
Si dice `unhealthy` o reinicia: `docker logs --tail 50 Def-MySQL-Test` (probable: `.env` mal formado).

- [ ] **Step 3: Verificar conexión interna como root**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command 'docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT VERSION();"'"'"' 2>/dev/null'
```
Expected: imprime `5.7.41` (o similar 5.7.x).

---

### Task 5: Primera sincronización y verificación de datos

**Files:** ninguno nuevo.

- [ ] **Step 1: Correr el refresh a mano**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "/opt/mysql-test/refresh.sh"
```
Expected (stdout/`refresh.log`): `Bases a clonar: GestionClientes KioskManager TournamentManager barmanager meatmanager`, `Dump OK`, `Clon recargado`, `Rotacion OK`, `Refresh finalizado OK`.

- [ ] **Step 2: Verificar que las bases llegaron al clon**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command 'docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW DATABASES;"'"'"' 2>/dev/null'
```
Expected: aparecen `meatmanager`, `GestionClientes`, `KioskManager`, `TournamentManager`, `barmanager` (más las internas del propio clon).

- [ ] **Step 3: Comparar conteo de tablas de una base contra prod**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command '
P=$(docker exec Def-MySQL sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"meatmanager\""'"'"' 2>/dev/null);
T=$(docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"meatmanager\""'"'"' 2>/dev/null);
echo "prod=$P clon=$T"'
```
Expected: `prod=<N> clon=<N>` con el mismo número.

- [ ] **Step 4: Verificar que el clon es ESCRIBIBLE (como root)**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command 'docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
  CREATE DATABASE IF NOT EXISTS _prueba_escritura;
  CREATE TABLE _prueba_escritura.t (id INT);
  INSERT INTO _prueba_escritura.t VALUES (1);
  SELECT COUNT(*) AS filas FROM _prueba_escritura.t;
  DROP DATABASE _prueba_escritura;"'"'"' 2>/dev/null'
```
Expected: `filas` = `1`. Confirma escritura OK en el clon.

---

### Task 6: Verificar la red interna (acceso desde Def-Network)

**Files:** ninguno nuevo.

- [ ] **Step 1: Conectar al clon por hostname interno desde otro contenedor de la red**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command '
docker run --rm --network Def-Network mysql/mysql-server:5.7 \
  mysql -hDef-MySQL-Test -uroot -ppos38ric0S -e "SELECT 1 AS ok;" 2>/dev/null'
```
Expected: `ok` = `1`. Confirma que las apps/webs de `Def-Network` lo alcanzan como `Def-MySQL-Test:3306`.

---

### Task 7: Probar la seguridad ante fallo de dump (el clon no se destruye)

**Files:** ninguno nuevo.

- [ ] **Step 1: Simular fallo de dump y verificar que el clon queda intacto**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command '
# Contar tablas del clon ANTES
A=$(docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"meatmanager\""'"'"' 2>/dev/null);
# Correr refresh con un PROD inexistente para forzar fallo del dump
sed "s/^PROD_CONTAINER=.*/PROD_CONTAINER=\"Def-MySQL-NOEXISTE\"/" /opt/mysql-test/refresh.sh > /tmp/refresh_fail.sh;
chmod +x /tmp/refresh_fail.sh;
/tmp/refresh_fail.sh; echo "exit=$?";
# Contar DESPUES
B=$(docker exec Def-MySQL-Test sh -c '"'"'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"meatmanager\""'"'"' 2>/dev/null);
rm -f /tmp/refresh_fail.sh;
echo "antes=$A despues=$B"'
```
Expected: el script aborta con `exit=1` y `ERROR: ... Aborta, clon intacto.`; `antes=<N> despues=<N>` (mismo número → el clon NO se tocó).

---

### Task 8: Programar el cron nocturno

**Files:**
- Modify (server): crontab de root

- [ ] **Step 1: Agregar la entrada de cron (idempotente)**

Run (Bash):
```bash
gcloud compute ssh def-server --zone us-central1-b --command '
LINE="0 4 * * * /opt/mysql-test/refresh.sh >/dev/null 2>>/opt/mysql-test/refresh.log";
sudo bash -c "(crontab -l 2>/dev/null | grep -vF \"/opt/mysql-test/refresh.sh\"; echo \"$LINE\") | crontab -";
echo "--- crontab root ---"; sudo crontab -l | grep mysql-test'
```
Expected: imprime la línea `0 4 * * * /opt/mysql-test/refresh.sh ...`.

---

### Task 9: Abrir el puerto 3307 en el firewall de GCP y verificar acceso externo

**Files:**
- Create: regla firewall GCP `mysql-test`

- [ ] **Step 1: Crear la regla de firewall**

Run (PowerShell):
```powershell
gcloud compute firewall-rules create mysql-test --direction=INGRESS --action=ALLOW --rules=tcp:3307 --source-ranges=0.0.0.0/0 --description="MySQL test clone Def-MySQL-Test (puerto 3307)"
```
Expected: `Creating firewall...done.` (sin target tags → aplica a la instancia, igual que la regla `mysql` del 3306).

- [ ] **Step 2: Verificar que el puerto escucha en el host**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "sudo ss -tlnp | grep 3307 || docker port Def-MySQL-Test"
```
Expected: `0.0.0.0:3307` (o `3306/tcp -> 0.0.0.0:3307`).

- [ ] **Step 3: Verificar conectividad externa al 3307**

Run (PowerShell, desde la PC local):
```powershell
Test-NetConnection -ComputerName 34.136.100.63 -Port 3307
```
Expected: `TcpTestSucceeded : True`.
(Si tenés un cliente MySQL local: conectar a `34.136.100.63:3307` con usuario `root` y clave `pos38ric0S`.)

---

### Task 10: Verificación final contra criterios de éxito

**Files:** ninguno nuevo.

- [ ] **Step 1: Repaso de criterios del spec**

Verificar uno por uno (ya cubiertos en tasks previas):
1. `Def-MySQL-Test` healthy → Task 4.2 ✅
2. Acceso externo (3307) + interno (`Def-MySQL-Test`) → Task 9.3 + Task 6 ✅
3. Bases de apps presentes con datos → Task 5.2/5.3 ✅
4. Clon escribible → Task 5.4 ✅
5. Cron + refresh manual OK → Task 8 + Task 5.1 ✅
6. Dump fallido no destruye el clon → Task 7 ✅
7. Backups acumulándose en `/opt/mysql-test/backups/` → verificar abajo.

- [ ] **Step 2: Confirmar backups en disco**

Run (PowerShell):
```powershell
gcloud compute ssh def-server --zone us-central1-b --command "ls -lh /opt/mysql-test/backups/"
```
Expected: al menos un `prod-YYYYMMDD-HHMMSS.sql.gz`.

- [ ] **Step 3: (Opcional) Commit de los archivos de infra al repo**

Solo si el usuario lo aprueba (rama actual `dev`):
```bash
git add infra/mysql-test/docker-compose.yml infra/mysql-test/refresh.sh infra/mysql-test/.gitignore docs/superpowers/specs/2026-06-04-mysql-test-clone-design.md docs/superpowers/plans/2026-06-04-mysql-test-clone.md
git commit -m "feat(infra): MySQL de pruebas Def-MySQL-Test con refresh nocturno"
```

---

## Notas de operación (post-implementación)

- **Refrescar a demanda:** `gcloud compute ssh def-server --zone us-central1-b --command "/opt/mysql-test/refresh.sh"`
- **Ver log:** `tail -n 40 /opt/mysql-test/refresh.log` (en server)
- **Restaurar un backup puntual:** `gzip -dc /opt/mysql-test/backups/prod-XXXX.sql.gz | docker exec -i Def-MySQL-Test mysql -uroot -p"$MYSQL_ROOT_PASSWORD"`
- **Credenciales del clon:** en `/opt/mysql-test/.env` (distintas de prod).
- **Apps del server apuntan al clon:** host `Def-MySQL-Test`, puerto `3306`, dentro de `Def-Network`.
