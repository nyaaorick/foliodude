import amexGoldRuleSetJson from './amex-gold.json';
import type { RewardRuleSet } from '@/lib/types/rewards';
import { normalizeRewardRuleSet, parseRewardRuleSet } from '@/lib/utils/reward-rule-schema';

const parsedRuleSets = [amexGoldRuleSetJson].map((ruleSetJson) =>
  normalizeRewardRuleSet(parseRewardRuleSet(ruleSetJson), 'cloud'),
);

export const CLOUD_REWARD_RULE_SETS = parsedRuleSets as RewardRuleSet[];

export function getCloudRewardRuleSet(ruleSetId: string): RewardRuleSet | undefined {
  return CLOUD_REWARD_RULE_SETS.find((ruleSet) => ruleSet.id === ruleSetId);
}
