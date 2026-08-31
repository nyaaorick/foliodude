import Decimal from 'decimal.js';
import { z } from 'zod';
import { getCloudRewardRuleSet } from '@/lib/data/cloud-rules';
import { getSessionContext } from '@/lib/db/session';
import { one, rows } from '@/lib/db/sql';
import type { Queryable } from '@/lib/db/session';
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
import { buildRewardRateMapStrict, normalizeMoneyAmount } from '@/lib/utils/financial-analytics';
import { normalizeRewardRuleSet, parseRewardRuleSet } from '@/lib/utils/reward-rule-schema';

const RewardTransactionSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum([TransactionType.REWARD_TRANSFER_IN, TransactionType.REWARD_REDEEM]),
  amount: z.number().int().positive(),
  memo: z.string().optional(),
  date: z.string().date(),
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

interface RewardAccountRow {
  id: string;
  type: string;
  reward_currency: string | null;
  reward_balance: number;
  reward_rules: RewardRule[];
}

async function requireRewardAccount(
  db: Queryable,
  userId: string,
  accountId: string,
): Promise<RewardAccountRow> {
  const account = await one<RewardAccountRow>(
    db,
    'SELECT id, type, reward_currency, reward_balance, reward_rules FROM accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId],
    'Account not found',
  );
  if (account.type !== 'LIABILITY') {
    throw new Error('Reward actions are only supported on liability accounts');
  }
  return account;
}

function requireRewardCurrency(account: RewardAccountRow): RewardCurrencyId {
  if (!isRewardCurrencyId(account.reward_currency ?? '')) {
    throw new Error('This account does not have a fixed reward currency');
  }
  return account.reward_currency as RewardCurrencyId;
}

async function replaceRewardRulesForAccount(
  db: Queryable,
  userId: string,
  accountId: string,
  rules: RewardRule[],
): Promise<RewardRule[]> {
  await requireRewardAccount(db, userId, accountId);
  await db.query('UPDATE accounts SET reward_rules = $1::jsonb WHERE id = $2 AND user_id = $3', [
    JSON.stringify(rules),
    accountId,
    userId,
  ]);
  return rules;
}

export async function getRewardRates(): Promise<RewardRateMap> {
  const { db, userId } = await getSessionContext();
  const rateRows = await rows<RewardRateRow>(
    db,
    'SELECT user_id, reward_currency, usd_per_10k_points, updated_at FROM reward_rates WHERE user_id = $1',
    [userId],
  );
  return buildRewardRateMapStrict(rateRows);
}

export async function updateRewardRate(
  input: z.infer<typeof UpdateRewardRateSchema>,
): Promise<{ rewardCurrency: RewardCurrencyId; usdPer10kPoints: number }> {
  const { db, userId } = await getSessionContext();
  const normalizedInput = UpdateRewardRateSchema.parse(input);

  await db.query(
    `INSERT INTO reward_rates (user_id, reward_currency, usd_per_10k_points)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, reward_currency) DO UPDATE SET usd_per_10k_points = EXCLUDED.usd_per_10k_points`,
    [userId, normalizedInput.rewardCurrency, normalizedInput.usdPer10kPoints],
  );

  return normalizedInput;
}

/** Move points into or out of a liability account's reward balance directly (no cash leg). */
export async function createRewardTransaction(
  input: z.infer<typeof RewardTransactionSchema>,
): Promise<{ transaction: Transaction }> {
  const { db, userId } = await getSessionContext();
  const normalizedInput = RewardTransactionSchema.parse(input);

  return db.transaction(async (tx) => {
    const account = await requireRewardAccount(tx, userId, normalizedInput.accountId);
    const rewardCurrency = requireRewardCurrency(account);
    const currentBalance = new Decimal(account.reward_balance);
    const amount = new Decimal(normalizedInput.amount);

    if (normalizedInput.type === TransactionType.REWARD_REDEEM && currentBalance.lt(amount)) {
      throw new Error('Insufficient reward balance');
    }

    const nextRewardBalance =
      normalizedInput.type === TransactionType.REWARD_TRANSFER_IN
        ? currentBalance.plus(amount).toNumber()
        : currentBalance.minus(amount).toNumber();
    const normalizedMemo = normalizedInput.memo?.trim() ? normalizedInput.memo.trim() : null;
    const isRedeem = normalizedInput.type === TransactionType.REWARD_REDEEM;

    const transaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions
         (user_id, type, amount, reward_currency, metadata, from_account, to_account, memo, transaction_date)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        normalizedInput.type,
        normalizedInput.amount,
        rewardCurrency,
        isRedeem ? normalizedInput.accountId : null,
        isRedeem ? null : normalizedInput.accountId,
        normalizedMemo,
        normalizedInput.date,
      ],
      'Failed to create reward transaction',
    );

    await tx.query('UPDATE accounts SET reward_balance = $1 WHERE id = $2 AND user_id = $3', [
      nextRewardBalance,
      normalizedInput.accountId,
      userId,
    ]);

    return { transaction };
  });
}

export type UpdateRewardRuleInput = z.infer<typeof UpdateRewardRuleSchema>;

/** Upsert one category's multiplier rule by category name (case-sensitive match). */
export async function updateRewardRule(input: UpdateRewardRuleInput): Promise<RewardRule> {
  const { db, userId } = await getSessionContext();
  const normalizedInput = UpdateRewardRuleSchema.parse(input);

  return db.transaction(async (tx) => {
    const account = await requireRewardAccount(tx, userId, normalizedInput.accountId);
    const rules = account.reward_rules ?? [];

    const newRule: RewardRule = {
      category: normalizedInput.category,
      multiplier: normalizedInput.multiplier,
      rule_source: 'manual',
      cap_amount:
        normalizedInput.cap_amount == null ? undefined : normalizeMoneyAmount(normalizedInput.cap_amount),
      cap_period: normalizedInput.cap_period,
      fallback_rate: normalizedInput.fallback_rate,
    };

    const existingRuleIdx = rules.findIndex((rule) => rule.category === normalizedInput.category);
    const updatedRules =
      existingRuleIdx >= 0
        ? rules.map((rule, index) => (index === existingRuleIdx ? newRule : rule))
        : [...rules, newRule];

    await tx.query('UPDATE accounts SET reward_rules = $1::jsonb WHERE id = $2 AND user_id = $3', [
      JSON.stringify(updatedRules),
      normalizedInput.accountId,
      userId,
    ]);

    return newRule;
  });
}

export async function importRewardRules(
  input: z.infer<typeof ReplaceRewardRulesSchema>,
): Promise<RewardRuleSet> {
  const { db, userId } = await getSessionContext();
  const parsed = ReplaceRewardRulesSchema.parse(input);
  const ruleSet = normalizeRewardRuleSet(parseRewardRuleSet(parsed.ruleSet), 'imported');
  await replaceRewardRulesForAccount(db, userId, parsed.accountId, ruleSet.rules);
  return ruleSet;
}

export async function applyCloudRewardRules(
  input: z.infer<typeof ApplyCloudRewardRulesSchema>,
): Promise<RewardRuleSet> {
  const { db, userId } = await getSessionContext();
  const parsed = ApplyCloudRewardRulesSchema.parse(input);
  const ruleSet = getCloudRewardRuleSet(parsed.ruleSetId);
  if (!ruleSet) {
    throw new Error('Cloud reward rule set not found');
  }
  await replaceRewardRulesForAccount(db, userId, parsed.accountId, ruleSet.rules);
  return ruleSet;
}
