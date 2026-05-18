export type DeliveryOrderStatus =
  | 'pending'
  | 'assigned'
  | 'on_route'
  | 'arrived'
  | 'delivered'
  | 'failed'
  | 'cancelled';

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
  requires_collection?: boolean;
  delivery_date?: string;
};

export type DriverLocation = {
  lat: number;
  lng: number;
  time: string;
  repartidor: string;
};
