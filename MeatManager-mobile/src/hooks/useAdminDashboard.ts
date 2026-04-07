import { useEffect, useMemo, useState } from 'react';

import {
  fetchClientBranches,
  fetchDriverLocations,
  fetchLogisticsDrivers,
  fetchTableRows,
} from '../services/mobileApi';

const ADMIN_DASHBOARD_REFRESH_INTERVAL_MS = 10000;

type VentaRow = {
  id: number;
  date?: string;
  total?: number | string;
  branch_id?: number | null;
  receipt_code?: string | null;
  payment_method?: string | null;
  payment_breakdown?: Array<{ method_name?: string; amount_charged?: number | string }> | string | null;
};

type CajaMovimientoRow = {
  id: number;
  type?: string | null;
  amount?: number | string;
  date?: string;
  branch_id?: number | null;
  receipt_code?: string | null;
};

type PaymentMethodRow = {
  id: number;
  name?: string;
  type?: string;
};

type CashClosureRow = {
  id: number;
  closure_date?: string | null;
  branch_id?: number | null;
  closed_at?: string | null;
  theoretical_cash?: number | string | null;
  counted_cash?: number | string | null;
  difference?: number | string | null;
  total_sales?: number | string | null;
  total_incomes?: number | string | null;
  total_expenses?: number | string | null;
  notes?: string | null;
};

