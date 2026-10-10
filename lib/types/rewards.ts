export const REWARD_CURRENCIES = [
  {
    id: 'MR',
    displayName: 'Amex Membership Rewards',
    description: 'American Express Membership Rewards points',
    color: '#2F6FED',
  },
  {
    id: 'UR',
    displayName: 'Chase Ultimate Rewards',
    description: 'Chase Ultimate Rewards points',
    color: '#1F4DB8',
  },
  {
    id: 'RC',
    displayName: 'HSBC Reward Cash',
    description: 'HSBC Reward Cash balance',
    color: '#D64545',
  },
] as const;

export type RewardCurrencyDefinition = (typeof REWARD_CURRENCIES)[number];
export type RewardCurrencyId = RewardCurrencyDefinition['id'];
export const REWARD_CURRENCY_IDS = REWARD_CURRENCIES.map(
  (currency) => currency.id,
) as [RewardCurrencyId, ...RewardCurrencyId[]];

export const REWARD_RULE_SOURCES = ['manual', 'imported', 'cloud'] as const;
type RewardRuleSource = (typeof REWARD_RULE_SOURCES)[number];

export const REWARD_CAP_PERIODS = ['monthly', 'annual'] as const;
export type RewardCapPeriod = (typeof REWARD_CAP_PERIODS)[number];

export interface RewardRule {
  category: string;
  multiplier: number;
  rule_source: RewardRuleSource;
  cap_amount?: number;
  cap_period?: RewardCapPeriod;
  fallback_rate?: number;
}

export type RewardRateMap = Record<RewardCurrencyId, number>;

export type SpendStats = Record<string, number>;

export interface RewardResult {
  points: number;
  capped: boolean;
}

export type RewardRuleSetSource = Extract<RewardRuleSource, 'imported' | 'cloud'>;

export interface RewardRuleSet {
  id: string;
  name: string;
  description?: string;
  source: RewardRuleSetSource;
  version: number;
  rules: RewardRule[];
}

export function isRewardCurrencyId(value: string): value is RewardCurrencyId {
  return REWARD_CURRENCIES.some((currency) => currency.id === value);
}

export function getRewardCurrencyDefinition(
  id: string,
): RewardCurrencyDefinition | undefined {
  return REWARD_CURRENCIES.find((currency) => currency.id === id);
}

export function getDefaultRewardRateMap(): RewardRateMap {
  return REWARD_CURRENCIES.reduce((acc, currency) => {
    acc[currency.id] = 0;
    return acc;
  }, {} as RewardRateMap);
}

export function estimateRewardUsd(
  points: number,
  usdPer10kPoints: number,
): number {
  return Math.round((points / 10000) * usdPer10kPoints);
}
