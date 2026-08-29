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

import { updateMileageRate } from '@/lib/actions/mileage-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(accountType = 'AIRLINE_MILES') {
  const calls = {
    accountUpdate: null as Record<string, unknown> | null,
  };

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: { id: ACCOUNT_ID, type: accountType },
        error: null,
      }),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      calls.accountUpdate = payload;
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

  return {
    calls,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'accounts') return accountsTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('updateMileageRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the mileage valuation rate for airline mileage accounts', async () => {
    const { calls, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateMileageRate({
      accountId: ACCOUNT_ID,
      usdPer10kMiles: 120,
    });

    expect(result).toEqual({
      success: true,
      data: {
        accountId: ACCOUNT_ID,
        usdPer10kMiles: 120,
      },
    });
    expect(calls.accountUpdate).toEqual({ usd_per_10k_miles: 120 });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/accounts/${ACCOUNT_ID}`);
  });

  it('rejects non-mileage accounts', async () => {
    const { supabase } = createSupabaseMock('LIABILITY');
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateMileageRate({
      accountId: ACCOUNT_ID,
      usdPer10kMiles: 120,
    });

    expect(result).toEqual({
      success: false,
      error: 'Mileage rates are only supported on airline mileage accounts',
    });
  });
});
