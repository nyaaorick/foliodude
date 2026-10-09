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
    const values = columns.map((c) =>
      fields[c] !== null && typeof fields[c] === 'object' ? JSON.stringify(fields[c]) : fields[c],
    );
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO transactions (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      values,
    );
    return rows[0]!.id;
  }

  async function isDeleted(id: string): Promise<boolean> {
    const { rows } = await ctx.db.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM transactions WHERE id = $1',
      [id],
    );
    return rows[0]!.deleted_at !== null;
  }

  async function balanceOf(id: string): Promise<number> {
    return (await getAccount(ctx.db, id)).balance as number;
  }

  it('tombstones a transfer and puts both balances back', async () => {
    const from = await seedAccount(ctx, { type: 'ASSET', balance: 50 });
    const to = await seedAccount(ctx, { type: 'ASSET', balance: 50 });
    const id = await insertTx({
      type: 'TRANSFER', amount: 50, currency: 'USD', from_account: from, to_account: to,
      memo: 'Rent', transaction_date: DATE,
    });

    const result = await deleteTransaction(id);

    expect(result).toEqual({ success: true, data: null });
    expect(await isDeleted(id)).toBe(true);
    expect(await balanceOf(from)).toBe(100);
    expect(await balanceOf(to)).toBe(0);
  });

  it('reverses a cross-currency transfer by the amount it credited', async () => {
    const from = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 0 });
    const to = await seedAccount(ctx, { type: 'ASSET', currency: 'HKD', balance: 780 });
    const id = await insertTx({
      type: 'TRANSFER', amount: 100, currency: 'USD', from_account: from, to_account: to,
      metadata: { target_amount: 780 }, transaction_date: DATE,
    });

    await deleteTransaction(id);

    expect(await balanceOf(from)).toBe(100);
    expect(await balanceOf(to)).toBe(0);
  });

  it('deletes an expense together with its reward earn, and takes the points and cap spend back', async () => {
    const card = await seedAccount(ctx, {
      type: 'LIABILITY', balance: -10, reward_currency: 'MR', reward_balance: 40,
      reward_rules: [{ category: 'Dining', multiplier: 4, cap_amount: 1000, cap_period: 'annual' }],
      spend_stats: { '2026_Dining': 10 },
    });
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
    expect(await isDeleted(expenseId)).toBe(true);
    expect(await isDeleted(rewardId)).toBe(true);
    expect(await getAccount(ctx.db, card)).toMatchObject({
      balance: 0, reward_balance: 0, spend_stats: {},
    });
  });

  it('refuses to claw back points that have already been spent', async () => {
    const card = await seedAccount(ctx, {
      type: 'LIABILITY', balance: -10, reward_currency: 'MR', reward_balance: 0,
    });
    const expenseId = await insertTx({
      type: 'EXPENSE', amount: 10, currency: 'USD', from_account: card,
      category: 'Dining', transaction_date: DATE,
    });
    await insertTx({
      type: 'REWARD_EARN', amount: 40, reward_currency: 'MR', to_account: card,
      reference_transaction_id: expenseId, category: 'Dining', transaction_date: DATE,
    });

    const result = await deleteTransaction(expenseId);

    expect(result).toEqual({
      success: false,
      error: 'Cannot delete: the reward points it added have already been spent',
    });
    expect(await isDeleted(expenseId)).toBe(false);
    expect(await balanceOf(card)).toBe(-10);
  });

  it('deletes a mileage transfer together with the reward redeems that funded it', async () => {
    const card = await seedAccount(ctx, { type: 'LIABILITY', reward_currency: 'MR', reward_balance: 0 });
    const miles = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 1000,
    });
    const transferId = await insertTx({
      type: 'MILEAGE_TRANSFER_IN', amount: 1000, to_account: miles, transaction_date: DATE,
    });
    const redeemId = await insertTx({
      type: 'REWARD_REDEEM', amount: 1000, reward_currency: 'MR', from_account: card,
      reference_transaction_id: transferId, transaction_date: DATE,
    });

    await deleteTransaction(transferId);

    expect(await isDeleted(transferId)).toBe(true);
    expect(await isDeleted(redeemId)).toBe(true);
    expect(await balanceOf(miles)).toBe(0);
    expect(await getAccount(ctx.db, card)).toMatchObject({ reward_balance: 1000 });
  });

  it('deletes a mileage flight redemption together with its tax expense', async () => {
    const miles = await seedAccount(ctx, {
      type: 'AIRLINE_MILES', currency: 'USD', airline_program: 'KRISFLYER', balance: 20000,
    });
    const card = await seedAccount(ctx, { type: 'LIABILITY', balance: -100 });
    const expenseId = await insertTx({
      type: 'EXPENSE', amount: 100, currency: 'USD', from_account: card,
      category: 'Travel', transaction_date: DATE,
    });
    const redeemId = await insertTx({
      type: 'MILEAGE_REDEEM_FLIGHT', amount: 30000, from_account: miles,
      reference_transaction_id: expenseId, transaction_date: DATE,
    });

    // Deleting from the expense side reaches the redemption too.
    await deleteTransaction(expenseId);

    expect(await isDeleted(redeemId)).toBe(true);
    expect(await balanceOf(miles)).toBe(50000);
    expect(await balanceOf(card)).toBe(0);
  });

  describe('share trades', () => {
    async function seedPosition() {
      const cash = await seedAccount(ctx, { type: 'ASSET', balance: 200 });
      const share = await seedAccount(ctx, {
        type: 'SHARE', brokerage_account_id: cash, ticker: 'AAPL',
        shares: 8, cost_basis: 800, last_price: 100, balance: 800,
      });
      return { cash, share };
    }

    const trade = (type: 'SHARE_BUY' | 'SHARE_SELL', cash: string, share: string, qty: number, date: string) => ({
      type, amount: qty * 100, currency: 'USD',
      from_account: type === 'SHARE_BUY' ? cash : share,
      to_account: type === 'SHARE_BUY' ? share : cash,
      share_ticker: 'AAPL', share_quantity: qty, share_price: 100,
      metadata: { shares_before: 5, cost_basis_before: 500 },
      transaction_date: date,
    });

    it('rejects deleting a non-latest share trade', async () => {
      const { cash, share } = await seedPosition();
      const oldBuy = await insertTx(trade('SHARE_BUY', cash, share, 5, '2026-03-18'));
      await insertTx(trade('SHARE_BUY', cash, share, 3, '2026-03-19'));

      const result = await deleteAction({ kind: 'transaction', id: oldBuy });

      expect(result).toEqual({
        success: false,
        error: 'Delete action only supports deleting the latest share trade',
      });
    });

    it('restores the position recorded on the latest trade', async () => {
      const { cash, share } = await seedPosition();
      const buy = await insertTx(trade('SHARE_BUY', cash, share, 3, '2026-03-19'));

      await deleteTransaction(buy);

      expect(await getAccount(ctx.db, share)).toMatchObject({
        shares: 5, cost_basis: 500, balance: 500,
      });
      expect(await balanceOf(cash)).toBe(500);
    });
  });

  describe('account delete', () => {
    it('hard-deletes the account and its closure, correcting the other side', async () => {
      const cash = await seedAccount(ctx, { type: 'ASSET', balance: 300 });
      const card = await seedAccount(ctx, { type: 'LIABILITY', balance: 0 });
      const transferId = await insertTx({
        type: 'TRANSFER', amount: 200, currency: 'USD', from_account: cash, to_account: card,
        transaction_date: DATE,
      });
      // Already tombstoned: must go with the account, and must not be reversed twice.
      const gone = await insertTx({
        type: 'EXPENSE', amount: 10, currency: 'USD', from_account: cash, category: 'Other',
        transaction_date: DATE, deleted_at: new Date().toISOString(),
      });

      const result = await deleteAccount(cash);

      expect(result).toEqual({ success: true, data: null });
      const accounts = await ctx.db.query('SELECT 1 FROM accounts WHERE id = $1', [cash]);
      expect(accounts.rows).toHaveLength(0);
      const left = await ctx.db.query('SELECT 1 FROM transactions WHERE id = ANY($1)', [[transferId, gone]]);
      expect(left.rows).toHaveLength(0);
      // The payment into the card is undone, so the debt comes back.
      expect(await balanceOf(card)).toBe(-200);
    });

    it('deletes the share positions held through a brokerage with it', async () => {
      const cash = await seedAccount(ctx, { type: 'ASSET', balance: 0 });
      await seedAccount(ctx, {
        type: 'SHARE', brokerage_account_id: cash, ticker: 'AAPL', shares: 2, cost_basis: 200,
      });

      const result = await deleteAccount(cash);

      expect(result).toEqual({ success: true, data: null });
      const remaining = await ctx.db.query('SELECT 1 FROM accounts');
      expect(remaining.rows).toHaveLength(0);
    });
  });

  it('rejects an unknown transaction id', async () => {
    const result = await deleteTransaction('00000000-0000-4000-8000-000000000999');
    expect(result.success).toBe(false);
  });
});
