import type { BranchFinanceCard, DashboardSummary, SalesReport } from './types';

export const mockSummary: DashboardSummary = {
  salesToday: 482500,
  salesMonth: 12640000,
  salesCountToday: 97,
  cashInDrawer: 215300,
  manualIncomes: 45000,
  manualExpenses: 32800,
  branchesCount: 4
};

export const mockBranches: BranchFinanceCard[] = [
  {
    code: '0001',
    name: 'Casa Central',
    locality: 'Pilar',
    manager: 'Martina Vega',
    phone: '+54 9 11 5555 1201',
    status: 'connected',
    cashBalance: 154200,
    salesToday: 192300,
    lastSync: new Date().toISOString()
  },
  {
    code: '0002',
    name: 'Sucursal Del Viso',
    locality: 'Del Viso',
    manager: 'Diego Flores',
    phone: '+54 9 11 5555 1202',
    status: 'connected',
    cashBalance: 61000,
    salesToday: 128700,
    lastSync: new Date(Date.now() - 1000 * 60 * 18).toISOString()
  },
  {
    code: '0003',
    name: 'Sucursal Tortuguitas',
    locality: 'Tortuguitas',
    manager: 'Carla Ríos',
    phone: '+54 9 11 5555 1203',
    status: 'pending_backend',
    cashBalance: null,
    salesToday: null,
    lastSync: null
  }
];

export const mockReports: SalesReport[] = [
  { title: 'Ventas últimos 7 días', value: 3182400, variation: '+12.4%' },
  { title: 'Ventas últimos 30 días', value: 12640000, variation: '+7.1%' },
  { title: 'Egresos manuales', value: 418900, variation: '-2.3%' }
];
