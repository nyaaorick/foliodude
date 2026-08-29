'use client';

import { useEffect, useState } from 'react';
import { updateRewardRate } from '@/lib/actions/reward-actions';
import {
  estimateRewardUsd,
  getRewardCurrencyDefinition,
  type RewardCurrencyId,
  type RewardRateMap,
} from '@/lib/types/rewards';
import { InlineValuationEditor } from './inline-valuation-editor';

interface RewardBalanceListProps {
  rewardCurrency: RewardCurrencyId | null;
  rewardBalance: number;
  rewardRates: RewardRateMap;
  compact?: boolean;
}

export function RewardBalanceList({
  rewardCurrency,
  rewardBalance,
  rewardRates,
  compact = false,
}: RewardBalanceListProps) {
  const [rates, setRates] = useState<RewardRateMap>(rewardRates);

  useEffect(() => {
    setRates(rewardRates);
  }, [rewardRates]);

  if (!rewardCurrency || rewardBalance <= 0) {
    return null;
  }

  const rewardDefinition = getRewardCurrencyDefinition(rewardCurrency);
  if (!rewardDefinition) {
    return null;
  }

  const rate = rates[rewardCurrency] ?? 0;
  const estimateUsd = estimateRewardUsd(rewardBalance, rate);

  return (
    <InlineValuationEditor
      title={`${rewardBalance.toLocaleString()} ${rewardCurrency}`}
      subtitle={rewardDefinition.displayName}
      quantityLabel={rate > 0 ? `10k point = $${rate.toLocaleString()} USD` : undefined}
      rate={rate}
      rateLabel="10k point ="
      estimateLabel={rate > 0 ? `≈ $${estimateUsd.toLocaleString()}` : undefined}
      compact={compact}
      onSave={async (nextRate) => {
        try {
          await updateRewardRate({
            rewardCurrency,
            usdPer10kPoints: nextRate,
          });
        } catch (error) {
          if (!(error instanceof Error)) {
            throw error;
          }

          return { success: false, error: error.message };
        }

        setRates((prev) => ({ ...prev, [rewardCurrency]: nextRate }));
        return { success: true };
      }}
    />
  );
}
