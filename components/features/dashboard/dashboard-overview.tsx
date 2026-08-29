'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AccountType } from '@/lib/types/accounts';
import type { DashboardAnalytics } from '@/lib/types/dashboard';
import {
  formatAccountBalance,
  formatCurrencyAmount,
  getLiabilityBalanceToneClass,
  toSignedLiabilityDisplayValue,
} from '@/lib/utils/account-balance-display';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface DashboardOverviewProps {
  analytics: DashboardAnalytics;
}

const CATEGORY_COLORS = [
  '#B46A4D',
  '#3B7A57',
  '#2F6FED',
  '#D6A44D',
  '#7C5C9C',
  '#D96868',
  '#5E8C9A',
  '#A57B5B',
];

function formatUsd(value: number) {
  return formatCurrencyAmount(value, 'USD', { maximumFractionDigits: 0 });
}

function formatLiabilityUsd(value: number) {
  return formatAccountBalance(value, 'USD', AccountType.LIABILITY, {
    maximumFractionDigits: 0,
  });
}

function formatTooltipUsd(
  value: number | string | readonly (string | number)[] | undefined,
) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
  return formatUsd(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatMonth(value: string) {
  const [year, month] = value.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: '2-digit',
  }).format(date);
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/25 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function DashboardOverview({ analytics }: DashboardOverviewProps) {
  const {
    allocation,
    debtSummary,
    totals,
    netWorthHistory,
    monthlyExpenses,
    expenseCategories,
  } = analytics;
  const liabilityTotalDisplayValue = toSignedLiabilityDisplayValue(totals.liabilitiesUsd);
  const debtSummaryDisplayValue = toSignedLiabilityDisplayValue(debtSummary?.usd ?? 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70 bg-background/80 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
          <CardHeader>
            <CardDescription>Net Worth</CardDescription>
            <CardTitle className="text-3xl tracking-tight [font-family:var(--font-display)]">
              {formatUsd(totals.netWorthUsd)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/70 bg-background/80 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
          <CardHeader>
            <CardDescription>Assets</CardDescription>
            <CardTitle className="text-3xl tracking-tight [font-family:var(--font-display)]">
              {formatUsd(totals.assetsUsd)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/70 bg-background/80 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
          <CardHeader>
            <CardDescription>Liabilities</CardDescription>
            <CardTitle
              className={`text-3xl tracking-tight [font-family:var(--font-display)] ${getLiabilityBalanceToneClass(
                liabilityTotalDisplayValue,
              )}`}
            >
              {formatLiabilityUsd(liabilityTotalDisplayValue)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/70 bg-background/85 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
          <CardHeader>
            <CardTitle>Asset Allocation</CardTitle>
            <CardDescription>Current USD valuation across positive asset groups.</CardDescription>
          </CardHeader>
          <CardContent>
            {allocation.length === 0 ? (
              <EmptyState label="No asset balances yet." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocation}
                        dataKey="usd"
                        nameKey="label"
                        innerRadius={72}
                        outerRadius={112}
                        paddingAngle={2}
                      >
                        {allocation.map((slice) => (
                          <Cell key={slice.key} fill={slice.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatTooltipUsd(value)}
                        contentStyle={{
                          borderRadius: 16,
                          borderColor: 'rgba(91, 76, 60, 0.18)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {allocation.map((slice) => (
                    <div
                      key={slice.key}
                      className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className="inline-block size-2.5 rounded-full"
                          style={{ backgroundColor: slice.color }}
                        />
                        {slice.label}
                      </div>
                      <p className="mt-2 text-lg font-medium tabular-nums">
                        {formatUsd(slice.usd)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {slice.percentage.toFixed(1)}% of assets
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/85 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
          <CardHeader>
            <CardTitle>Credit Card Debt</CardTitle>
            <CardDescription>Liabilities are tracked separately from the asset mix.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-[380px] flex-col rounded-2xl border border-border/70 bg-muted/25 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Net liability
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold tabular-nums [font-family:var(--font-display)] ${
                      getLiabilityBalanceToneClass(debtSummaryDisplayValue) || 'text-muted-foreground'
                    }`}
                  >
                    {formatLiabilityUsd(debtSummaryDisplayValue)}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Gross / Overpay
                  </p>
                  <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {formatUsd(debtSummary?.grossDebtUsd ?? 0)} / {formatUsd(debtSummary?.overpaymentUsd ?? 0)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between px-1 text-xs font-medium tracking-wide text-muted-foreground">
                <span>Account</span>
                <span>Balance</span>
              </div>

              <div className="mt-2 flex-1 space-y-2 overflow-auto pr-1">
                {debtSummary?.accounts.length ? (
                  debtSummary.accounts.map((account) => (
                    <div
                      key={account.account_id}
                      className="flex items-center justify-between rounded-xl border border-border/70 bg-background/80 px-3 py-2"
                    >
                      <p className="truncate pr-3 text-sm text-foreground">
                        {account.name}
                      </p>
                      <p
                        className={`shrink-0 text-sm font-medium tabular-nums ${
                          getLiabilityBalanceToneClass(account.usd) || 'text-muted-foreground'
                        }`}
                      >
                        {formatLiabilityUsd(account.usd)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/50 text-sm text-muted-foreground">
                    No credit card accounts yet.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-background/85 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
        <CardHeader>
          <CardTitle>Net Worth History</CardTitle>
          <CardDescription>Daily snapshots stored from the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          {netWorthHistory.length === 0 ? (
            <EmptyState label="No history yet." />
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={netWorthHistory}>
                  <CartesianGrid stroke="rgba(120, 105, 90, 0.16)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatMonth}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    tickFormatter={(value: number) => formatUsd(value)}
                    tickLine={false}
                    axisLine={false}
                    width={88}
                  />
                  <Tooltip
                    labelFormatter={(value) => formatMonth(String(value))}
                    formatter={(value) => formatTooltipUsd(value)}
                    contentStyle={{
                      borderRadius: 16,
                      borderColor: 'rgba(91, 76, 60, 0.18)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="netWorthUsd"
                    stroke="#3B7A57"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5, fill: '#3B7A57' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-background/85 shadow-[0_20px_60px_rgba(69,41,19,0.08)]">
        <CardHeader>
          <CardTitle>Monthly Expenses</CardTitle>
          <CardDescription>Expense totals grouped by category and converted to USD.</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlyExpenses.length === 0 ? (
            <EmptyState label="No expense transactions yet." />
          ) : (
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyExpenses}>
                  <CartesianGrid stroke="rgba(120, 105, 90, 0.16)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonth}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(value: number) => formatUsd(value)}
                    tickLine={false}
                    axisLine={false}
                    width={88}
                  />
                  <Tooltip
                    labelFormatter={(value) => formatMonth(String(value))}
                    formatter={(value) => formatTooltipUsd(value)}
                    contentStyle={{
                      borderRadius: 16,
                      borderColor: 'rgba(91, 76, 60, 0.18)',
                    }}
                  />
                  <Legend />
                  {expenseCategories.map((category, index) => (
                    <Bar
                      key={category}
                      dataKey={category}
                      stackId="expenses"
                      fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                      radius={index === expenseCategories.length - 1 ? [6, 6, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
