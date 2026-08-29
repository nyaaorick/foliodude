'use server';

import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCloudRewardRuleSet } from '@/lib/data/cloud-rules';
import {
  requireSessionContext,
  type RequestSessionContext,
} from '@/lib/supabase/server';
import type { RewardRateRow } from '@/lib/types/database';
import {
  isRewardCurrencyId,
  REWARD_CAP_PERIODS,
  REWARD_CURRENCY_IDS,
  type RewardCurrencyId,
  type RewardRateMap,
  type RewardRule,
  type RewardRuleSet,
} from '@/lib/types/rewards';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import {
  buildRewardRateMapStrict,
  normalizeMoneyAmount,
} from '@/lib/utils/financial-analytics';
import { normalizeRewardRuleSet, parseRewardRuleSet } from '@/lib/utils/reward-rule-schema';

const RewardTransactionSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum([TransactionType.REWARD_TRANSFER_IN, TransactionType.REWARD_REDEEM]),
  amount: z.number().int().positive(),
  memo: z.string().optional(),
  date: z.string().datetime(),
});

const UpdateRewardRateSchema = z.object({
  rewardCurrency: z.enum(REWARD_CURRENCY_IDS),
  usdPer10kPoints: z.number().int().nonnegative(),
});

const UpdateRewardRuleSchema = z.object({
  accountId: z.string().uuid(),
  category: z.string().trim().min(1),
  multiplier: z.number().nonnegative(),
  cap_amount: z.number().finite().min(0).optional(),
  cap_period: z.enum(REWARD_CAP_PERIODS).optional(),
  fallback_rate: z.number().nonnegative().optional(),
});

const ReplaceRewardRulesSchema = z.object({
  accountId: z.string().uuid(),
  ruleSet: z.unknown(),
});

const ApplyCloudRewardRulesSchema = z.object({
  accountId: z.string().uuid(),
  ruleSetId: z.string().trim().min(1),
});

type SupabaseServerClient = RequestSessionContext['supabase'];

type RewardAccountRow = {
  id: string;
  type: string;
  reward_currency: string | null;
  reward_balance: number | null;
  reward_rules?: unknown;
};

async function getAuthenticatedContext() {
  return requireSessionContext();
}

function revalidateRewardPages(accountId?: string) {
  revalidatePath('/accounts');

  if (accountId) {
    revalidatePath(`/accounts/${accountId}`);
  }
}

async function requireRewardAccount(
  supabase: SupabaseServerClient,
  userId: string,
  accountId: string,
): Promise<RewardAccountRow> {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, reward_currency, reward_balance, reward_rules')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (data.type !== 'LIABILITY') {
    throw new Error('Reward actions are only supported on liability accounts');
  }

  return data as RewardAccountRow;
}

function requireRewardCurrency(account: RewardAccountRow): RewardCurrencyId {
  const rewardCurrency = account.reward_currency;

  if (!isRewardCurrencyId(rewardCurrency ?? '')) {
    throw new Error('This account does not have a fixed reward currency');
  }

  return rewardCurrency as RewardCurrencyId;
}

async function replaceRewardRulesForAccount(
  supabase: SupabaseServerClient,
  userId: string,
  accountId: string,
  rules: RewardRule[],
): Promise<RewardRule[]> {
  await requireRewardAccount(supabase, userId, accountId);

  const { error } = await supabase
    .from('accounts')
    .update({ reward_rules: rules as unknown as Record<string, unknown>[] })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidateRewardPages(accountId);
  return rules;
}

export async function getRewardRates(context: RequestSessionContext): Promise<RewardRateMap> {
  const { data, error } = await context.supabase
    .from('reward_rates')
    .select('user_id, reward_currency, usd_per_10k_points, updated_at')
    .eq('user_id', context.userId);

  if (error) {
    throw new Error(error.message);
  }

  return buildRewardRateMapStrict(data as RewardRateRow[]);
}

export async function updateRewardRate(
  input: z.infer<typeof UpdateRewardRateSchema>,
): Promise<{ rewardCurrency: RewardCurrencyId; usdPer10kPoints: number }> {
  const { supabase, userId } = await getAuthenticatedContext();
  const normalizedInput = UpdateRewardRateSchema.parse(input);

  const { error } = await supabase.from('reward_rates').upsert(
    {
      user_id: userId,
      reward_currency: normalizedInput.rewardCurrency,
      usd_per_10k_points: normalizedInput.usdPer10kPoints,
    },
    { onConflict: 'user_id,reward_currency' },
  );

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/accounts');
  revalidatePath('/accounts/[id]', 'page');

  return normalizedInput;
}

