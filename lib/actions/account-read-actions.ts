import { getSessionContext } from '@/lib/db/session';
import { one, rows } from '@/lib/db/sql';
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
    transaction_date: row.transaction_date,
    created_at: row.created_at,
  };
}

function sortAccounts<T extends { type: AccountType }>(accounts: T[]): T[] {
  return accounts.sort((a, b) => ACCOUNT_TYPE_ORDER[a.type] - ACCOUNT_TYPE_ORDER[b.type]);
}

export async function getAccounts(): Promise<AccountWithStats[]> {
  const { db } = await getSessionContext();
  const accountRows = await rows<AccountRow>(db, 'SELECT * FROM accounts_flat');
  return sortAccounts(accountRows.map(mapAccount));
}

export async function getAccountById(id: string): Promise<AccountWithStats> {
  const { db } = await getSessionContext();
  const row = await one<AccountRow>(
    db,
    'SELECT * FROM accounts_flat WHERE id = $1',
    [id],
    'Account not found',
  );
  return mapAccount(row);
}

/** Same lookup as `getAccountById`, but `null` on a miss instead of throwing. */
export async function loadAccountDetailCore(accountId: string): Promise<AccountWithStats | null> {
  const { db } = await getSessionContext();
  const result = await db.query<AccountRow>(
    'SELECT * FROM accounts_flat WHERE id = $1',
    [accountId],
  );
  return result.rows[0] ? mapAccount(result.rows[0]) : null;
}

export async function loadAccountDetailSupport(): Promise<AccountDetailSupportData> {
  const { db } = await getSessionContext();

  const [accountRows, rewardRateRows] = await Promise.all([
    rows<AccountOptionRow>(
      db,
      `SELECT id, name, type, balance, currency, reward_currency, reward_balance,
              airline_program, brokerage_account_id
         FROM accounts_flat`,
    ),
    rows<RewardRateRow>(
      db,
      'SELECT reward_currency, usd_per_10k_points, updated_at FROM reward_rates',
    ),
  ]);

  return {
    accounts: sortAccounts(accountRows.map(mapAccountOption)),
    rewardRates: rewardRateRows.length > 0
      ? buildRewardRateMap(rewardRateRows)
      : getDefaultRewardRateMap(),
  };
}

/**
 * An account's ledger, newest first, with each row's reward/mileage origin
 * transaction attached for display (e.g. "earned from" a specific expense).
 * Deleted (tombstoned) rows are omitted.
 */
export async function loadAccountTransactions(accountId: string): Promise<TransactionWithReward[]> {
  const { db } = await getSessionContext();

  const transactionRows = await rows<TransactionRow>(
    db,
    `SELECT * FROM transactions
      WHERE (from_account = $1 OR to_account = $1) AND deleted_at IS NULL
      ORDER BY transaction_date DESC, seq DESC`,
    [accountId],
  );

  const transactions = transactionRows.map(mapTransaction);
  const referenceIds = [
    ...new Set(
      transactions
        .map((transaction) => transaction.reference_transaction_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  let referenceLookup = new Map<string, LinkedTransactionSummary>();

  if (referenceIds.length > 0) {
    const referenceRows = await rows<
      Pick<TransactionRow, 'id' | 'type' | 'from_account' | 'to_account'>
    >(
      db,
      'SELECT id, type, from_account, to_account FROM transactions WHERE id = ANY($1)',
      [referenceIds],
    );

    referenceLookup = new Map(
      referenceRows.map((transaction) => [
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

  return transactions.map((transaction) => ({
    ...transaction,
    reference_transaction: transaction.reference_transaction_id
      ? referenceLookup.get(transaction.reference_transaction_id) ?? null
      : null,
  }));
}
