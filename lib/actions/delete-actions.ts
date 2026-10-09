import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import type { Queryable } from '@/lib/db/session';
import { isCheckViolation, maybeOne, rows } from '@/lib/db/sql';
import { syncShareBalance } from '@/lib/actions/share-actions';
import { TransactionType } from '@/lib/types/transactions';
import type { RewardRule, SpendStats } from '@/lib/types/rewards';
import { SUPPORTED_DELETE_TRANSACTION_TYPES } from '@/lib/utils/delete-support';
import { buildStatsKey, findMatchedRule } from '@/lib/utils/rewards-engine';

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
  metadata: Record<string, unknown>;
  deleted_at: string | null;
}

const TRANSACTION_SELECT_COLUMNS =
  'id, type, amount, from_account, to_account, reference_transaction_id, category, transaction_date, metadata, deleted_at';

function fail(message: string): never {
  throw new Error(message);
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

/**
 * Reads see live rows only, except when an account is being deleted: its
 * tombstoned rows must go with it, and a tombstoned row can still be pointed at
 * by rows in the same closure.
 */
function visibility(includeDeleted: boolean): string {
  return includeDeleted ? '' : ' AND deleted_at IS NULL';
}

async function fetchTransactionById(
  db: Queryable,
  id: string,
  includeDeleted: boolean,
): Promise<RelatedTransactionRecord> {
  const data = await maybeOne<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions WHERE id = $1${visibility(includeDeleted)}`,
    [id],
  );
  if (!data) fail(`Transaction ${id} not found`);
  return data;
}

function fetchTransactionsByReferenceId(db: Queryable, referenceId: string, includeDeleted: boolean) {
  return rows<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions
      WHERE reference_transaction_id = $1${visibility(includeDeleted)}`,
    [referenceId],
  );
}

