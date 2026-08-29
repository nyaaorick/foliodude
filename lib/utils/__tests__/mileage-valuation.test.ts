import { describe, expect, it } from 'vitest';
import { estimateMileageUsd } from '@/lib/types/mileage';

describe('estimateMileageUsd', () => {
  it('converts mileage balances using usd per 10k miles and rounds to integer', () => {
    expect(estimateMileageUsd(12345, 120)).toBe(148);
    expect(estimateMileageUsd(10000, 100)).toBe(100);
    expect(estimateMileageUsd(0, 200)).toBe(0);
  });
});
