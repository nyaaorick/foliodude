import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
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

import { createTransfer } from '@/lib/actions/createTransfer';

const USER_ID = 'user-1';
const FROM_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const TO_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

interface MockAccountRow {
  id: string;
  user_id: string;
  type: AccountType;
  currency: string;
  balance: number;
}

interface MockResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface CreateSupabaseMockOptions {
  user?: { id: string } | null;
  accountRows?: MockAccountRow[];
  accountSelectResult?: MockResult<MockAccountRow[]>;
  insertResult?: MockResult<Record<string, unknown>>;
  updateResults?: Array<MockResult<Record<string, unknown>>>;
}

function makeAccount(
  id: string,
  type: AccountType,
  balance: number,
  currency = 'USD',
  userId = USER_ID,
): MockAccountRow {
  return {
    id,
    user_id: userId,
    type,
    currency,
    balance,
  };
}

function makeTransactionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    user_id: USER_ID,
    type: TransactionType.TRANSFER,
    amount: 25.5,
    currency: 'USD',
    from_account: FROM_ACCOUNT_ID,
    to_account: TO_ACCOUNT_ID,
    category: null,
    memo: 'rent',
    transaction_at: '2026-03-16T00:00:00.000Z',
    created_at: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

function createSupabaseMock({
  user = { id: USER_ID },
  accountRows = [],
  accountSelectResult,
  insertResult = { data: makeTransactionRow(), error: null },
  updateResults = [
    { data: { id: 'from-1' }, error: null },
    { data: { id: 'to-1' }, error: null },
  ],
}: CreateSupabaseMockOptions = {}) {
  const calls = {
    insertedTransaction: null as Record<string, unknown> | null,
    accountUpdates: [] as Array<{
      payload: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>,
  };

  let updateIndex = 0;

  const accountsTable = {
    select: vi.fn(() => {
      const filters: Record<string, unknown> = {};

      return {
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        in(key: string, values: string[]) {
          filters[key] = values;

          if (accountSelectResult) {
            return Promise.resolve(accountSelectResult);
          }

          const rows = accountRows.filter((row) => {
            const matchesUser =
              filters.user_id === undefined || row.user_id === filters.user_id;
            const matchesId = values.includes(row.id);
            return matchesUser && matchesId;
          });

          return Promise.resolve({ data: rows, error: null });
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
          const result = updateResults[updateIndex] ?? {
            data: null,
            error: null,
          };
          updateIndex += 1;
          return Promise.resolve(result);
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
          return Promise.resolve(insertResult);
        },
      };
    }),
  };

  return {
    calls,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user },
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

describe('createTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthorized when the user is missing', async () => {
    const { supabase } = createSupabaseMock({ user: null });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects invalid input before hitting the database', async () => {
    const { supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: 'not-a-uuid',
        toAccountId: TO_ACCOUNT_ID,
        amount: 0,
        memo: 'test',
      }),
    ).rejects.toThrow();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects transfers where an account is missing', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100)],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('One or more accounts were not found');
  });

  it('rejects transfers from non-asset accounts', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.LIABILITY, -100),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 50),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('Source account must be an asset account');
  });

  it('rejects cross-currency transfers without a target amount', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100, 'USD'),
        makeAccount(TO_ACCOUNT_ID, AccountType.LIABILITY, -50, 'EUR'),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('Target amount is required for cross-currency transfers');
  });

  it('rejects insufficient balances', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 9.99),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 0),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('Insufficient balance');
  });

  it('creates an asset-to-asset transfer and revalidates both account pages', async () => {
    const { supabase, calls } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 25),
      ],
      insertResult: {
        data: makeTransactionRow({
          from_account: FROM_ACCOUNT_ID,
          to_account: TO_ACCOUNT_ID,
        }),
        error: null,
      },
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createTransfer({
      fromAccountId: FROM_ACCOUNT_ID,
      toAccountId: TO_ACCOUNT_ID,
      amount: 25.5,
      memo: 'Savings top-up',
    });

    expect(result.transaction).toBeDefined();
    expect(calls.insertedTransaction).toMatchObject({
      amount: 25.5,
      currency: 'USD',
      from_account: FROM_ACCOUNT_ID,
      to_account: TO_ACCOUNT_ID,
      memo: 'Savings top-up',
      type: TransactionType.TRANSFER,
      user_id: USER_ID,
    });
    expect(calls.accountUpdates).toEqual([
      {
        payload: { balance: 74.5 },
        filters: {
          id: FROM_ACCOUNT_ID,
          user_id: USER_ID,
          balance: 100,
        },
      },
      {
        payload: { balance: 50.5 },
        filters: {
          id: TO_ACCOUNT_ID,
          user_id: USER_ID,
          balance: 25,
        },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/accounts/${FROM_ACCOUNT_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/accounts/${TO_ACCOUNT_ID}`);
  });

  it('creates an asset-to-liability repayment', async () => {
    const { supabase, calls } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 200),
        makeAccount(TO_ACCOUNT_ID, AccountType.LIABILITY, -60),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createTransfer({
      fromAccountId: FROM_ACCOUNT_ID,
      toAccountId: TO_ACCOUNT_ID,
      amount: 25.5,
      memo: 'Card payment',
    });

    expect(result.transaction).toBeDefined();
    expect(calls.accountUpdates[0]?.payload).toEqual({ balance: 174.5 });
    expect(calls.accountUpdates[1]?.payload).toEqual({ balance: -34.5 });
  });

  it('creates a cross-currency transfer using the target amount', async () => {
    const { supabase, calls } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 1000, 'HKD'),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 25, 'USD'),
      ],
      insertResult: {
        data: makeTransactionRow({
          amount: 100,
          currency: 'HKD',
          from_account: FROM_ACCOUNT_ID,
          to_account: TO_ACCOUNT_ID,
        }),
        error: null,
      },
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createTransfer({
      fromAccountId: FROM_ACCOUNT_ID,
      toAccountId: TO_ACCOUNT_ID,
      amount: 100,
      targetAmount: 12.82,
      memo: 'FX transfer',
    });

    expect(result.transaction).toBeDefined();
    expect(calls.insertedTransaction).toMatchObject({
      amount: 100,
      currency: 'HKD',
      metadata: {
        source_currency: 'HKD',
        target_currency: 'USD',
        target_amount: 12.82,
        implied_exchange_rate: 0.1282,
      },
    });
    expect(calls.accountUpdates).toEqual([
      {
        payload: { balance: 900 },
        filters: {
          id: FROM_ACCOUNT_ID,
          user_id: USER_ID,
          balance: 1000,
        },
      },
      {
        payload: { balance: 37.82 },
        filters: {
          id: TO_ACCOUNT_ID,
          user_id: USER_ID,
          balance: 25,
        },
      },
    ]);
  });

  it('returns insert errors without updating balances', async () => {
    const { supabase, calls } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 25),
      ],
      insertResult: {
        data: null,
        error: { message: 'insert failed' },
      },
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('insert failed');
    expect(calls.accountUpdates).toEqual([]);
  });

  it('returns a concurrency error when the source update affects no rows', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100),
        makeAccount(TO_ACCOUNT_ID, AccountType.ASSET, 25),
      ],
      updateResults: [
        { data: null, error: null },
        { data: { id: 'to-1' }, error: null },
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('Source balance changed, please retry');
  });

  it('returns target update errors after the source update succeeds', async () => {
    const { supabase } = createSupabaseMock({
      accountRows: [
        makeAccount(FROM_ACCOUNT_ID, AccountType.ASSET, 100),
        makeAccount(TO_ACCOUNT_ID, AccountType.LIABILITY, -20),
      ],
      updateResults: [
        { data: { id: 'from-1' }, error: null },
        { data: null, error: { message: 'target update failed' } },
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createTransfer({
        fromAccountId: FROM_ACCOUNT_ID,
        toAccountId: TO_ACCOUNT_ID,
        amount: 10,
        memo: 'test',
      }),
    ).rejects.toThrow('target update failed');
  });
});
