import { describe, expect, it } from 'vitest';
import { estimateRewardUsd } from '@/lib/types/rewards';

describe('estimateRewardUsd', () => {
  it('converts point balances using usd per 10k points and rounds to integer', () => {
    expect(estimateRewardUsd(12345, 180)).toBe(222);
    expect(estimateRewardUsd(10000, 150)).toBe(150);
    expect(estimateRewardUsd(0, 200)).toBe(0);
  });
});
