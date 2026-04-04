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
};

export type DriverLocation = {
  lat: number;
  lng: number;
  time: string;
  repartidor: string;
};
