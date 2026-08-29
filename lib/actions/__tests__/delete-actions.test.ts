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

import {
  deleteAccount,
  deleteAction,
  deleteTransaction,
} from '@/lib/actions/delete-actions';

const USER_ID = 'user-1';

type TransactionRow = {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  from_account: string | null;
  to_account: string | null;
  reference_transaction_id: string | null;
  category: string | null;
  transaction_at: string;
  created_at: string;
  memo: string | null;
  metadata: unknown;
  share_quantity: number | null;
  share_price: number | null;
};

type AccountRow = {
  id: string;
  user_id: string;
  type: AccountType;
  balance: number;
  reward_balance: number;
  reward_rules: Array<{
    category: string;
    multiplier: number;
    rule_source: 'manual' | 'imported' | 'cloud';
    cap_period?: 'annual' | 'monthly';
  }>;
  spend_stats: Record<string, number>;
  shares: number;
  cost_basis: number;
  last_price: number | null;
};

function makeTransaction(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 'tx-1',
    user_id: USER_ID,
    type: TransactionType.REWARD_TRANSFER_IN,
    amount: 100,
    from_account: null,
    to_account: null,
    reference_transaction_id: null,
    category: null,
    transaction_at: '2026-03-19T00:00:00.000Z',
    created_at: '2026-03-19T00:00:00.000Z',
    memo: null,
    metadata: {},
    share_quantity: null,
    share_price: null,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'account-1',
    user_id: USER_ID,
    type: AccountType.ASSET,
    balance: 0,
    reward_balance: 0,
    reward_rules: [],
    spend_stats: {},
    shares: 0,
    cost_basis: 0,
    last_price: null,
    ...overrides,
  };
}

