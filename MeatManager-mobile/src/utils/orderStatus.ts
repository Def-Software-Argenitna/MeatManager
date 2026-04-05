import type { DeliveryOrderStatus } from '../types/delivery';
import { theme } from '../theme';

export const getOrderStatusLabel = (status: DeliveryOrderStatus) => {
  switch (status) {
    case 'assigned':
      return 'Asignado';
    case 'on_route':
      return 'En ruta';
    case 'arrived':
      return 'En puerta';
    case 'delivered':
      return 'Entregado';
    case 'failed':
      return 'Fallido';
    case 'cancelled':
      return 'Cancelado';
    case 'pending':
    default:
      return 'Pendiente';
  }
};

export const getOrderStatusColors = (status: DeliveryOrderStatus) => {
  switch (status) {
    case 'assigned':
      return { text: theme.colors.info, background: theme.colors.infoSoft };
    case 'on_route':
    case 'arrived':
      return { text: theme.colors.primary, background: theme.colors.warningSoft };
    case 'delivered':
      return { text: theme.colors.success, background: theme.colors.successSoft };
    case 'failed':
      return { text: theme.colors.danger, background: theme.colors.dangerSoft };
    case 'cancelled':
      return { text: theme.colors.danger, background: theme.colors.dangerSoft };
    case 'pending':
    default:
      return { text: theme.colors.warning, background: theme.colors.warningSoft };
  }
};
