import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient, mockFetchUsdExchangeRates } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockFetchUsdExchangeRates: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/fx-rates', () => ({
  fetchUsdExchangeRates: mockFetchUsdExchangeRates,
}));

import { getDashboardAnalytics } from '@/lib/actions/getDashboardAnalytics';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock({
  snapshotExists = false,
}: {
  snapshotExists?: boolean;
} = {}) {
  const calls = {
    snapshotInsert: null as Record<string, unknown> | null,
    expenseVisibilityFilter: null as string | null,
  };

  const accounts = [
    {
      id: 'asset-1',
      user_id: USER_ID,
      name: 'Checking',
      type: 'ASSET',
      currency: 'USD',
      balance: 100,
      credit_limit: null,
      reward_currency: null,
      reward_balance: 0,
      airline_program: null,
      usd_per_10k_miles: 0,
      transfer_rates: {},
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
    },
    {
      id: 'card-1',
      user_id: USER_ID,
      name: 'Amex Gold',
      type: 'LIABILITY',
      currency: 'USD',
      balance: -25,
      credit_limit: 1000,
      reward_currency: 'MR',
      reward_balance: 10000,
      airline_program: null,
      usd_per_10k_miles: 0,
      transfer_rates: {},
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
    },
    {
      id: 'card-2',
      user_id: USER_ID,
      name: 'Citi Premier',
      type: 'LIABILITY',
      currency: 'USD',
      balance: 5,
      credit_limit: 1000,
      reward_currency: null,
      reward_balance: 0,
      airline_program: null,
      usd_per_10k_miles: 0,
      transfer_rates: {},
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
    },
  ];

  const rewardRates = [
    {
      user_id: USER_ID,
      reward_currency: 'MR',
      usd_per_10k_points: 180,
      updated_at: '2026-03-16T00:00:00.000Z',
    },
  ];

  const expenses = [
    {
      amount: 20,
      currency: 'USD',
      category: 'Dining',
      transaction_at: '2026-02-12T00:00:00.000Z',
    },
    {
      amount: 10,
      currency: 'HKD',
      category: 'Travel',
      transaction_at: '2026-02-18T00:00:00.000Z',
    },
  ];

  const snapshots = [
    { snapshot_date: '2026-03-15', net_worth_usd: 240 },
    { snapshot_date: '2026-03-16', net_worth_usd: 255 },
  ];

  const accountsTable = {
    select: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({
        data: accounts,
        error: null,
      }),
    })),
  };

  const rewardRatesTable = {
    select: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({
        data: rewardRates,
        error: null,
      }),
    })),
  };

  const transactionsTable = {
    select: vi.fn(() => ({
      eq(key: string) {
        if (key === 'user_id') {
          return this;
        }

        return this;
      },
      or: vi.fn((expr: string) => {
        calls.expenseVisibilityFilter = expr;
        return {
          order: vi.fn().mockResolvedValue({
            data: expenses,
            error: null,
          }),
        };
      }),
      order: vi.fn().mockResolvedValue({
        data: expenses,
        error: null,
      }),
    })),
  };

  const snapshotsTable = {
    select: vi.fn((columns: string) => {
      if (columns === 'id') {
        return {
          eq() {
            return this;
          },
          maybeSingle: vi.fn().mockResolvedValue({
            data: snapshotExists ? { id: 'snapshot-1' } : null,
            error: null,
          }),
        };
      }

      return {
        eq() {
          return this;
        },
        order: vi.fn().mockResolvedValue({
          data: snapshots,
          error: null,
        }),
      };
    }),
    insert: vi.fn((payload: Record<string, unknown>) => {
      calls.snapshotInsert = payload;

      return Promise.resolve({
        error: null,
      });
    }),
  };

  return {
    calls,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'accounts') return accountsTable;
        if (table === 'reward_rates') return rewardRatesTable;
        if (table === 'transactions') return transactionsTable;
        if (table === 'net_worth_snapshots') return snapshotsTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('getDashboardAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchUsdExchangeRates.mockResolvedValue({ USD: 1, HKD: 0.13 });
  });

  it('creates a snapshot when today is missing and returns chart data from snapshots', async () => {
    const { supabase, calls } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await getDashboardAnalytics({
      supabase,
      userId: USER_ID,
      userEmail: 'user@example.com',
    });

    expect(result.success).toBe(true);
    expect(calls.snapshotInsert).toMatchObject({
      user_id: USER_ID,
      assets_usd: 280,
      liabilities_usd: 20,
      net_worth_usd: 260,
    });

    if (!result.success) {
      throw new Error('Expected success result');
    }

    expect(result.data.debtSummary).toEqual({
      label: 'Credit Card Debt',
      usd: 20,
      grossDebtUsd: 25,
      overpaymentUsd: 5,
      accounts: [
        {
          account_id: 'card-1',
          name: 'Amex Gold',
          usd: -25,
        },
        {
          account_id: 'card-2',
          name: 'Citi Premier',
          usd: 5,
        },
      ],
    });
    expect(result.data.netWorthHistory).toEqual([
      { date: '2026-03-15', netWorthUsd: 240 },
      { date: '2026-03-16', netWorthUsd: 255 },
    ]);
    expect(result.data.monthlyExpenses).toEqual([
      {
        month: '2026-02',
        Dining: 20,
        Travel: 1.3,
      },
    ]);
    expect(calls.expenseVisibilityFilter).toBe('memo.is.null,memo.not.ilike.*[HIDDEN]*');
  });

  it('does not insert a duplicate snapshot when today already exists', async () => {
    const { supabase, calls } = createSupabaseMock({ snapshotExists: true });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await getDashboardAnalytics({
      supabase,
      userId: USER_ID,
      userEmail: 'user@example.com',
    });

    expect(result.success).toBe(true);
    expect(calls.snapshotInsert).toBeNull();
  });
});
