import { describe, expect, it } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import type { AirlineProgram } from '@/lib/types/mileage';
import type { RewardCurrencyId } from '@/lib/types/rewards';
import { TransactionType } from '@/lib/types/transactions';
import {
  getAccountTypeLabel,
  getAirlineProgramLabel,
  getRewardCapPeriodLabel,
  getRewardCurrencyLabel,
  getTransactionTypeLabel,
} from '@/lib/utils/display-labels';

describe('display labels', () => {
  it('renders account type labels', () => {
    expect(getAccountTypeLabel(AccountType.AIRLINE_MILES)).toBe('Airline Miles');
  });

  it('renders airline program labels', () => {
    expect(getAirlineProgramLabel('AVIOS', 'short')).toBe('Avios');
    expect(getAirlineProgramLabel('ALASKA_AS', 'full')).toBe(
      'Alaska Mileage Plan · Alaska Airlines (AS)',
    );
  });

  it('renders reward currency labels', () => {
    expect(getRewardCurrencyLabel('MR', 'short')).toBe('Amex Membership Rewards');
    expect(getRewardCurrencyLabel('UR', 'full')).toBe('UR · Chase Ultimate Rewards');
  });

  it('renders transaction and cap period labels', () => {
    expect(getTransactionTypeLabel(TransactionType.REWARD_TRANSFER_IN)).toBe('Add Points');
    expect(getRewardCapPeriodLabel('monthly')).toBe('Monthly');
  });

  it('throws on unsupported values', () => {
    expect(() =>
      getAirlineProgramLabel('BAD_VALUE' as AirlineProgram),
    ).toThrowError('Unknown airline program: BAD_VALUE');
    expect(() =>
      getRewardCurrencyLabel('BAD_VALUE' as RewardCurrencyId),
    ).toThrowError('Unknown reward currency: BAD_VALUE');
  });
});
