import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { transferRewardsToMileageAccount } from '@/lib/actions/mileage-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('transferRewardsToMileageAccount', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('combines two source cards into one mileage transfer at the configured rate', async () => {
    const mileageId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER',
      transfer_rates: { MR: 1 },
    });
    const card1 = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR', reward_balance: 1000 });
    const card2 = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR', reward_balance: 500 });

    const result = await transferRewardsToMileageAccount({
      mileageAccountId: mileageId,
      sources: [{ accountId: card1, points: 800 }, { accountId: card2, points: 200 }],
      date: '2026-03-16',
    });

    expect(result).toEqual({
      success: true,
      data: { transaction: expect.objectContaining({ type: 'MILEAGE_TRANSFER_IN', amount: 1000 }), transferredMiles: 1000 },
    });
    expect((await getAccount(ctx.db, mileageId)).balance).toBe(1000);
    expect((await getAccount(ctx.db, card1)).reward_balance).toBe(200);
    expect((await getAccount(ctx.db, card2)).reward_balance).toBe(300);
  });

  it('rejects a transfer when a source balance is insufficient', async () => {
    const mileageId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', transfer_rates: { MR: 1 },
    });
    const card = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR', reward_balance: 100 });

    const result = await transferRewardsToMileageAccount({
      mileageAccountId: mileageId, sources: [{ accountId: card, points: 500 }], date: '2026-03-16',
    });

    expect(result).toEqual({ success: false, error: 'Insufficient reward balance' });
  });
});
