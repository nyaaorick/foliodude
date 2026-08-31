'use client';

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
import { DonutChart, LineChart, StackedBarChart } from './charts';

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

function formatMonth(value: string) {
  const [year, month] = value.split('-');
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' })
    .format(new Date(Number(year), Number(month) - 1, 1));
}

function formatDay(value: string) {
  const [year, month, day] = value.split('-');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
    .format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/25 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function StatCard({ label, value, toneClass }: { label: string; value: string; toneClass?: string }) {
  return (
    <Card className="border-border/70 bg-background/80">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`text-2xl tabular-nums tracking-tight [font-family:var(--font-display)] ${toneClass ?? ''}`}
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
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
  const liabilityTotal = toSignedLiabilityDisplayValue(totals.liabilitiesUsd);
  const debtTotal = toSignedLiabilityDisplayValue(debtSummary?.usd ?? 0);
  const allocationTotal = allocation.reduce((sum, slice) => sum + slice.usd, 0);

  return (
    <div className="space-y-4">
      {/* Two columns even at 350px: three stacked cards would push the charts
          below the fold in the sidebar. Net worth spans the row. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1">
          <StatCard label="Net Worth" value={formatUsd(totals.netWorthUsd)} />
        </div>
        <StatCard label="Assets" value={formatUsd(totals.assetsUsd)} />
        <StatCard
          label="Liabilities"
          value={formatLiabilityUsd(liabilityTotal)}
          toneClass={getLiabilityBalanceToneClass(liabilityTotal)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/70 bg-background/85">
          <CardHeader>
            <CardTitle>Asset Allocation</CardTitle>
            <CardDescription>Current USD valuation across positive asset groups.</CardDescription>
          </CardHeader>
          <CardContent>
            {allocation.length === 0 ? (
              <EmptyState label="No asset balances yet." />
            ) : (
              <div className="space-y-3">
                <DonutChart slices={allocation} height={168} />
                <ul className="space-y-1.5">
                  {allocation.map((slice) => (
                    <li
                      key={slice.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: slice.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                      <span className="shrink-0 tabular-nums">{formatUsd(slice.usd)}</span>
                      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {allocationTotal > 0 ? `${slice.percentage.toFixed(0)}%` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/85">
          <CardHeader>
            <CardTitle>Credit Card Debt</CardTitle>
            <CardDescription>Liabilities are tracked separately from the asset mix.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Net liability
                </p>
                <p
                  className={`mt-1 text-xl font-semibold tabular-nums [font-family:var(--font-display)] ${
                    getLiabilityBalanceToneClass(debtTotal) || 'text-muted-foreground'
                  }`}
                >
                  {formatLiabilityUsd(debtTotal)}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Gross / Overpay
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {formatUsd(debtSummary?.grossDebtUsd ?? 0)} /{' '}
                  {formatUsd(debtSummary?.overpaymentUsd ?? 0)}
                </p>
              </div>
            </div>

            {debtSummary?.accounts.length ? (
              <ul className="space-y-1.5">
                {debtSummary.accounts.map((account) => (
                  <li key={account.account_id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{account.name}</span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        getLiabilityBalanceToneClass(account.usd) || 'text-muted-foreground'
                      }`}
                    >
                      {formatLiabilityUsd(account.usd)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState label="No credit card accounts yet." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-background/85">
        <CardHeader>
          <CardTitle>Net Worth History</CardTitle>
          <CardDescription>Daily snapshots stored from the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          {netWorthHistory.length === 0 ? (
            <EmptyState label="No history yet." />
          ) : (
            <LineChart
              height={168}
              points={netWorthHistory.map((point) => ({
                label: point.date,
                value: point.netWorthUsd,
              }))}
              formatValue={formatUsd}
              formatLabel={formatDay}
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-background/85">
        <CardHeader>
          <CardTitle>Monthly Expenses</CardTitle>
          <CardDescription>Expense totals grouped by category and converted to USD.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {monthlyExpenses.length === 0 ? (
            <EmptyState label="No expense transactions yet." />
          ) : (
            <>
              <StackedBarChart
                height={168}
                points={monthlyExpenses.map((point) => ({
                  label: String(point.month),
                  values: Object.fromEntries(
                    expenseCategories.map((category) => [
                      category,
                      typeof point[category] === 'number' ? (point[category] as number) : 0,
                    ]),
                  ),
                }))}
                categories={expenseCategories}
                colors={CATEGORY_COLORS}
                formatValue={formatUsd}
                formatLabel={formatMonth}
              />
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                {expenseCategories.map((category, index) => (
                  <li key={category} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
                    />
                    {category}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
