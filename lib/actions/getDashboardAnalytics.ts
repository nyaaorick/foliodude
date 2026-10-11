import { getSessionContext } from '@/lib/db/session';
import { getApiKey } from '@/lib/db/settings';
import { rows } from '@/lib/db/sql';
import { AccountType, type Account } from '@/lib/types/accounts';
import type { DashboardAnalytics } from '@/lib/types/dashboard';
import type { RewardRateMap } from '@/lib/types/rewards';
import type { AccountRow, RewardRateRow } from '@/lib/types/database';
import {
  buildAllocationSlices,
  buildDashboardBreakdown,
  buildRewardRateMap,
  getAccountUsdValue,
  buildMonthlyExpenseSeries,
  mapAccountRowToAccount,
  type ExpenseRow,
} from '@/lib/utils/financial-analytics';
import { fetchUsdExchangeRates } from '@/lib/utils/fx-rates';
import { localToday } from '@/lib/utils/local-date';
import { toActionResult, type ActionResult } from './result';

async function ensureTodaySnapshot(
  db: Awaited<ReturnType<typeof getSessionContext>>['db'],
  accounts: Account[],
  rewardRates: RewardRateMap,
  apiKey: string | null,
): Promise<void> {
  const today = localToday();
  const existing = await db.query('SELECT 1 FROM net_worth_snapshots WHERE snapshot_date = $1', [today]);
  if (existing.rows.length > 0) return;

  const accountCurrencies = accounts
    .filter((a) => a.type === AccountType.ASSET || a.type === AccountType.LIABILITY)
    .map((a) => a.currency);
  const fxRates = await fetchUsdExchangeRates(accountCurrencies, apiKey);
  const snapshot = buildDashboardBreakdown(accounts, rewardRates, fxRates);

  await db.query(
    `INSERT INTO net_worth_snapshots
       (snapshot_date, net_worth_usd, assets_usd, liabilities_usd, breakdown, valuation_inputs)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (snapshot_date) DO NOTHING`,
    [
      today,
      snapshot.netWorthUsd,
      snapshot.assetsUsd,
      snapshot.liabilitiesUsd,
      JSON.stringify(snapshot.breakdown),
      JSON.stringify(snapshot.valuationInputs),
    ],
  );
}

export function getDashboardAnalytics(): Promise<ActionResult<DashboardAnalytics>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();

    const [accountRows, rewardRateRows] = await Promise.all([
      rows<AccountRow>(db, 'SELECT * FROM accounts_flat'),
      rows<RewardRateRow>(
        db,
        'SELECT reward_currency, usd_per_10k_points, updated_at FROM reward_rates',
      ),
    ]);
    const accounts = accountRows.map(mapAccountRowToAccount);
    const rewardRates = buildRewardRateMap(rewardRateRows);
    const apiKey = await getApiKey(db, 'exchangerate');

    await ensureTodaySnapshot(db, accounts, rewardRates, apiKey);

    const [expenseRows, snapshotRows] = await Promise.all([
      rows<ExpenseRow>(
        db,
        `SELECT amount, currency, category, transaction_date FROM transactions
          WHERE type = 'EXPENSE' AND deleted_at IS NULL
          ORDER BY transaction_date ASC, seq ASC`,
      ),
      rows<{ snapshot_date: string; net_worth_usd: number }>(
        db,
        'SELECT snapshot_date, net_worth_usd FROM net_worth_snapshots ORDER BY snapshot_date ASC',
      ),
    ]);

    const allCurrencies = [
      ...accounts
        .filter((a) => a.type === AccountType.ASSET || a.type === AccountType.LIABILITY)
        .map((a) => a.currency),
      ...expenseRows.map((expense) => expense.currency ?? 'USD'),
    ];
    const fxRates = await fetchUsdExchangeRates(allCurrencies, apiKey);
    const currentBreakdown = buildDashboardBreakdown(accounts, rewardRates, fxRates);
    const expenseSeries = buildMonthlyExpenseSeries(expenseRows, fxRates);

    return {
      allocation: buildAllocationSlices(currentBreakdown.breakdown),
      debtSummary: accounts.some((a) => a.type === AccountType.LIABILITY)
        ? {
            label: 'Credit Card Debt',
            usd: currentBreakdown.liabilitiesUsd,
            grossDebtUsd: currentBreakdown.breakdown.credit_card_debt,
            overpaymentUsd: currentBreakdown.breakdown.credit_card_overpayment,
            accounts: accounts
              .filter((a) => a.type === AccountType.LIABILITY)
              .map((a) => ({
                account_id: a.id,
                name: a.name,
                usd: getAccountUsdValue(a, rewardRates, fxRates),
              })),
          }
        : null,
      totals: {
        assetsUsd: currentBreakdown.assetsUsd,
        liabilitiesUsd: currentBreakdown.liabilitiesUsd,
        netWorthUsd: currentBreakdown.netWorthUsd,
      },
      netWorthHistory: snapshotRows.map((row) => ({
        date: row.snapshot_date,
        netWorthUsd: row.net_worth_usd,
      })),
      monthlyExpenses: expenseSeries.monthlyExpenses,
      expenseCategories: expenseSeries.expenseCategories,
      asOf: new Date().toISOString(),
    };
  });
}
