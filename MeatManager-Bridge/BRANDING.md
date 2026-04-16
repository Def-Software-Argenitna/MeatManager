# MeatManager Bridge Branding

## Archivo principal recibido

- `public/branding/def-software-512.png`
- `public/branding/def-software-tray.png`
- `public/branding/def-software-tray-update.png`

Este archivo se usara como base para:

- Icono de app (`.ico`) para Windows.
- Icono de bandeja (tray) normal.
- Icono de bandeja con badge rojo para update disponible.
- Imagen del instalador.

## Siguiente paso recomendado

Generar estos assets derivados:

- `build/icons/app.ico`
- `build/icons/tray.png` (16/20 px)
- `build/icons/tray-update.png` (16/20 px con punto rojo)
- `build/installer/header.bmp` o recurso equivalente del instalador

Cuando confirmes, armo el pipeline de empaquetado con Electron + auto-update por GitHub Releases y dejo conectado este branding.
