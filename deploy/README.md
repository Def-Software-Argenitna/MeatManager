# Deploy Cloud

Este esquema publica dos stacks en el mismo servidor:

- `main` -> `meatmanager.def-software.com`
- `dev` -> `meatmanager.demo.def-software.com`

## Requisitos

- Docker y Docker Compose plugin en el servidor
- DNS apuntando ambos dominios al servidor
- acceso del servidor a `ghcr.io`
- **Caddy** del host ya funcionando como reverse proxy principal
- runner `self-hosted` de GitHub Actions ya instalado y funcionando en el servidor

## Archivos necesarios en el servidor

Copiar esta carpeta a una ruta fija, por ejemplo:

```bash
/opt/meatmanager
```

Crear:

```bash
/opt/meatmanager/.env
/opt/meatmanager/env/api-main.env
/opt/meatmanager/env/api-dev.env
/opt/meatmanager/secrets/firebase-service-account.json
```

Usá [`.env.example`](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/.env.example) como base para el archivo `.env`.
Usá:

- [api-main.env.example](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/env/api-main.env.example)
- [api-dev.env.example](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/env/api-dev.env.example)

para los envs de cada API.
El JSON de Firebase Admin ahora se escribe automaticamente desde el secret `FIREBASE_SERVICE_ACCOUNT_JSON`.

Si MySQL y Redis corren en el mismo host Docker, usá `host.docker.internal` en:

- `DB_HOST`
- `CLIENTS_DB_HOST`
- `REDIS_HOST`

El compose ya agrega `host-gateway` para resolverlo correctamente dentro de los contenedores.

## Primer arranque manual

```bash
cd /opt/meatmanager
docker compose -f docker-compose.cloud.yml --env-file .env pull
docker compose -f docker-compose.cloud.yml --env-file .env up -d --wait
```

## Bootstrap inicial

Podés preparar la carpeta así:

```bash
chmod +x deploy/bootstrap-server.sh
./deploy/bootstrap-server.sh /opt/meatmanager
```

## Caddy del host

Como el servidor ya tiene otra web en `80/443`, este deploy no publica esos puertos desde Docker.

Los servicios quedan asi:

- main web: `127.0.0.1:4100`
- main api: `127.0.0.1:4101`
- dev web: `127.0.0.1:4200`
- dev api: `127.0.0.1:4201`

Caddy del host hace reverse proxy a estos puertos locales.

## Estrategia de deploy

El deploy de GitHub Actions ahora hace esto:

- build y push de imagenes con tag de rama (`main` / `dev`)
- build y push de la misma imagen con tag inmutable por commit: `sha-<commit>`
- el compose del servidor levanta exactamente esa version `sha-*`
- `docker compose up -d --force-recreate --wait` espera a que web y API queden sanos antes de dar el deploy por terminado

Esto reduce dos problemas comunes:

- que el servidor quede usando una imagen vieja por una tag mutable
- que el proxy apunte a un contenedor nuevo todavia no listo

Importante:

- el frontend sigue pudiendo tener usuarios con una pestaña vieja abierta; por eso conviene mantener el manejo de recarga de chunks en la app
- si necesitás rollback, podés volvCaddy del host:

- [meatmanager.def-software.com.caddy](caddy/meatmanager.def-software.com.caddy)
- [meatmanager.demo.def-software.com.caddy](caddy/meatmanager.demo.def-software.com.caddy)

## Configuración SSL/HTTPS

⚠️ **IMPORTANTE**: Los dominios deben estar configurados con certificados SSL válidos para funcionar en producción.

Caddy obtiene y renueva certificados SSL automáticamente de Let's Encrypt.

### Setup rápido

```bash
# En el servidor, ejecutar como root
sudo ./deploy/setup-ssl.sh
```

Este script automáticamente:
- Instala Caddy si no está instalado
- Configura el email para notificaciones de Let's Encrypt
- Copia las configuraciones de sitios
- Obtiene certificados SSL automáticamente
- Configura renovación automática (sin necesidad de cron)

### Configuración manual

Ver la guía completa en [SSL_SETUP.md](SSL_SETUP.md) con:
- Instrucciones detalladas paso a paso
- Troubleshooting de errores comunes
- Configuración de seguridad adicional
- Comandos útiles de Caddyerrores comunes
- Configuración de seguridad adicional
- Monitoreo y alertas

## Secrets necesarios en GitHub

Con runner self-hosted ya no hacen falta secrets de SSH.

Solo necesitás:

- `DEPLOY_PATH`
- `API_MAIN_ENV`
- `API_DEV_ENV`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
