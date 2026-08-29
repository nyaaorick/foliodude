'use server';

import {
  requireSessionContext,
  type RequestSessionContext,
} from '@/lib/supabase/server';
import {
  AccountType,
  type AccountOption,
  type AccountWithStats,
} from '@/lib/types/accounts';
import type { AccountRow, RewardRateRow, TransactionRow } from '@/lib/types/database';
import {
  getDefaultRewardRateMap,
  isRewardCurrencyId,
  type RewardRateMap,
} from '@/lib/types/rewards';
import {
  TransactionType,
  type LinkedTransactionSummary,
  type Transaction,
  type TransactionWithReward,
} from '@/lib/types/transactions';
import {
  mapAccountRowToAccount,
  buildRewardRateMap,
} from '@/lib/utils/financial-analytics';

const ACCOUNT_TYPE_ORDER: Record<AccountType, number> = {
  [AccountType.ASSET]: 0,
  [AccountType.LIABILITY]: 1,
  [AccountType.AIRLINE_MILES]: 2,
  [AccountType.SHARE]: 3,
};
const HIDDEN_MARKER = '[HIDDEN]';

type AccountOptionRow = Pick<
  AccountRow,
  | 'id'
  | 'name'
  | 'type'
  | 'balance'
  | 'currency'
  | 'reward_currency'
  | 'reward_balance'
  | 'airline_program'
  | 'brokerage_account_id'
>;

export interface AccountDetailSupportData {
  accounts: AccountOption[];
  rewardRates: RewardRateMap;
}

function mapAccount(row: AccountRow): AccountWithStats {
  const account = mapAccountRowToAccount(row);

  return {
    ...account,
    available_credit:
      account.type === AccountType.LIABILITY && account.credit_limit !== null
        ? account.credit_limit + account.balance
        : null,
  };
}

function mapAccountOption(row: AccountOptionRow): AccountOption {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    balance: row.balance,
    currency: row.currency as AccountWithStats['currency'],
    reward_currency: isRewardCurrencyId(row.reward_currency ?? '')
      ? (row.reward_currency as AccountWithStats['reward_currency'])
      : null,
    reward_balance: row.reward_balance ?? 0,
    airline_program: row.airline_program,
    brokerage_account_id: row.brokerage_account_id ?? null,
  };
}

function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type as TransactionType,
    amount: row.amount,
    currency: row.currency,
    reward_currency: row.reward_currency,
    metadata: row.metadata,
    reference_transaction_id: row.reference_transaction_id,
    from_account: row.from_account,
    to_account: row.to_account,
    category: row.category,
    memo: row.memo,
    share_ticker: row.share_ticker,
    share_quantity: row.share_quantity,
    share_price: row.share_price,
    fee: row.fee,
    transaction_at: row.transaction_at,
    created_at: row.created_at,
  };
}

function sortAccounts<T extends { type: AccountType }>(accounts: T[]): T[] {
  return accounts.sort((a, b) => ACCOUNT_TYPE_ORDER[a.type] - ACCOUNT_TYPE_ORDER[b.type]);
}

export async function getAccounts(
  context: RequestSessionContext,
): Promise<AccountWithStats[]> {
  const { data, error } = await context.supabase
    .from('accounts')
    .select('*')
    .eq('user_id', context.userId);

  if (error) {
    throw new Error(error.message);
  }

  return sortAccounts(((data ?? []) as AccountRow[]).map(mapAccount));
}

export async function getAccountById(id: string): Promise<AccountWithStats> {
  const context = await requireSessionContext();

  const { data, error } = await context.supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .eq('user_id', context.userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Account not found');
  }

  return mapAccount(data as AccountRow);
}

export async function loadAccountDetailCore(
  context: RequestSessionContext,
  accountId: string,
): Promise<AccountWithStats | null> {
  const { data, error } = await context.supabase
    .from('accounts')
    .select('*')
    .eq('user_id', context.userId)
    .eq('id', accountId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapAccount(data as AccountRow);
}

export async function loadAccountDetailSupport(
  context: RequestSessionContext,
): Promise<AccountDetailSupportData> {
  const [accountsResult, rewardRatesResult] = await Promise.all([
    context.supabase
      .from('accounts')
      .select(
        'id, name, type, balance, currency, reward_currency, reward_balance, airline_program, brokerage_account_id',
      )
      .eq('user_id', context.userId),
    context.supabase
      .from('reward_rates')
      .select('user_id, reward_currency, usd_per_10k_points, updated_at')
      .eq('user_id', context.userId),
  ]);

  const accounts = accountsResult.error
    ? []
    : sortAccounts(((accountsResult.data ?? []) as AccountOptionRow[]).map(mapAccountOption));

  const rewardRates = rewardRatesResult.error
    ? getDefaultRewardRateMap()
    : buildRewardRateMap(rewardRatesResult.data as RewardRateRow[] | null);

  return { accounts, rewardRates };
}

export async function loadAccountTransactions(
  context: RequestSessionContext,
  accountId: string,
): Promise<TransactionWithReward[]> {
  const { data, error } = await context.supabase
    .from('transactions')
    .select('*')
    .eq('user_id', context.userId)
    .or(
      `and(from_account.eq.${accountId},memo.is.null),and(to_account.eq.${accountId},memo.is.null),and(from_account.eq.${accountId},memo.not.ilike.*${HIDDEN_MARKER}*),and(to_account.eq.${accountId},memo.not.ilike.*${HIDDEN_MARKER}*)`,
    )
    .order('transaction_at', { ascending: false });

  if (error) {
    return [];
  }

  const transactions = ((data ?? []) as TransactionRow[]).map(mapTransaction);
  const referenceIds = [
    ...new Set(
      transactions
        .map((transaction) => transaction.reference_transaction_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  let referenceLookup = new Map<string, LinkedTransactionSummary>();

  if (referenceIds.length > 0) {
    const { data: referenceRows, error: referenceError } = await context.supabase
      .from('transactions')
      .select('id, type, from_account, to_account')
      .eq('user_id', context.userId)
      .in('id', referenceIds);

    if (!referenceError) {
      referenceLookup = new Map(
        ((referenceRows ?? []) as Array<
          Pick<TransactionRow, 'id' | 'type' | 'from_account' | 'to_account'>
        >).map((transaction) => [
          transaction.id,
          {
            id: transaction.id,
            type: transaction.type as TransactionType,
            from_account: transaction.from_account,
            to_account: transaction.to_account,
          },
        ]),
      );
    }
  }

  return transactions.map((transaction) => ({
    ...transaction,
    reference_transaction: transaction.reference_transaction_id
      ? referenceLookup.get(transaction.reference_transaction_id) ?? null
      : null,
  }));
}
