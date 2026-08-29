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

import { updateRewardRule } from '@/lib/actions/reward-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock(
  rewardRules: Array<Record<string, unknown>> = [
    {
      category: 'Dining',
      multiplier: 4,
      rule_source: 'imported',
    },
  ],
) {
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: {
          type: 'LIABILITY',
          reward_rules: rewardRules,
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

  return {
    accountUpdates,
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

describe('updateRewardRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks edited imported rules as manual and preserves cap and basic reward rate', async () => {
    const { accountUpdates, supabase } = createSupabaseMock([
      {
        category: 'Dining',
        multiplier: 4,
        rule_source: 'imported',
        cap_amount: 2500,
        cap_period: 'annual',
        fallback_rate: 1,
      },
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateRewardRule({
      accountId: ACCOUNT_ID,
      category: 'Dining',
      multiplier: 5,
      cap_amount: 2500,
      cap_period: 'annual',
      fallback_rate: 1,
    });

    expect(result).toMatchObject({
      category: 'Dining',
      rule_source: 'manual',
      cap_amount: 2500,
      cap_period: 'annual',
      fallback_rate: 1,
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_rules: [
        {
          category: 'Dining',
          multiplier: 5,
          rule_source: 'manual',
          cap_amount: 2500,
          cap_period: 'annual',
          fallback_rate: 1,
        },
      ],
    });
  });

  it('preserves multiplier and basic reward rate when editing cap', async () => {
    const { accountUpdates, supabase } = createSupabaseMock([
      {
        category: 'Travel',
        multiplier: 3,
        rule_source: 'manual',
        cap_amount: 2000,
        cap_period: 'annual',
        fallback_rate: 1.5,
      },
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateRewardRule({
      accountId: ACCOUNT_ID,
      category: 'Travel',
      multiplier: 3,
      cap_amount: 3000,
      cap_period: 'monthly',
      fallback_rate: 1.5,
    });

    expect(result).toMatchObject({
      category: 'Travel',
      multiplier: 3,
      cap_amount: 3000,
      cap_period: 'monthly',
      fallback_rate: 1.5,
      rule_source: 'manual',
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_rules: [
        {
          category: 'Travel',
          multiplier: 3,
          cap_amount: 3000,
          cap_period: 'monthly',
          fallback_rate: 1.5,
          rule_source: 'manual',
        },
      ],
    });
  });

  it('preserves multiplier and cap when editing basic reward rate', async () => {
    const { accountUpdates, supabase } = createSupabaseMock([
      {
        category: 'Grocery',
        multiplier: 2,
        rule_source: 'manual',
        cap_amount: 1200,
        cap_period: 'annual',
        fallback_rate: 1,
      },
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateRewardRule({
      accountId: ACCOUNT_ID,
      category: 'Grocery',
      multiplier: 2,
      cap_amount: 1200,
      cap_period: 'annual',
      fallback_rate: 0.5,
    });

    expect(result).toMatchObject({
      category: 'Grocery',
      multiplier: 2,
      cap_amount: 1200,
      cap_period: 'annual',
      fallback_rate: 0.5,
      rule_source: 'manual',
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_rules: [
        {
          category: 'Grocery',
          multiplier: 2,
          cap_amount: 1200,
          cap_period: 'annual',
          fallback_rate: 0.5,
          rule_source: 'manual',
        },
      ],
    });
  });

  it('marks edited cloud rules as manual', async () => {
    const { accountUpdates, supabase } = createSupabaseMock([
      {
        category: 'Travel',
        multiplier: 3,
        rule_source: 'cloud',
        cap_amount: 1800,
        cap_period: 'annual',
        fallback_rate: 1,
      },
    ]);
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateRewardRule({
      accountId: ACCOUNT_ID,
      category: 'Travel',
      multiplier: 6,
      cap_amount: 1800,
      cap_period: 'annual',
      fallback_rate: 1,
    });

    expect(result).toMatchObject({
      category: 'Travel',
      rule_source: 'manual',
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_rules: [
        {
          category: 'Travel',
          multiplier: 6,
          cap_amount: 1800,
          cap_period: 'annual',
          fallback_rate: 1,
          rule_source: 'manual',
        },
      ],
    });
  });
});
