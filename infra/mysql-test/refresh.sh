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
