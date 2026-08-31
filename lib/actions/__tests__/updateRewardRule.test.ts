import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { updateRewardRule } from '@/lib/actions/reward-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('updateRewardRule', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('appends a new category rule and marks it manual', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY', reward_rules: [] });

    const result = await updateRewardRule({
      accountId,
      category: 'Dining',
      multiplier: 4,
      cap_amount: 2500,
      cap_period: 'annual',
      fallback_rate: 1,
    });

    expect(result).toMatchObject({
      category: 'Dining',
      multiplier: 4,
      rule_source: 'manual',
      cap_amount: 2500,
      cap_period: 'annual',
      fallback_rate: 1,
    });
    expect((await getAccount(ctx.db, accountId)).reward_rules).toEqual([result]);
  });

  it('replaces the existing rule for the same category rather than appending a duplicate', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_rules: [
        { category: 'Dining', multiplier: 4, rule_source: 'imported', cap_amount: 2500, cap_period: 'annual', fallback_rate: 1 },
        { category: 'Travel', multiplier: 3, rule_source: 'cloud' },
      ],
    });

    await updateRewardRule({ accountId, category: 'Dining', multiplier: 5, cap_amount: 2500, cap_period: 'annual', fallback_rate: 1 });

    const rules = (await getAccount(ctx.db, accountId)).reward_rules as Array<{ category: string; multiplier: number; rule_source: string }>;
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.category === 'Dining')).toMatchObject({ multiplier: 5, rule_source: 'manual' });
    // Sibling category untouched.
    expect(rules.find((r) => r.category === 'Travel')).toMatchObject({ multiplier: 3, rule_source: 'cloud' });
  });

  it('marks a rule edited from a cloud preset as manual', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_rules: [{ category: 'Travel', multiplier: 3, rule_source: 'cloud' }],
    });

    const result = await updateRewardRule({ accountId, category: 'Travel', multiplier: 6 });
    expect(result.rule_source).toBe('manual');
  });

  it('rejects a non-liability account', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });
    await expect(
      updateRewardRule({ accountId, category: 'Dining', multiplier: 4 }),
    ).rejects.toThrow('Reward actions are only supported on liability accounts');
  });
});
