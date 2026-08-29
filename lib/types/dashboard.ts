export interface DashboardAllocationSlice {
  key:
    | 'cash_banking'
    | 'stock_portfolio'
    | 'reward_points'
    | 'airline_miles';
  label: string;
  usd: number;
  percentage: number;
  color: string;
}

export interface DashboardDebtSummary {
  label: 'Credit Card Debt';
  usd: number;
  grossDebtUsd: number;
  overpaymentUsd: number;
  accounts: Array<{
    account_id: string;
    name: string;
    usd: number;
  }>;
}

export interface DashboardBreakdownAccount {
  account_id: string;
  name: string;
  type: string;
  usd: number;
}

export interface DashboardBreakdown {
  cash_banking: number;
  credit_card_debt: number;
  credit_card_overpayment: number;
  stock_portfolio: number;
  reward_points: number;
  airline_miles: number;
  accounts: DashboardBreakdownAccount[];
}

export interface DashboardValuationInputs {
  fx_rates: Record<string, number>;
  reward_rates: Record<string, number>;
  mileage_rates: Record<string, number>;
}

export interface DashboardNetWorthPoint {
  date: string;
  netWorthUsd: number;
}

export interface DashboardMonthlyExpensePoint {
  month: string;
  [category: string]: number | string;
}

export interface DashboardTotals {
  assetsUsd: number;
  liabilitiesUsd: number;
  netWorthUsd: number;
}

export interface DashboardAnalytics {
  allocation: DashboardAllocationSlice[];
  debtSummary: DashboardDebtSummary | null;
  totals: DashboardTotals;
  netWorthHistory: DashboardNetWorthPoint[];
  monthlyExpenses: DashboardMonthlyExpensePoint[];
  expenseCategories: string[];
  asOf: string;
}

export interface NetWorthSnapshotRow {
  snapshot_date: string;
  net_worth_usd: number;
}
