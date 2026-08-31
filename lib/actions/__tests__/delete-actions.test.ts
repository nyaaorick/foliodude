import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));

import { deleteAccount, deleteAction, deleteTransaction } from '@/lib/actions/delete-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

const DATE = '2026-03-16';

describe('deleteAction', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
  });

  async function insertTx(fields: Record<string, unknown>): Promise<string> {
    const columns = Object.keys(fields);
    const values = columns.map((c) => fields[c]);
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO transactions (user_id, ${columns.join(', ')})
       VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')})
       RETURNING id`,
      [ctx.userId, ...values],
    );
    return rows[0]!.id;
  }

  async function transactionMemo(id: string): Promise<string | null> {
    const { rows } = await ctx.db.query<{ memo: string | null }>(
      'SELECT memo FROM transactions WHERE id = $1',
      [id],
    );
    return rows[0]?.memo ?? null;
  }

  async function transactionExists(id: string): Promise<boolean> {
    const { rows } = await ctx.db.query('SELECT 1 FROM transactions WHERE id = $1', [id]);
    return rows.length > 0;
  }

  it('hides a standalone transfer by appending the memo marker', async () => {
    const from = await seedAccount(ctx, { type: 'ASSET', balance: 100 });
    const to = await seedAccount(ctx, { type: 'ASSET', balance: 0 });
    const id = await insertTx({
      type: 'TRANSFER', amount: 50, currency: 'USD', from_account: from, to_account: to,
      memo: 'Rent', transaction_date: DATE,
    });

    const result = await deleteTransaction(id);

    expect(result).toEqual({ success: true, data: null });
    expect(await transactionMemo(id)).toBe('Rent [HIDDEN]');
    expect(await transactionExists(id)).toBe(true); // soft delete
  });

  it('does not append the memo marker twice', async () => {
    const from = await seedAccount(ctx, { type: 'ASSET', balance: 100 });
    const id = await insertTx({
      type: 'EXPENSE', amount: 10, currency: 'USD', from_account: from,
      category: 'Other', memo: 'Coffee [HIDDEN]', transaction_date: DATE,
    });

    await deleteTransaction(id);
    expect(await transactionMemo(id)).toBe('Coffee [HIDDEN]');
  });

  it('hides an expense together with its linked reward earn transaction', async () => {
    const card = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR' });
    const expenseId = await insertTx({
      type: 'EXPENSE', amount: 10, currency: 'USD', from_account: card,
      category: 'Dining', transaction_date: DATE,
    });
    const rewardId = await insertTx({
      type: 'REWARD_EARN', amount: 40, reward_currency: 'MR', to_account: card,
      reference_transaction_id: expenseId, category: 'Dining', transaction_date: DATE,
    });

    const result = await deleteTransaction(expenseId);

    expect(result).toEqual({ success: true, data: null });
    expect(await transactionMemo(expenseId)).toBe('[HIDDEN]');
    expect(await transactionMemo(rewardId)).toBe('[HIDDEN]');
  });

  it('hides a mileage transfer together with the reward redeems that funded it', async () => {
    const card = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR', reward_balance: 0 });
    const miles = await seedAccount(ctx, { type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER' });
    const transferId = await insertTx({
      type: 'MILEAGE_TRANSFER_IN', amount: 1000, to_account: miles, transaction_date: DATE,
    });
    const redeemId = await insertTx({
      type: 'REWARD_REDEEM', amount: 1000, reward_currency: 'MR', from_account: card,
      reference_transaction_id: transferId, transaction_date: DATE,
    });

    await deleteTransaction(transferId);

    expect(await transactionMemo(transferId)).toBe('[HIDDEN]');
    expect(await transactionMemo(redeemId)).toBe('[HIDDEN]');
  });

  it('hides a mileage flight redemption together with its tax expense', async () => {
    const miles = await seedAccount(ctx, { type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 50000 });
    const card = await seedAccount(ctx, { type: 'LIABILITY' });
    const expenseId = await insertTx({
      type: 'EXPENSE', amount: 100, currency: 'USD', from_account: card,
      category: 'Travel', transaction_date: DATE,
    });
    const redeemId = await insertTx({
      type: 'MILEAGE_REDEEM_FLIGHT', amount: 30000, from_account: miles, transaction_date: DATE,
      metadata: JSON.stringify({ tax_expense_transaction_id: expenseId }),
    });

    await deleteTransaction(redeemId);

    expect(await transactionMemo(redeemId)).toBe('[HIDDEN]');
    expect(await transactionMemo(expenseId)).toBe('[HIDDEN]');
  });

  it('rejects deleting a non-latest share trade', async () => {
    const cash = await seedAccount(ctx, { type: 'ASSET', balance: 200 });
    const share = await seedAccount(ctx, { type: 'SHARE', currency: 'USD', brokerage_account_id: cash, ticker: 'AAPL', shares: 8, cost_basis: 800, last_price: 100 });
    const oldBuy = await insertTx({
      type: 'SHARE_BUY', amount: 500, currency: 'USD', from_account: cash, to_account: share,
      share_ticker: 'AAPL', share_quantity: 5, share_price: 100, fee: 0, transaction_date: '2026-03-18',
    });
    await insertTx({
      type: 'SHARE_BUY', amount: 300, currency: 'USD', from_account: cash, to_account: share,
      share_ticker: 'AAPL', share_quantity: 3, share_price: 100, fee: 0, transaction_date: '2026-03-19',
    });

    const result = await deleteAction({ kind: 'transaction', id: oldBuy });

    expect(result).toEqual({
      success: false,
      error: 'Delete action only supports deleting the latest share trade',
    });
  });

  it('deleteAccount hard-deletes the account and its full transaction closure', async () => {
    const accountId = await seedAccount(ctx, { type: 'ASSET', balance: 500 });
    await insertTx({
      type: 'EXPENSE', amount: 10, currency: 'USD', from_account: accountId,
      category: 'Other', transaction_date: DATE,
    });

    const result = await deleteAccount(accountId);

    expect(result).toEqual({ success: true, data: null });
    const { rows } = await ctx.db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
    expect(rows).toHaveLength(0);
  });

  it('deletes account transactions without correcting counterpart balances', async () => {
    const cash = await seedAccount(ctx, { type: 'ASSET', balance: 500 });
    const card = await seedAccount(ctx, { type: 'LIABILITY', balance: -200 });
    await insertTx({
      type: 'TRANSFER', amount: 200, currency: 'USD', from_account: cash, to_account: card,
      transaction_date: DATE,
    });

    await deleteAction({ kind: 'account', id: cash });

    // The counterpart's balance is untouched — deletion does not reverse the
    // ledger effect of the transactions it removes.
    expect((await getAccount(ctx.db, card)).balance).toBe(-200);
  });

  it('rejects an unknown transaction id', async () => {
    const result = await deleteTransaction('00000000-0000-4000-8000-000000000999');
    expect(result.success).toBe(false);
  });
});
