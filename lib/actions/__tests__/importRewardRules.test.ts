import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { applyCloudRewardRules, importRewardRules } from '@/lib/actions/reward-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('importRewardRules', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('replaces existing rules with imported rules and normalizes the source to imported', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_rules: [{ category: 'Old', multiplier: 1, rule_source: 'manual' }],
    });

    const result = await importRewardRules({
      accountId,
      ruleSet: {
        id: 'local-json',
        name: 'Local Import',
        source: 'imported',
        version: 1,
        rules: [{ category: 'Dining', multiplier: 3, currency: 'MR', rule_source: 'cloud' }],
      },
    });

    expect(result).toMatchObject({ source: 'imported', rules: [{ category: 'Dining', rule_source: 'imported' }] });
    // Old rules are gone entirely — this is a replace, not a merge.
    const stored = (await getAccount(ctx.db, accountId)).reward_rules as Array<{ category: string }>;
    expect(stored).toEqual([expect.objectContaining({ category: 'Dining', rule_source: 'imported' })]);
  });

  it('applies a cloud preset by id', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY' });

    const result = await applyCloudRewardRules({ accountId, ruleSetId: 'amex-gold-core' });

    expect(result).toMatchObject({ id: 'amex-gold-core', source: 'cloud' });
    const stored = (await getAccount(ctx.db, accountId)).reward_rules as unknown[];
    expect(stored.length).toBeGreaterThan(0);
  });

  it('rejects an unknown cloud rule set id', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY' });
    await expect(applyCloudRewardRules({ accountId, ruleSetId: 'nonexistent' })).rejects.toThrow(
      'Cloud reward rule set not found',
    );
  });
});
