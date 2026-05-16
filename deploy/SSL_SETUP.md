# Configuración SSL para MeatManager con Caddy

## Problema Original

Las configuraciones no tenían SSL habilitado correctamente, causando errores de certificado en producción.

## Solución con Caddy

Caddy obtiene y renueva certificados SSL automáticamente de Let's Encrypt. No necesita configuración manual de certificados.

### Ventajas de Caddy

- ✅ SSL automático con Let's Encrypt
- ✅ Renovación automática de certificados (sin cron jobs)
- ✅ HTTP/2 y HTTP/3 por defecto
- ✅ Configuración más simple y legible
- ✅ Headers de seguridad incluidos

### 1. Configuraciones Caddy

Las configuraciones están en `deploy/caddy/`:

- `meatmanager.def-software.com.caddy` - Producción
- `meatmanager.demo.def-software.com.caddy` - Demo/Dev
- `barmanager.def-software.com.caddy` - BarManager

Cada archivo incluye:
- Compresión gzip/zstd
- Headers de seguridad (HSTS, X-Frame-Options, etc.)
- Reverse proxy a los contenedores Docker

### 2. Instalar y configurar Caddy en el servidor

#### Opción A: Script automático (recomendado)

```bash
# Copiar el script al servidor
scp deploy/setup-ssl.sh usuario@servidor:/opt/meatmanager/

# En el servidor, ejecutar como root
sudo chmod +x /opt/meatmanager/setup-ssl.sh
sudo /opt/meatmanager/setup-ssl.sh
```

Este script automáticamente:
- Instala Caddy si no está instalado
- Configura el email para notificaciones de Let's Encrypt
- Copia las configuraciones de sitios
- Valida y recarga Caddy
- Obtiene certificados SSL automáticamente

#### Opción B: Manual

```bash
# Instalar Caddy
sudo apt-get update
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy

# Crear estructura de directorios
sudo mkdir -p /etc/caddy/sites

# Crear Caddyfile principal
sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
{
    email tu-email@ejemplo.com
}

import /etc/caddy/sites/*.caddy
EOF

# Copiar configuraciones de sitios
sudo cp deploy/caddy/*.caddy /etc/caddy/sites/

# Validar y recargar
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
```

### 3. Verificar que funciona

```bash
# Verificar estado de Caddy
sudo systemctl status caddy

# Ver logs en tiempo real
sudo journalctl -u caddy -f

# Probar HTTPS (debe funcionar automáticamente)
curl -I https://meatmanager.def-software.com
curl -I https://meatmanager.demo.def-software.com

# Verificar redirección HTTP → HTTPS (Caddy lo hace automáticamente)
curl -I http://meatmanager.def-software.com
```

### 4. Ver certificados

```bash
# Listar certificados activos
sudo ls -la /var/lib/caddy/.local/share/caddy/certificates/

# Ver detalles de un certificado específico
sudo cat /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/meatmanager.def-software.com/meatmanager.def-software.com.crt | \
    openssl x509 -noout -text
```

## Renovación Automática

**No necesitás hacer nada**. Caddy renueva los certificados automáticamente cuando están por vencer (30 días antes).

### Monitoreo de renovación

```bash
# Ver logs de Caddy para verificar renovaciones
sudo journalctl -u caddy | grep -i "renew\|certificate"

# Verificar cuándo vence un certificado
echo | openssl s_client -servername meatmanager.def-software.com \
    -connect meatmanager.def-software.com:443 2>/dev/null | \
    openssl x509 -noout -dates
```

## Configuración de Caddyfile

### Estructura recomendada

```
/etc/caddy/
├── Caddyfile              # Configuración principal con email y imports
└── sites/                 # Configuraciones de cada sitio
    ├── meatmanager.def-software.com.caddy
    ├── meatmanager.demo.def-software.com.caddy
    └── barmanager.def-software.com.caddy
```

### Caddyfile principal

```caddy
{
    email tu-email@ejemplo.com
    
    # Opcional: configuración global
    # admin off  # Desactivar API de administración
}

# Importar todas las configuraciones de sitios
import /etc/caddy/sites/*.caddy
```

### Ejemplo de sitio

```caddy
meatmanager.def-software.com {
    encode gzip zstd
    
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }
    
    handle /api/* {
        reverse_proxy 127.0.0.1:4101
    }
    
    handle {
        reverse_proxy 127.0.0.1:4100
    }
}
```

## Troubleshooting

