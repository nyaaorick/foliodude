import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient, mockRevalidatePath } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

import { transferRewardsToMileageAccount } from '@/lib/actions/mileage-actions';

const USER_ID = 'user-1';
const MILEAGE_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ONE_ID = '22222222-2222-4222-8222-222222222222';
const CARD_TWO_ID = '33333333-3333-4333-8333-333333333333';

function createSupabaseMock(
  rewardBalances: number[] = [6000, 6000],
) {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn((columns: string) => {
      const filters: Record<string, unknown> = {};

      return {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        in(_key: string, ids: string[]) {
          return Promise.resolve({
            data: [
              {
                id: CARD_ONE_ID,
                name: 'Amex Gold',
                type: 'LIABILITY',
                reward_currency: 'MR',
                reward_balance: rewardBalances[0],
              },
              {
                id: CARD_TWO_ID,
                name: 'Amex Platinum',
                type: 'LIABILITY',
                reward_currency: 'MR',
                reward_balance: rewardBalances[1],
              },
            ].filter((row) => ids.includes(row.id)),
            error: null,
          });
        },
        single() {
          if (columns.includes('airline_program')) {
            return Promise.resolve({
              data: {
                id: MILEAGE_ACCOUNT_ID,
                name: 'KrisFlyer Main',
                type: 'AIRLINE_MILES',
                balance: 100,
                airline_program: 'KRISFLYER',
                transfer_rates: {
                  MR: 20,
                  RC: 15,
                },
              },
              error: null,
            });
          }

          return Promise.resolve({ data: null, error: null });
        },
      };
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      accountUpdates.push(payload);
      return {
        eq() {
          return this;
        },
        then(resolve: (value: { error: null }) => unknown) {
          return Promise.resolve(resolve({ error: null }));
        },
      };
    }),
  };

  const transactionsTable = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertedTransactions.push(payload);

      if (payload.type === 'MILEAGE_TRANSFER_IN') {
        return {
          select() {
            return this;
          },
          single() {
            return Promise.resolve({
              data: { id: 'mileage-tx-1', ...payload },
              error: null,
            });
          },
        };
      }

      return Promise.resolve({ error: null });
    }),
  };

  return {
    insertedTransactions,
    accountUpdates,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'accounts') return accountsTable;
        if (table === 'transactions') return transactionsTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('transferRewardsToMileageAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combines up to 3 source cards into one mileage transfer', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await transferRewardsToMileageAccount({
      mileageAccountId: MILEAGE_ACCOUNT_ID,
      sources: [
        { accountId: CARD_ONE_ID, points: 5000 },
        { accountId: CARD_TWO_ID, points: 5000 },
      ],
      date: '2026-03-16T00:00:00.000Z',
      memo: 'Flight pool',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        transferredMiles: 200000,
      },
    });
    expect(insertedTransactions[0]).toMatchObject({
      type: 'MILEAGE_TRANSFER_IN',
      amount: 200000,
      to_account: MILEAGE_ACCOUNT_ID,
      metadata: {
        total_source_points: 10000,
        transferred_miles: 200000,
        ratio_snapshot: {
          reward_currency: 'MR',
          miles_per_point: 20,
        },
      },
    });
    expect(insertedTransactions[1]).toMatchObject({
      type: 'REWARD_REDEEM',
      amount: 5000,
      from_account: CARD_ONE_ID,
      reference_transaction_id: 'mileage-tx-1',
    });
    expect(insertedTransactions[2]).toMatchObject({
      type: 'REWARD_REDEEM',
      amount: 5000,
      from_account: CARD_TWO_ID,
      reference_transaction_id: 'mileage-tx-1',
    });
    expect(accountUpdates[0]).toEqual({ reward_balance: 1000 });
    expect(accountUpdates[1]).toEqual({ reward_balance: 1000 });
    expect(accountUpdates[2]).toEqual({ balance: 200100 });
  });

  it('rejects transfers when a source balance is insufficient', async () => {
    const { supabase } = createSupabaseMock([3000, 6000]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await transferRewardsToMileageAccount({
      mileageAccountId: MILEAGE_ACCOUNT_ID,
      sources: [{ accountId: CARD_ONE_ID, points: 5000 }],
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toEqual({
      success: false,
      error: 'Insufficient reward balance',
    });
  });
});
