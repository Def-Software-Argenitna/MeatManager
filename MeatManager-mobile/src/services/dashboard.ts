import { env } from '../config/env';
import { mockBranches, mockReports, mockSummary } from '../data/mocks';
import type { Branch, BranchFinanceCard, DashboardSummary, SalesReport } from '../data/types';
import { fetchSetting, fetchTable } from './api';

type Venta = {
  date: string;
  total: number;
};

type CajaMovimiento = {
  amount: number;
  type: 'ingreso' | 'egreso';
  date: string;
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const isAfter = (value: string, date: Date) => new Date(value).getTime() >= date.getTime();

const parseRegisteredBranches = (raw: string | null): Branch[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((branch, index) => ({
      code: String(branch.code || index + 1).replace(/\D/g, '').padStart(4, '0'),
      name: String(branch.name || `Sucursal ${index + 1}`),
      locality: String(branch.locality || ''),
      address: String(branch.address || ''),
      responsible: String(branch.responsible || ''),
      phone: String(branch.phone || ''),
      type: String(branch.type || 'sucursal')
    }));
  } catch {
    return [];
  }
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  if (env.useMocks) return mockSummary;

  const [ventas, movimientos, branchSetting] = await Promise.all([
    fetchTable<Venta>('ventas', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
    fetchTable<CajaMovimiento>('caja_movimientos', { limit: 1000, orderBy: 'date', direction: 'DESC' }),
    fetchSetting('registered_branches')
  ]);

  const today = startOfToday();
  const month = startOfMonth();
  const ventasHoy = ventas.filter((venta) => isAfter(venta.date, today));
  const ventasMes = ventas.filter((venta) => isAfter(venta.date, month));
  const movimientosHoy = movimientos.filter((mov) => isAfter(mov.date, today));
  const manualIncomes = movimientosHoy
    .filter((mov) => mov.type === 'ingreso')
    .reduce((sum, mov) => sum + Number(mov.amount || 0), 0);
  const manualExpenses = movimientosHoy
    .filter((mov) => mov.type === 'egreso')
    .reduce((sum, mov) => sum + Number(mov.amount || 0), 0);

  return {
    salesToday: ventasHoy.reduce((sum, venta) => sum + Number(venta.total || 0), 0),
    salesMonth: ventasMes.reduce((sum, venta) => sum + Number(venta.total || 0), 0),
    salesCountToday: ventasHoy.length,
    cashInDrawer: manualIncomes - manualExpenses,
    manualIncomes,
    manualExpenses,
    branchesCount: parseRegisteredBranches(branchSetting.value).length
  };
}

export async function getBranchFinanceCards(): Promise<BranchFinanceCard[]> {
  if (env.useMocks) return mockBranches;

  const branchesSetting = await fetchSetting('registered_branches');
  const branches = parseRegisteredBranches(branchesSetting.value);

  return branches.map((branch) => ({
    code: branch.code,
    name: branch.name,
    locality: branch.locality || 'Sin localidad',
    manager: branch.responsible || 'Sin responsable',
    phone: branch.phone || 'Sin teléfono',
    status: 'pending_backend',
    cashBalance: null,
    salesToday: null,
    lastSync: null
  }));
}

export async function getSalesReports(): Promise<SalesReport[]> {
  if (env.useMocks) return mockReports;

  const [ventas, movimientos] = await Promise.all([
    fetchTable<Venta>('ventas', { limit: 3000, orderBy: 'date', direction: 'DESC' }),
    fetchTable<CajaMovimiento>('caja_movimientos', { limit: 3000, orderBy: 'date', direction: 'DESC' })
  ]);

  const now = Date.now();
  const daysWindow = (days: number) => now - days * 24 * 60 * 60 * 1000;
  const sales7 = ventas.filter((venta) => new Date(venta.date).getTime() >= daysWindow(7));
  const sales30 = ventas.filter((venta) => new Date(venta.date).getTime() >= daysWindow(30));
  const expenses30 = movimientos.filter(
    (mov) => mov.type === 'egreso' && new Date(mov.date).getTime() >= daysWindow(30)
  );

  return [
    {
      title: 'Ventas últimos 7 días',
      value: sales7.reduce((sum, venta) => sum + Number(venta.total || 0), 0),
      variation: 'Basado en datos reales del tenant'
    },
    {
      title: 'Ventas últimos 30 días',
      value: sales30.reduce((sum, venta) => sum + Number(venta.total || 0), 0),
      variation: 'Basado en datos reales del tenant'
    },
    {
      title: 'Egresos manuales últimos 30 días',
      value: expenses30.reduce((sum, mov) => sum + Number(mov.amount || 0), 0),
      variation: 'Basado en caja_movimientos'
    }
  ];
}
