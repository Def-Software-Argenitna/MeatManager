#!/usr/bin/env sh
set -eu

DEPLOY_PATH="${1:-/opt/meatmanager}"

mkdir -p "${DEPLOY_PATH}/env"

echo "Deploy path preparado en ${DEPLOY_PATH}"
echo "Siguientes pasos:"
echo "1. Copiar deploy/.env.example a ${DEPLOY_PATH}/.env"
echo "2. Crear ${DEPLOY_PATH}/env/api-main.env"
echo "3. Crear ${DEPLOY_PATH}/env/api-dev.env"
echo "4. Copiar firebase-service-account.json dentro de cada contexto de API si lo vas a bakear o montarlo por volumen"
