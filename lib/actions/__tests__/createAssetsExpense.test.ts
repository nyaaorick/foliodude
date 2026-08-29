import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';

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

import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(options?: {
  accountType?: AccountType;
  balance?: number;
  currency?: string;
}) {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const accountRow = {
    balance: options?.balance ?? 100,
    currency: options?.currency ?? 'USD',
    type: options?.accountType ?? AccountType.ASSET,
  };

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({ data: accountRow, error: null }),
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
            data: { id: 'asset-expense-1' },
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

describe('createAssetsExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an asset expense with fixed expense semantics', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock({
      balance: 100,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createAssetsExpense({
      accountId: ACCOUNT_ID,
      amount: 12.5,
      memo: 'Lunch',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toEqual({
      expense_id: 'asset-expense-1',
      reward_id: null,
      reward_points: 0,
    });
    expect(insertedTransactions).toHaveLength(1);
    expect(insertedTransactions[0]).toMatchObject({
      user_id: USER_ID,
      type: 'EXPENSE',
      amount: 12.5,
      currency: 'USD',
      reward_currency: null,
      metadata: {},
      reference_transaction_id: null,
      from_account: ACCOUNT_ID,
      to_account: null,
      category: 'Other',
      memo: 'Lunch',
      transaction_at: '2026-03-16T00:00:00.000Z',
    });
    expect(accountUpdates).toEqual([{ balance: 87.5 }]);
    expect(accountUpdates[0]).not.toHaveProperty('reward_balance');
    expect(accountUpdates[0]).not.toHaveProperty('spend_stats');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/accounts/${ACCOUNT_ID}`);
  });

  it('rejects non-asset accounts', async () => {
    const { supabase } = createSupabaseMock({
      accountType: AccountType.LIABILITY,
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createAssetsExpense({
        accountId: ACCOUNT_ID,
        amount: 12.5,
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow('Account must be an asset account');
  });

  it('rejects invalid amount', async () => {
    const { supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createAssetsExpense({
        accountId: ACCOUNT_ID,
        amount: 0,
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow('Amount must be greater than 0');
  });
});
