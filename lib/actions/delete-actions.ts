import { getSessionContext } from '@/lib/db/session';
import type { Queryable } from '@/lib/db/session';
import { maybeOne, rows } from '@/lib/db/sql';
import { TransactionType } from '@/lib/types/transactions';
import { SUPPORTED_DELETE_TRANSACTION_TYPES } from '@/lib/utils/delete-support';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type DeleteActionInput = { kind: 'account'; id: string } | { kind: 'transaction'; id: string };

interface RelatedTransactionRecord {
  id: string;
  type: TransactionType;
  amount: number;
  from_account: string | null;
  to_account: string | null;
  reference_transaction_id: string | null;
  category: string | null;
  transaction_date: string;
  created_at: string;
  memo: string | null;
  metadata: unknown;
  share_quantity: number | null;
  share_price: number | null;
}

const TRANSACTION_SELECT_COLUMNS =
  'id, type, amount, from_account, to_account, reference_transaction_id, category, transaction_date, created_at, memo, metadata, share_quantity, share_price';
const HIDDEN_MARKER = '[HIDDEN]';

function fail(message: string): never {
  throw new Error(message);
}

function requireTaxExpenseTransactionId(transaction: RelatedTransactionRecord): string {
  const metadata =
    transaction.metadata && typeof transaction.metadata === 'object'
      ? (transaction.metadata as Record<string, unknown>)
      : null;
  const expenseId = metadata?.tax_expense_transaction_id;

  if (typeof expenseId !== 'string' || expenseId.length === 0) {
    fail(`Mileage redemption ${transaction.id} is missing tax_expense_transaction_id`);
  }
  return expenseId;
}

function ensureSupportedTransactionType(transaction: RelatedTransactionRecord) {
  if (!SUPPORTED_DELETE_TRANSACTION_TYPES.has(transaction.type)) {
    fail(`Delete action does not support ${transaction.type}`);
  }
}

function getShareAccountId(transaction: RelatedTransactionRecord): string {
  if (transaction.type === TransactionType.SHARE_BUY && transaction.to_account) {
    return transaction.to_account;
  }
  if (transaction.type === TransactionType.SHARE_SELL && transaction.from_account) {
    return transaction.from_account;
  }
  fail(`Share transaction ${transaction.id} is missing linked share account`);
}

async function fetchTransactionById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<RelatedTransactionRecord> {
  const data = await maybeOne<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!data) fail(`Transaction ${id} not found`);
  return data;
}

function fetchTransactionsByReferenceId(db: Queryable, userId: string, referenceId: string) {
  return rows<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions WHERE reference_transaction_id = $1 AND user_id = $2`,
    [referenceId, userId],
  );
}

function fetchDirectAccountTransactions(db: Queryable, userId: string, accountId: string) {
  return rows<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions
      WHERE user_id = $1 AND (from_account = $2 OR to_account = $2)`,
    [userId, accountId],
  );
}

function fetchMileageRedeemFlights(db: Queryable, userId: string) {
  return rows<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions WHERE type = $1 AND user_id = $2`,
    [TransactionType.MILEAGE_REDEEM_FLIGHT, userId],
  );
}

async function assertLatestShareTrade(
  db: Queryable,
  userId: string,
  transaction: RelatedTransactionRecord,
) {
  const shareAccountId = getShareAccountId(transaction);
  const latest = await maybeOne<RelatedTransactionRecord>(
    db,
    // Casting the enum column to text (rather than casting $3 to
    // transaction_type[]) is what PGlite's array-bind parser accepts — see
    // lib/db/sql.ts's note on enum-typed ANY() params.
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions
      WHERE user_id = $1 AND (from_account = $2 OR to_account = $2)
        AND type::text = ANY($3)
      ORDER BY transaction_date DESC, seq DESC
      LIMIT 1`,
    [userId, shareAccountId, [TransactionType.SHARE_BUY, TransactionType.SHARE_SELL]],
  );

  if (!latest) fail(`No share trade found for account ${shareAccountId}`);
  if (latest.id !== transaction.id) {
    fail('Delete action only supports deleting the latest share trade');
  }
}

/**
 * Walk every transaction linked to the deletion target — reward earns back to
 * their expense, reward redeems back to a mileage transfer, mileage
 * redemptions to their tax expense, and so on — so a delete never orphans half
 * of a linked pair. Read-only: callers apply the actual hide/delete.
 */
