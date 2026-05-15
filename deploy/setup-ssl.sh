#!/bin/bash
# Script para configurar Caddy con SSL automático para MeatManager

set -e

echo "================================================"
echo "Configuración de Caddy para MeatManager"
echo "================================================"

# Verificar que se ejecuta como root
if [ "$EUID" -ne 0 ]; then 
    echo "Error: Este script debe ejecutarse como root (usa sudo)"
    exit 1
fi

# Detectar el directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDY_CONFIG_DIR="/etc/caddy"
CADDYFILE="$CADDY_CONFIG_DIR/Caddyfile"

# Instalar Caddy si no está instalado
if ! command -v caddy &> /dev/null; then
    echo "📦 Instalando Caddy..."
    apt-get update
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
else
    echo "✓ Caddy ya está instalado"
fi

# Email para notificaciones de Let's Encrypt
read -p "Ingresá tu email para notificaciones de Let's Encrypt: " EMAIL

if [ -z "$EMAIL" ]; then
    echo "Error: El email es requerido"
    exit 1
fi

# Configurar email global en Caddy
echo ""
echo "📝 Configurando Caddy..."
mkdir -p "$CADDY_CONFIG_DIR"

# Crear Caddyfile principal si no existe
if [ ! -f "$CADDYFILE" ]; then
    cat > "$CADDYFILE" << EOF
{
    email $EMAIL
}

import /etc/caddy/sites/*.caddy
EOF
    echo "✓ Caddyfile principal creado"
else
    echo "✓ Caddyfile principal ya existe"
fi

# Crear directorio para los sitios
mkdir -p "$CADDY_CONFIG_DIR/sites"

# Copiar configuraciones de sitios
echo ""
echo "📄 Copiando configuraciones de sitios..."
cp "$SCRIPT_DIR/caddy/meatmanager.def-software.com.caddy" "$CADDY_CONFIG_DIR/sites/"
cp "$SCRIPT_DIR/caddy/meatmanager.demo.def-software.com.caddy" "$CADDY_CONFIG_DIR/sites/"

# Si existe barmanager, copiarlo también
if [ -f "$SCRIPT_DIR/caddy/barmanager.def-software.com.caddy" ]; then
    cp "$SCRIPT_DIR/caddy/barmanager.def-software.com.caddy" "$CADDY_CONFIG_DIR/sites/"
    echo "✓ Configuraciones copiadas (meatmanager.def-software.com, meatmanager.demo.def-software.com, barmanager.def-software.com)"
else
    echo "✓ Configuraciones copiadas (meatmanager.def-software.com, meatmanager.demo.def-software.com)"
fi

# Validar configuración
echo ""
echo "🔍 Validando configuración de Caddy..."
if caddy validate --config "$CADDYFILE"; then
    echo "✓ Configuración válida"
else
    echo "❌ Error en la configuración de Caddy"
    exit 1
fi

# Recargar Caddy
echo ""
echo "🔄 Recargando Caddy..."
systemctl enable caddy
systemctl restart caddy

# Esperar a que Caddy obtenga los certificados
echo ""
echo "⏳ Esperando a que Caddy obtenga los certificados SSL..."
sleep 5

# Verificar estado
echo ""
echo "📊 Estado de Caddy:"
systemctl status caddy --no-pager || true

echo ""
echo "✅ Configuración completada!"
echo ""
echo "Caddy está configurado y funcionando con SSL automático."
echo ""
echo "Los certificados se obtienen y renuevan automáticamente."
echo "No necesitás configurar renovación manual."
echo ""
echo "Sitios configurados:"
echo "  - https://meatmanager.def-software.com"
echo "  - https://meatmanager.demo.def-software.com"
if [ -f "$CADDY_CONFIG_DIR/sites/barmanager.def-software.com.caddy" ]; then
    echo "  - https://barmanager.def-software.com"
fi
echo ""
echo "Para ver los certificados activos:"
echo "  ls -la /var/lib/caddy/.local/share/caddy/certificates/"
echo ""
echo "Para ver logs de Caddy:"
echo "  journalctl -u caddy -f"
echo ""
echo "Para recargar configuración:"
echo "  caddy reload --config /etc/caddy/Caddyfile"
echo ""
