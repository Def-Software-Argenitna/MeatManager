# Configuraciones nginx (DEPRECATED)

⚠️ **NOTA**: Estas configuraciones son para nginx y ya **NO SE USAN** en producción.

El servidor usa **Caddy** como reverse proxy.

## Migrar a Caddy

Las configuraciones de Caddy están en la carpeta `../caddy/`.

Para migrar desde nginx a Caddy, ver [../SSL_SETUP.md](../SSL_SETUP.md) - sección "Migración desde nginx".

## Si necesitás usar nginx

Estas configuraciones están actualizadas con:
- SSL/TLS configurado
- Headers de seguridad
- Reverse proxy a los contenedores Docker

Pero vas a necesitar:
1. Instalar certbot para gestionar certificados SSL
2. Configurar renovación automática con cron
3. Gestionar manualmente la configuración de nginx

Recomendamos usar **Caddy** en su lugar porque:
- SSL automático (no necesita certbot)
- Renovación automática de certificados (sin cron)
- Configuración más simple
- HTTP/2 y HTTP/3 por defecto
