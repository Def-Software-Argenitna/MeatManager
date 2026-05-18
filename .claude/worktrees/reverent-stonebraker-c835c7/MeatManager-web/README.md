# MeatManager Web Base

Base web de MeatManager alineada con la app funcional del instalable, preparada para trabajar con API Node multi-tenant.

## Modos de API

- Desarrollo local:
  - usar [`.env.local`](.\.env.local) con `VITE_API_URL=http://127.0.0.1:3001`
- Producción:
  - usar `VITE_API_URL=/api`
  - el frontend queda listo para trabajar detrás del mismo dominio vía `nginx` o `caddy`

Ejemplos:
- [`.env.example`](.\.env.example)
- [`.env.production.example`](.\.env.production.example)

## Flujo recomendado para vender/desplegar

1. Publicar el frontend en el dominio final.
2. Publicar la API Node detrás del mismo dominio.
3. Proxy:
   - frontend en `/`
   - API en `/api/*`
   - health en `/health`
4. Configurar DNS del dominio.
5. Ajustar sólo variables del server y del proxy.

Con esta configuración no hace falta recompilar por cada cliente si el dominio y el proxy ya están bien armados.

## Redis para logística

Se dejó una base de despliegue en:

- [deploy/docker-compose.redis.yml](./deploy/docker-compose.redis.yml)
- [deploy/redis/users.acl.example](./deploy/redis/users.acl.example)

Uso recomendado:

1. Copiar `deploy/redis/users.acl.example` a `deploy/redis/users.acl`
2. Cambiar la clave del usuario `root`
3. Ajustar el `healthcheck` del compose con esa misma clave
4. Levantar con:

```bash
docker compose -f deploy/docker-compose.redis.yml up -d
```

Este Redis queda con:

- persistencia AOF
- reinicio automático
- usuario `default` desactivado
- usuario `root` con acceso total
