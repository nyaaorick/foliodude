import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { redeemMileageFlight } from '@/lib/actions/mileage-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('redeemMileageFlight', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('redeems miles and logs the taxes as a linked expense atomically', async () => {
    const mileageId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 50000,
    });
    const card = await seedAccount(ctx, { type: 'LIABILITY', currency: 'USD' });

    const result = await redeemMileageFlight({
      mileageAccountId: mileageId, ticketName: 'SFO-NRT', miles: 30000,
      taxAccountId: card, taxAmount: 45.5, taxCurrency: 'USD', date: '2026-03-16',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.mileageTransaction).toMatchObject({ type: 'MILEAGE_REDEEM_FLIGHT', amount: 30000 });
    expect((await getAccount(ctx.db, mileageId)).balance).toBe(20000);
  });

  it('rejects a tax account that is not a liability', async () => {
    const mileageId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 50000,
    });
    const cash = await seedAccount(ctx, { type: 'ASSET', currency: 'USD' });

    const result = await redeemMileageFlight({
      mileageAccountId: mileageId, ticketName: 'SFO-NRT', miles: 30000,
      taxAccountId: cash, taxAmount: 45.5, taxCurrency: 'USD', date: '2026-03-16',
    });

    expect(result).toEqual({ success: false, error: 'Tax payment account must be a liability account' });
  });
});
