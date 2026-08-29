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

import { createAssetBalanceAdjustment } from '@/lib/actions/createAssetBalanceAdjustment';

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
            data: { id: 'adjustment-1' },
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

describe('createAssetBalanceAdjustment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates positive adjustments as income and increases balance', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock({
      balance: 100,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createAssetBalanceAdjustment({
      accountId: ACCOUNT_ID,
      amount: 25,
      memo: 'Top up',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toEqual({ transaction_id: 'adjustment-1' });
    expect(insertedTransactions[0]).toMatchObject({
      user_id: USER_ID,
      type: 'INCOME',
      amount: 25,
      currency: 'USD',
      reward_currency: null,
      metadata: { kind: 'asset_balance_adjustment' },
      reference_transaction_id: null,
      from_account: null,
      to_account: ACCOUNT_ID,
      category: 'Balance Adjustment',
      memo: 'Top up',
      transaction_at: '2026-03-16T00:00:00.000Z',
    });
    expect(accountUpdates).toEqual([{ balance: 125 }]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/accounts/${ACCOUNT_ID}`);
  });

  it('creates negative adjustments as expense and decreases balance', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock({
      balance: 100,
    });
    mockCreateClient.mockResolvedValue(supabase);

    await createAssetBalanceAdjustment({
      accountId: ACCOUNT_ID,
      amount: -7.25,
      memo: 'Correction',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(insertedTransactions[0]).toMatchObject({
      type: 'EXPENSE',
      amount: 7.25,
      from_account: ACCOUNT_ID,
      to_account: null,
      category: 'Balance Adjustment',
      metadata: { kind: 'asset_balance_adjustment' },
    });
    expect(accountUpdates).toEqual([{ balance: 92.75 }]);
  });

  it('rejects zero amount', async () => {
    const { supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createAssetBalanceAdjustment({
        accountId: ACCOUNT_ID,
        amount: 0,
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow('Amount must not be 0');
  });

  it('rejects non-asset accounts', async () => {
    const { supabase } = createSupabaseMock({
      accountType: AccountType.LIABILITY,
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createAssetBalanceAdjustment({
        accountId: ACCOUNT_ID,
        amount: 10,
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow('Account must be an asset account');
  });
});
