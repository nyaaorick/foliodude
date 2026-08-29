'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
import { TransactionType } from '@/lib/types/transactions';
import { SUPPORTED_DELETE_TRANSACTION_TYPES } from '@/lib/utils/delete-support';

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type SupabaseClient = Awaited<ReturnType<typeof requireSessionContext>>['supabase'];

export type DeleteActionInput =
  | { kind: 'account'; id: string }
  | { kind: 'transaction'; id: string };

interface RelatedTransactionRecord {
  id: string;
  type: TransactionType;
  amount: number;
  from_account: string | null;
  to_account: string | null;
  reference_transaction_id: string | null;
  category: string | null;
  transaction_at: string;
  created_at: string;
  memo: string | null;
  metadata: unknown;
  share_quantity: number | null;
  share_price: number | null;
}

const TRANSACTION_SELECT_COLUMNS =
  'id, type, amount, from_account, to_account, reference_transaction_id, category, transaction_at, created_at, memo, metadata, share_quantity, share_price';
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
  supabase: Awaited<ReturnType<typeof requireSessionContext>>['supabase'],
  userId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<RelatedTransactionRecord>();

  if (error) {
    fail(error.message);
  }

  if (!data) {
    fail(`Transaction ${id} not found`);
  }

  return data;
}

async function fetchTransactionsByReferenceId(
  supabase: SupabaseClient,
  userId: string,
  referenceId: string,
) {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_COLUMNS)
    .eq('reference_transaction_id', referenceId)
    .eq('user_id', userId)
    .returns<RelatedTransactionRecord[]>();

  if (error) {
    fail(error.message);
  }

  return data ?? [];
}

async function fetchDirectAccountTransactions(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_COLUMNS)
    .or(`from_account.eq.${accountId},to_account.eq.${accountId}`)
    .eq('user_id', userId)
    .returns<RelatedTransactionRecord[]>();

  if (error) {
    fail(error.message);
  }

  return data ?? [];
}

async function fetchMileageRedeemFlights(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_COLUMNS)
    .eq('type', TransactionType.MILEAGE_REDEEM_FLIGHT)
    .eq('user_id', userId)
    .returns<RelatedTransactionRecord[]>();

  if (error) {
    fail(error.message);
  }

  return data ?? [];
}

async function assertLatestShareTrade(
  supabase: SupabaseClient,
  userId: string,
  transaction: RelatedTransactionRecord,
) {
  const shareAccountId = getShareAccountId(transaction);
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT_COLUMNS)
    .or(`from_account.eq.${shareAccountId},to_account.eq.${shareAccountId}`)
    .in('type', [TransactionType.SHARE_BUY, TransactionType.SHARE_SELL])
    .eq('user_id', userId)
    .order('transaction_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<RelatedTransactionRecord>();

  if (error) {
    fail(error.message);
  }

  if (!data) {
    fail(`No share trade found for account ${shareAccountId}`);
  }

  if (data.id !== transaction.id) {
    fail('Delete action only supports deleting the latest share trade');
  }
}

async function loadDeletionScope(
  supabase: SupabaseClient,
  userId: string,
  input: DeleteActionInput,
) {
  const transactions = new Map<string, RelatedTransactionRecord>();
  const processedIds = new Set<string>();
  const mileageRedeemFlights = await fetchMileageRedeemFlights(supabase, userId);

  const collectTransaction = async (transaction: RelatedTransactionRecord): Promise<void> => {
    if (processedIds.has(transaction.id)) {
      return;
    }

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
          await assertLatestShareTrade(supabase, userId, transaction);
        }
        return;
      case TransactionType.REWARD_REDEEM:
        if (!transaction.reference_transaction_id) {
          return;
        }

        await collectTransaction(
          await fetchTransactionById(supabase, userId, transaction.reference_transaction_id),
        );

        for (const linked of await fetchTransactionsByReferenceId(
          supabase,
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
        for (const linked of await fetchTransactionsByReferenceId(
          supabase,
          userId,
          transaction.id,
        )) {
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
          await fetchTransactionById(supabase, userId, transaction.reference_transaction_id),
        );
        return;
      case TransactionType.EXPENSE:
        for (const linked of await fetchTransactionsByReferenceId(
          supabase,
          userId,
          transaction.id,
        )) {
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
          await fetchTransactionById(
            supabase,
            userId,
            requireTaxExpenseTransactionId(transaction),
          ),
        );
        return;
      default:
        fail(`Delete action does not support ${transaction.type}`);
    }
  };

  if (input.kind === 'account') {
    for (const transaction of await fetchDirectAccountTransactions(
      supabase,
      userId,
      input.id,
    )) {
      await collectTransaction(transaction);
    }
  } else {
    await collectTransaction(await fetchTransactionById(supabase, userId, input.id));
  }

  return transactions;
}

function appendHiddenMarker(memo: string | null): string {
  if (!memo) {
    return HIDDEN_MARKER;
  }

  if (memo.includes(HIDDEN_MARKER)) {
    return memo;
  }

  return `${memo} ${HIDDEN_MARKER}`;
}

async function hideTransactions(
  supabase: SupabaseClient,
  userId: string,
  transactions: Map<string, RelatedTransactionRecord>,
) {
  for (const transaction of transactions.values()) {
    const { error } = await supabase
      .from('transactions')
      .update({ memo: appendHiddenMarker(transaction.memo) })
      .eq('id', transaction.id)
      .eq('user_id', userId);

    if (error) {
      fail(error.message);
    }
  }
}

async function deleteTransactionsAndAccount(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  transactions: Map<string, RelatedTransactionRecord>,
) {
  if (transactions.size > 0) {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('id', [...transactions.keys()])
      .eq('user_id', userId);

    if (error) {
      fail(error.message);
    }
  }

  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    fail(error.message);
  }
}

export async function deleteAction(input: DeleteActionInput): Promise<ActionResult<null>> {
  const { supabase, userId } = await requireSessionContext();

  try {
    const transactions = await loadDeletionScope(supabase, userId, input);
    const touchedAccountIds = new Set<string>();

    if (input.kind === 'account') {
      touchedAccountIds.add(input.id);
    }

    for (const transaction of transactions.values()) {
      if (transaction.from_account) {
        touchedAccountIds.add(transaction.from_account);
      }
      if (transaction.to_account) {
        touchedAccountIds.add(transaction.to_account);
      }
    }

    if (input.kind === 'transaction') {
      await hideTransactions(supabase, userId, transactions);
    } else {
      await deleteTransactionsAndAccount(supabase, userId, input.id, transactions);
    }

    revalidatePath('/dashboard');
    revalidatePath('/accounts');
    for (const accountId of touchedAccountIds) {
      revalidatePath(`/accounts/${accountId}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    throw error;
  }

  return { success: true, data: null };
}

export async function deleteAccount(id: string) {
  return deleteAction({ kind: 'account', id });
}

export async function deleteTransaction(id: string) {
  return deleteAction({ kind: 'transaction', id });
}
