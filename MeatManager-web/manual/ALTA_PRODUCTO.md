# 📦 MANUAL: Cómo Cargar un Producto Nuevo

## MeatManager PRO - Sistema de Gestión para Carnicerías

---

## 🎯 FLUJO COMPLETO DE ALTA DE PRODUCTO

Para que un producto esté disponible para **vender**, debe pasar por estos pasos:

### 1️⃣ CATEGORÍA (Opcional, pero recomendado)
### 2️⃣ CATÁLOGO DE COMPRAS (Alta del producto)
### 3️⃣ CARGAR STOCK (Compras o Ajuste Manual)
### 4️⃣ VENDER

---

## 📋 PASO A PASO DETALLADO

### PASO 1: Crear Categoría (Si no existe)

**¿Para qué?** Las categorías organizan tus productos (Ejemplo: "Carnes Rojas", "Aves", "Chacinados", etc.)

**Ubicación:** `Configuración → Categorías`

**Pasos:**
1. Click en **"Nueva Categoría Principal"**
2. Escribir el nombre (Ejemplo: `Carnes Rojas`)
3. Guardar

![Categorías](../assets/manual_categorias.png)

---

### PASO 2: Crear Producto en Catálogo de Compras ⭐

**¿Para qué?** Aquí defines TODOS los datos del producto: nombre, unidad, categoría, **precio de venta** y **PLU para la balanza**.

**Ubicación:** `Configuración → Productos de Compra`

**Pasos:**

1. Click en **"Nuevo Producto"**

2. **Completar Datos Básicos:**
   - **Nombre del Producto:** Ej. `Bife Ancho`
   - **Categoría:** Seleccionar (Ej. `Carnes Rojas`)
   - **Unidad de Medida:** `kg` (o `un`, `l`, etc.)
   - **Destino/Uso:** 
     - `Venta Directa / Insumo` → Para vender directo
     - `Animal para Despostada` → Si comprás media res (Solo PRO)

3. **Completar Datos para Ventas (IMPORTANTE):**
   
   Esta sección es **obligatoria** para que el producto aparezca en Ventas:
   
   - **Categoría de Venta:** `Vaca`, `Cerdo`, `Pollo`, `Pescado`, `Pre-elaborados`
   - **PLU:** Código numérico para la balanza (Ej. `111`)
   - **Precio de Venta:** Precio por kg o unidad (Ej. `15000`)

4. Click en **"Guardar"**

**¿Qué hace el sistema automáticamente?**
- ✅ Crea el producto en el catálogo de compras
- ✅ Crea una entrada en Stock con **cantidad 0**
- ✅ Guarda el **Precio** y **PLU** para Ventas

---

### PASO 3: Cargar Stock

Ahora que el producto existe, cargamos la cantidad disponible.

#### **Opción A: Desde COMPRAS** (Recomendado)

**Ubicación:** `Compras`

1. Click en **"Nueva Compra"**
2. Seleccionar **Proveedor**
3. Agregar productos y cantidades
4. El sistema actualiza el stock automáticamente

#### **Opción B: Desde STOCK (Ajuste Manual)**

**Ubicación:** `Stock e Inventario`

1. Click en **"Ajuste Manual"**
2. Seleccionar el **Producto**
3. Ingresar **Cantidad**
4. Elegir **Sumar Stock** o **Restar Stock**
5. Guardar

---

### PASO 4: Vender el Producto

**Ubicación:** `Ventas`

El producto ya está listo para vender. Podés:

**Método 1: Buscar manualmente**
- Escribir el nombre o PLU en el buscador
- Click en el producto para agregarlo al carrito

**Método 2: Escanear código de barras**
- Click en el botón **📦** para activar el escáner
- Escanear el código de la balanza
- El producto se agrega automáticamente con el peso correcto

---

## 🔍 EJEMPLO PRÁCTICO

### Quiero vender "Bife Ancho"

1. **Categoría:** Ya existe `Carnes Rojas`

2. **Catálogo de Compras:**
   - Nombre: `Bife Ancho`
   - Categoría: `Carnes Rojas`
   - Unidad: `kg`
   - Destino: `Venta Directa`
   - **Categoría de Venta:** `Vaca`
   - **PLU:** `111`
   - **Precio:** `15000`
   - Guardar ✅

3. **Cargar Stock (Compra):**
   - Compro 50kg al proveedor
   - Stock actual: **50kg**

4. **Vender:**
   - Cliente pide 2kg
   - Busco "Bife Ancho" o escaneo código
   - Se agrega al carrito: 2kg × $15000 = **$30000**
   - Stock restante: **48kg**

---

## ⚠️ ERRORES COMUNES

### ❌ "No aparece mi producto en Ventas"
**Solución:** Verificar que completaste **PLU** y **Precio** en el Catálogo de Compras.

### ❌ "El escáner no lee el código"
**Solución:** 
1. Activar el escáner con el botón 📦
2. Verificar que el PLU del producto coincida con el de la balanza
3. Revisar que el código sea EAN-13 (formato Systel)

### ❌ "Stock negativo"
**Solución:** Ir a `Stock → Ajuste Manual` y sumar la cantidad correcta.

---

## 📞 SOPORTE

**MeatManager PRO**  
Sistema de Gestión Integral para Carnicerías

Para consultas técnicas, revisar la sección **Manual** dentro de la aplicación.

---

**Versión:** 1.0.0  
**Fecha:** Febrero 2026
