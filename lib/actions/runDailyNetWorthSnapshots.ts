'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { AccountType } from '@/lib/types/accounts';
import type { AccountRow, RewardRateRow } from '@/lib/types/database';
import {
  buildDashboardBreakdown,
  buildRewardRateMap,
  mapAccountRowToAccount,
} from '@/lib/utils/financial-analytics';
import { fetchUsdExchangeRates } from '@/lib/utils/fx-rates';

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function toSnapshotDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function runDailyNetWorthSnapshots(
  snapshotDate = toSnapshotDate(),
): Promise<ActionResult<{ snapshotDate: string; processedUsers: number }>> {
  const supabase = createAdminClient();

  const { data: userRows, error: userRowsError } = await supabase
    .from('accounts')
    .select('user_id');

  if (userRowsError) {
    return { success: false, error: userRowsError.message };
  }

  const userIds = [...new Set((userRows ?? []).map((row) => row.user_id).filter(Boolean))];

  for (const userId of userIds) {
    const [{ data: accountsData, error: accountsError }, { data: rewardRatesData, error: ratesError }] =
      await Promise.all([
        supabase.from('accounts').select('*').eq('user_id', userId),
        supabase
          .from('reward_rates')
          .select('user_id, reward_currency, usd_per_10k_points, updated_at')
          .eq('user_id', userId),
      ]);

    if (accountsError) {
      return { success: false, error: accountsError.message };
    }

    if (ratesError) {
      return { success: false, error: ratesError.message };
    }

    const accounts = ((accountsData ?? []) as AccountRow[]).map(mapAccountRowToAccount);
    const rewardRates = buildRewardRateMap((rewardRatesData ?? []) as RewardRateRow[]);
    const fxRates = await fetchUsdExchangeRates(
      accounts
        .filter(
          (account) =>
            account.type === AccountType.ASSET || account.type === AccountType.LIABILITY,
        )
        .map((account) => account.currency),
    );
    const snapshot = buildDashboardBreakdown(accounts, rewardRates, fxRates);

    const { error: upsertError } = await supabase.from('net_worth_snapshots').upsert(
      {
        user_id: userId,
        snapshot_date: snapshotDate,
        snapshot_at: new Date().toISOString(),
        net_worth_usd: snapshot.netWorthUsd,
        assets_usd: snapshot.assetsUsd,
        liabilities_usd: snapshot.liabilitiesUsd,
        breakdown: snapshot.breakdown,
        valuation_inputs: snapshot.valuationInputs,
      },
      {
        onConflict: 'user_id,snapshot_date',
      },
    );

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }
  }

  return {
    success: true,
    data: {
      snapshotDate,
      processedUsers: userIds.length,
    },
  };
}
