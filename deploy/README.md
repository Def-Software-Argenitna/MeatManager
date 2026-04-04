# Deploy Cloud

Este esquema publica dos stacks en el mismo servidor:

- `main` -> `meatmanager.def-software.com`
- `dev` -> `meatmanager.demo.def-software.com`

## Requisitos

- Docker y Docker Compose plugin en el servidor
- DNS apuntando ambos dominios al servidor
- acceso del servidor a `ghcr.io`
- `nginx` del host ya funcionando como reverse proxy principal

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

## Primer arranque manual

```bash
cd /opt/meatmanager
docker compose -f docker-compose.cloud.yml --env-file .env pull
docker compose -f docker-compose.cloud.yml --env-file .env up -d
```

## Bootstrap inicial

Podés preparar la carpeta así:

```bash
chmod +x deploy/bootstrap-server.sh
./deploy/bootstrap-server.sh /opt/meatmanager
```

## Nginx del host

Como el servidor ya tiene otra web en `80/443`, este deploy no publica esos puertos desde Docker.

Los servicios quedan asi:

- main web: `127.0.0.1:4100`
- main api: `127.0.0.1:4101`
- dev web: `127.0.0.1:4200`
- dev api: `127.0.0.1:4201`

Usá estas configs de referencia en el nginx del host:

- [meatmanager.def-software.com.conf](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/nginx/meatmanager.def-software.com.conf)
- [meatmanager.demo.def-software.com.conf](/Users/rodrigocortes/Documents/GitHub/MeatManager/deploy/nginx/meatmanager.demo.def-software.com.conf)
