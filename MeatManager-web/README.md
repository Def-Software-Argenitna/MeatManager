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
