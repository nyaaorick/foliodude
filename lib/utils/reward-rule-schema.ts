import { z } from 'zod';
import {
  REWARD_CAP_PERIODS,
  REWARD_RULE_SOURCES,
  type RewardRule,
  type RewardRuleSet,
  type RewardRuleSetSource,
} from '@/lib/types/rewards';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const RewardRuleSchema = z.object({
  category: z.string().trim().min(1),
  multiplier: z.number().nonnegative(),
  rule_source: z.enum(REWARD_RULE_SOURCES),
  cap_amount: z.number().finite().min(0).optional(),
  cap_period: z.enum(REWARD_CAP_PERIODS).optional(),
  fallback_rate: z.number().nonnegative().optional(),
}).passthrough();

const RewardRuleSetSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  source: z.enum(['imported', 'cloud']),
  version: z.number().int().positive(),
  rules: z.array(RewardRuleSchema),
});

function ensureUniqueCategories(rules: RewardRule[]) {
  const categories = new Set<string>();
  for (const rule of rules) {
    const normalizedCategory = rule.category.trim().toLowerCase();
    if (categories.has(normalizedCategory)) {
      throw new Error(`Duplicate reward rule category: ${rule.category}`);
    }
    categories.add(normalizedCategory);
  }
}

export function parseRewardRuleSet(input: unknown): RewardRuleSet {
  const parsed = RewardRuleSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  ensureUniqueCategories(parsed.data.rules);
  return parsed.data as RewardRuleSet;
}

export function normalizeRewardRuleSet(
  ruleSet: RewardRuleSet,
  sourceOverride?: RewardRuleSetSource,
): RewardRuleSet {
  const source = sourceOverride ?? ruleSet.source;
  const rules = ruleSet.rules.map((rule) => ({
    category: rule.category,
    multiplier: rule.multiplier,
    rule_source: source,
    cap_amount:
      rule.cap_amount == null ? undefined : normalizeMoneyAmount(rule.cap_amount),
    cap_period: rule.cap_period,
    fallback_rate: rule.fallback_rate,
  }));

  ensureUniqueCategories(rules);

  return {
    ...ruleSet,
    source,
    rules,
  };
}
