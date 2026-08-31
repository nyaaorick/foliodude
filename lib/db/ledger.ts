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
  fee?: number | null;
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
  userId: string,
  row: TransactionInsert,
): Promise<string> {
  const inserted = await one<{ id: string }>(
    db,
    `INSERT INTO transactions
       (user_id, type, amount, currency, reward_currency, metadata,
        reference_transaction_id, from_account, to_account, category, memo,
        share_ticker, share_quantity, share_price, fee, transaction_date)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      userId,
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
      row.fee ?? null,
      row.transaction_date,
    ],
    'Failed to create transaction',
  );

  return inserted.id;
}

/**
 * Load one account the user owns. A miss means the account does not exist or
 * belongs to someone else — the caller cannot distinguish, and should not.
 */
export function loadAccount<T>(
  db: Queryable,
  userId: string,
  accountId: string,
  columns: string,
  notFoundMessage = 'Account not found',
): Promise<T> {
  return one<T>(
    db,
    `SELECT ${columns} FROM accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
    notFoundMessage,
  );
}

/** Apply a partial account update. Keys are column names; values are bound. */
export async function updateAccount(
  db: Queryable,
  userId: string,
  accountId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;

  const assignments = columns.map((column, i) => `${column} = $${i + 1}`).join(', ');
  const values = columns.map((column) => {
    const value = patch[column];
    return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  });

  await db.query(
    `UPDATE accounts SET ${assignments} WHERE id = $${columns.length + 1} AND user_id = $${columns.length + 2}`,
    [...values, accountId, userId],
  );
}

/** Trim to null — the ledger stores an absent memo as NULL, never ''. */
export function normalizeMemo(memo: string | undefined | null): string | null {
  return memo?.trim() ? memo.trim() : null;
}
