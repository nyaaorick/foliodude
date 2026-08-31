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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const HIDDEN_MARKER = '[HIDDEN]';

async function ensureTodaySnapshot(
  db: Awaited<ReturnType<typeof getSessionContext>>['db'],
  userId: string,
  accounts: Account[],
  rewardRates: RewardRateMap,
  apiKey: string | null,
): Promise<void> {
  const existing = await db.query('SELECT 1 FROM net_worth_snapshots WHERE user_id = $1 AND snapshot_date = CURRENT_DATE', [userId]);
  if (existing.rows.length > 0) return;

  const accountCurrencies = accounts
    .filter((a) => a.type === AccountType.ASSET || a.type === AccountType.LIABILITY)
    .map((a) => a.currency);
  const fxRates = await fetchUsdExchangeRates(accountCurrencies, apiKey);
  const snapshot = buildDashboardBreakdown(accounts, rewardRates, fxRates);

  await db.query(
    `INSERT INTO net_worth_snapshots
       (user_id, snapshot_date, net_worth_usd, assets_usd, liabilities_usd, breakdown, valuation_inputs)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      userId,
      snapshot.netWorthUsd,
      snapshot.assetsUsd,
      snapshot.liabilitiesUsd,
      JSON.stringify(snapshot.breakdown),
      JSON.stringify(snapshot.valuationInputs),
    ],
  );
}

export async function getDashboardAnalytics(): Promise<ActionResult<DashboardAnalytics>> {
  try {
    const { db, userId } = await getSessionContext();

    const [accountRows, rewardRateRows] = await Promise.all([
      rows<AccountRow>(db, 'SELECT * FROM accounts WHERE user_id = $1', [userId]),
      rows<RewardRateRow>(
        db,
        'SELECT user_id, reward_currency, usd_per_10k_points, updated_at FROM reward_rates WHERE user_id = $1',
        [userId],
      ),
    ]);
    const accounts = accountRows.map(mapAccountRowToAccount);
    const rewardRates = buildRewardRateMap(rewardRateRows);
    const apiKey = await getApiKey(db, userId, 'exchangerate');

    await ensureTodaySnapshot(db, userId, accounts, rewardRates, apiKey);

    const [expenseRows, snapshotRows] = await Promise.all([
      rows<ExpenseRow>(
        db,
        `SELECT amount, currency, category, transaction_date FROM transactions
          WHERE user_id = $1 AND type = 'EXPENSE'
            AND (memo IS NULL OR memo NOT ILIKE '%' || $2 || '%')
          ORDER BY transaction_date ASC, seq ASC`,
        [userId, HIDDEN_MARKER],
      ),
      rows<{ snapshot_date: string; net_worth_usd: number }>(
        db,
        'SELECT snapshot_date, net_worth_usd FROM net_worth_snapshots WHERE user_id = $1 ORDER BY snapshot_date ASC',
        [userId],
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
      success: true,
      data: {
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
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load dashboard analytics' };
  }
}