export async function createRewardTransaction(
  input: z.infer<typeof RewardTransactionSchema>,
): Promise<{ transaction: Transaction }> {
  const { supabase, userId } = await getAuthenticatedContext();
  const normalizedInput = RewardTransactionSchema.parse(input);
  const account = await requireRewardAccount(supabase, userId, normalizedInput.accountId);
  const rewardCurrency = requireRewardCurrency(account);
  const currentBalance = new Decimal(account.reward_balance ?? 0);
  const amount = new Decimal(normalizedInput.amount);

  if (normalizedInput.type === TransactionType.REWARD_REDEEM && currentBalance.lt(amount)) {
    throw new Error('Insufficient reward balance');
  }

  const nextRewardBalance =
    normalizedInput.type === TransactionType.REWARD_TRANSFER_IN
      ? currentBalance.plus(amount).toNumber()
      : currentBalance.minus(amount).toNumber();
  const normalizedMemo = normalizedInput.memo?.trim() ? normalizedInput.memo.trim() : null;

  const { data: transactionRow, error: insertError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: normalizedInput.type,
      amount: normalizedInput.amount,
      currency: null,
      reward_currency: rewardCurrency,
      metadata: {},
      reference_transaction_id: null,
      from_account:
        normalizedInput.type === TransactionType.REWARD_REDEEM
          ? normalizedInput.accountId
          : null,
      to_account:
        normalizedInput.type === TransactionType.REWARD_TRANSFER_IN
          ? normalizedInput.accountId
          : null,
      category: null,
      memo: normalizedMemo,
      transaction_at: normalizedInput.date,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { error: updateError } = await supabase
    .from('accounts')
    .update({ reward_balance: nextRewardBalance })
    .eq('id', normalizedInput.accountId)
    .eq('user_id', userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  revalidateRewardPages(normalizedInput.accountId);

  return { transaction: transactionRow as Transaction };
}

export type UpdateRewardRuleInput = z.infer<typeof UpdateRewardRuleSchema>;

export async function updateRewardRule(input: UpdateRewardRuleInput): Promise<RewardRule> {
  const { supabase, userId } = await getAuthenticatedContext();
  const normalizedInput = UpdateRewardRuleSchema.parse(input);
  const account = await requireRewardAccount(supabase, userId, normalizedInput.accountId);
  const rules = (account.reward_rules ?? []) as RewardRule[];

  const newRule: RewardRule = {
    category: normalizedInput.category,
    multiplier: normalizedInput.multiplier,
    rule_source: 'manual',
    cap_amount:
      normalizedInput.cap_amount == null
        ? undefined
        : normalizeMoneyAmount(normalizedInput.cap_amount),
    cap_period: normalizedInput.cap_period,
    fallback_rate: normalizedInput.fallback_rate,
  };

  const existingRuleIdx = rules.findIndex((rule) => rule.category === normalizedInput.category);
  const updatedRules =
    existingRuleIdx >= 0
      ? rules.map((rule, index) => (index === existingRuleIdx ? newRule : rule))
      : [...rules, newRule];

  const { error } = await supabase
    .from('accounts')
    .update({ reward_rules: updatedRules as unknown as Record<string, unknown>[] })
    .eq('id', normalizedInput.accountId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidateRewardPages(normalizedInput.accountId);
  return newRule;
}

export async function importRewardRules(
  input: z.infer<typeof ReplaceRewardRulesSchema>,
): Promise<RewardRuleSet> {
  const { supabase, userId } = await getAuthenticatedContext();
  const parsed = ReplaceRewardRulesSchema.parse(input);
  const ruleSet = normalizeRewardRuleSet(parseRewardRuleSet(parsed.ruleSet), 'imported');

  await replaceRewardRulesForAccount(supabase, userId, parsed.accountId, ruleSet.rules);

  return ruleSet;
}

export async function applyCloudRewardRules(
  input: z.infer<typeof ApplyCloudRewardRulesSchema>,
): Promise<RewardRuleSet> {
  const { supabase, userId } = await getAuthenticatedContext();
  const parsed = ApplyCloudRewardRulesSchema.parse(input);
  const ruleSet = getCloudRewardRuleSet(parsed.ruleSetId);

  if (!ruleSet) {
    throw new Error('Cloud reward rule set not found');
  }

  await replaceRewardRulesForAccount(supabase, userId, parsed.accountId, ruleSet.rules);

  return ruleSet;
}
