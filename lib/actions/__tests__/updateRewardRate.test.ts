import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { getRewardRates, updateRewardRate } from '@/lib/actions/reward-actions';
import { createTestContext } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('updateRewardRate', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('inserts a new rate', async () => {
    const result = await updateRewardRate({ rewardCurrency: 'MR', usdPer10kPoints: 180 });
    expect(result).toEqual({ rewardCurrency: 'MR', usdPer10kPoints: 180 });
    expect((await getRewardRates()).MR).toBe(180);
  });

  it('upserts — a second call for the same currency overwrites, not duplicates', async () => {
    await updateRewardRate({ rewardCurrency: 'MR', usdPer10kPoints: 180 });
    await updateRewardRate({ rewardCurrency: 'MR', usdPer10kPoints: 200 });

    const { rows } = await ctx.db.query(
      "SELECT count(*)::int AS n FROM reward_rates WHERE reward_currency = 'MR'",
    );
    expect((rows[0] as { n: number }).n).toBe(1);
    expect((await getRewardRates()).MR).toBe(200);
  });

  it('rejects negative rate values', async () => {
    await expect(updateRewardRate({ rewardCurrency: 'MR', usdPer10kPoints: -1 })).rejects.toThrow();
  });
});
