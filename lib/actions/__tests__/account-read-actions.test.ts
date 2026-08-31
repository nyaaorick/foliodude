import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import {
  getAccountById,
  getAccounts,
  loadAccountDetailCore,
  loadAccountDetailSupport,
  loadAccountTransactions,
} from '@/lib/actions/account-read-actions';
import { createTestContext, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('account-read-actions', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  it('getAccounts sorts by ASSET, LIABILITY, AIRLINE_MILES, SHARE', async () => {
    const brokerageId = await seedAccount(ctx, { type: 'ASSET', name: 'Broker' });
    await seedAccount(ctx, {
      type: 'SHARE',
      name: 'AAPL',
      currency: 'USD',
      brokerage: 'IBKR',
      ticker: 'AAPL',
      brokerage_account_id: brokerageId,
    });
    await seedAccount(ctx, {
      type: 'AIRLINE_MILES',
      name: 'Miles',
      currency: 'USD',
      airline_program: 'KRISFLYER',
    });
    await seedAccount(ctx, { type: 'LIABILITY', name: 'Card' });

    const accounts = await getAccounts();
    expect(accounts.map((a) => a.type)).toEqual([
      'ASSET',
      'LIABILITY',
      'AIRLINE_MILES',
      'SHARE',
    ]);
  });

  it('getAccounts computes available_credit only for liabilities', async () => {
    await seedAccount(ctx, { type: 'LIABILITY', balance: -200, credit_limit: 1000 });
    await seedAccount(ctx, { type: 'ASSET', balance: 500 });

    // getAccounts sorts ASSET ahead of LIABILITY.
    const [asset, liability] = await getAccounts();
    expect(liability?.available_credit).toBe(800);
    expect(asset?.available_credit).toBeNull();
  });

  it('getAccountById throws on a miss, including cross-user rows', async () => {
    const otherUserId = '00000000-0000-4000-8000-000000000999';
    const id = await seedAccount(ctx, { user_id: otherUserId });
    await expect(getAccountById(id)).rejects.toThrow('Account not found');
  });

  it('loadAccountDetailCore returns null instead of throwing on a miss', async () => {
    expect(await loadAccountDetailCore('00000000-0000-4000-8000-000000000001')).toBeNull();
  });

  it('loadAccountDetailSupport returns default reward rates when none are set', async () => {
    await seedAccount(ctx, { type: 'ASSET' });
    const support = await loadAccountDetailSupport();
    expect(support.accounts).toHaveLength(1);
    expect(support.rewardRates).toBeDefined();
  });

  it('loadAccountTransactions returns newest first and hides HIDDEN_MARKER memos', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', balance: 100 });
    const insert = (date: string, memo: string | null) =>
      ctx.db.query(
        `INSERT INTO transactions (user_id, type, amount, currency, from_account, category, memo, transaction_date)
         VALUES ($1, 'EXPENSE', 10, 'USD', $2, 'Other', $3, $4)`,
        [ctx.userId, accountId, memo, date],
      );

    await insert('2026-01-01', 'visible old');
    await insert('2026-01-03', 'visible new');
    await insert('2026-01-02', 'secret [HIDDEN] note');

    const visible = await loadAccountTransactions(accountId);
    expect(visible.map((t) => t.memo)).toEqual(['visible new', 'visible old']);
  });

  it('loadAccountTransactions attaches the reference transaction for reward rows', async () => {
    const accountId = await seedAccount(ctx, {
      type: 'LIABILITY',
      reward_currency: 'MR',
      reward_rules: [{ category: 'Dining', multiplier: 4, rule_source: 'cloud' }],
    });
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO transactions (user_id, type, amount, currency, from_account, category, transaction_date)
       VALUES ($1, 'EXPENSE', 10, 'USD', $2, 'Dining', '2026-01-01') RETURNING id`,
      [ctx.userId, accountId],
    );
    const expenseId = rows[0]!.id;
    await ctx.db.query(
      `INSERT INTO transactions
         (user_id, type, amount, reward_currency, to_account, reference_transaction_id, category, transaction_date)
       VALUES ($1, 'REWARD_EARN', 40, 'MR', $2, $3, 'Dining', '2026-01-01')`,
      [ctx.userId, accountId, expenseId],
    );

    const transactions = await loadAccountTransactions(accountId);
    const reward = transactions.find((t) => t.type === 'REWARD_EARN');
    expect(reward?.reference_transaction).toMatchObject({ id: expenseId, type: 'EXPENSE' });
  });
});