function createSupabaseMock({
  transactions,
  accounts,
}: {
  transactions: TransactionRow[];
  accounts: AccountRow[];
}) {
  const transactionRows = [...transactions];
  const accountRows = [...accounts];
  const calls = {
    accountUpdates: [] as Record<string, unknown>[],
    transactionUpdates: [] as Record<string, unknown>[],
  };

  const parseOrAccountId = (expr: string) => expr.split('.eq.')[1]?.split(',')[0] ?? '';

  const filterRows = <T extends Record<string, unknown>>(
    rows: T[],
    filters: {
      eq: Record<string, unknown>;
      in: Record<string, unknown[]>;
      orAccountId?: string;
    },
  ) =>
    rows.filter((row) => {
      for (const [field, value] of Object.entries(filters.eq)) {
        if (row[field] !== value) return false;
      }

      for (const [field, values] of Object.entries(filters.in)) {
        if (!values.includes(row[field])) return false;
      }

      if (filters.orAccountId) {
        return (
          row.from_account === filters.orAccountId ||
          row.to_account === filters.orAccountId
        );
      }

      return true;
    });

  const createSelectBuilder = <T extends Record<string, unknown>>(rows: T[]) => {
    const filters = {
      eq: {} as Record<string, unknown>,
      in: {} as Record<string, unknown[]>,
      orAccountId: undefined as string | undefined,
      order: [] as Array<{ field: string; ascending: boolean }>,
      limit: undefined as number | undefined,
    };

    const applySortAndLimit = (input: T[]) => {
      let output = [...input];

      for (const orderRule of filters.order) {
        output = output.sort((a, b) => {
          const av = String(a[orderRule.field] ?? '');
          const bv = String(b[orderRule.field] ?? '');
          if (av === bv) return 0;
          if (orderRule.ascending) return av < bv ? -1 : 1;
          return av > bv ? -1 : 1;
        });
      }

      if (typeof filters.limit === 'number') {
        output = output.slice(0, filters.limit);
      }

      return output;
    };

    const builder = {
      eq(field: string, value: unknown) {
        filters.eq[field] = value;
        return builder;
      },
      in(field: string, values: unknown[]) {
        filters.in[field] = values;
        return builder;
      },
      or(expr: string) {
        filters.orAccountId = parseOrAccountId(expr);
        return builder;
      },
      order(field: string, options?: { ascending?: boolean }) {
        filters.order.push({ field, ascending: options?.ascending ?? true });
        return builder;
      },
      limit(value: number) {
        filters.limit = value;
        return builder;
      },
      returns<U>() {
        return builder as unknown as Promise<{ data: U; error: null }>;
      },
      maybeSingle() {
        const data = applySortAndLimit(filterRows(rows, filters))[0] ?? null;
        return Promise.resolve({ data, error: null });
      },
      single() {
        const data = applySortAndLimit(filterRows(rows, filters))[0] ?? null;
        return Promise.resolve({
          data,
          error: data ? null : { message: 'Not found' },
        });
      },
      then(resolve: (value: { data: T[]; error: null }) => void) {
        resolve({
          data: applySortAndLimit(filterRows(rows, filters)),
          error: null,
        });
      },
    };

    return builder;
  };

  const createUpdateBuilder = <T extends Record<string, unknown>>(
    rows: T[],
    payload: Record<string, unknown>,
    collector: Record<string, unknown>[],
  ) => {
    const filters = { eq: {} as Record<string, unknown> };

    const builder = {
      eq(field: string, value: unknown) {
        filters.eq[field] = value;
        return builder;
      },
      then(resolve: (value: { error: null }) => void) {
        collector.push({ ...payload, filters: { ...filters.eq } });
        for (const row of rows) {
          const matched = Object.entries(filters.eq).every(
            ([field, value]) => row[field] === value,
          );
          if (matched) Object.assign(row, payload);
        }
        resolve({ error: null });
      },
    };

    return builder;
  };

  const createDeleteBuilder = <T extends Record<string, unknown>>(rows: T[]) => {
    const filters = { eq: {} as Record<string, unknown>, in: {} as Record<string, unknown[]> };

    const builder = {
      eq(field: string, value: unknown) {
        filters.eq[field] = value;
        return builder;
      },
      in(field: string, values: unknown[]) {
        filters.in[field] = values;
        return builder;
      },
      then(resolve: (value: { error: null }) => void) {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          const matchesEq = Object.entries(filters.eq).every(
            ([field, value]) => row[field] === value,
          );
          const matchesIn = Object.entries(filters.in).every(([field, values]) =>
            values.includes(row[field]),
          );

          if (matchesEq && matchesIn) rows.splice(index, 1);
        }
        resolve({ error: null });
      },
    };

    return builder;
  };

  return {
    calls,
    transactionRows,
    accountRows,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn(() => createSelectBuilder(transactionRows)),
            update: vi.fn((payload: Record<string, unknown>) =>
              createUpdateBuilder(transactionRows, payload, calls.transactionUpdates),
            ),
            delete: vi.fn(() => createDeleteBuilder(transactionRows)),
          };
        }

        if (table === 'accounts') {
          return {
            select: vi.fn(() => createSelectBuilder(accountRows)),
            update: vi.fn((payload: Record<string, unknown>) =>
              createUpdateBuilder(accountRows, payload, calls.accountUpdates),
            ),
            delete: vi.fn(() => createDeleteBuilder(accountRows)),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('deleteAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides a standalone transfer by appending the memo marker', async () => {
    const { supabase, calls, accountRows, transactionRows } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'transfer-1',
          type: TransactionType.TRANSFER,
          amount: 100,
          from_account: 'cash-1',
          to_account: 'cash-2',
          memo: 'Rent split',
        }),
      ],
      accounts: [
        makeAccount({ id: 'cash-1', balance: 900 }),
        makeAccount({ id: 'cash-2', balance: 400 }),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAction({ kind: 'transaction', id: 'transfer-1' });

    expect(result).toEqual({ success: true, data: null });
    expect(transactionRows.find((row) => row.id === 'transfer-1')?.memo).toBe(
      'Rent split [HIDDEN]',
    );
    expect(accountRows.find((row) => row.id === 'cash-1')?.balance).toBe(900);
    expect(accountRows.find((row) => row.id === 'cash-2')?.balance).toBe(400);
    expect(calls.accountUpdates).toHaveLength(0);
  });

  it('deleteTransaction delegates to transaction hiding', async () => {
    const { supabase, calls, accountRows, transactionRows } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'transfer-wrapper',
          type: TransactionType.TRANSFER,
          amount: 40,
          from_account: 'cash-1',
          to_account: 'cash-2',
        }),
      ],
      accounts: [
        makeAccount({ id: 'cash-1', balance: 160 }),
        makeAccount({ id: 'cash-2', balance: 90 }),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteTransaction('transfer-wrapper');

    expect(result).toEqual({ success: true, data: null });
    expect(transactionRows.find((row) => row.id === 'transfer-wrapper')?.memo).toBe(
      '[HIDDEN]',
    );
    expect(accountRows.find((row) => row.id === 'cash-1')?.balance).toBe(160);
    expect(accountRows.find((row) => row.id === 'cash-2')?.balance).toBe(90);
    expect(calls.accountUpdates).toHaveLength(0);
  });

  it('hides an expense together with its linked reward earn transaction', async () => {
    const { supabase, calls, accountRows, transactionRows } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'expense-1',
          type: TransactionType.EXPENSE,
          amount: 20,
          from_account: 'card-1',
          category: 'Dining',
        }),
        makeTransaction({
          id: 'reward-1',
          type: TransactionType.REWARD_EARN,
          amount: 20,
          reference_transaction_id: 'expense-1',
          to_account: 'card-1',
        }),
      ],
      accounts: [makeAccount({ id: 'card-1', balance: -20, reward_balance: 20 })],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAction({ kind: 'transaction', id: 'expense-1' });

    expect(result).toEqual({ success: true, data: null });
    expect(transactionRows.find((row) => row.id === 'expense-1')?.memo).toBe('[HIDDEN]');
    expect(transactionRows.find((row) => row.id === 'reward-1')?.memo).toBe('[HIDDEN]');
    expect(accountRows.find((row) => row.id === 'card-1')?.balance).toBe(-20);
    expect(accountRows.find((row) => row.id === 'card-1')?.reward_balance).toBe(20);
    expect(calls.accountUpdates).toHaveLength(0);
  });

  it('does not append the memo marker twice', async () => {
    const { supabase, transactionRows } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'hidden-income',
          type: TransactionType.INCOME,
          to_account: 'cash-1',
          memo: 'Already hidden [HIDDEN]',
        }),
      ],
      accounts: [makeAccount({ id: 'cash-1', balance: 125 })],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAction({ kind: 'transaction', id: 'hidden-income' });

    expect(result).toEqual({ success: true, data: null });
    expect(transactionRows.find((row) => row.id === 'hidden-income')?.memo).toBe(
      'Already hidden [HIDDEN]',
    );
  });

  it('deleteAccount delegates to account deletion', async () => {
    const { supabase, calls, accountRows, transactionRows } = createSupabaseMock({
      transactions: [],
      accounts: [makeAccount({ id: 'account-wrapper', balance: 500 })],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAccount('account-wrapper');

    expect(result).toEqual({ success: true, data: null });
    expect(accountRows).toHaveLength(0);
    expect(transactionRows).toHaveLength(0);
    expect(calls.accountUpdates).toHaveLength(0);
  });

  it('rejects deleting a non-latest share trade', async () => {
    const { supabase } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'buy-old',
          type: TransactionType.SHARE_BUY,
          amount: 500,
          from_account: 'cash-1',
          to_account: 'share-1',
          share_quantity: 5,
          share_price: 100,
          transaction_at: '2026-03-18T00:00:00.000Z',
          created_at: '2026-03-18T00:00:00.000Z',
        }),
        makeTransaction({
          id: 'buy-new',
          type: TransactionType.SHARE_BUY,
          amount: 300,
          from_account: 'cash-1',
          to_account: 'share-1',
          share_quantity: 3,
          share_price: 100,
          transaction_at: '2026-03-19T00:00:00.000Z',
          created_at: '2026-03-19T00:00:00.000Z',
        }),
      ],
      accounts: [
        makeAccount({ id: 'cash-1', type: AccountType.ASSET, balance: 200 }),
        makeAccount({
          id: 'share-1',
          type: AccountType.SHARE,
          balance: 800,
          shares: 8,
          cost_basis: 800,
          last_price: 100,
        }),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAction({ kind: 'transaction', id: 'buy-old' });

    expect(result).toEqual({
      success: false,
      error: 'Delete action only supports deleting the latest share trade',
    });
  });

  it('deletes account transactions without updating counterpart balances', async () => {
    const { supabase, calls, accountRows, transactionRows } = createSupabaseMock({
      transactions: [
        makeTransaction({
          id: 'transfer-1',
          type: TransactionType.TRANSFER,
          amount: 200,
          from_account: 'cash-1',
          to_account: 'card-1',
        }),
        makeTransaction({
          id: 'buy-1',
          type: TransactionType.SHARE_BUY,
          amount: 300,
          from_account: 'cash-1',
          to_account: 'share-1',
          share_quantity: 3,
          share_price: 100,
        }),
      ],
      accounts: [
        makeAccount({ id: 'cash-1', type: AccountType.ASSET, balance: 500 }),
        makeAccount({ id: 'card-1', type: AccountType.LIABILITY, balance: -200 }),
        makeAccount({
          id: 'share-1',
          type: AccountType.SHARE,
          balance: 300,
          shares: 3,
          cost_basis: 300,
          last_price: 100,
        }),
      ],
    });
    mockCreateClient.mockResolvedValue(supabase);

    const result = await deleteAction({ kind: 'account', id: 'cash-1' });

    expect(result).toEqual({ success: true, data: null });
    expect(accountRows.find((row) => row.id === 'card-1')?.balance).toBe(-200);
    expect(accountRows.find((row) => row.id === 'share-1')?.shares).toBe(3);
    expect(transactionRows).toHaveLength(0);
    expect(accountRows.find((row) => row.id === 'cash-1')).toBeUndefined();
    expect(calls.accountUpdates).toHaveLength(0);
  });
});
