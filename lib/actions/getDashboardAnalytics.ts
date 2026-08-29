'use server';

import { createClient } from '@/lib/supabase/server';
import type { RequestSessionContext } from '@/lib/supabase/server';
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

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
type DashboardInputsResult =
  | { accounts: Account[]; rewardRates: RewardRateMap }
  | { error: string };
const HIDDEN_MARKER = '[HIDDEN]';

function toSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function loadAccountsAndRewardRates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<DashboardInputsResult> {
  const [{ data: accountsData, error: accountsError }, { data: rewardRatesData, error: ratesError }] =
    await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', userId),
      supabase
        .from('reward_rates')
        .select('user_id, reward_currency, usd_per_10k_points, updated_at')
        .eq('user_id', userId),
    ]);

  if (accountsError) {
    return { error: accountsError.message };
  }

  if (ratesError) {
    return { error: ratesError.message };
  }

  return {
    accounts: ((accountsData ?? []) as AccountRow[]).map(mapAccountRowToAccount),
    rewardRates: buildRewardRateMap(rewardRatesData as RewardRateRow[] | null),
  };
}

async function ensureTodaySnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  accounts: Account[],
  rewardRates: RewardRateMap,
) {
  const snapshotDate = toSnapshotDate();

  const { data: existingSnapshot, error: existingError } = await supabase
    .from('net_worth_snapshots')
    .select('id')
    .eq('user_id', userId)
    .eq('snapshot_date', snapshotDate)
    .maybeSingle();

  if (existingError) {
    return { success: false as const, error: existingError.message };
  }

  if (existingSnapshot) {
    return { success: true as const };
  }

  const accountCurrencies = accounts
    .filter(
      (account) =>
        account.type === AccountType.ASSET || account.type === AccountType.LIABILITY,
    )
    .map((account) => account.currency);
  const fxRates = await fetchUsdExchangeRates(accountCurrencies);
  const snapshot = buildDashboardBreakdown(accounts, rewardRates, fxRates);

  const { error: insertError } = await supabase.from('net_worth_snapshots').insert({
    user_id: userId,
    snapshot_date: snapshotDate,
    snapshot_at: new Date().toISOString(),
    net_worth_usd: snapshot.netWorthUsd,
    assets_usd: snapshot.assetsUsd,
    liabilities_usd: snapshot.liabilitiesUsd,
    breakdown: snapshot.breakdown,
    valuation_inputs: snapshot.valuationInputs,
  });

  if (insertError) {
    return { success: false as const, error: insertError.message };
  }

  return { success: true as const };
}

export async function getDashboardAnalytics(
  context: RequestSessionContext,
): Promise<ActionResult<DashboardAnalytics>> {
  const supabase = context.supabase;
  const userId = context.userId;

  const inputsResult = await loadAccountsAndRewardRates(supabase, userId);
  if ('error' in inputsResult) {
    return { success: false, error: inputsResult.error };
  }

  const { accounts, rewardRates } = inputsResult;

  const snapshotResult = await ensureTodaySnapshot(
    supabase,
    userId,
    accounts,
    rewardRates,
  );
  if (!snapshotResult.success) {
    return { success: false, error: snapshotResult.error };
  }

  const expenseRowsPromise = supabase
    .from('transactions')
    .select('amount, currency, category, transaction_at')
    .eq('user_id', userId)
    .eq('type', 'EXPENSE')
    .or(`memo.is.null,memo.not.ilike.*${HIDDEN_MARKER}*`)
    .order('transaction_at', { ascending: true });

  const snapshotRowsPromise = supabase
    .from('net_worth_snapshots')
    .select('snapshot_date, net_worth_usd')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: true });

  const [{ data: expenseRows, error: expensesError }, { data: snapshotRows, error: historyError }] =
    await Promise.all([expenseRowsPromise, snapshotRowsPromise]);

  if (expensesError) {
    return { success: false, error: expensesError.message };
  }

  if (historyError) {
    return { success: false, error: historyError.message };
  }

  const allCurrencies = [
    ...accounts
      .filter(
        (account) =>
          account.type === AccountType.ASSET || account.type === AccountType.LIABILITY,
      )
      .map((account) => account.currency),
    ...(expenseRows ?? []).map((expense) => expense.currency ?? 'USD'),
  ];
  const fxRates = await fetchUsdExchangeRates(allCurrencies);
  const currentBreakdown = buildDashboardBreakdown(accounts, rewardRates, fxRates);
  const expenseSeries = buildMonthlyExpenseSeries(
    (expenseRows ?? []) as ExpenseRow[],
    fxRates,
  );

  return {
    success: true,
    data: {
      allocation: buildAllocationSlices(currentBreakdown.breakdown),
      debtSummary:
        accounts.some((account) => account.type === AccountType.LIABILITY)
          ? {
              label: 'Credit Card Debt',
              usd: currentBreakdown.liabilitiesUsd,
              grossDebtUsd: currentBreakdown.breakdown.credit_card_debt,
              overpaymentUsd: currentBreakdown.breakdown.credit_card_overpayment,
              accounts: accounts
                .filter((account) => account.type === AccountType.LIABILITY)
                .map((account) => ({
                  account_id: account.id,
                  name: account.name,
                  usd: getAccountUsdValue(account, rewardRates, fxRates),
                })),
            }
          : null,
      totals: {
        assetsUsd: currentBreakdown.assetsUsd,
        liabilitiesUsd: currentBreakdown.liabilitiesUsd,
        netWorthUsd: currentBreakdown.netWorthUsd,
      },
      netWorthHistory: (snapshotRows ?? []).map((row) => ({
        date: row.snapshot_date,
        netWorthUsd: row.net_worth_usd,
      })),
      monthlyExpenses: expenseSeries.monthlyExpenses,
      expenseCategories: expenseSeries.expenseCategories,
      asOf: new Date().toISOString(),
    },
  };
}
