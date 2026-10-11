import { REWARD_CURRENCIES, isRewardCurrencyId, type RewardCurrencyId } from '@/lib/types/rewards';
import type { MileageTransferRateMap } from '@/lib/types/mileage';

const DEFAULT_MILEAGE_TRANSFER_RATES: MileageTransferRateMap = {
  MR: 20,
  UR: 20,
  RC: 15,
};

export function getDefaultMileageTransferRates(): MileageTransferRateMap {
  return REWARD_CURRENCIES.reduce((acc, currency) => {
    acc[currency.id] = DEFAULT_MILEAGE_TRANSFER_RATES[currency.id] ?? 0;
    return acc;
  }, {} as MileageTransferRateMap);
}

export function normalizeMileageTransferRates(value: unknown): MileageTransferRateMap {
  const defaults = getDefaultMileageTransferRates();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  const rates = { ...defaults };
  for (const [key, rawValue] of Object.entries(value)) {
    if (!isRewardCurrencyId(key)) {
      continue;
    }

    const numericValue =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number.parseInt(rawValue, 10)
          : Number.NaN;

    if (Number.isInteger(numericValue) && numericValue >= 0) {
      rates[key] = numericValue;
    }
  }

  return rates;
}

export function getMileageTransferRate(
  transferRates: MileageTransferRateMap,
  rewardCurrency: RewardCurrencyId,
): number {
  const value = transferRates[rewardCurrency];
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
