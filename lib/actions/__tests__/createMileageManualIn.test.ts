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

import { createMileageManualIn } from '@/lib/actions/mileage-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(accountType = 'AIRLINE_MILES') {
  const insertedTransactions: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: { id: ACCOUNT_ID, type: accountType, balance: 1000 },
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
            data: { id: 'mile-tx-1', ...payload },
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

describe('createMileageManualIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a manual mileage transfer and updates the balance', async () => {
    const { insertedTransactions, accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await createMileageManualIn({
      accountId: ACCOUNT_ID,
      miles: 5000,
      sourceDescription: 'Hotel transfer',
      date: '2026-03-16T00:00:00.000Z',
    });

    expect(result.transaction).toBeDefined();
    expect(insertedTransactions[0]).toMatchObject({
      type: 'MILEAGE_MANUAL_IN',
      amount: 5000,
      to_account: ACCOUNT_ID,
      metadata: { source_description: 'Hotel transfer' },
    });
    expect(accountUpdates[0]).toEqual({ balance: 6000 });
  });

  it('rejects non-mileage accounts', async () => {
    const { supabase } = createSupabaseMock('LIABILITY');
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      createMileageManualIn({
        accountId: ACCOUNT_ID,
        miles: 5000,
        sourceDescription: 'Hotel transfer',
        date: '2026-03-16T00:00:00.000Z',
      }),
    ).rejects.toThrow(
      'Manual mileage transfers are only supported on airline mileage accounts',
    );
  });
});
