import { useEffect, useMemo, useState } from 'react';

import { fetchDriverLocations, fetchTableRows } from '../services/mobileApi';

type VentaRow = {
  id: number;
  date?: string;
  total?: number | string;
  payment_method?: string | null;
  payment_breakdown?: Array<{ method_name?: string; amount_charged?: number | string }> | string | null;
};

type CajaMovimientoRow = {
  id: number;
  type?: string | null;
  amount?: number | string;
  date?: string;
};

type PaymentMethodRow = {
  id: number;
  name?: string;
  type?: string;
};

type PedidoRow = {
  id: number;
  customer_name?: string;
  repartidor?: string | null;
  status?: string | null;
  total?: number | string;
};

type DriverRow = {
  id: number;
  name?: string | null;
  vehicle?: string | null;
  status?: string | null;
};

type DriverLocationRow = {
  firebaseUid?: string;
  email?: string | null;
  repartidor?: string | null;
  lat?: number;
  lng?: number;
  updatedAt?: string;
};

type DriverSummary = {
  name: string;
  vehicle: string | null;
  pendingCount: number;
  deliveredCount: number;
  activeOrderCount: number;
  online: boolean;
  locationText: string | null;
};

type AdminDashboardState = {
  isLoading: boolean;
  error: string | null;
  salesTodayTotal: number;
  salesMonthTotal: number;
  salesTodayCount: number;
  cashInDrawerTotal: number;
  pendingDeliveries: number;
  deliveredOrders: number;
  drivers: DriverSummary[];
  reload: () => void;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase();

const isCashPayment = (methodName: string, paymentMethods: PaymentMethodRow[]) => {
  const cashMethodNames = new Set(
    paymentMethods
      .filter((method) => method.type === 'cash' || method.name === 'Efectivo')
      .map((method) => String(method.name || '').trim()),
  );
  cashMethodNames.add('Efectivo');
  return cashMethodNames.has(methodName);
};

export function useAdminDashboard(): AdminDashboardState {
  const [refreshTick, setRefreshTick] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salesTodayTotal, setSalesTodayTotal] = useState(0);
  const [salesMonthTotal, setSalesMonthTotal] = useState(0);
  const [salesTodayCount, setSalesTodayCount] = useState(0);
  const [cashInDrawerTotal, setCashInDrawerTotal] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [deliveredOrders, setDeliveredOrders] = useState(0);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setIsLoading(true);
      setError(null);

      try {
        const [ventas, cajaMovimientos, paymentMethods, pedidos, repartidores, locations] = await Promise.all([
          fetchTableRows<VentaRow>('ventas', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
          fetchTableRows<CajaMovimientoRow>('caja_movimientos', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
          fetchTableRows<PaymentMethodRow>('payment_methods', { limit: 100, orderBy: 'id', direction: 'ASC' }),
          fetchTableRows<PedidoRow>('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
          fetchTableRows<DriverRow>('repartidores', { limit: 200, orderBy: 'id', direction: 'ASC' }),
          fetchDriverLocations(),
        ]);

        if (cancelled) return;

        const now = new Date();
        const startDay = new Date(now);
        startDay.setHours(0, 0, 0, 0);
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

        const salesToday = ventas.filter((sale) => {
          const saleDate = sale.date ? new Date(sale.date) : null;
          return saleDate && !Number.isNaN(saleDate.getTime()) && saleDate >= startDay;
        });

        const salesMonth = ventas.filter((sale) => {
          const saleDate = sale.date ? new Date(sale.date) : null;
          return saleDate && !Number.isNaN(saleDate.getTime()) && saleDate >= startMonth;
        });

        const totalByMethod = salesToday.reduce<Record<string, number>>((acc, sale) => {
          if (Array.isArray(sale.payment_breakdown) && sale.payment_breakdown.length > 0) {
            sale.payment_breakdown.forEach((part) => {
              const methodName = String(part.method_name || 'Pago Mixto').trim();
              acc[methodName] = (acc[methodName] || 0) + toNumber(part.amount_charged);
            });
            return acc;
          }

          const methodName = String(sale.payment_method || 'Efectivo').trim();
          acc[methodName] = (acc[methodName] || 0) + toNumber(sale.total);
          return acc;
        }, {});

        const cashSales = Object.entries(totalByMethod).reduce((sum, [methodName, total]) => {
          return isCashPayment(methodName, paymentMethods) ? sum + total : sum;
        }, 0);

        const totalExpenses = cajaMovimientos
          .filter((movement) => movement.type === 'egreso')
          .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

        const totalIncomes = cajaMovimientos
          .filter((movement) => movement.type === 'ingreso')
          .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

        const locationMap = new Map<string, DriverLocationRow>();
        (locations as DriverLocationRow[]).forEach((location) => {
          const keys = [location.repartidor, location.email].map(normalizeName).filter(Boolean);
          keys.forEach((key) => locationMap.set(key, location));
        });

        const orderGroups = pedidos.reduce<Record<string, DriverSummary>>((acc, pedido) => {
          const rawName = String(pedido.repartidor || '').trim();
          if (!rawName) return acc;
          const key = normalizeName(rawName);
          if (!acc[key]) {
            const liveLocation = locationMap.get(key);
            acc[key] = {
              name: rawName,
              vehicle: null,
              pendingCount: 0,
              deliveredCount: 0,
              activeOrderCount: 0,
              online: Boolean(liveLocation),
              locationText:
                liveLocation && Number.isFinite(liveLocation.lat) && Number.isFinite(liveLocation.lng)
                  ? `${Number(liveLocation.lat).toFixed(4)}, ${Number(liveLocation.lng).toFixed(4)}`
                  : null,
            };
          }

          if (pedido.status === 'delivered') {
            acc[key].deliveredCount += 1;
          } else {
            acc[key].pendingCount += 1;
            acc[key].activeOrderCount += 1;
          }

          return acc;
        }, {});

        repartidores.forEach((driver) => {
          const rawName = String(driver.name || '').trim();
          if (!rawName) return;
          const key = normalizeName(rawName);
          if (!orderGroups[key]) {
            const liveLocation = locationMap.get(key);
            orderGroups[key] = {
              name: rawName,
              vehicle: driver.vehicle || null,
              pendingCount: 0,
              deliveredCount: 0,
              activeOrderCount: 0,
              online: Boolean(liveLocation),
              locationText:
                liveLocation && Number.isFinite(liveLocation.lat) && Number.isFinite(liveLocation.lng)
                  ? `${Number(liveLocation.lat).toFixed(4)}, ${Number(liveLocation.lng).toFixed(4)}`
                  : null,
            };
          } else if (!orderGroups[key].vehicle) {
            orderGroups[key].vehicle = driver.vehicle || null;
          }
        });

        const sortedDrivers = Object.values(orderGroups).sort((left, right) => {
          if (right.pendingCount !== left.pendingCount) {
            return right.pendingCount - left.pendingCount;
          }
          return left.name.localeCompare(right.name);
        });

        setSalesTodayTotal(salesToday.reduce((sum, sale) => sum + toNumber(sale.total), 0));
        setSalesMonthTotal(salesMonth.reduce((sum, sale) => sum + toNumber(sale.total), 0));
        setSalesTodayCount(salesToday.length);
        setCashInDrawerTotal(cashSales - totalExpenses + totalIncomes);
        setPendingDeliveries(pedidos.filter((pedido) => pedido.status && pedido.status !== 'delivered').length);
        setDeliveredOrders(pedidos.filter((pedido) => pedido.status === 'delivered').length);
        setDrivers(sortedDrivers);
      } catch (nextError) {
        if (cancelled) return;
        const message = nextError instanceof Error ? nextError.message : 'No se pudo cargar el panel admin.';
        setError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return useMemo(
    () => ({
      isLoading,
      error,
      salesTodayTotal,
      salesMonthTotal,
      salesTodayCount,
      cashInDrawerTotal,
      pendingDeliveries,
      deliveredOrders,
      drivers,
      reload: () => setRefreshTick((value) => value + 1),
    }),
    [
      cashInDrawerTotal,
      deliveredOrders,
      drivers,
      error,
      isLoading,
      pendingDeliveries,
      salesMonthTotal,
      salesTodayCount,
      salesTodayTotal,
    ],
  );
}
