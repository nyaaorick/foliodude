import { AccountType } from '@/lib/types/accounts';

type CurrencyFormatOptions = Pick<
  Intl.NumberFormatOptions,
  'maximumFractionDigits' | 'minimumFractionDigits' | 'signDisplay'
>;

export function formatCurrencyAmount(
  amount: number,
  currency: string,
  options: CurrencyFormatOptions = {},
) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    ...options,
  }).format(amount);
}

/** A share count: whole numbers stay whole, up to 6 decimal places otherwise. */
export function formatShares(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
}

export function formatAccountBalance(
  amount: number,
  currency: string,
  accountType: AccountType,
  options: CurrencyFormatOptions = {},
) {
  if (accountType === AccountType.LIABILITY) {
    return formatCurrencyAmount(amount, currency, {
      ...options,
      signDisplay: 'exceptZero',
    });
  }

  return formatCurrencyAmount(amount, currency, options);
}

export function getLiabilityBalanceToneClass(amount: number) {
  if (amount > 0) {
    return 'text-green-600';
  }

  if (amount < 0) {
    return 'text-red-500';
  }

  return '';
}

export function toSignedLiabilityDisplayValue(netLiabilities: number) {
  return netLiabilities === 0 ? 0 : -netLiabilities;
}
