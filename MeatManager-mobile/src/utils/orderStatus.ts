import type { DeliveryOrderStatus } from '../types/delivery';
import { theme } from '../theme';

export const getOrderStatusLabel = (status: DeliveryOrderStatus) => {
  switch (status) {
    case 'ready':
      return 'Listo para salir';
    case 'delivered':
      return 'Entregado';
    case 'cancelled':
      return 'Cancelado';
    case 'pending':
    default:
      return 'Pendiente';
  }
};

export const getOrderStatusColors = (status: DeliveryOrderStatus) => {
  switch (status) {
    case 'ready':
      return { text: theme.colors.info, background: theme.colors.infoSoft };
    case 'delivered':
      return { text: theme.colors.success, background: theme.colors.successSoft };
    case 'cancelled':
      return { text: theme.colors.danger, background: theme.colors.dangerSoft };
    case 'pending':
    default:
      return { text: theme.colors.warning, background: theme.colors.warningSoft };
  }
};