### Error: "Certificate validation failed"

**Causa**: DNS no apunta correctamente al servidor.

**Solución**:
```bash
# Verificar DNS
dig meatmanager.def-software.com
nslookup meatmanager.def-software.com

# El DNS debe apuntar a la IP del servidor
```

### Error: "Port 80 is already in use"

**Causa**: Otro servicio (probablemente nginx) está usando el puerto 80.

**Solución**:
```bash
# Verificar qué está usando el puerto 80
sudo lsof -i :80

# Si es nginx, detenerlo
sudo systemctl stop nginx
sudo systemctl disable nginx

# Reiniciar Caddy
sudo systemctl restart caddy
```

### Error: "Failed to obtain certificate"

**Causas comunes**:
1. Firewall bloqueando puerto 80 o 443
2. DNS no propagado
3. Demasiados intentos fallidos (rate limit de Let's Encrypt)

**Solución**:
```bash
# Verificar firewall
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Ver logs detallados
sudo journalctl -u caddy -n 100 --no-pager

# Esperar 1 hora si alcanzaste el rate limit
```

### Caddy no inicia

**Solución**:
```bash
# Ver error específico
sudo journalctl -xeu caddy

# Validar configuración
sudo caddy validate --config /etc/caddy/Caddyfile

# Ver sintaxis del Caddyfile
sudo caddy fmt /etc/caddy/Caddyfile
```

### Certificado no se renueva

**Solución**:
```bash
# Forzar renovación (para testing)
# Nota: Caddy no tiene comando manual de renovación,
# simplemente reinicia el servicio
sudo systemctl restart caddy

# Ver si hay errores en los logs
sudo journalctl -u caddy | grep -i error
```

## Comandos útiles

### Recargar configuración sin downtime

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Ver configuración actual parseada

```bash
sudo caddy adapt --config /etc/caddy/Caddyfile
```

### Formatear Caddyfile

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
```

### Ver logs en vivo

```bash
# Logs de systemd
sudo journalctl -u caddy -f

# Solo errores
sudo journalctl -u caddy -p err -f
```

### Verificar versión de Caddy

```bash
caddy version
```

## Seguridad

### Headers configurados

- **HSTS**: Fuerza HTTPS por 1 año
- **X-Frame-Options**: Previene clickjacking  
- **X-Content-Type-Options**: Previene MIME sniffing
- **X-XSS-Protection**: Protección contra XSS

### Configuración adicional recomendada

```caddy
{
    email tu-email@ejemplo.com
    
    # Usar servidor de staging para testing
    # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
    
    # Configurar servidores DNS para el challenge
    # acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}
}
```

## Migración desde nginx

Si ya tenés nginx instalado:

1. **Exportar configuración actual de nginx** (backup)
2. **Detener nginx**:
   ```bash
   sudo systemctl stop nginx
   sudo systemctl disable nginx
   ```
3. **Instalar y configurar Caddy** (ver arriba)
4. **Verificar que funciona** antes de desinstalar nginx

## Monitoreo

### Métricas de Caddy

Caddy expone métricas en formato JSON:

```bash
# Habilitar API de admin (opcional)
# Agregar en Caddyfile global:
{
    admin localhost:2019
}

# Ver métricas
curl localhost:2019/metrics
```

### Alertas

Caddy envía notificaciones al email configurado cuando:
- Un certificado no se puede renovar
- Hay errores críticos

Asegurate de que el email en `/etc/caddy/Caddyfile` sea válido.

## Checklist de Deployment

- [ ] DNS apunta al servidor (ambos dominios)
- [ ] Puerto 80 y 443 abiertos en firewall
- [ ] Caddy instalado
- [ ] Email configurado en Caddyfile
- [ ] Configuraciones de sitios en `/etc/caddy/sites/`
- [ ] Caddyfile válido (`caddy validate`)
- [ ] Caddy corriendo (`systemctl status caddy`)
- [ ] HTTPS funciona en ambos dominios
- [ ] HTTP redirige a HTTPS automáticamente
- [ ] Headers de seguridad presentes (`curl -I`)
- [ ] Logs sin errores (`journalctl -u caddy`)

## Referencias

- [Caddy Documentation](https://caddyserver.com/docs/)
- [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddyfile Concepts](https://caddyserver.com/docs/caddyfile/concepts)
- [Reverse Proxy Guide](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [SSL Labs Test](https://www.ssllabs.com/ssltest/)
