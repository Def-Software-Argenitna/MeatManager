export type DeliveryOrderStatus = 'pending' | 'ready' | 'delivered' | 'cancelled';

export type DeliveryOrder = {
  cloudId: string;
  id?: number | string;
  customer_name: string;
  customer_phone?: string;
  address: string;
  items: string;
  repartidor: string;
  status: DeliveryOrderStatus;
  total?: number;
  updated_at?: string;
  delivered_at?: string;
  payment_method?: string;
  payment_status?: string;
  paid?: boolean;
  amount_due?: number;
};

export type DriverLocation = {
  lat: number;
  lng: number;
  time: string;
  repartidor: string;
};
