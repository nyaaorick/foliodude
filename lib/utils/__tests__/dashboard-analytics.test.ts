import { describe, expect, it } from 'vitest';
import { AccountType, type Account } from '@/lib/types/accounts';
import {
  buildAllocationSlices,
  buildDashboardBreakdown,
  buildRewardRateMap,
  buildRewardRateMapStrict,
} from '@/lib/utils/financial-analytics';
import type { RewardRateRow } from '@/lib/types/database';
import type { RewardRateMap } from '@/lib/types/rewards';

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 'account-1',
    user_id: 'user-1',
    name: 'Account',
    type: AccountType.ASSET,
    balance: 0,
    credit_limit: null,
    reward_currency: null,
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    currency: 'USD',
    brokerage: null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
    reward_rules: [],
    spend_stats: {},
    auto_pay_config: null,
    created_at: '2026-03-16T00:00:00.000Z',
    updated_at: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('dashboard analytics utils', () => {
  it('builds USD totals and excludes liabilities from the main allocation pie', () => {
    const rewardRates: RewardRateMap = { MR: 180, UR: 0, RC: 100 };
    const accounts = [
      makeAccount({
        id: 'asset-1',
        name: 'Checking',
        type: AccountType.ASSET,
        balance: 100,
      }),
      makeAccount({
        id: 'liability-1',
        name: 'Amex Gold',
        type: AccountType.LIABILITY,
        balance: -40,
        reward_currency: 'MR',
        reward_balance: 10000,
      }),
      makeAccount({
        id: 'share-1',
        name: 'AAPL',
        type: AccountType.SHARE,
        balance: 50,
      }),
      makeAccount({
        id: 'miles-1',
        name: 'KrisFlyer',
        type: AccountType.AIRLINE_MILES,
        balance: 10000,
        usd_per_10k_miles: 120,
      }),
    ];

    const result = buildDashboardBreakdown(accounts, rewardRates, { USD: 1 });
    const allocation = buildAllocationSlices(result.breakdown);

    expect(result.assetsUsd).toBe(450);
    expect(result.liabilitiesUsd).toBe(40);
    expect(result.netWorthUsd).toBe(410);
    expect(result.breakdown.reward_points).toBe(180);
    expect(allocation.map((slice) => slice.key)).toEqual([
      'cash_banking',
      'stock_portfolio',
      'reward_points',
      'airline_miles',
    ]);
  });

  it('nets credit card debt against positive card balances', () => {
    const rewardRates: RewardRateMap = { MR: 0, UR: 0, RC: 0 };
    const accounts = [
      makeAccount({
        id: 'card-1',
        name: 'Card A',
        type: AccountType.LIABILITY,
        balance: -120,
      }),
      makeAccount({
        id: 'card-2',
        name: 'Card B',
        type: AccountType.LIABILITY,
        balance: 30,
      }),
    ];

    const result = buildDashboardBreakdown(accounts, rewardRates, { USD: 1 });

    expect(result.breakdown.credit_card_debt).toBe(120);
    expect(result.breakdown.credit_card_overpayment).toBe(30);
    expect(result.liabilitiesUsd).toBe(90);
    expect(result.netWorthUsd).toBe(-90);
  });

  it('falls back to 1:1 FX when a currency rate is missing', () => {
    const rewardRates: RewardRateMap = { MR: 0, UR: 0, RC: 0 };
    const accounts = [
      makeAccount({
        id: 'asset-hkd',
        name: 'HK Savings',
        type: AccountType.ASSET,
        currency: 'HKD',
        balance: 250,
      }),
    ];

    const result = buildDashboardBreakdown(accounts, rewardRates, {});

    expect(result.assetsUsd).toBe(250);
    expect(result.netWorthUsd).toBe(250);
  });

  it('buildRewardRateMap skips unsupported currencies', () => {
    const rates = buildRewardRateMap([
      { reward_currency: 'MR', usd_per_10k_points: 180 },
      { reward_currency: 'INVALID', usd_per_10k_points: 999 },
    ] as RewardRateRow[]);

    expect(rates.MR).toBe(180);
    expect('INVALID' in rates).toBe(false);
  });

  it('buildRewardRateMapStrict rejects unsupported currencies', () => {
    expect(() =>
      buildRewardRateMapStrict([
        { reward_currency: 'MR', usd_per_10k_points: 180 },
        { reward_currency: 'INVALID', usd_per_10k_points: 999 },
      ] as RewardRateRow[]),
    ).toThrow('Unsupported reward currency: INVALID');
  });
});
