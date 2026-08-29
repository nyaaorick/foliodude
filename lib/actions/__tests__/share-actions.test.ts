import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType } from '@/lib/types/transactions';

const { mockCreateClient, mockRevalidatePath, mockFetchStockPrices } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockFetchStockPrices: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock('@/lib/utils/stock-price', () => ({
  fetchStockPrices: mockFetchStockPrices,
}));

import { buyShare, refreshSharePrices, sellShare } from '@/lib/actions/share-actions';

const USER_ID = 'user-1';
const SHARE_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CASH_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

interface MockAccountRow {
  id: string;
  user_id: string;
  type: AccountType;
  currency: string;
  balance: number;
  ticker?: string | null;
  brokerage_account_id?: string | null;
  shares?: number;
  cost_basis?: number;
  last_price?: number | null;
  last_price_at?: string | null;
}

function makeShareAccount(
  overrides: Partial<MockAccountRow> = {},
): MockAccountRow {
  return {
    id: SHARE_ACCOUNT_ID,
    user_id: USER_ID,
    type: AccountType.SHARE,
    currency: 'USD',
    balance: 1000,
    ticker: 'AAPL',
    brokerage_account_id: CASH_ACCOUNT_ID,
    shares: 10,
    cost_basis: 800,
    last_price: 100,
    last_price_at: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeCashAccount(
  overrides: Partial<MockAccountRow> = {},
): MockAccountRow {
  return {
    id: CASH_ACCOUNT_ID,
    user_id: USER_ID,
    type: AccountType.ASSET,
    currency: 'USD',
    balance: 5000,
    ...overrides,
  };
}

function createSupabaseMock(accounts: MockAccountRow[]) {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const calls = {
    insertedTransaction: null as Record<string, unknown> | null,
    accountUpdates: [] as Array<{
      payload: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>,
  };

  const accountsTable = {
    select: vi.fn(() => {
      const filters: Record<string, unknown> = {};

      return {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        single() {
          const row = accountMap.get(String(filters.id));

          if (!row) {
            return Promise.resolve({
              data: null,
              error: { message: 'Account not found' },
            });
          }

          if (filters.user_id && row.user_id !== filters.user_id) {
            return Promise.resolve({
              data: null,
              error: { message: 'Account not found' },
            });
          }

          return Promise.resolve({ data: row, error: null });
        },
      };
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      const filters: Record<string, unknown> = {};
      calls.accountUpdates.push({ payload, filters });

      return {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        select() {
          return this;
        },
        single() {
          return Promise.resolve({ data: { id: filters.id }, error: null });
        },
      };
    }),
  };

  const transactionsTable = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      calls.insertedTransaction = payload;

      return {
        select() {
          return this;
        },
        single() {
          return Promise.resolve({
            data: {
              id: 'tx-1',
              user_id: USER_ID,
              type: payload.type,
              amount: payload.amount,
              currency: 'USD',
              from_account: payload.from_account,
              to_account: payload.to_account,
              category: null,
              memo: payload.memo ?? null,
              share_ticker: payload.share_ticker ?? null,
              share_quantity: payload.share_quantity ?? null,
              share_price: payload.share_price ?? null,
              fee: payload.fee ?? null,
              transaction_at: '2026-03-16T00:00:00.000Z',
              created_at: '2026-03-16T00:00:00.000Z',
            },
            error: null,
          });
        },
      };
    }),
  };

  return {
    calls,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn((table: string) => {
        if (table === 'accounts') return accountsTable;
        if (table === 'transactions') return transactionsTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('share actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a buy and updates cash plus position balances', async () => {
    const { supabase, calls } = createSupabaseMock([
      makeShareAccount(),
      makeCashAccount(),
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await buyShare({
      shareAccountId: SHARE_ACCOUNT_ID,
      brokerageAccountId: CASH_ACCOUNT_ID,
      quantity: 2,
      price: 150,
      fee: 5,
      memo: 'buy more',
    });

    expect(result.success).toBe(true);
    expect(calls.insertedTransaction).toMatchObject({
      type: TransactionType.SHARE_BUY,
      amount: 305,
      from_account: CASH_ACCOUNT_ID,
      to_account: SHARE_ACCOUNT_ID,
      share_ticker: 'AAPL',
      share_quantity: 2,
      share_price: 150,
      fee: 5,
    });
    expect(calls.accountUpdates).toHaveLength(2);
    expect(calls.accountUpdates[0]?.payload).toEqual({ balance: 4695 });
    expect(calls.accountUpdates[1]?.payload).toEqual({
      shares: 12,
      cost_basis: 1105,
      last_price: 150,
      last_price_at: expect.any(String),
      balance: 1800,
    });
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('rejects a buy when cash is insufficient', async () => {
    const { supabase } = createSupabaseMock([
      makeShareAccount(),
      makeCashAccount({ balance: 100 }),
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await buyShare({
      shareAccountId: SHARE_ACCOUNT_ID,
      brokerageAccountId: CASH_ACCOUNT_ID,
      quantity: 1,
      price: 150,
      fee: 1,
      memo: 'too expensive',
    });

    expect(result).toEqual({ success: false, error: 'Insufficient cash balance' });
  });

  it('records a sell and clears the position when all shares are sold', async () => {
    const { supabase, calls } = createSupabaseMock([
      makeShareAccount({ balance: 1000, shares: 5, cost_basis: 400 }),
      makeCashAccount({ balance: 1000 }),
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await sellShare({
      shareAccountId: SHARE_ACCOUNT_ID,
      brokerageAccountId: CASH_ACCOUNT_ID,
      quantity: 5,
      price: 120,
      fee: 10,
      memo: 'exit',
    });

    expect(result.success).toBe(true);
    expect(calls.insertedTransaction).toMatchObject({
      type: TransactionType.SHARE_SELL,
      amount: 590,
      from_account: SHARE_ACCOUNT_ID,
      to_account: CASH_ACCOUNT_ID,
      share_quantity: 5,
      share_price: 120,
      fee: 10,
    });
    expect(calls.accountUpdates[0]?.payload).toEqual({ balance: 1590 });
    expect(calls.accountUpdates[1]?.payload).toEqual({
      shares: 0,
      cost_basis: 0,
      last_price: 120,
      last_price_at: expect.any(String),
      balance: 0,
    });
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('reuses the authorized client when refreshing share prices', async () => {
    const shareAccounts = [
      {
        id: SHARE_ACCOUNT_ID,
        ticker: 'AAPL',
        shares: 10,
        last_price_at: null,
      },
    ];

    mockFetchStockPrices.mockResolvedValue({ AAPL: 123.45 });

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'accounts') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: vi.fn(() => ({
            eq(key: string, value: unknown) {
              if (key === 'user_id' && value === USER_ID) {
                return {
                  eq(typeKey: string, typeValue: unknown) {
                    if (typeKey === 'type' && typeValue === AccountType.SHARE) {
                      return Promise.resolve({ data: shareAccounts, error: null });
                    }
                    throw new Error(`Unexpected filter: ${typeKey}=${String(typeValue)}`);
                  },
                };
              }
              throw new Error(`Unexpected filter: ${key}=${String(value)}`);
            },
          })),
          update: vi.fn(() => ({
            eq() {
              return this;
            },
          })),
        };
      }),
    };

    mockCreateClient.mockResolvedValue(supabase);

    const result = await refreshSharePrices();

    expect(result.success).toBe(true);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('refreshSharePrices continues when one account update fails', async () => {
    const shareAccounts = [
      {
        id: 'share-1',
        ticker: 'AAPL',
        shares: 10,
        last_price_at: null,
      },
      {
        id: 'share-2',
        ticker: 'MSFT',
        shares: 5,
        last_price_at: null,
      },
    ];

    mockFetchStockPrices.mockResolvedValue({ AAPL: 123.45, MSFT: 456.78 });

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'accounts') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: vi.fn(() => ({
            eq(key: string, value: unknown) {
              if (key === 'user_id' && value === USER_ID) {
                return {
                  eq(typeKey: string, typeValue: unknown) {
                    if (typeKey === 'type' && typeValue === AccountType.SHARE) {
                      return Promise.resolve({ data: shareAccounts, error: null });
                    }
                    throw new Error(`Unexpected filter: ${typeKey}=${String(typeValue)}`);
                  },
                };
              }
              throw new Error(`Unexpected filter: ${key}=${String(value)}`);
            },
          })),
          update: vi.fn(() => {
            const filters: Record<string, unknown> = {};

            return {
              eq(key: string, value: unknown) {
                filters[key] = value;

                if (key === 'user_id') {
                  return Promise.resolve({
                    error:
                      filters.id === 'share-2'
                        ? { message: 'Update failed' }
                        : null,
                  });
                }

                return this;
              },
            };
          }),
        };
      }),
    };

    mockCreateClient.mockResolvedValue(supabase);

    const result = await refreshSharePrices();

    expect(result).toEqual({
      success: true,
      data: {
        updated: 1,
        failed: ['MSFT'],
        freshSkipped: 0,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts/share-1');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
  });
});