type PedidoRow = {
  id: number;
  branch_id?: number | null;
  customer_name?: string;
  address?: string | null;
  repartidor?: string | null;
  assigned_driver_uid?: string | null;
  assigned_driver_email?: string | null;
  status?: string | null;
  total?: number | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

type DriverOrderSummary = {
  id: number;
  customerName: string;
  status: string;
  total: number;
};

type BranchOption = {
  code: string;
  name: string;
};

type DriverRow = {
  id: number;
  branchId?: number | null;
  firebaseUid?: string | null;
  email?: string | null;
  name?: string | null;
  vehicle?: string | null;
  status?: string | null;
};

type ClientBranchRow = {
  id: number;
  name?: string | null;
  internalCode?: string | null;
  address?: string | null;
};

type DriverLocationRow = {
  firebaseUid?: string;
  email?: string | null;
  repartidor?: string | null;
  lat?: number;
  lng?: number;
  lastSeenAt?: string;
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
  latitude: number | null;
  longitude: number | null;
  lastSyncText: string | null;
  pendingOrders: DriverOrderSummary[];
  deliveredOrders: DriverOrderSummary[];
};

export type DriverMapMarker = {
  id: string;
  name: string;
  vehicle: string | null;
  latitude: number;
  longitude: number;
  online: boolean;
  activeOrderCount: number;
  lastSyncText: string | null;
};

export type OrderMapMarker = {
  id: string;
  orderId: number;
  customerName: string;
  address: string | null;
  status: string;
  total: number;
  latitude: number;
  longitude: number;
  driverName: string | null;
};

type CashClosureSummary = {
  id: number;
  branchName: string;
  closureDate: string;
  closedAtText: string | null;
  theoreticalCash: number;
  countedCash: number;
  difference: number;
  totalSales: number;
  notes: string | null;
};

type AdminDashboardState = {
  isLoading: boolean;
  error: string | null;
  selectedBranchCode: string;
  selectedBranchName: string;
  branchOptions: BranchOption[];
  setSelectedBranchCode: (value: string) => void;
  salesTodayTotal: number;
  salesMonthTotal: number;
  salesTodayCount: number;
  cashInDrawerTotal: number;
  pendingDeliveries: number;
  deliveredOrders: number;
  drivers: DriverSummary[];
  driverMapMarkers: DriverMapMarker[];
  orderMapMarkers: OrderMapMarker[];
  cashClosures: CashClosureSummary[];
  reload: () => void;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeBranchCode = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const extractBranchCodeFromReceipt = (value: unknown) => {
  const match = String(value || '').trim().match(/^(\d{4})-/);
  return match ? normalizeBranchCode(match[1]) : null;
};
const formatLastSync = (value: unknown) => {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  return `Ultima sync: ${date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};
const formatClosureDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

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
  const [selectedBranchCode, setSelectedBranchCode] = useState('all');
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [salesTodayTotal, setSalesTodayTotal] = useState(0);
  const [salesMonthTotal, setSalesMonthTotal] = useState(0);
  const [salesTodayCount, setSalesTodayCount] = useState(0);
  const [cashInDrawerTotal, setCashInDrawerTotal] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [deliveredOrders, setDeliveredOrders] = useState(0);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [driverMapMarkers, setDriverMapMarkers] = useState<DriverMapMarker[]>([]);
  const [orderMapMarkers, setOrderMapMarkers] = useState<OrderMapMarker[]>([]);
  const [cashClosures, setCashClosures] = useState<CashClosureSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setIsLoading(true);
      setError(null);

      try {
        const [ventas, cajaMovimientos, paymentMethods, pedidos, repartidores, locations, branches, closures] = await Promise.all([
          fetchTableRows<VentaRow>('ventas', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
          fetchTableRows<CajaMovimientoRow>('caja_movimientos', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
          fetchTableRows<PaymentMethodRow>('payment_methods', { limit: 100, orderBy: 'id', direction: 'ASC' }),
          fetchTableRows<PedidoRow>('pedidos', { limit: 1000, orderBy: 'created_at', direction: 'DESC' }),
          fetchLogisticsDrivers(),
          fetchDriverLocations(),
          fetchClientBranches(),
          fetchTableRows<CashClosureRow>('cash_closures', { limit: 30, orderBy: 'closed_at', direction: 'DESC' }).catch(() => []),
        ]);

        if (cancelled) return;

        const nextBranchOptions: BranchOption[] = [{ code: 'all', name: 'Todas las sucursales' }];
        const seenCodes = new Set<string>(['all']);
        branches.forEach((branch: ClientBranchRow) => {
          const code = String(branch.id);
          const name = String(branch.name || `Sucursal ${branch.id}`).trim();
          if (!seenCodes.has(code)) {
            seenCodes.add(code);
            nextBranchOptions.push({ code, name });
          }
        });

        setBranchOptions(nextBranchOptions);

        const selectedCode = selectedBranchCode === 'all'
          ? 'all'
          : (nextBranchOptions.some((branch) => branch.code === selectedBranchCode) ? selectedBranchCode : 'all');

        if (selectedCode !== selectedBranchCode) {
          setSelectedBranchCode(selectedCode);
        }
        const selectedBranchId = selectedCode === 'all' ? null : Number(selectedCode);
        const matchesSelectedBranch = (branchId: unknown, receiptCode?: unknown) => {
          if (selectedBranchId == null) return true;
          const directBranchId = Number(branchId);
          if (Number.isFinite(directBranchId) && directBranchId > 0) {
            return directBranchId === selectedBranchId;
          }
          return extractBranchCodeFromReceipt(receiptCode) === selectedBranchId;
        };
        const filteredVentas = ventas.filter((sale) => matchesSelectedBranch(sale.branch_id, sale.receipt_code));
        const filteredCajaMovimientos = cajaMovimientos.filter((movement) => matchesSelectedBranch(movement.branch_id, movement.receipt_code));
        const filteredDrivers = repartidores.filter((driver) => (
          selectedCode === 'all' || String(driver.branchId || '') === selectedCode
        ));
        const filteredClosures = closures.filter((closure) => matchesSelectedBranch(closure.branch_id));
        const branchDriverNames = new Set(filteredDrivers.map((driver) => normalizeName(driver.name)).filter(Boolean));
        const branchDriverEmails = new Set(filteredDrivers.map((driver) => normalizeName(driver.email)).filter(Boolean));
        const branchDriverUids = new Set(filteredDrivers.map((driver) => String(driver.firebaseUid || '').trim()).filter(Boolean));
        const filteredPedidos = pedidos.filter((pedido) => (
          matchesSelectedBranch(pedido.branch_id)
          || branchDriverNames.has(normalizeName(pedido.repartidor))
          || branchDriverEmails.has(normalizeName(pedido.assigned_driver_email))
          || branchDriverUids.has(String(pedido.assigned_driver_uid || '').trim())
        ));

        const now = new Date();
        const startDay = new Date(now);
        startDay.setHours(0, 0, 0, 0);
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

        const salesToday = filteredVentas.filter((sale) => {
          const saleDate = sale.date ? new Date(sale.date) : null;
          return saleDate && !Number.isNaN(saleDate.getTime()) && saleDate >= startDay;
        });

        const salesMonth = filteredVentas.filter((sale) => {
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

        const totalExpenses = filteredCajaMovimientos
          .filter((movement) => movement.type === 'egreso')
          .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

        const totalIncomes = filteredCajaMovimientos
          .filter((movement) => movement.type === 'ingreso')
          .reduce((sum, movement) => sum + toNumber(movement.amount), 0);

        const locationMap = new Map<string, DriverLocationRow>();
        (locations as DriverLocationRow[]).forEach((location) => {
          const keys = [
            location.repartidor,
            location.email,
            location.firebaseUid,
          ]
            .map((value) => String(value || '').trim())
            .map(normalizeName)
            .filter(Boolean);
          keys.forEach((key) => locationMap.set(key, location));
        });

        const orderGroups = filteredPedidos.reduce<Record<string, DriverSummary>>((acc, pedido) => {
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
              latitude: Number.isFinite(liveLocation?.lat) ? Number(liveLocation?.lat) : null,
              longitude: Number.isFinite(liveLocation?.lng) ? Number(liveLocation?.lng) : null,
              locationText:
                liveLocation && Number.isFinite(liveLocation.lat) && Number.isFinite(liveLocation.lng)
                  ? `${Number(liveLocation.lat).toFixed(4)}, ${Number(liveLocation.lng).toFixed(4)}`
                  : null,
              lastSyncText: formatLastSync(liveLocation?.lastSeenAt || liveLocation?.updatedAt),
              pendingOrders: [],
              deliveredOrders: [],
            };
          }

          const orderSummary = {
            id: pedido.id,
            customerName: String(pedido.customer_name || `Pedido #${pedido.id}`).trim(),
            status: String(pedido.status || 'pending').trim(),
            total: toNumber(pedido.total),
          };

          if (pedido.status === 'delivered') {
            acc[key].deliveredCount += 1;
            acc[key].deliveredOrders.push(orderSummary);
          } else {
            acc[key].pendingCount += 1;
            acc[key].activeOrderCount += 1;
            acc[key].pendingOrders.push(orderSummary);
          }

          return acc;
        }, {});

        filteredDrivers.forEach((driver) => {
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
              latitude: Number.isFinite(liveLocation?.lat) ? Number(liveLocation?.lat) : null,
              longitude: Number.isFinite(liveLocation?.lng) ? Number(liveLocation?.lng) : null,
              locationText:
                liveLocation && Number.isFinite(liveLocation.lat) && Number.isFinite(liveLocation.lng)
                  ? `${Number(liveLocation.lat).toFixed(4)}, ${Number(liveLocation.lng).toFixed(4)}`
                  : null,
              lastSyncText: formatLastSync(liveLocation?.lastSeenAt || liveLocation?.updatedAt),
              pendingOrders: [],
              deliveredOrders: [],
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
        const nextDriverMapMarkers: DriverMapMarker[] = sortedDrivers
          .filter((driver) => Number.isFinite(driver.latitude) && Number.isFinite(driver.longitude))
          .map((driver) => ({
            id: normalizeName(driver.name),
            name: driver.name,
            vehicle: driver.vehicle,
            latitude: Number(driver.latitude),
            longitude: Number(driver.longitude),
            online: driver.online,
            activeOrderCount: driver.activeOrderCount,
            lastSyncText: driver.lastSyncText,
          }));
        const nextOrderMapMarkers: OrderMapMarker[] = filteredPedidos
          .filter((pedido) => Number.isFinite(Number(pedido.latitude)) && Number.isFinite(Number(pedido.longitude)))
          .map((pedido) => ({
            id: `order-${pedido.id}`,
            orderId: pedido.id,
            customerName: String(pedido.customer_name || `Pedido #${pedido.id}`).trim(),
            address: String(pedido.address || '').trim() || null,
            status: String(pedido.status || 'pending').trim(),
            total: toNumber(pedido.total),
            latitude: Number(pedido.latitude),
            longitude: Number(pedido.longitude),
            driverName: String(pedido.repartidor || '').trim() || null,
          }));
        const branchNameById = new Map(nextBranchOptions.map((branch) => [branch.code, branch.name]));
        const activeBranchName =
          nextBranchOptions.find((branch) => branch.code === selectedCode)?.name || 'Sucursal general';
        const latestClosures = filteredClosures
          .map((closure) => {
            const closureBranchName =
              branchNameById.get(String(closure.branch_id || ''))
              || (selectedCode === 'all' ? 'Sucursal general' : activeBranchName);

            return {
              id: closure.id,
              branchName: closureBranchName,
              closureDate: formatClosureDate(closure.closure_date || closure.closed_at),
              closedAtText: formatLastSync(closure.closed_at)?.replace('Ultima sync: ', 'Cerrado: ') || null,
              theoreticalCash: toNumber(closure.theoretical_cash),
              countedCash: toNumber(closure.counted_cash),
              difference: toNumber(closure.difference),
              totalSales: toNumber(closure.total_sales),
              notes: String(closure.notes || '').trim() || null,
            };
          })
          .slice(0, 8);

        setSalesTodayTotal(salesToday.reduce((sum, sale) => sum + toNumber(sale.total), 0));
        setSalesMonthTotal(salesMonth.reduce((sum, sale) => sum + toNumber(sale.total), 0));
        setSalesTodayCount(salesToday.length);
        setCashInDrawerTotal(cashSales - totalExpenses + totalIncomes);
        setPendingDeliveries(filteredPedidos.filter((pedido) => pedido.status && pedido.status !== 'delivered').length);
        setDeliveredOrders(filteredPedidos.filter((pedido) => pedido.status === 'delivered').length);
        setDrivers(sortedDrivers);
        setDriverMapMarkers(nextDriverMapMarkers);
        setOrderMapMarkers(nextOrderMapMarkers);
        setCashClosures(latestClosures);
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
    const interval = setInterval(loadDashboard, ADMIN_DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshTick, selectedBranchCode]);

  return useMemo(
    () => ({
      isLoading,
      error,
      selectedBranchCode,
      selectedBranchName: branchOptions.find((branch) => branch.code === selectedBranchCode)?.name || 'Todas las sucursales',
      branchOptions,
      setSelectedBranchCode,
      salesTodayTotal,
      salesMonthTotal,
      salesTodayCount,
      cashInDrawerTotal,
      pendingDeliveries,
      deliveredOrders,
      drivers,
      driverMapMarkers,
      orderMapMarkers,
      cashClosures,
      reload: () => setRefreshTick((value) => value + 1),
    }),
    [
      cashInDrawerTotal,
      branchOptions,
      deliveredOrders,
      drivers,
      driverMapMarkers,
      orderMapMarkers,
      cashClosures,
      error,
      isLoading,
      pendingDeliveries,
      selectedBranchCode,
      salesMonthTotal,
      salesTodayCount,
      salesTodayTotal,
    ],
  );
}
