// src/utils/priceFormat.js

// Redondeo especial: 0.5 para arriba, 0.4 para abajo, sin decimales
export function round6d(value) {
  const intPart = Math.floor(value);
  const decimal = value - intPart;
  if (decimal >= 0.5) return Math.ceil(value);
  return Math.floor(value);
}

// Formatea el precio según configuración
export function formatPrice(value, config) {
  if (config === '6d') {
    return round6d(value);
  }
  // Default: 4 dígitos + 2 decimales
  return Number(value).toFixed(2);
}
