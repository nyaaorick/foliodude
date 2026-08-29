import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateClient,
  mockRevalidatePath,
  mockCreateTransaction,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockCreateTransaction: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock('@/lib/actions/createTransaction', () => ({
  createTransaction: mockCreateTransaction,
}));

import { redeemMileageFlight } from '@/lib/actions/mileage-actions';

const USER_ID = 'user-1';
const MILEAGE_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const TAX_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function createSupabaseMock(mileageBalance = 20000, taxAccountType = 'LIABILITY') {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn((columns: string) => ({
      eq() {
        return this;
      },
      single: vi.fn().mockImplementation(() => {
        if (columns.includes('balance')) {
          return Promise.resolve({
            data: {
              id: MILEAGE_ACCOUNT_ID,
              type: 'AIRLINE_MILES',
              balance: mileageBalance,
            },
            error: null,
          });
        }

        return Promise.resolve({
          data: {
            id: TAX_ACCOUNT_ID,
            name: 'Amex Gold',
            type: taxAccountType,
            currency: 'USD',
          },
          error: null,
        });
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
            data: { id: 'mileage-redeem-1', ...payload },
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

describe('redeemMileageFlight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTransaction.mockResolvedValue({
      expense_id: 'expense-1',
      reward_id: null,
      reward_points: 0,
    });
  });

  it('creates a flight redemption plus linked tax expense', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await redeemMileageFlight({
      mileageAccountId: MILEAGE_ACCOUNT_ID,
      ticketName: 'Tokyo round trip 2026-03',
      miles: 10000,
      taxAccountId: TAX_ACCOUNT_ID,
      taxAmount: 123.45,
      taxCurrency: 'USD',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      accountId: TAX_ACCOUNT_ID,
      category: 'Travel',
      amount: 123.45,
      memo: 'Tokyo round trip 2026-03',
      date: '2026-03-16T00:00:00.000Z',
    });
    expect(insertedTransactions[0]).toMatchObject({
      type: 'MILEAGE_REDEEM_FLIGHT',
      amount: 10000,
      from_account: MILEAGE_ACCOUNT_ID,
      metadata: {
        ticket_name: 'Tokyo round trip 2026-03',
        tax_expense_transaction_id: 'expense-1',
      },
    });
    expect(accountUpdates[0]).toEqual({ balance: 10000 });
  });

  it('rejects non-liability tax accounts', async () => {
    const { supabase } = createSupabaseMock(20000, 'ASSET');
    mockCreateClient.mockResolvedValue(supabase);

    const result = await redeemMileageFlight({
      mileageAccountId: MILEAGE_ACCOUNT_ID,
      ticketName: 'Tokyo round trip 2026-03',
      miles: 10000,
      taxAccountId: TAX_ACCOUNT_ID,
      taxAmount: 123.45,
      taxCurrency: 'USD',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result).toEqual({
      success: false,
      error: 'Tax payment account must be a liability account',
    });
  });
});
