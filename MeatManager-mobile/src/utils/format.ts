export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

export const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value || 0));
