#!/bin/bash
# Script de diagnóstico para problemas de SSL en producción

echo "🔍 Diagnóstico de SSL - MeatManager"
echo "=================================="
echo ""

# 1. Verificar que Caddy está instalado
echo "1. Verificando Caddy..."
if command -v caddy &> /dev/null; then
    echo "   ✓ Caddy instalado: $(caddy version)"
else
    echo "   ✗ Caddy NO está instalado"
    echo "   → Ejecutar: sudo ./setup-ssl.sh"
fi
echo ""

# 2. Verificar que Caddy está corriendo
echo "2. Verificando estado de Caddy..."
if systemctl is-active --quiet caddy; then
    echo "   ✓ Caddy está corriendo"
else
    echo "   ✗ Caddy NO está corriendo"
    echo "   → Ejecutar: sudo systemctl start caddy"
fi
echo ""

# 3. Verificar configuraciones de sitios
echo "3. Verificando configuraciones de sitios..."
if [ -f "/etc/caddy/sites/meatmanager.def-software.com.caddy" ]; then
    echo "   ✓ meatmanager.def-software.com.caddy existe"
else
    echo "   ✗ Falta configuración de producción"
    echo "   → Ejecutar: sudo cp deploy/caddy/*.caddy /etc/caddy/sites/"
fi

if [ -f "/etc/caddy/sites/meatmanager.demo.def-software.com.caddy" ]; then
    echo "   ✓ meatmanager.demo.def-software.com.caddy existe"
else
    echo "   ✗ Falta configuración de demo"
fi
echo ""

# 4. Verificar Caddyfile principal
echo "4. Verificando Caddyfile principal..."
if [ -f "/etc/caddy/Caddyfile" ]; then
    echo "   ✓ Caddyfile existe"
    if grep -q "import /etc/caddy/sites/\*.caddy" /etc/caddy/Caddyfile; then
        echo "   ✓ Importa configuraciones de sitios"
    else
        echo "   ⚠ Caddyfile no importa las configuraciones de sitios"
        echo "   → Agregar: import /etc/caddy/sites/*.caddy"
    fi
else
    echo "   ✗ Caddyfile NO existe"
    echo "   → Ejecutar: sudo ./setup-ssl.sh"
fi
echo ""

# 5. Verificar puertos
echo "5. Verificando puertos..."
if lsof -i :80 &> /dev/null; then
    echo "   ✓ Puerto 80 en uso por: $(lsof -i :80 | grep LISTEN | awk '{print $1}' | uniq)"
else
    echo "   ✗ Puerto 80 no está en uso"
fi

if lsof -i :443 &> /dev/null; then
    echo "   ✓ Puerto 443 en uso por: $(lsof -i :443 | grep LISTEN | awk '{print $1}' | uniq)"
else
    echo "   ✗ Puerto 443 no está en uso"
fi
echo ""

# 6. Verificar contenedores Docker
echo "6. Verificando contenedores Docker..."
if docker ps --filter "name=meatmanager-web-main" --format "{{.Status}}" | grep -q "Up"; then
    echo "   ✓ meatmanager-web-main corriendo"
else
    echo "   ✗ meatmanager-web-main NO está corriendo"
    echo "   → Revisar docker compose"
fi

if docker ps --filter "name=meatmanager-api-main" --format "{{.Status}}" | grep -q "Up"; then
    echo "   ✓ meatmanager-api-main corriendo"
else
    echo "   ✗ meatmanager-api-main NO está corriendo"
    echo "   → Revisar docker compose"
fi
echo ""

# 7. Verificar certificados SSL
echo "7. Verificando certificados SSL..."
CERT_DIR="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory"
if [ -d "$CERT_DIR" ]; then
    echo "   ✓ Directorio de certificados existe"
    if ls $CERT_DIR/meatmanager.def-software.com/*.crt &> /dev/null; then
        echo "   ✓ Certificado para meatmanager.def-software.com existe"
        # Verificar expiración
        EXPIRY=$(openssl x509 -noout -enddate -in $CERT_DIR/meatmanager.def-software.com/*.crt | cut -d= -f2)
        echo "   → Expira: $EXPIRY"
    else
        echo "   ✗ No hay certificado para meatmanager.def-software.com"
        echo "   → Revisar logs: journalctl -u caddy -n 50"
    fi
else
    echo "   ✗ No hay certificados de Caddy"
    echo "   → Caddy debe obtenerlos automáticamente al iniciar"
fi
echo ""

# 8. Verificar DNS
echo "8. Verificando DNS..."
MAIN_IP=$(dig +short meatmanager.def-software.com | head -n1)
DEMO_IP=$(dig +short meatmanager.demo.def-software.com | head -n1)
SERVER_IP=$(hostname -I | awk '{print $1}')

echo "   meatmanager.def-software.com → $MAIN_IP"
echo "   meatmanager.demo.def-software.com → $DEMO_IP"
echo "   IP del servidor → $SERVER_IP"

if [ "$MAIN_IP" = "$SERVER_IP" ]; then
    echo "   ✓ DNS principal apunta correctamente"
else
    echo "   ✗ DNS principal NO apunta a este servidor"
fi
echo ""

# 9. Probar conexión local
echo "9. Probando conexión local a contenedores..."
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100 | grep -q "200"; then
    echo "   ✓ Web principal responde en puerto 4100"
else
    echo "   ✗ Web principal NO responde en puerto 4100"
fi

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4101/health | grep -q "200"; then
    echo "   ✓ API principal responde en puerto 4101"
else
    echo "   ✗ API principal NO responde en puerto 4101"
fi
echo ""

# 10. Ver últimos logs de Caddy
echo "10. Últimos logs de Caddy (errores):"
echo "-----------------------------------"
journalctl -u caddy -n 20 --no-pager | grep -i "error\|warn\|fail" || echo "   (sin errores recientes)"
echo ""

echo "=================================="
echo "Diagnóstico completado"
echo ""
echo "SOLUCIONES RÁPIDAS:"
echo "-------------------"
echo "Si Caddy no está instalado o configurado:"
echo "  sudo ./deploy/setup-ssl.sh"
echo ""
echo "Si las configuraciones no están aplicadas:"
echo "  sudo cp deploy/caddy/*.caddy /etc/caddy/sites/"
echo "  sudo caddy reload --config /etc/caddy/Caddyfile"
echo ""
echo "Si Caddy no está corriendo:"
echo "  sudo systemctl start caddy"
echo "  sudo systemctl enable caddy"
echo ""
echo "Si los contenedores no están corriendo:"
echo "  cd /opt/meatmanager"
echo "  docker compose -f docker-compose.cloud.yml up -d"
echo ""
echo "Ver logs en tiempo real:"
echo "  sudo journalctl -u caddy -f"
echo ""