function fetchDirectAccountTransactions(db: Queryable, accountIds: string[], includeDeleted: boolean) {
  return rows<RelatedTransactionRecord>(
    db,
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions
      WHERE (from_account = ANY($1) OR to_account = ANY($1))${visibility(includeDeleted)}`,
    [accountIds],
  );
}

async function assertLatestShareTrade(db: Queryable, transaction: RelatedTransactionRecord) {
  const shareAccountId = getShareAccountId(transaction);
  const latest = await maybeOne<RelatedTransactionRecord>(
    db,
    // Casting the enum column to text (rather than casting $2 to
    // transaction_type[]) is what PGlite's array-bind parser accepts — see
    // lib/db/sql.ts's note on enum-typed ANY() params.
    `SELECT ${TRANSACTION_SELECT_COLUMNS} FROM transactions
      WHERE (from_account = $1 OR to_account = $1)
        AND type::text = ANY($2) AND deleted_at IS NULL
      ORDER BY transaction_date DESC, seq DESC
      LIMIT 1`,
    [shareAccountId, [TransactionType.SHARE_BUY, TransactionType.SHARE_SELL]],
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
 * of a linked pair. Read-only: callers apply the actual reversal and delete.
 */
async function loadDeletionScope(
  db: Queryable,
  input: DeleteActionInput,
  doomedAccountIds: string[],
): Promise<Map<string, RelatedTransactionRecord>> {
  const includeDeleted = input.kind === 'account';
  const transactions = new Map<string, RelatedTransactionRecord>();
  const processedIds = new Set<string>();

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
          await assertLatestShareTrade(db, transaction);
        }
        return;
      case TransactionType.REWARD_REDEEM:
        if (!transaction.reference_transaction_id) return;
        await collectTransaction(
          await fetchTransactionById(db, transaction.reference_transaction_id, includeDeleted),
        );
        for (const linked of await fetchTransactionsByReferenceId(
          db,
          transaction.reference_transaction_id,
          includeDeleted,
        )) {
          if (linked.type !== TransactionType.REWARD_REDEEM) {
            fail(`Linked transaction ${linked.id} is not a reward redeem`);
          }
          await collectTransaction(linked);
        }
        return;
      case TransactionType.MILEAGE_TRANSFER_IN:
        for (const linked of await fetchTransactionsByReferenceId(db, transaction.id, includeDeleted)) {
          if (linked.type !== TransactionType.REWARD_REDEEM) {
            fail(`Linked transaction ${linked.id} is not a reward redeem`);
          }
          await collectTransaction(linked);
        }
        return;
      case TransactionType.REWARD_EARN:
      case TransactionType.MILEAGE_REDEEM_FLIGHT:
        // Both point back at the expense they belong to (the one that earned the
        // points / the one that paid the taxes).
        if (!transaction.reference_transaction_id) {
          fail(`${transaction.type} ${transaction.id} is missing its parent expense`);
        }
        await collectTransaction(
          await fetchTransactionById(db, transaction.reference_transaction_id, includeDeleted),
        );
        return;
      case TransactionType.EXPENSE:
        for (const linked of await fetchTransactionsByReferenceId(db, transaction.id, includeDeleted)) {
          if (
            linked.type !== TransactionType.REWARD_EARN &&
            linked.type !== TransactionType.MILEAGE_REDEEM_FLIGHT
          ) {
            fail(`Linked transaction ${linked.id} is not a reward earn or mileage redemption`);
          }
          await collectTransaction(linked);
        }
        return;
      default:
        fail(`Delete action does not support ${transaction.type}`);
    }
  };

  if (input.kind === 'account') {
    for (const transaction of await fetchDirectAccountTransactions(db, doomedAccountIds, true)) {
      await collectTransaction(transaction);
    }
  } else {
    await collectTransaction(await fetchTransactionById(db, input.id, false));
  }

  return transactions;
}

// ── Reversing a transaction's effect on balances ────────────────────────────
// Every helper skips accounts in `doomed` — an account that is itself being
// deleted needs no correction, and correcting it could trip a CHECK for no
// reason.

async function addBalance(
  db: Queryable,
  accountId: string | null,
  delta: Decimal.Value,
  doomed: Set<string>,
): Promise<void> {
  if (!accountId || doomed.has(accountId)) return;
  try {
    await db.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [
      new Decimal(delta).toNumber(),
      accountId,
    ]);
  } catch (error) {
    if (isCheckViolation(error)) {
      fail('Cannot delete: the balance it added has already been spent');
    }
    throw error;
  }
}

async function addRewardBalance(
  db: Queryable,
  accountId: string | null,
  delta: Decimal.Value,
  doomed: Set<string>,
): Promise<void> {
  if (!accountId || doomed.has(accountId)) return;
  try {
    await db.query(
      'UPDATE liability_details SET reward_balance = reward_balance + $1 WHERE account_id = $2',
      [new Decimal(delta).toNumber(), accountId],
    );
  } catch (error) {
    if (isCheckViolation(error)) {
      fail('Cannot delete: the reward points it added have already been spent');
    }
    throw error;
  }
}

/**
 * Take a reward-earning expense's spend back out of the card's cap tracking.
 * The key is rebuilt from the card's current rules, so if the rule changed since
 * the expense the key may no longer exist — in which case there is nothing to
 * take back.
 */
async function reverseSpendStats(
  db: Queryable,
  earn: RelatedTransactionRecord,
  expense: RelatedTransactionRecord,
  doomed: Set<string>,
): Promise<void> {
  if (!earn.to_account || doomed.has(earn.to_account)) return;

  const card = await maybeOne<{ reward_rules: RewardRule[]; spend_stats: SpendStats }>(
    db,
    'SELECT reward_rules, spend_stats FROM liability_details WHERE account_id = $1',
    [earn.to_account],
  );
  if (!card) return;

  const category = earn.category ?? '';
  const key = buildStatsKey(
    category,
    expense.transaction_date,
    findMatchedRule(card.reward_rules, category)?.cap_period,
  );
  const spent = card.spend_stats[key];
  if (spent === undefined) return;

  const stats = { ...card.spend_stats };
  const remaining = new Decimal(spent).minus(expense.amount);
  if (remaining.lte(0)) delete stats[key];
  else stats[key] = remaining.toNumber();

  await db.query('UPDATE liability_details SET spend_stats = $1::jsonb WHERE account_id = $2', [
    JSON.stringify(stats),
    earn.to_account,
  ]);
}

/** Put a share position back to how it was before the trade being deleted. */
async function restoreSharePosition(
  db: Queryable,
  shareAccountId: string,
  trade: RelatedTransactionRecord,
  doomed: Set<string>,
): Promise<void> {
  if (doomed.has(shareAccountId)) return;

  await db.query('UPDATE share_details SET shares = $1, cost_basis = $2 WHERE account_id = $3', [
    trade.metadata.shares_before,
    trade.metadata.cost_basis_before,
    shareAccountId,
  ]);
  await syncShareBalance(db, shareAccountId);
}

async function reverseTransaction(
  db: Queryable,
  transaction: RelatedTransactionRecord,
  scope: Map<string, RelatedTransactionRecord>,
  doomed: Set<string>,
): Promise<void> {
  const { amount, from_account: from, to_account: to } = transaction;

  switch (transaction.type) {
    case TransactionType.EXPENSE:
      return addBalance(db, from, amount, doomed);
    case TransactionType.INCOME:
      return addBalance(db, to, new Decimal(amount).neg(), doomed);
    case TransactionType.TRANSFER: {
      // A cross-currency transfer credited the target amount, not `amount`.
      const credited =
        typeof transaction.metadata.target_amount === 'number' ? transaction.metadata.target_amount : amount;
      await addBalance(db, from, amount, doomed);
      return addBalance(db, to, new Decimal(credited).neg(), doomed);
    }
    case TransactionType.REWARD_EARN: {
      await addRewardBalance(db, to, new Decimal(amount).neg(), doomed);
      return reverseSpendStats(db, transaction, scope.get(transaction.reference_transaction_id!)!, doomed);
    }
    case TransactionType.REWARD_TRANSFER_IN:
      return addRewardBalance(db, to, new Decimal(amount).neg(), doomed);
    case TransactionType.REWARD_REDEEM:
      return addRewardBalance(db, from, amount, doomed);
    case TransactionType.MILEAGE_TRANSFER_IN:
    case TransactionType.MILEAGE_MANUAL_IN:
      return addBalance(db, to, new Decimal(amount).neg(), doomed);
    case TransactionType.MILEAGE_REDEEM_FLIGHT:
      return addBalance(db, from, amount, doomed);
    case TransactionType.SHARE_BUY:
      await addBalance(db, from, amount, doomed);
      return restoreSharePosition(db, to!, transaction, doomed);
    case TransactionType.SHARE_SELL:
      await addBalance(db, to, new Decimal(amount).neg(), doomed);
      return restoreSharePosition(db, from!, transaction, doomed);
    default:
      fail(`Delete action does not support ${transaction.type}`);
  }
}

/**
 * Delete an account or a transaction, along with everything linked to it, and
 * undo the balance changes the transactions caused.
 *
 * A transaction delete is a tombstone (`deleted_at`): the row stays for
 * referential integrity (other rows may still point at it) and drops out of
 * every ledger read. An account delete is a hard delete of the account and its
 * full transaction closure — tombstoned rows included — and corrects the
 * balances of the accounts on the other side of those transactions.
 *
 * Deleting a brokerage cash account also deletes the share positions held
 * through it (first: the foreign key from a position to its brokerage has no
 * delete action).
 */
export async function deleteAction(input: DeleteActionInput): Promise<ActionResult<null>> {
  const { db } = await getSessionContext();

  try {
    return await db.transaction(async (tx) => {
      const doomedAccountIds: string[] = [];
      if (input.kind === 'account') {
        const positions = await rows<{ account_id: string }>(
          tx,
          'SELECT account_id FROM share_details WHERE brokerage_account_id = $1',
          [input.id],
        );
        doomedAccountIds.push(input.id, ...positions.map((position) => position.account_id));
      }

      const scope = await loadDeletionScope(tx, input, doomedAccountIds);
      const doomed = new Set(doomedAccountIds);

      // Tombstoned rows were reversed when they were deleted.
      for (const transaction of scope.values()) {
        if (transaction.deleted_at === null) {
          await reverseTransaction(tx, transaction, scope, doomed);
        }
      }

      const ids = [...scope.keys()];
      if (input.kind === 'transaction') {
        await tx.query('UPDATE transactions SET deleted_at = now() WHERE id = ANY($1)', [ids]);
      } else {
        if (ids.length > 0) {
          await tx.query('DELETE FROM transactions WHERE id = ANY($1)', [ids]);
        }
        // Positions before their brokerage: `doomedAccountIds` lists the target first.
        for (const accountId of [...doomedAccountIds].reverse()) {
          await tx.query('DELETE FROM accounts WHERE id = $1', [accountId]);
        }
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
