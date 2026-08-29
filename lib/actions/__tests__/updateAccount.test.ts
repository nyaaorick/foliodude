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

import {
  setAssetApy,
  updateAccount,
} from '@/lib/actions/update-accounts-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(
  accountType: AccountType,
  autoPayConfig: Record<string, unknown> | null = null,
) {
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: {
          id: ACCOUNT_ID,
          type: accountType,
          auto_pay_config: autoPayConfig,
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
        select() {
          return this;
        },
        single() {
          return Promise.resolve({
            data: {
              id: ACCOUNT_ID,
              name: payload.name,
              balance: payload.balance ?? 0,
              auto_pay_config: payload.auto_pay_config ?? autoPayConfig,
            },
            error: null,
          });
        },
      };
    }),
  };

  return {
    accountUpdates,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'accounts') {
          return accountsTable;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('updateAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports name-only edits', async () => {
    const { accountUpdates, supabase } = createSupabaseMock(AccountType.ASSET);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateAccount({
      id: ACCOUNT_ID,
      name: 'Renamed Account',
    });

    expect(result).toMatchObject({
      id: ACCOUNT_ID,
      name: 'Renamed Account',
      balance: 0,
    });
    expect(accountUpdates[0]).toEqual({
      name: 'Renamed Account',
    });
  });

  it('supports decimal balance edits for money accounts', async () => {
    const { accountUpdates, supabase } = createSupabaseMock(AccountType.LIABILITY);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateAccount({
      id: ACCOUNT_ID,
      name: 'Card',
      balance: -123.45,
    });

    expect(result).toMatchObject({
      id: ACCOUNT_ID,
      name: 'Card',
      balance: -123.45,
    });
    expect(accountUpdates[0]).toEqual({
      name: 'Card',
      balance: -123.45,
    });
  });

  it('rejects fractional mileage balances', async () => {
    const { supabase } = createSupabaseMock(AccountType.AIRLINE_MILES);
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      updateAccount({
        id: ACCOUNT_ID,
        name: 'Miles',
        balance: 1234.5,
      }),
    ).rejects.toThrow('Mileage balances must be whole numbers');
  });

  it('rejects share balance edits', async () => {
    const { supabase } = createSupabaseMock(AccountType.SHARE);
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      updateAccount({
        id: ACCOUNT_ID,
        name: 'Brokerage',
        balance: 5000,
      }),
    ).rejects.toThrow('Share account balances cannot be edited directly');
  });

  it('sets asset APY by updating auto_pay_config.asset_apy', async () => {
    const { accountUpdates, supabase } = createSupabaseMock(
      AccountType.ASSET,
      { existing_flag: true },
    );
    mockCreateClient.mockResolvedValue(supabase);

    const result = await setAssetApy({
      id: ACCOUNT_ID,
      apy: 3.456,
    });

    expect(result).toEqual({
      id: ACCOUNT_ID,
      name: undefined,
      balance: 0,
      auto_pay_config: {
        existing_flag: true,
        asset_apy: 3.46,
      },
    });
    expect(accountUpdates[0]).toEqual({
      auto_pay_config: {
        existing_flag: true,
        asset_apy: 3.46,
      },
    });
  });

  it('rejects APY updates for non-asset accounts', async () => {
    const { supabase } = createSupabaseMock(AccountType.LIABILITY);
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      setAssetApy({
        id: ACCOUNT_ID,
        apy: 2.5,
      }),
    ).rejects.toThrow('APY can only be set on asset accounts');
  });
});