async function loadDeletionScope(
  db: Queryable,
  userId: string,
  input: DeleteActionInput,
): Promise<Map<string, RelatedTransactionRecord>> {
  const transactions = new Map<string, RelatedTransactionRecord>();
  const processedIds = new Set<string>();
  const mileageRedeemFlights = await fetchMileageRedeemFlights(db, userId);

  const collectTransaction = async (transaction: RelatedTransactionRecord): Promise<void> => {
    if (processedIds.has(transaction.id)) return;
    processedIds.add(transaction.id);
    ensureSupportedTransactionType(transaction);
    transactions.set(transaction.id, transaction);

    switch (transaction.type) {
      case TransactionType.TRANSFER:
      case TransactionType.INCOME:
      case TransactionType.REWARD_TRANSFER_IN:
      case TransactionType.MILEAGE_MANUAL_IN:
        return;
      case TransactionType.SHARE_BUY:
      case TransactionType.SHARE_SELL:
        if (input.kind === 'transaction') {
          await assertLatestShareTrade(db, userId, transaction);
        }
        return;
      case TransactionType.REWARD_REDEEM:
        if (!transaction.reference_transaction_id) return;
        await collectTransaction(
          await fetchTransactionById(db, userId, transaction.reference_transaction_id),
        );
        for (const linked of await fetchTransactionsByReferenceId(
          db,
          userId,
          transaction.reference_transaction_id,
        )) {
          if (linked.type !== TransactionType.REWARD_REDEEM) {
            fail(`Linked transaction ${linked.id} is not a reward redeem`);
          }
          await collectTransaction(linked);
        }
        return;
      case TransactionType.MILEAGE_TRANSFER_IN:
        for (const linked of await fetchTransactionsByReferenceId(db, userId, transaction.id)) {
          if (linked.type !== TransactionType.REWARD_REDEEM) {
            fail(`Linked transaction ${linked.id} is not a reward redeem`);
          }
          await collectTransaction(linked);
        }
        return;
      case TransactionType.REWARD_EARN:
        if (!transaction.reference_transaction_id) {
          fail(`Reward earn ${transaction.id} is missing its parent expense`);
        }
        await collectTransaction(
          await fetchTransactionById(db, userId, transaction.reference_transaction_id),
        );
        return;
      case TransactionType.EXPENSE:
        for (const linked of await fetchTransactionsByReferenceId(db, userId, transaction.id)) {
          if (linked.type !== TransactionType.REWARD_EARN) {
            fail(`Linked transaction ${linked.id} is not a reward earn`);
          }
          await collectTransaction(linked);
        }
        for (const linked of mileageRedeemFlights) {
          if (requireTaxExpenseTransactionId(linked) === transaction.id) {
            await collectTransaction(linked);
          }
        }
        return;
      case TransactionType.MILEAGE_REDEEM_FLIGHT:
        await collectTransaction(
          await fetchTransactionById(db, userId, requireTaxExpenseTransactionId(transaction)),
        );
        return;
      default:
        fail(`Delete action does not support ${transaction.type}`);
    }
  };

  if (input.kind === 'account') {
    for (const transaction of await fetchDirectAccountTransactions(db, userId, input.id)) {
      await collectTransaction(transaction);
    }
  } else {
    await collectTransaction(await fetchTransactionById(db, userId, input.id));
  }

  return transactions;
}

function appendHiddenMarker(memo: string | null): string {
  if (!memo) return HIDDEN_MARKER;
  if (memo.includes(HIDDEN_MARKER)) return memo;
  return `${memo} ${HIDDEN_MARKER}`;
}

async function hideTransactions(
  db: Queryable,
  userId: string,
  transactions: Map<string, RelatedTransactionRecord>,
) {
  for (const transaction of transactions.values()) {
    await db.query('UPDATE transactions SET memo = $1 WHERE id = $2 AND user_id = $3', [
      appendHiddenMarker(transaction.memo),
      transaction.id,
      userId,
    ]);
  }
}

async function deleteTransactionsAndAccount(
  db: Queryable,
  userId: string,
  accountId: string,
  transactions: Map<string, RelatedTransactionRecord>,
) {
  if (transactions.size > 0) {
    await db.query('DELETE FROM transactions WHERE id = ANY($1) AND user_id = $2', [
      [...transactions.keys()],
      userId,
    ]);
  }
  await db.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId]);
}

/**
 * Delete an account or a transaction, along with everything linked to it.
 *
 * A transaction delete is a soft delete (memo gets `[HIDDEN]`, appended once):
 * the row stays for referential integrity (other rows may still point at it via
 * `reference_transaction_id`) but drops out of `loadAccountTransactions`. An
 * account delete is a hard delete of the account and its full transaction
 * closure. Neither path reverses the balance changes those transactions
 * caused — this mirrors the pre-migration behavior; balance correction after a
 * delete is a separate, not-yet-built feature.
 */
export async function deleteAction(input: DeleteActionInput): Promise<ActionResult<null>> {
  const { db, userId } = await getSessionContext();

  try {
    return await db.transaction(async (tx) => {
      const transactions = await loadDeletionScope(tx, userId, input);

      if (input.kind === 'transaction') {
        await hideTransactions(tx, userId, transactions);
      } else {
        await deleteTransactionsAndAccount(tx, userId, input.id, transactions);
      }

      return { success: true as const, data: null };
    });
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

export async function deleteAccount(id: string) {
  return deleteAction({ kind: 'account', id });
}

export async function deleteTransaction(id: string) {
  return deleteAction({ kind: 'transaction', id });
}
