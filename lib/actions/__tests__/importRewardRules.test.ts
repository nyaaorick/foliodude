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

import {
  applyCloudRewardRules,
  importRewardRules,
} from '@/lib/actions/reward-actions';

const USER_ID = 'user-1';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function createSupabaseMock() {
  const accountUpdates: Array<Record<string, unknown>> = [];

  const accountsTable = {
    select: vi.fn(() => ({
      eq() {
        return this;
      },
      single: vi.fn().mockResolvedValue({
        data: {
          id: ACCOUNT_ID,
          type: 'LIABILITY',
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

describe('importRewardRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces existing rules with imported rules and normalizes the source', async () => {
    const { accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await importRewardRules({
      accountId: ACCOUNT_ID,
      ruleSet: {
        id: 'local-json',
        name: 'Local Import',
        source: 'imported',
        version: 1,
        rules: [
          {
            category: 'Dining',
            multiplier: 3,
            currency: 'MR',
            rule_source: 'cloud',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      source: 'imported',
      rules: [
        {
          category: 'Dining',
          rule_source: 'imported',
        },
      ],
    });

    expect(accountUpdates[0]).toMatchObject({
      reward_rules: [
        {
          category: 'Dining',
          rule_source: 'imported',
        },
      ],
    });
  });

  it('replaces existing rules with a cloud preset', async () => {
    const { accountUpdates, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await applyCloudRewardRules({
      accountId: ACCOUNT_ID,
      ruleSetId: 'amex-gold-core',
    });

    expect(result).toMatchObject({
      id: 'amex-gold-core',
      source: 'cloud',
    });
    expect(accountUpdates[0]).toMatchObject({
      reward_rules: expect.arrayContaining([
        expect.objectContaining({
          rule_source: 'cloud',
        }),
      ]),
    });
  });
});
