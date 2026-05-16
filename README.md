# 🥩 MeatManager

Suite de gestión especializada para carnicerías desarrollada por **DEF Software Argentina**.

## 🚀 Módulos Principales

El proyecto se divide en módulos interconectados, cada uno con su propio documento README detallado.

- 🌐 **MeatManager-web:** Panel web principal Frontend desarrollado en React + Vite. [Ver README](./MeatManager-web/README.md)
- ⚙️ **MeatManager-API:** Backend Node.js. Administra la autenticación, multi-tenant, permisos y tracking usando Firebase, MySQL y Redis. [Ver README](./MeatManager-API/README.md)
- 📱 **MeatManager-mobile:** App móvil nativa de repartidores/operarios en React Native + Expo para asignación de pedidos y tracking. [Ver README](./MeatManager-mobile/README.md)
- ☁️ **deploy:** Scripts y configuración cloud para ambientes productivos y demos. [Ver README](./deploy/README.md)

## 🔄 Flujo General del Sistema

1. **Autenticación Unificada:** La plataforma web y la app móvil autentican a los usuarios a través de Firebase Auth.
2. **Validación:** La API procesa y valida los tokens de Firebase para resolver el acceso por tenant, los permisos y las licencias correspondientes.
3. **Logística Online:** La ubicación en tiempo real de los repartidores es reportada desde la app móvil hacia la API.
4. **Almacenamiento de Estados:** La API hace uso de Redis para persistir la presencia y la última ubicación conocida.
5. **Despliegue Continuo (CI/CD):** Las ramas `dev` y `main` se despliegan automáticamente a través de *GitHub Actions* en un entorno productivo autoalojado.

## 🛠️ Arranque Rápido por Módulo

### 1. Panel Web
```bash
cd MeatManager-web
npm install
npm run dev
```

### 2. Backend (API)
```bash
cd MeatManager-API
npm install
cp .env.example .env # Completar variables
npm run dev
```

### 3. App Móvil (Repartidores)
```bash
cd MeatManager-mobile
npm install
npx expo start --lan --clear
```

## 🌍 Entornos
- `dev`: Ambiente demo y pruebas (`meatmanager.demo.def-software.com`)
- `main`: Ambiente productivo (`meatmanager.def-software.com`)

> [!WARNING]
> **Notas Importantes:**
> - Jamás comitear archivos `.env` ni credenciales sensibles de Firebase Admin al repositorio público.
> - La raíz contiene este README general. Por favor, visita las subcarpetas de cada módulo para conocer las especificaciones técnicas profundas.

---
© **DEF Software Argentina.** Todos los derechos reservados.
