# 👑 Guía Maestra: Gestión de Sucursales y Stock Global
**MeatManager PRO / CONTROL**

Esta guía explica paso a paso cómo configurar y operar el sistema en múltiples locales para que la administración central (Dueña) tenga el control total de los kilos de carne sin necesidad de servidores costosos.

---

## 🏗️ 1. Configuración de Identidad (Primer Paso)

Cada computadora donde se instale el programa debe tener su propia "Identidad".

### 📍 En cada Sucursal (Local de Venta):
1. Entrá al menú **Sucursales**.
2. Tocá el ícono del **Pin de Ubicación (📍)** en el encabezado.
3. Completá la ficha con el nombre del local (ej: *Antigravity Pilar*), dirección, teléfono y responsable.
4. Asegurate de que en **"Tipo de PC / Rol"** diga: *Sucursal de Venta*.
5. Tocá **Guardar Perfil**.

### 👑 En la PC de la Dueña (Administración):
1. Entrá al menú **Sucursales**.
2. Tocá el ícono del **Pin (📍)**.
3. En el desplegable **"Tipo de PC / Rol"**, elegí: **Administración Central (Master)**.
4. El sistema te pedirá el **PIN de Seguridad**. El código por defecto es: `1234`.
5. Una vez activado, verás que el logo de la barra lateral cambia a una **Corona Dorada** y aparece la etiqueta **CONTROL**.

---

## ☁️ 2. El Nexo: Vincular la Carpeta Compartida

Para que los datos viajen de un local a otro, todos deben usar la misma carpeta de **Google Drive** o **Dropbox**.

1. Instalá Google Drive en todas las PCs.
2. Creá una carpeta llamada "STOCK_CARNICERIA".
3. En el programa, dentro de **Sucursales**, tocá el botón **"Vincular Carpeta"**.
4. Seleccioná esa carpeta "STOCK_CARNICERIA" que creaste en el Drive.
5. **¡Listo!** Ahora la PC "mira" directamente esa carpeta en la nube.

---

## 📈 3. Operativa Diaria

### Al Cierre del Día (El Carnicero):
El carnicero debe entrar a **Sucursales** y tocar el botón **"Exportar Stock"**.
* El sistema genera un archivo automático (ej: `STOCK_Pilar.json`) y lo guarda en la carpeta vinculada.
* Ese archivo viaja por internet al Drive de la dueña en segundos.

### Consulta de la Dueña (Vista Global):
La dueña entra a su sección de **Sucursales** y toca el botón del **Ojito (Ver Vista Global)**.
* El sistema escanea la carpeta y busca los archivos de todos los locales.
* Se abre una tabla comparativa donde se ve:
    * **Producto:** (Bife de Chorizo, Lomo, etc.)
    * **Locales:** Una columna por cada local (Pilar, Fátima, Norte).
    * **Kilos:** Cuántos kilos hay en cada uno y el **Total General** de toda la empresa.

---

## 🔒 4. Seguridad y PIN

* **PIN Master:** El código `1234` es el que permite ver el stock global. Se recomienda no dárselo a los empleados.
* **Archivos .json:** No borres los archivos de la carpeta del Drive manualmente, el sistema se encarga de actualizarlos cada vez que una sucursal exporta.

---

## ❓ Preguntas Frecuentes

**¿Qué pasa si no tengo internet?**
Podés exportar el stock igual. El archivo se guardará en tu PC y, en cuanto recuperes internet, el Google Drive lo subirá solo.

**¿Puedo ver las ventas también?**
En esta versión, la vista global está enfocada en el **Stock (Kilos)**. Para ver ventas detalladas, se requiere la suscripción PRO con sincronización en la nube en tiempo real.

**¿Cómo cambio el PIN?**
Por ahora el PIN es fijo (`1234`), pero podés solicitar un cambio personalizado en el menú de Configuración > Seguridad.

---
*Manual generado por Antigravity AI - MeatManager CONTROL Edition*
