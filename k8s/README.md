# MeatManager K8s

Manifiestos Kubernetes para MeatManager.

## Requisitos

- Kubernetes cluster (1.28+)
- MySQL/MariaDB dentro del cluster o accesible desde el cluster
- Redis dentro del cluster o accesible desde el cluster
- Firebase service account JSON

## Aplicar

```bash
# Namespace primero
kubectl apply -f k8s/namespace.yaml

# Config y secrets (editar api-secret.yaml antes)
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/api-secret.yaml

# Redis (si no tenes uno ya)
kubectl apply -f k8s/redis.yaml

# API
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/api-service.yaml

# Web
kubectl apply -f k8s/web-deployment.yaml
kubectl apply -f k8s/web-service.yaml

# Ingress (opcional si usas NPM)
kubectl apply -f k8s/ingress.yaml
```

## Variables de entorno

Editar `configmap.yaml` y `api-secret.yaml` con los valores correctos antes de aplicar.

- `configmap.yaml`: variables no sensibles (hosts, puertos, nombres de DB)
- `api-secret.yaml`: passwords, Firebase JSON, SMTP

## Firebase

El `firebase-service-account.json` va dentro de `api-secret.yaml` como una clave del secret.
