import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import type { Queryable } from '@/lib/db/session';
import { one } from '@/lib/db/sql';
import {
  buildStatsKey,
  calculateReward,
  findMatchedRule,
} from '@/lib/utils/rewards-engine';
import { isRewardCurrencyId } from '@/lib/types/rewards';
import { TransactionType } from '@/lib/types/transactions';
import type {
  RewardResult,
  RewardRule,
  SpendStats,
} from '@/lib/types/rewards';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const CreateExpenseSchema = z.object({
  accountId: z.string().uuid(),
  category: z.string().min(1),
  amount: z.number().finite().gt(0),
  memo: z.string().optional(),
  date: z.string().date(),
});

type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

interface CreateExpenseResult {
  expense_id: string;
  reward_id: string | null;
  reward_points: number;
  reward?: RewardResult;
}

interface AccountRow {
  balance: number;
  currency: string;
  reward_currency: string | null;
  reward_balance: number;
  reward_rules: RewardRule[] | null;
  spend_stats: SpendStats | null;
}

/**
 * Expense-logging logic, callable standalone (wrapped in its own transaction by
 * `createTransaction`) or from inside a caller's existing transaction — e.g.
 * `redeemMileageFlight` needs its own mileage debit to commit atomically with
 * this expense, and PGlite has no nested-transaction support to open a second
 * one with.
 */
export async function createTransactionWithinTransaction(
  db: Queryable,
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const parsed = CreateExpenseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid expense input');
  }
  const {
    accountId,
    category,
    amount: rawAmount,
    memo,
    date,
  } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);

  const account = await one<AccountRow>(
    db,
    `SELECT balance, currency, reward_currency, reward_balance, reward_rules, spend_stats
       FROM accounts_flat
      WHERE id = $1`,
    [accountId],
    'Account not found',
  );

  const rules = account.reward_rules ?? [];
  const currentStats = account.spend_stats ?? {};
  const rewardCurrency = isRewardCurrencyId(account.reward_currency ?? '')
    ? account.reward_currency
    : null;

  const rewardResult = rewardCurrency
    ? calculateReward(rules, currentStats, category, amount)
    : { points: 0, capped: false };

  let updatedStats = currentStats;
  let updatedRewardBalance = account.reward_balance ?? 0;

  if (rewardCurrency && rewardResult.points > 0) {
    updatedRewardBalance = new Decimal(account.reward_balance ?? 0)
      .plus(rewardResult.points)
      .toNumber();
    const matchedRule = findMatchedRule(rules, category);
    const statsKey = buildStatsKey(category, date, matchedRule?.cap_period);
    updatedStats = { ...currentStats };
    updatedStats[statsKey] = normalizeMoneyAmount((updatedStats[statsKey] ?? 0) + amount);
  }

  const nextBalance = new Decimal(account.balance).minus(amount).toNumber();
  const normalizedMemo = memo?.trim() ? memo.trim() : null;

  const expense = await one<{ id: string }>(
    db,
    `INSERT INTO transactions
       (type, amount, currency, reward_currency, metadata,
        reference_transaction_id, from_account, to_account, category, memo, transaction_date)
     VALUES ($1, $2, $3, NULL, '{}'::jsonb, NULL, $4, NULL, $5, $6, $7)
     RETURNING id`,
    [
      TransactionType.EXPENSE,
      amount,
      account.currency,
      accountId,
      category,
      normalizedMemo,
      date,
    ],
    'Failed to create expense transaction',
  );

  await db.query('UPDATE accounts SET balance = $1 WHERE id = $2', [nextBalance, accountId]);

  let rewardId: string | null = null;

  if (rewardCurrency && rewardResult.points > 0) {
    const reward = await one<{ id: string }>(
      db,
      `INSERT INTO transactions
         (type, amount, currency, reward_currency, metadata,
          reference_transaction_id, from_account, to_account, category, memo, transaction_date)
       VALUES ($1, $2, NULL, $3, '{}'::jsonb, $4, NULL, $5, $6, $7, $8)
       RETURNING id`,
      [
        TransactionType.REWARD_EARN,
        rewardResult.points,
        rewardCurrency,
        expense.id,
        accountId,
        category,
        normalizedMemo,
        date,
      ],
      'Failed to create reward transaction',
    );

    rewardId = reward.id;

    await db.query(
      `UPDATE liability_details SET reward_balance = $1, spend_stats = $2 WHERE account_id = $3`,
      [updatedRewardBalance, JSON.stringify(updatedStats), accountId],
    );
  }

  return {
    expense_id: expense.id,
    reward_id: rewardId,
    reward_points: rewardResult.points,
    reward: rewardResult.points > 0 ? rewardResult : undefined,
  };
}

/**
 * Log an expense, and the reward it earns, as one atomic write.
 *
 * The expense, the balance decrement, the reward transaction and the reward
 * balance/stats update all commit together. Under the previous Supabase client
 * these were four separate round-trips, so a failure between them could leave
 * an expense with no matching reward, or a reward whose points were never
 * credited.
 */
export async function createTransaction(
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const { db } = await getSessionContext();
  return db.transaction((tx) => createTransactionWithinTransaction(tx, input));
}
