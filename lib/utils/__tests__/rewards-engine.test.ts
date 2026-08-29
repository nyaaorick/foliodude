import { describe, expect, it } from 'vitest';
import {
  buildStatsKey,
  calculateReward,
  findMatchedRule,
} from '@/lib/utils/rewards-engine';
import type { RewardRule } from '@/lib/types/rewards';

describe('calculateReward', () => {
  it('prefers manual rules over imported or cloud rules for the same category', () => {
    const rules: RewardRule[] = [
      {
        category: 'Dining',
        multiplier: 4,
        rule_source: 'cloud',
      },
      {
        category: 'Dining',
        multiplier: 5,
        rule_source: 'manual',
      },
    ];

    expect(calculateReward(rules, {}, 'Dining', 1)).toEqual({
      points: 5,
      capped: false,
    });
  });

  it('findMatchedRule prefers manual rules over other sources', () => {
    const rules: RewardRule[] = [
      {
        category: 'Dining',
        multiplier: 4,
        rule_source: 'cloud',
      },
      {
        category: 'Dining',
        multiplier: 5,
        rule_source: 'manual',
      },
    ];

    expect(findMatchedRule(rules, 'Dining')).toEqual(rules[1]);
  });

  it('buildStatsKey uses monthly and annual formats', () => {
    expect(buildStatsKey('Dining', '2026-03-21T00:00:00.000Z', 'monthly')).toBe(
      '2026-03_Dining',
    );
    expect(buildStatsKey('Dining', '2026-03-21T00:00:00.000Z', 'annual')).toBe(
      '2026_Dining',
    );
    expect(buildStatsKey('Dining', '2026-03-21T00:00:00.000Z', undefined)).toBe(
      '2026_Dining',
    );
  });
});
