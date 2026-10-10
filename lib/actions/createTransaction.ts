import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { adjustBalance, adjustRewardBalance, insertTransaction, normalizeMemo } from '@/lib/db/ledger';
import { one } from '@/lib/db/sql';
import type { Tx } from '@/lib/db/tx';
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
  currency: string;
  reward_currency: string | null;
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
  tx: Tx,
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
    tx,
    `SELECT currency, reward_currency, reward_rules, spend_stats
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

  const memoValue = normalizeMemo(memo);

  const expense = await insertTransaction(tx, {
    type: TransactionType.EXPENSE,
    amount,
    currency: account.currency,
    from_account: accountId,
    category,
    memo: memoValue,
    transaction_date: date,
  });
  await adjustBalance(tx, accountId, -amount);

  let rewardId: string | null = null;

  if (rewardCurrency && rewardResult.points > 0) {
    const reward = await insertTransaction(tx, {
      type: TransactionType.REWARD_EARN,
      amount: rewardResult.points,
      reward_currency: rewardCurrency,
      reference_transaction_id: expense.id,
      to_account: accountId,
      category,
      memo: memoValue,
      transaction_date: date,
    });
    rewardId = reward.id;

    await adjustRewardBalance(tx, accountId, rewardResult.points);

    const statsKey = buildStatsKey(category, date, findMatchedRule(rules, category)?.cap_period);
    const updatedStats: SpendStats = { ...currentStats };
    updatedStats[statsKey] = normalizeMoneyAmount((updatedStats[statsKey] ?? 0) + amount);
    await tx.query('UPDATE liability_details SET spend_stats = $1::jsonb WHERE account_id = $2', [
      JSON.stringify(updatedStats),
      accountId,
    ]);
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
 * balance/stats update commit together or not at all, so a failure between
 * them cannot leave an expense with no matching reward, or points that were
 * never credited.
 */
export async function createTransaction(
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const { db } = await getSessionContext();
  return db.transaction((tx) => createTransactionWithinTransaction(tx, input));
}
