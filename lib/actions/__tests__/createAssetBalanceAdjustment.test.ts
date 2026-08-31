import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { createAssetBalanceAdjustment } from '@/lib/actions/createAssetBalanceAdjustment';
import { allTransactions, createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

const DATE = '2026-03-16';

describe('createAssetBalanceAdjustment', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('creates positive adjustments as income and increases balance', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 100 });

    const result = await createAssetBalanceAdjustment({ accountId, amount: 25, date: DATE });
    expect(result).toEqual({ transaction_id: expect.any(String) });

    expect((await allTransactions(ctx.db))[0]).toMatchObject({
      type: 'INCOME',
      amount: 25,
      category: 'Balance Adjustment',
      metadata: { kind: 'asset_balance_adjustment' },
      from_account: null,
      to_account: accountId,
    });
    expect(Number((await getAccount(ctx.db, accountId)).balance)).toBe(125);
  });

  it('creates negative adjustments as expense and decreases balance', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 100 });

    await createAssetBalanceAdjustment({ accountId, amount: -7.25, date: DATE });

    // Direction lives in the type and from/to; the stored amount stays positive.
    expect((await allTransactions(ctx.db))[0]).toMatchObject({
      type: 'EXPENSE',
      amount: 7.25,
      from_account: accountId,
      to_account: null,
    });
    expect(Number((await getAccount(ctx.db, accountId)).balance)).toBe(92.75);
  });

  it('rejects zero amount', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });
    await expect(
      createAssetBalanceAdjustment({ accountId, amount: 0, date: DATE }),
    ).rejects.toThrow('Amount must not be 0');
  });

  it('rejects non-asset accounts', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY' });
    await expect(
      createAssetBalanceAdjustment({ accountId, amount: 10, date: DATE }),
    ).rejects.toThrow('Account must be an asset account');
  });
});
