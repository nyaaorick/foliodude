import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';
import { allTransactions, createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

const DATE = '2026-03-16';

describe('createAssetsExpense', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('creates an asset expense with fixed expense semantics', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 100 });

    const result = await createAssetsExpense({
      accountId,
      amount: 12.5,
      memo: '  Coffee  ',
      date: DATE,
    });

    expect(result).toEqual({
      expense_id: expect.any(String),
      reward_id: null,
      reward_points: 0,
    });

    const rows = await allTransactions(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'EXPENSE',
      currency: 'USD',
      reward_currency: null,
      category: 'Other',
      memo: 'Coffee',
      from_account: accountId,
      to_account: null,
      transaction_date: DATE,
    });

    const account = await getAccount(ctx.db, accountId);
    expect(Number(account.balance)).toBe(87.5);
    // Asset spending never touches reward state.
    expect(account.reward_balance).toBe(0);
    expect(account.spend_stats).toEqual({});
  });

  it('rejects non-asset accounts', async () => {
    const accountId = await seedAccount(ctx, { type: 'LIABILITY', balance: 100 });

    await expect(
      createAssetsExpense({ accountId, amount: 10, date: DATE }),
    ).rejects.toThrow('Account must be an asset account');

    expect(await allTransactions(ctx.db)).toHaveLength(0);
  });

  it('rejects invalid amount', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET' });

    await expect(
      createAssetsExpense({ accountId, amount: 0, date: DATE }),
    ).rejects.toThrow('Amount must be greater than 0');
  });
});
