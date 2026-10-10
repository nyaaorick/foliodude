import { beforeEach, describe, expect, it } from 'vitest';

import { InsufficientBalanceError, adjustBalance, insertTransaction } from '@/lib/db/ledger';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('ledger write primitives', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('applies deltas relatively and refuses to overdraw cash', async () => {
    const cash = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 100 });

    await ctx.db.transaction(async (tx) => {
      await adjustBalance(tx, cash, -30);
      await adjustBalance(tx, cash, 5.5);
    });
    expect((await getAccount(ctx.db, cash)).balance).toBe(75.5);

    await expect(
      ctx.db.transaction((tx) => adjustBalance(tx, cash, -100)),
    ).rejects.toThrow(InsufficientBalanceError);
    expect((await getAccount(ctx.db, cash)).balance).toBe(75.5);
  });

  it('does not let a ledger write compile outside a transaction', () => {
    // Never called: the assertion is that `tsc` rejects the line below.
    const rawInsert = () =>
      // @ts-expect-error — only `db.transaction()` produces a `Tx`
      insertTransaction(ctx.db, { type: 'INCOME', amount: 1, transaction_date: '2026-01-01' });
    expect(rawInsert).toBeTypeOf('function');
  });
});
