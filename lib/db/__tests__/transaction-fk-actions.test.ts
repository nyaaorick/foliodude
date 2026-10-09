import { describe, expect, it } from 'vitest';

import { createTestContext, seedAccount } from '@/lib/db/testing';

/**
 * The transaction foreign keys use NO ACTION rather than `ON DELETE SET NULL`.
 * These assert the two behaviours that motivated it: a
 * partial delete is refused with a referential error rather than a confusing
 * `transactions_shape_check` violation, and a whole closure still deletes.
 */
describe('transaction foreign key actions', () => {
  it('refuses to delete a row another row still points at, and never orphans one', async () => {
    const ctx = await createTestContext();
    const card = await seedAccount(ctx, {
      type: 'LIABILITY', balance: -80, credit_limit: 1000, reward_currency: 'MR',
    });

    const expense = await ctx.db.query<{ id: string }>(
      `INSERT INTO transactions (type, amount, currency, from_account, transaction_date)
       VALUES ('EXPENSE',25,'USD',$1,'2026-08-01') RETURNING id`,
      [card],
    );
    await ctx.db.query(
      `INSERT INTO transactions (type, amount, reward_currency, to_account, transaction_date, reference_transaction_id)
       VALUES ('REWARD_EARN',50,'MR',$1,'2026-08-01',$2)`,
      [card, expense.rows[0]!.id],
    );

    // Was: "violates check constraint transactions_shape_check" — a constraint
    // the caller never touched. Now names the actual relationship.
    await expect(
      ctx.db.query('DELETE FROM transactions WHERE id = $1', [expense.rows[0]!.id]),
    ).rejects.toThrow(/foreign key|referenced/i);

    // Was: silently nulled from_account, leaving an expense on no account.
    await expect(
      ctx.db.query('DELETE FROM accounts WHERE id = $1', [card]),
    ).rejects.toThrow(/foreign key|referenced/i);

    // Deleting the whole closure in one statement still works — the check is
    // end-of-statement, which is what deleteAction's account path relies on.
    await ctx.db.query('DELETE FROM transactions');
    await ctx.db.query('DELETE FROM accounts WHERE id = $1', [card]);

    const left = await ctx.db.query('SELECT 1 FROM accounts');
    expect(left.rows).toHaveLength(0);
  });
});
