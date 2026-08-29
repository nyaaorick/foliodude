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

import { createTransaction } from '@/lib/actions/createTransaction';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock() {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  let transactionInsertIndex = 0;

  const accountRow = {
    balance: 0,
    currency: 'USD',
    reward_currency: 'MR',
    reward_balance: 1000,
    reward_rules: [
      {
        category: 'Dining',
        multiplier: 4,
        rule_source: 'cloud',
      },
    ],
    spend_stats: {},
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
      transactionInsertIndex += 1;
      return {
        select() {
          return this;
        },
        single() {
          return Promise.resolve({
            data: { id: transactionInsertIndex === 1 ? 'expense-1' : 'reward-1' },
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

describe('createTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates reward earn transactions with reward currency and reference id', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createTransaction({
      accountId: ACCOUNT_ID,
      category: 'Dining',
      amount: 12.5,
      memo: 'Lunch',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      expense_id: 'expense-1',
      reward_id: 'reward-1',
      reward_points: 50,
    });

    expect(insertedTransactions[0]).toMatchObject({
      type: 'EXPENSE',
      currency: 'USD',
      reward_currency: null,
      reference_transaction_id: null,
      from_account: ACCOUNT_ID,
    });

    expect(insertedTransactions[1]).toMatchObject({
      type: 'REWARD_EARN',
      currency: null,
      reward_currency: 'MR',
      reference_transaction_id: 'expense-1',
      to_account: ACCOUNT_ID,
      memo: 'Lunch',
    });

    expect(accountUpdates[1]).toMatchObject({
      reward_balance: 1050,
      spend_stats: { '2026_Dining': 12.5 },
    });
  });
});
