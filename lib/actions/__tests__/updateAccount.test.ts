import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { setAssetApy, updateAccount } from '@/lib/actions/update-accounts-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('updateAccount', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('supports name-only edits', async () => {
    const id = await seedAccount(ctx, { name: 'Old', type: 'ASSET', balance: 42.5 });
    expect(await updateAccount({ id, name: '  New  ' })).toMatchObject({
      id,
      name: 'New',
      balance: 42.5,
    });
  });

  it('supports decimal balance edits for money accounts', async () => {
    const id = await seedAccount(ctx, { type: 'ASSET', balance: 0 });
    expect((await updateAccount({ id, name: 'Savings', balance: 1234.56 })).balance).toBe(1234.56);
    expect((await getAccount(ctx.db, id)).balance).toBe(1234.56);
  });

  it('rejects balances with more than two decimal places', async () => {
    const id = await seedAccount(ctx, { type: 'ASSET' });
    await expect(updateAccount({ id, name: 'Savings', balance: 1.234 })).rejects.toThrow(
      'Balance must have at most 2 decimal places',
    );
  });

  it('rejects fractional mileage balances', async () => {
    const id = await seedAccount(ctx, {
      type: 'AIRLINE_MILES',
      currency: 'USD',
      airline_program: 'KRISFLYER',
    });
    await expect(updateAccount({ id, name: 'Miles', balance: 10.5 })).rejects.toThrow(
      'Mileage balances must be whole numbers',
    );
  });

  it('rejects share balance edits', async () => {
    const brokerageId = await seedAccount(ctx, { type: 'ASSET', name: 'Broker' });
    const id = await seedAccount(ctx, {
      type: 'SHARE',
      currency: 'USD',
      ticker: 'AAPL',
      brokerage_account_id: brokerageId,
    });
    await expect(updateAccount({ id, name: 'AAPL', balance: 10 })).rejects.toThrow(
      'Share account balances cannot be edited directly',
    );
  });

  it('stores asset APY rounded to 2 decimals', async () => {
    const id = await seedAccount(ctx, { type: 'ASSET' });
    expect((await setAssetApy({ id, apy: 4.256 })).apy).toBe(4.26);
  });

  it('rejects APY updates for non-asset accounts', async () => {
    const id = await seedAccount(ctx, { type: 'LIABILITY' });
    await expect(setAssetApy({ id, apy: 1 })).rejects.toThrow(
      'APY can only be set on asset accounts',
    );
  });
});
