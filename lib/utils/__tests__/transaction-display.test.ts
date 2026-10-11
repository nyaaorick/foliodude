import { describe, expect, it } from 'vitest';
import { AccountType } from '@/lib/types/accounts';
import {
  TransactionType,
  type TransactionWithReward,
} from '@/lib/types/transactions';
import {
  getTransactionAmountLabel,
  getTransactionDisplay,
  getLinkedAccountTargetId,
} from '@/lib/utils/transaction-display';

function makeTransaction(
  overrides: Partial<TransactionWithReward> = {},
): TransactionWithReward {
  return {
    id: 'tx-1',
    type: TransactionType.TRANSFER,
    amount: 50,
    currency: 'USD',
    reward_currency: null,
    metadata: null,
    reference_transaction_id: null,
    from_account: 'from-1',
    to_account: 'to-1',
    category: null,
    memo: null,
    share_ticker: null,
    share_quantity: null,
    share_price: null,
    transaction_date: '2026-03-16T00:00:00.000Z',
    created_at: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('transaction display', () => {
  it('labels incoming transfers on asset pages as transfer in', () => {
    const display = getTransactionDisplay(
      makeTransaction({ to_account: 'asset-1' }),
      'asset-1',
      AccountType.ASSET,
    );

    expect(display).toEqual({
      title: 'Transfer In',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('returns the share account for share buys on the cash account page', () => {
    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.SHARE_BUY,
          from_account: 'cash-1',
          to_account: 'share-1',
        }),
        'cash-1',
      ),
    ).toBe('share-1');
  });

  it('shows target amount and target currency for incoming cross-currency transfers', () => {
    const amountLabel = getTransactionAmountLabel(
      makeTransaction({
        amount: 100,
        currency: 'USD',
        to_account: 'asset-hkd',
        metadata: {
          source_currency: 'USD',
          target_currency: 'HKD',
          target_amount: 780,
          implied_exchange_rate: 7.8,
        },
      }),
      'asset-hkd',
      'HKD',
    );

    expect(amountLabel).toBe('HK$780.00');
  });

  it('keeps source amount for outgoing cross-currency transfers', () => {
    const amountLabel = getTransactionAmountLabel(
      makeTransaction({
        amount: 100,
        currency: 'USD',
        from_account: 'asset-usd',
        to_account: 'asset-hkd',
        metadata: {
          source_currency: 'USD',
          target_currency: 'HKD',
          target_amount: 780,
          implied_exchange_rate: 7.8,
        },
      }),
      'asset-usd',
      'USD',
    );

    expect(amountLabel).toBe('$100.00');
  });
});
