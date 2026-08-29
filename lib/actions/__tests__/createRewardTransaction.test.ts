import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionType } from '@/lib/types/transactions';

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

import { createRewardTransaction } from '@/lib/actions/reward-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(initialBalance = 1000) {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: {
          id: ACCOUNT_ID,
          type: 'LIABILITY',
          reward_currency: 'MR',
          reward_balance: initialBalance,
        },
        error: null,
      }),
    })),
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
      return {
        select() {
          return this;
        },
        single() {
          return Promise.resolve({
            data: {
              id: 'reward-tx-1',
              ...payload,
            },
            error: null,
          });
        },
      };
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

describe('createRewardTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds reward balances for transfer-in transactions', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock(1000);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createRewardTransaction({
      accountId: ACCOUNT_ID,
      type: TransactionType.REWARD_TRANSFER_IN,
      amount: 500,
      memo: 'Welcome bonus',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toHaveProperty('transaction');
    expect(insertedTransactions[0]).toMatchObject({
      type: TransactionType.REWARD_TRANSFER_IN,
      reward_currency: 'MR',
      to_account: ACCOUNT_ID,
      from_account: null,
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_balance: 1500,
    });
  });

  it('rejects redeems that would overdraw the reward balance', async () => {
    const { supabase } = createSupabaseMock(200);
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createRewardTransaction({
        accountId: ACCOUNT_ID,
        type: TransactionType.REWARD_REDEEM,
        amount: 500,
        memo: 'Flight',
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow('Insufficient reward balance');
  });
});
