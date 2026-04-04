export type Branch = {
  code: string;
  name: string;
  address?: string;
  locality?: string;
  responsible?: string;
  phone?: string;
  type?: string;
};

export type UserProfile = {
  id: string | number;
  uid?: string | null;
  email: string;
  username: string;
  role: 'admin' | 'employee';
  active: number;
  clientId?: number;
  clientStatus?: string;
  perms: string[];
};

export type DashboardSummary = {
  salesToday: number;
  salesMonth: number;
  salesCountToday: number;
  cashInDrawer: number;
  manualIncomes: number;
  manualExpenses: number;
  branchesCount: number;
};

export type BranchFinanceCard = {
  code: string;
  name: string;
  locality: string;
  manager: string;
  phone: string;
  status: 'connected' | 'pending_backend';
  cashBalance?: number | null;
  salesToday?: number | null;
  lastSync?: string | null;
};

export type SalesReport = {
  title: string;
  value: number;
  variation: string;
};
