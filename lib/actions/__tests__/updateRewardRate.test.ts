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

import { updateRewardRate } from '@/lib/actions/reward-actions';

const USER_ID = 'user-1';

function createSupabaseMock() {
  const calls = {
    upsertPayload: null as Record<string, unknown> | null,
    upsertOptions: null as Record<string, unknown> | null,
  };

  const rewardRatesTable = {
    upsert: vi.fn(
      (
        payload: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        calls.upsertPayload = payload;
        calls.upsertOptions = options;
        return Promise.resolve({ error: null });
      },
    ),
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
        if (table === 'reward_rates') return rewardRatesTable;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

describe('updateRewardRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts reward rate and revalidates account pages', async () => {
    const { calls, supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    const result = await updateRewardRate({
      rewardCurrency: 'MR',
      usdPer10kPoints: 180,
    });

    expect(result).toEqual({
      rewardCurrency: 'MR',
      usdPer10kPoints: 180,
    });
    expect(calls.upsertPayload).toMatchObject({
      user_id: USER_ID,
      reward_currency: 'MR',
      usd_per_10k_points: 180,
    });
    expect(calls.upsertOptions).toEqual({ onConflict: 'user_id,reward_currency' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/accounts/[id]', 'page');
  });

  it('rejects invalid rate values', async () => {
    const { supabase } = createSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase);

    await expect(
      updateRewardRate({
        rewardCurrency: 'MR',
        usdPer10kPoints: -1,
      }),
    ).rejects.toThrow();
  });
});
