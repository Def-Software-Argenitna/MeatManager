# 🚨 Solución rápida para ERR_SSL_PROTOCOL_ERROR

## Problema

El navegador muestra errores:
```
Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR
/api/data:1  Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR
```

## Causa

Caddy no está configurado o no está corriendo en el servidor de producción.

## Solución (Ejecutar en el servidor)

### 1️⃣ Verificar el problema

```bash
cd /opt/meatmanager
./deploy/diagnose-ssl.sh
```

### 2️⃣ Aplicar configuración (si Caddy no está configurado)

```bash
# Ejecutar script de setup
sudo chmod +x ./deploy/setup-ssl.sh
sudo ./deploy/setup-ssl.sh
```

Cuando pida el email, ingresá tu email para notificaciones de Let's Encrypt.

### 3️⃣ Verificar que funciona

```bash
# Ver logs de Caddy
sudo journalctl -u caddy -f

# Probar HTTPS
curl -I https://meatmanager.def-software.com
curl -I https://meatmanager.demo.def-software.com
```

Deberías ver `HTTP/2 200` en la respuesta.

---

## Si ya tenés Caddy instalado pero las configuraciones no están aplicadas

```bash
cd /opt/meatmanager

# Copiar configuraciones actualizadas
sudo cp deploy/caddy/*.caddy /etc/caddy/sites/

# Validar configuración
sudo caddy validate --config /etc/caddy/Caddyfile

# Recargar Caddy (sin downtime)
sudo caddy reload --config /etc/caddy/Caddyfile
```

---

## Si los contenedores Docker no están corriendo

```bash
cd /opt/meatmanager

# Ver estado de contenedores
docker ps

# Si no están corriendo, levantarlos
docker compose -f docker-compose.cloud.yml up -d --wait

# Verificar que están sanos
docker ps
```

---

## Verificación final

Abrí en el navegador:
- https://meatmanager.def-software.com → Debería cargar el sitio
- https://meatmanager.demo.def-software.com → Debería cargar el sitio demo

Si ves el sitio pero sigue habiendo errores en la consola de `/api/`, verifica que la API responde:

```bash
# Desde el servidor
curl http://127.0.0.1:4101/health

# Debería devolver: {"status":"ok"}
```

---

## Troubleshooting adicional

### Caddy no inicia

```bash
# Ver error específico
sudo journalctl -xeu caddy

# Verificar que los puertos no están en uso por otro servicio
sudo lsof -i :80
sudo lsof -i :443

# Si nginx está corriendo, detenerlo
sudo systemctl stop nginx
sudo systemctl disable nginx

# Iniciar Caddy
sudo systemctl start caddy
```

### Certificados no se obtienen

```bash
# Ver logs de Caddy
sudo journalctl -u caddy -n 100

# Verificar DNS
dig +short meatmanager.def-software.com
# Debe devolver la IP del servidor

# Verificar firewall
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Reiniciar Caddy para reintentar
sudo systemctl restart caddy
```

### Los contenedores no arrancan

```bash
cd /opt/meatmanager

# Ver logs de contenedores
docker compose -f docker-compose.cloud.yml logs web-main
docker compose -f docker-compose.cloud.yml logs api-main

# Forzar recreación
docker compose -f docker-compose.cloud.yml up -d --force-recreate --wait
```

---

## Checklist completo

- [ ] DNS apunta al servidor (`dig meatmanager.def-software.com`)
- [ ] Puertos 80 y 443 abiertos en firewall
- [ ] Caddy instalado (`caddy version`)
- [ ] Caddy corriendo (`systemctl status caddy`)
- [ ] Configuraciones en `/etc/caddy/sites/*.caddy`
- [ ] Caddyfile importa sitios (`cat /etc/caddy/Caddyfile`)
- [ ] Certificados obtenidos (esperar ~30 segundos después de iniciar Caddy)
- [ ] Contenedores Docker corriendo (`docker ps`)
- [ ] Web responde localmente (`curl http://127.0.0.1:4100`)
- [ ] API responde localmente (`curl http://127.0.0.1:4101/health`)
- [ ] HTTPS funciona (`curl -I https://meatmanager.def-software.com`)
- [ ] Frontend carga en el navegador
- [ ] No hay errores en consola del navegador

---

## Contacto

Si seguís teniendo problemas, compartí la salida de:

```bash
./deploy/diagnose-ssl.sh > diagnostico.txt
cat diagnostico.txt
```
