'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
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
  date: z.string().datetime(),
});

type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

interface CreateExpenseResult {
  expense_id: string;
  reward_id: string | null;
  reward_points: number;
  reward?: RewardResult;
}

export async function createTransaction(
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const { supabase, userId } = await requireSessionContext();

  const parsed = CreateExpenseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  const {
    accountId,
    category,
    amount: rawAmount,
    memo,
    date,
  } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('balance, currency, reward_currency, reward_balance, reward_rules, spend_stats')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (accountError || !account) {
    throw new Error(accountError?.message ?? 'Account not found');
  }

  const rules = (account.reward_rules ?? []) as RewardRule[];
  const currentStats = (account.spend_stats ?? {}) as SpendStats;
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

  const { data: expenseRow, error: expenseError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: TransactionType.EXPENSE,
      amount,
      currency: account.currency as string,
      reward_currency: null,
      metadata: {},
      reference_transaction_id: null,
      from_account: accountId,
      to_account: null,
      category,
      memo: normalizedMemo,
      transaction_at: date,
    })
    .select('id')
    .single();

  if (expenseError || !expenseRow) {
    throw new Error(expenseError?.message ?? 'Failed to create expense transaction');
  }

  const { error: balanceError } = await supabase
    .from('accounts')
    .update({ balance: nextBalance })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (balanceError) {
    throw new Error(balanceError.message);
  }

  let rewardId: string | null = null;

  if (rewardCurrency && rewardResult.points > 0) {
    const { data: rewardRow, error: rewardError } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        type: TransactionType.REWARD_EARN,
        amount: rewardResult.points,
        currency: null,
        reward_currency: rewardCurrency,
        metadata: {},
        reference_transaction_id: expenseRow.id,
        from_account: null,
        to_account: accountId,
        category,
        memo: normalizedMemo,
        transaction_at: date,
      })
      .select('id')
      .single();

    if (rewardError || !rewardRow) {
      throw new Error(rewardError?.message ?? 'Failed to create reward transaction');
    }

    rewardId = rewardRow.id;

    const { error: rewardUpdateError } = await supabase
      .from('accounts')
      .update({
        reward_balance: updatedRewardBalance,
        spend_stats: updatedStats,
      })
      .eq('id', accountId)
      .eq('user_id', userId);

    if (rewardUpdateError) {
      throw new Error(rewardUpdateError.message);
    }
  }

  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);

  return {
    expense_id: expenseRow.id,
    reward_id: rewardId,
    reward_points: rewardResult.points,
    reward: rewardResult.points > 0 ? rewardResult : undefined,
  };
}
