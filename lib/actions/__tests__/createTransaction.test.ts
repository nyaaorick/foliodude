import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({
  mockGetSessionContext: vi.fn(),
}));

vi.mock('@/lib/db/session', () => ({
  getSessionContext: mockGetSessionContext,
}));

import { createTransaction } from '@/lib/actions/createTransaction';
import {
  allTransactions,
  createTestContext,
  getAccount,
  seedAccount,
} from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

const DATE = '2026-03-16';

describe('createTransaction', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('creates reward earn transactions with reward currency and reference id', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      currency: 'USD',
      reward_currency: 'MR',
      reward_balance: 1000,
      reward_rules: [{ category: 'Dining', multiplier: 4, rule_source: 'cloud' }],
      spend_stats: {},
    });

    const result = await createTransaction({
      accountId,
      category: 'Dining',
      amount: 12.5,
      memo: 'Lunch',
      date: DATE,
    });

    expect(result).toMatchObject({ reward_points: 50 });
    expect(result.expense_id).toEqual(expect.any(String));
    expect(result.reward_id).toEqual(expect.any(String));

    const rows = await allTransactions(ctx.db);
    expect(rows[0]).toMatchObject({
      type: 'EXPENSE',
      currency: 'USD',
      reward_currency: null,
      reference_transaction_id: null,
      from_account: accountId,
      transaction_date: DATE,
    });
    expect(rows[1]).toMatchObject({
      type: 'REWARD_EARN',
      currency: null,
      reward_currency: 'MR',
      reference_transaction_id: result.expense_id,
      to_account: accountId,
      memo: 'Lunch',
    });

    const account = await getAccount(ctx.db, accountId);
    expect(account).toMatchObject({
      reward_balance: 1050,
      spend_stats: { '2026_Dining': 12.5 },
    });
    expect(Number(account.balance)).toBe(-12.5);
  });

  it('creates a bare expense when the account earns no rewards', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', balance: 100 });

    const result = await createTransaction({
      accountId,
      category: 'Groceries',
      amount: 30,
      date: DATE,
    });

    expect(result).toMatchObject({ reward_id: null, reward_points: 0, reward: undefined });

    const rows = await allTransactions(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'EXPENSE', memo: null });
    expect(Number((await getAccount(ctx.db, accountId)).balance)).toBe(70);
  });

  it('rejects an account that belongs to someone else', async () => {
    const accountId = await seedAccount(ctx, {
      user_id: '00000000-0000-4000-8000-000000000999',
    });

    await expect(
      createTransaction({ accountId, category: 'Dining', amount: 5, date: DATE }),
    ).rejects.toThrow('Account not found');
  });

  it('writes nothing when the reward insert violates a constraint', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_currency: 'MR',
      reward_rules: [{ category: 'Dining', multiplier: 4, rule_source: 'cloud' }],
    });
    // Drop the FK target mid-flight is not possible; instead force the reward
    // insert to fail by removing the column default the constraint depends on.
    await ctx.db.exec(
      "ALTER TABLE transactions ADD CONSTRAINT no_rewards CHECK (type <> 'REWARD_EARN')",
    );

    await expect(
      createTransaction({ accountId, category: 'Dining', amount: 10, date: DATE }),
    ).rejects.toThrow();

    // The expense and the balance decrement must have rolled back with it.
    expect(await allTransactions(ctx.db)).toHaveLength(0);
    expect(Number((await getAccount(ctx.db, accountId)).balance)).toBe(0);
  });
});
