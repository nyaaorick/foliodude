import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { createMileageManualIn } from '@/lib/actions/mileage-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('createMileageManualIn', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('records a manual mileage credit and increases the balance', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 1000,
    });

    const result = await createMileageManualIn({
      accountId, miles: 500, sourceDescription: 'Hotel promo', date: '2026-03-16',
    });

    expect(result.transaction).toMatchObject({ type: 'MILEAGE_MANUAL_IN', amount: 500, to_account: accountId });
    expect((await getAccount(ctx.db, accountId)).balance).toBe(1500);
  });

  it('rejects a non-mileage account', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });
    await expect(
      createMileageManualIn({ accountId, miles: 100, sourceDescription: 'x', date: '2026-03-16' }),
    ).rejects.toThrow('Manual mileage transfers are only supported on airline mileage accounts');
  });
});
