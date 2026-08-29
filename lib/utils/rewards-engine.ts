import type { RewardRule, SpendStats, RewardResult } from '@/lib/types/rewards';

/**
 * Find the best matching rule for a category.
 * Manual rules take priority over imported/cloud defaults.
 */
export function findMatchedRule(
  rules: RewardRule[],
  category: string,
): RewardRule | undefined {
  const manual = rules.find(
    (rule) => rule.category === category && rule.rule_source === 'manual',
  );
  if (manual) return manual;
  return rules.find((r) => r.category === category);
}

export function buildStatsKey(
  category: string,
  dateStr: string,
  capPeriod: 'annual' | 'monthly' | undefined,
): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();

  if (capPeriod === 'monthly') {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}_${category}`;
  }

  return `${year}_${category}`;
}

/**
 * Sum historical spend from spendStats for a given category and period.
 *
 * Key formats:
 *   annual  → "YYYY_Category"   e.g. "2026_Dining"
 *   monthly → "YYYY-MM_Category" e.g. "2026-03_Dining"
 */
function getSpend(
  spendStats: SpendStats,
  category: string,
  period: 'annual' | 'monthly',
): number {
  const suffix = `_${category}`;
  let total = 0;

  for (const [key, value] of Object.entries(spendStats)) {
    if (!key.endsWith(suffix)) continue;
    const prefix = key.slice(0, -suffix.length);
    const matches =
      period === 'annual'
        ? /^\d{4}$/.test(prefix)
        : /^\d{4}-\d{2}$/.test(prefix);
    if (matches) total += value;
  }

  return total;
}

export function calculateReward(
  rules: RewardRule[],
  spendStats: SpendStats,
  category: string,
  amount: number,
): RewardResult {
  const rule = findMatchedRule(rules, category);

  if (!rule) {
    return { points: 0, capped: false };
  }

  if (amount === 0) {
    return { points: 0, capped: false };
  }

  const { multiplier, cap_amount, cap_period, fallback_rate } = rule;
  const toRewardUnits = (amountInCurrencyUnits: number, rate: number) =>
    Math.round(amountInCurrencyUnits * rate);

  if (cap_amount == null || cap_period == null) {
    return {
      points: toRewardUnits(amount, multiplier),
      capped: false,
    };
  }

  const currentSpend = getSpend(spendStats, category, cap_period);
  const headroom = cap_amount - currentSpend;
  const fallback = fallback_rate ?? 1;

  if (headroom <= 0) {
    return {
      points: toRewardUnits(amount, fallback),
      capped: true,
    };
  }

  if (headroom >= amount) {
    return {
      points: toRewardUnits(amount, multiplier),
      capped: false,
    };
  }

  const overflowPortion = amount - headroom;
  return {
    points:
      toRewardUnits(headroom, multiplier) +
      toRewardUnits(overflowPortion, fallback),
    capped: true,
  };
}
