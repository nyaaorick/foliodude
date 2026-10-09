import type { Queryable } from './session';
import { one } from './sql';

/**
 * Shared write helpers for the ledger.
 *
 * These exist because a dozen actions repeat the same three statements, not to
 * abstract SQL away: each one is a single statement you can read in full here,
 * and anything non-trivial stays written out at the call site.
 */

export interface TransactionInsert {
  type: string;
  amount: number;
  transaction_date: string;
  currency?: string | null;
  reward_currency?: string | null;
  metadata?: unknown;
  reference_transaction_id?: string | null;
  from_account?: string | null;
  to_account?: string | null;
  category?: string | null;
  memo?: string | null;
  share_ticker?: string | null;
  share_quantity?: number | null;
  share_price?: number | null;
}

/**
 * Insert one ledger row and return its id.
 *
 * Every column is listed explicitly so the discriminant CHECK constraints in
 * 001_init see exactly what the caller intended — an omitted field becomes NULL
 * rather than silently picking up a default.
 */
export async function insertTransaction(
  db: Queryable,
  row: TransactionInsert,
): Promise<string> {
  const inserted = await one<{ id: string }>(
    db,
    `INSERT INTO transactions
       (type, amount, currency, reward_currency, metadata,
        reference_transaction_id, from_account, to_account, category, memo,
        share_ticker, share_quantity, share_price, transaction_date)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      row.type,
      row.amount,
      row.currency ?? null,
      row.reward_currency ?? null,
      JSON.stringify(row.metadata ?? {}),
      row.reference_transaction_id ?? null,
      row.from_account ?? null,
      row.to_account ?? null,
      row.category ?? null,
      row.memo ?? null,
      row.share_ticker ?? null,
      row.share_quantity ?? null,
      row.share_price ?? null,
      row.transaction_date,
    ],
    'Failed to create transaction',
  );

  return inserted.id;
}

/** Load one account, flattened with its details. */
export function loadAccount<T>(
  db: Queryable,
  accountId: string,
  columns: string,
  notFoundMessage = 'Account not found',
): Promise<T> {
  return one<T>(
    db,
    `SELECT ${columns} FROM accounts_flat WHERE id = $1`,
    [accountId],
    notFoundMessage,
  );
}

/** Set an account's balance. */
export async function setBalance(db: Queryable, accountId: string, balance: number): Promise<void> {
  await db.query('UPDATE accounts SET balance = $1 WHERE id = $2', [balance, accountId]);
}

/** Trim to null — the ledger stores an absent memo as NULL, never ''. */
export function normalizeMemo(memo: string | undefined | null): string | null {
  return memo?.trim() ? memo.trim() : null;
}
