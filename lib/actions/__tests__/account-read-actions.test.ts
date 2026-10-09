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

  it('getAccountById throws on a miss', async () => {
    await expect(getAccountById('00000000-0000-4000-8000-000000000999')).rejects.toThrow(
      'Account not found',
    );
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

  it('loadAccountTransactions returns newest first and hides deleted rows', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', balance: 100 });
    const insert = (date: string, memo: string | null, deleted = false) =>
      ctx.db.query(
        `INSERT INTO transactions (type, amount, currency, from_account, category, memo, transaction_date, deleted_at)
         VALUES ('EXPENSE', 10, 'USD', $1, 'Other', $2, $3, CASE WHEN $4 THEN now() END)`,
        [accountId, memo, date, deleted],
      );

    await insert('2026-01-01', 'visible old');
    await insert('2026-01-03', 'visible new');
    await insert('2026-01-02', 'deleted note', true);

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
      `INSERT INTO transactions (type, amount, currency, from_account, category, transaction_date)
       VALUES ('EXPENSE', 10, 'USD', $1, 'Dining', '2026-01-01') RETURNING id`,
      [accountId],
    );
    const expenseId = rows[0]!.id;
    await ctx.db.query(
      `INSERT INTO transactions
         (type, amount, reward_currency, to_account, reference_transaction_id, category, transaction_date)
       VALUES ('REWARD_EARN', 40, 'MR', $1, $2, 'Dining', '2026-01-01')`,
      [accountId, expenseId],
    );

    const transactions = await loadAccountTransactions(accountId);
    const reward = transactions.find((t) => t.type === 'REWARD_EARN');
    expect(reward?.reference_transaction).toMatchObject({ id: expenseId, type: 'EXPENSE' });
  });
});
