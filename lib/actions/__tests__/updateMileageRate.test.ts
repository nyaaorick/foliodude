import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { updateMileageRate } from '@/lib/actions/mileage-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('updateMileageRate', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('updates the mileage valuation rate', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER',
    });

    const result = await updateMileageRate({ accountId, usdPer10kMiles: 130 });

    expect(result).toEqual({ success: true, data: { accountId, usdPer10kMiles: 130 } });
    expect((await getAccount(ctx.db, accountId)).usd_per_10k_miles).toBe(130);
  });

  it('rejects a non-mileage account', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });
    const result = await updateMileageRate({ accountId, usdPer10kMiles: 100 });
    expect(result).toEqual({
      success: false,
      error: 'Mileage rates are only supported on airline mileage accounts',
    });
  });
});
