import Decimal from 'decimal.js';

import type { Transaction } from '@/lib/types/transactions';

import type { Queryable } from './session';
import { isCheckViolation, one } from './sql';
import type { Tx } from './tx';

/**
 * Shared write helpers for the ledger. Every write takes a `Tx` — a handle only
 * `db.transaction()` produces — so a ledger write cannot compile outside one.
 */

/** A debit pushed a balance below what its CHECK constraint allows. */
export class InsufficientBalanceError extends Error {}

/** CHECK constraint -> the message a debit that trips it should carry. */
const BALANCE_FLOORS: Record<string, string> = {
  accounts_asset_balance_check: 'Insufficient balance',
  accounts_miles_check: 'Insufficient mileage balance',
  accounts_share_check: 'Insufficient balance',
  liability_reward_balance_check: 'Insufficient reward balance',
};

async function applyDelta(
  tx: Tx,
  text: string,
  accountId: string,
  signedDelta: Decimal.Value,
  notFound: string,
): Promise<void> {
  const delta = new Decimal(signedDelta);
  try {
    const result = await tx.query(text, [delta.toNumber(), accountId]);
    if (result.affectedRows === 0) throw new Error(notFound);
  } catch (error) {
    const constraint = (error as { constraint?: string }).constraint;
    if (isCheckViolation(error) && delta.isNegative() && constraint && constraint in BALANCE_FLOORS) {
      throw new InsufficientBalanceError(BALANCE_FLOORS[constraint]);
    }
    throw error;
  }
}

/**
 * Add `signedDelta` to an account's stored balance — positive raises the
 * column, negative lowers it. The sign is the change to the column itself, not
 * debit/credit: an expense on a credit card passes a negative delta because the
 * card's balance moves further below zero.
 *
 * Relative in SQL, so it never overwrites a value read earlier. Throws
 * `InsufficientBalanceError` when a debit breaks a balance floor.
 */
export function adjustBalance(tx: Tx, accountId: string, signedDelta: Decimal.Value): Promise<void> {
  return applyDelta(
    tx,
    'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
    accountId,
    signedDelta,
    'Account not found',
  );
}

/** Same as `adjustBalance`, for a liability account's reward points. */
export function adjustRewardBalance(
  tx: Tx,
  accountId: string,
  signedDelta: Decimal.Value,
): Promise<void> {
  return applyDelta(
    tx,
    'UPDATE liability_details SET reward_balance = reward_balance + $1 WHERE account_id = $2',
    accountId,
    signedDelta,
    'Reward account not found',
  );
}

/** Set a share position outright (from a computed trade or a stored snapshot). */
export async function setSharePosition(
  tx: Tx,
  accountId: string,
  shares: Decimal.Value,
  costBasis: Decimal.Value,
): Promise<void> {
  const result = await tx.query(
    'UPDATE share_details SET shares = $1, cost_basis = $2 WHERE account_id = $3',
    [new Decimal(shares).toNumber(), new Decimal(costBasis).toNumber(), accountId],
  );
  if (result.affectedRows === 0) throw new Error('Share account not found');
}

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
 * Insert one ledger row and return it.
 *
 * Every column is listed explicitly so the discriminant CHECK constraints in
 * 001_init see exactly what the caller intended — an omitted field becomes NULL
 * rather than silently picking up a default.
 */
export function insertTransaction(tx: Tx, row: TransactionInsert): Promise<Transaction> {
  return one<Transaction>(
    tx,
    `INSERT INTO transactions
       (type, amount, currency, reward_currency, metadata,
        reference_transaction_id, from_account, to_account, category, memo,
        share_ticker, share_quantity, share_price, transaction_date)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
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

/** Trim to null — the ledger stores an absent memo as NULL, never ''. */
export function normalizeMemo(memo: string | undefined | null): string | null {
  return memo?.trim() ? memo.trim() : null;
}
