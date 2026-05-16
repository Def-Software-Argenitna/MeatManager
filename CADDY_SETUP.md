# Configuración de Caddy para MeatManager

## 📋 Arquitectura actual

Este proyecto usa **Caddy en contenedor** (`kioskmanager-caddy`) como reverse proxy compartido para múltiples aplicaciones en el servidor.

```
Internet (HTTPS :443)
         ↓
   kioskmanager-caddy (contenedor)
         ↓
   ├── meatmanager.def-software.com → meatmanager-web-main:80 + meatmanager-api-main:3001
   ├── meatmanager.demo.def-software.com → meatmanager-web-dev:80 + meatmanager-api-dev:3001
   ├── barmanager.def-software.com → barmanager-web-1:80
   └── kioskmanager.def-software.com → kioskmanager-web-1:80
```

### ✅ Ventajas de esta configuración:

- **SSL automático**: Caddy obtiene y renueva certificados de Let's Encrypt automáticamente
- **Un solo punto de entrada**: Todos los dominios comparten el mismo Caddy
- **Sin downtime**: Recargar configuración sin reiniciar
- **Configuración simple**: Un archivo `.caddy` por dominio

---

## 🔧 Cómo agregar un nuevo dominio

### 1️⃣ Crear archivo de configuración

Crear un archivo en `/etc/caddy/sites/` en el servidor:

```bash
sudo tee /etc/caddy/sites/nuevo-dominio.com.caddy > /dev/null << 'EOF'
nuevo-dominio.com {
    encode gzip zstd

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    # Si es una SPA (Single Page App)
    handle {
        reverse_proxy nombre-contenedor:puerto
    }
}
EOF
```

### 2️⃣ Asegurar que el contenedor esté en la red correcta

Si el contenedor nuevo no está en la red `gestionclientes_gestionclientes_net`:

```bash
# Conectar el contenedor a la red compartida
docker network connect gestionclientes_gestionclientes_net nombre-contenedor

# Verificar
docker network inspect gestionclientes_gestionclientes_net | grep nombre-contenedor
```

### 3️⃣ Recargar Caddy (sin downtime)

```bash
# Recargar configuración
docker exec kioskmanager-caddy caddy reload --config /etc/caddy/Caddyfile

# Ver logs
docker logs kioskmanager-caddy --tail 30
```

### 4️⃣ Verificar

```bash
# Probar HTTPS (Caddy obtiene certificados automáticamente)
curl -I https://nuevo-dominio.com

# Ver certificados obtenidos
docker exec kioskmanager-caddy ls -la /data/caddy/certificates/
```

---

## 📝 Configuraciones actuales de MeatManager

### Producción: `meatmanager.def-software.com`

```caddy
meatmanager.def-software.com {
    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    # API endpoint
    handle /api/* {
        reverse_proxy meatmanager-api-main:3001
    }

    # Web frontend
    handle {
        reverse_proxy meatmanager-web-main:80
    }
}
```

### Demo/Dev: `meatmanager.demo.def-software.com`

```caddy
meatmanager.demo.def-software.com {
    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    # API endpoint
    handle /api/* {
        reverse_proxy meatmanager-api-dev:3001
    }

    # Web frontend
    handle {
        reverse_proxy meatmanager-web-dev:80
    }
}
```

---

## 🔍 Troubleshooting

### Ver logs de Caddy en tiempo real

```bash
docker logs kioskmanager-caddy -f
```

### Validar configuración antes de recargar

```bash
docker exec kioskmanager-caddy caddy validate --config /etc/caddy/Caddyfile
```

### Ver configuración actual parseada

```bash
docker exec kioskmanager-caddy caddy adapt --config /etc/caddy/Caddyfile
```

### Error 502 Bad Gateway

**Causa**: Caddy no puede conectarse al contenedor backend.

**Solución**:
1. Verificar que el contenedor esté corriendo: `docker ps | grep nombre-contenedor`
2. Verificar que esté en la red correcta: `docker network inspect gestionclientes_gestionclientes_net`
3. Probar conectividad: `docker exec kioskmanager-caddy wget -O- http://nombre-contenedor:puerto`

### Certificado no se obtiene

**Causa**: DNS no apunta al servidor o puertos bloqueados.

**Solución**:
1. Verificar DNS: `dig dominio.com`
2. Verificar puertos abiertos: `sudo lsof -i :80` y `sudo lsof -i :443`
3. Ver logs detallados: `docker logs kioskmanager-caddy --tail 50`

---

## 📂 Estructura de archivos en el servidor

```
/etc/caddy/
├── Caddyfile                      # Configuración principal
│   {
│       email def.software.arg@gmail.com
│   }
│   import /etc/caddy/sites/*.caddy
│
└── sites/                         # Configuraciones por sitio
    ├── meatmanager.def-software.com.caddy
    ├── meatmanager.demo.def-software.com.caddy
    ├── barmanager.def-software.com.caddy
    └── kioskmanager.def-software.com.caddy
```

---

## 🚀 Deploy automático

Cuando hacés deploy con GitHub Actions, los contenedores se actualizan automáticamente pero **las configuraciones de Caddy NO cambian**.

Si necesitás actualizar la configuración de Caddy durante un deploy, podés agregar un paso al workflow:

```yaml
- name: Update Caddy config
  run: |
    # Copiar nueva configuración si existe
    if [ -f deploy/caddy/nuevo-sitio.caddy ]; then
      sudo cp deploy/caddy/nuevo-sitio.caddy /etc/caddy/sites/
      docker exec kioskmanager-caddy caddy reload --config /etc/caddy/Caddyfile
    fi
```

---

## ⚠️ Importante

- **Caddy del host NO**: Este proyecto usa Caddy en contenedor, NO Caddy instalado en el host
- **Red compartida**: Todos los contenedores deben estar en `gestionclientes_gestionclientes_net`
- **Nombres de contenedores**: Usar nombres de contenedores en lugar de IPs
- **SSL automático**: No necesitás certificados manuales ni certbot

---

## 📞 Comandos útiles

```bash
# Ver todas las redes Docker
docker network ls

# Ver qué contenedores están en una red
docker network inspect gestionclientes_gestionclientes_net

# Ver qué redes usa un contenedor
docker inspect nombre-contenedor | grep -A 10 Networks

# Reiniciar Caddy (solo si es necesario)
docker restart kioskmanager-caddy

# Ver el Caddyfile actual
cat /etc/caddy/Caddyfile

# Listar configuraciones de sitios
ls -la /etc/caddy/sites/
```

---

## 🔄 Migración desde Nginx (histórico)

Este proyecto originalmente usaba **Nginx** en el host. Las configuraciones viejas están en `deploy/nginx/` pero están **DEPRECATED**.

Si necesitás volver a Nginx (no recomendado):
1. Detener `kioskmanager-caddy`: `docker stop kioskmanager-caddy`
2. Copiar configuraciones: `sudo cp deploy/nginx/*.conf /etc/nginx/sites-available/`
3. Habilitar sitios: `sudo ln -s /etc/nginx/sites-available/meatmanager.*.conf /etc/nginx/sites-enabled/`
4. Instalar certbot: `sudo apt install certbot python3-certbot-nginx`
5. Obtener certificados: `sudo certbot --nginx -d meatmanager.def-software.com`
6. Iniciar nginx: `sudo systemctl start nginx`

**No recomendamos esta opción** porque pierdes SSL automático y renovación de certificados.
