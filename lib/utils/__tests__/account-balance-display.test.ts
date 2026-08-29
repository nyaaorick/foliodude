import { describe, expect, it } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import {
  formatAccountBalance,
  getLiabilityBalanceToneClass,
  toSignedLiabilityDisplayValue,
} from '@/lib/utils/account-balance-display';

describe('account balance display utils', () => {
  it('formats liability balances with explicit signs', () => {
    expect(formatAccountBalance(-120, 'USD', AccountType.LIABILITY)).toBe('-$120.00');
    expect(formatAccountBalance(45, 'USD', AccountType.LIABILITY)).toBe('+$45.00');
  });

  it('keeps non-liability balances unsigned when positive', () => {
    expect(formatAccountBalance(45, 'USD', AccountType.ASSET)).toBe('$45.00');
  });

  it('maps liability tones by signed value', () => {
    expect(getLiabilityBalanceToneClass(45)).toBe('text-green-600');
    expect(getLiabilityBalanceToneClass(-45)).toBe('text-red-500');
    expect(getLiabilityBalanceToneClass(0)).toBe('');
  });

  it('converts dashboard liability totals to signed display values', () => {
    expect(toSignedLiabilityDisplayValue(120)).toBe(-120);
    expect(toSignedLiabilityDisplayValue(-45)).toBe(45);
    expect(toSignedLiabilityDisplayValue(0)).toBe(0);
  });
});
