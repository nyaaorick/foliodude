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
  getTransferTargetAccountId,
} from '@/lib/utils/transaction-display';

function makeTransaction(
  overrides: Partial<TransactionWithReward> = {},
): TransactionWithReward {
  return {
    id: 'tx-1',
    user_id: 'user-1',
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
    fee: null,
    transaction_date: '2026-03-16T00:00:00.000Z',
    created_at: '2026-03-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('getTransactionDisplay', () => {
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

  it('labels incoming transfers on liability pages as repayment', () => {
    const display = getTransactionDisplay(
      makeTransaction({ to_account: 'card-1' }),
      'card-1',
      AccountType.LIABILITY,
    );

    expect(display).toEqual({
      title: 'Repayment',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('labels outgoing transfers as transfer out', () => {
    const display = getTransactionDisplay(
      makeTransaction({ from_account: 'asset-1', to_account: 'asset-2' }),
      'asset-1',
      AccountType.ASSET,
    );

    expect(display).toEqual({
      title: 'Transfer Out',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
  });

  it('returns to_account as the transfer target on the source account page', () => {
    const targetAccountId = getTransferTargetAccountId(
      makeTransaction({ from_account: 'asset-1', to_account: 'asset-2' }),
      'asset-1',
    );

    expect(targetAccountId).toBe('asset-2');
  });

  it('returns from_account as the transfer target on the destination account page', () => {
    const targetAccountId = getTransferTargetAccountId(
      makeTransaction({ from_account: 'asset-1', to_account: 'asset-2' }),
      'asset-2',
    );

    expect(targetAccountId).toBe('asset-1');
  });

  it('returns null for non-transfer transactions or missing counterparties', () => {
    expect(
      getTransferTargetAccountId(
        makeTransaction({
          type: TransactionType.EXPENSE,
          from_account: 'asset-1',
          to_account: null,
        }),
        'asset-1',
      ),
    ).toBeNull();

    expect(
      getTransferTargetAccountId(
        makeTransaction({ from_account: 'asset-1', to_account: null }),
        'asset-1',
      ),
    ).toBeNull();
  });

  it('returns the linked mileage account for reward redeems tied to mileage transfers', () => {
    const targetAccountId = getLinkedAccountTargetId(
      makeTransaction({
        type: TransactionType.REWARD_REDEEM,
        from_account: 'card-1',
        reference_transaction: {
          id: 'mileage-tx-1',
          type: TransactionType.MILEAGE_TRANSFER_IN,
          from_account: null,
          to_account: 'miles-1',
        },
      }),
      'card-1',
    );

    expect(targetAccountId).toBe('miles-1');
  });

  it('returns the first source card for mileage transfer-in transactions', () => {
    const targetAccountId = getLinkedAccountTargetId(
      makeTransaction({
        type: TransactionType.MILEAGE_TRANSFER_IN,
        to_account: 'miles-1',
        metadata: {
          reward_currency: 'MR',
          sources: [
            {
              account_id: 'card-1',
              account_name_snapshot: 'Amex Gold',
              points_deducted: 5000,
            },
          ],
        },
      }),
      'miles-1',
    );

    expect(targetAccountId).toBe('card-1');
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

  it('returns the cash account for share buys on the share account page', () => {
    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.SHARE_BUY,
          from_account: 'cash-1',
          to_account: 'share-1',
        }),
        'share-1',
      ),
    ).toBe('cash-1');
  });

  it('returns the cash account for share sells on the share account page', () => {
    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.SHARE_SELL,
          from_account: 'share-1',
          to_account: 'cash-1',
        }),
        'share-1',
      ),
    ).toBe('cash-1');
  });

  it('returns the share account for share sells on the cash account page', () => {
    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.SHARE_SELL,
          from_account: 'share-1',
          to_account: 'cash-1',
        }),
        'cash-1',
      ),
    ).toBe('share-1');
  });

  it('returns null for unrelated reward redeem and mileage transactions', () => {
    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.REWARD_REDEEM,
          from_account: 'card-1',
          reference_transaction: null,
        }),
        'card-1',
      ),
    ).toBeNull();

    expect(
      getLinkedAccountTargetId(
        makeTransaction({
          type: TransactionType.MILEAGE_TRANSFER_IN,
          to_account: 'miles-1',
          metadata: {
            reward_currency: 'MR',
            sources: [],
          },
        }),
        'miles-1',
      ),
    ).toBeNull();
  });

  it('labels expense transactions without transaction-level rule editing state', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.EXPENSE,
        category: 'Dining',
      }),
      'card-1',
      AccountType.LIABILITY,
    );

    expect(display).toEqual({
      title: 'Dining',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
  });

  it('labels asset balance adjustment expenses with a fixed title', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.EXPENSE,
        category: 'Balance Adjustment',
        metadata: {
          kind: 'asset_balance_adjustment',
        },
      }),
      'asset-1',
      AccountType.ASSET,
    );

    expect(display).toEqual({
      title: 'Balance Adjustment',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
  });

  it('labels asset balance adjustment income with a fixed title', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.INCOME,
        category: 'Balance Adjustment',
        metadata: {
          kind: 'asset_balance_adjustment',
        },
      }),
      'asset-1',
      AccountType.ASSET,
    );

    expect(display).toEqual({
      title: 'Balance Adjustment',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('labels share buys with the ticker', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.SHARE_BUY,
        to_account: 'share-1',
        share_ticker: 'AAPL',
      }),
      'share-1',
      AccountType.SHARE,
    );

    expect(display).toEqual({
      title: 'Buy AAPL',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('labels share sells with the ticker', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.SHARE_SELL,
        from_account: 'share-1',
        to_account: 'cash-1',
        share_ticker: 'AAPL',
      }),
      'share-1',
      AccountType.SHARE,
    );

    expect(display).toEqual({
      title: 'Sell AAPL',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
  });

  it('labels reward transfer in transactions', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.REWARD_TRANSFER_IN,
        currency: null,
      }),
      'card-1',
      AccountType.LIABILITY,
    );

    expect(display).toEqual({
      title: 'Reward Transfer In',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('labels reward redeem transactions', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.REWARD_REDEEM,
        currency: null,
      }),
      'card-1',
      AccountType.LIABILITY,
    );

    expect(display).toEqual({
      title: 'Reward Redeem',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
  });

  it('labels mileage transfer-in transactions', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.MILEAGE_TRANSFER_IN,
        currency: null,
        metadata: {
          reward_currency: 'MR',
        },
      }),
      'miles-1',
      AccountType.AIRLINE_MILES,
    );

    expect(display).toEqual({
      title: 'Points Transfer In',
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
    });
  });

  it('uses the ticket name for mileage flight redemptions', () => {
    const display = getTransactionDisplay(
      makeTransaction({
        type: TransactionType.MILEAGE_REDEEM_FLIGHT,
        currency: null,
        metadata: {
          ticket_name: 'Tokyo round trip 2026-03',
        },
      }),
      'miles-1',
      AccountType.AIRLINE_MILES,
    );

    expect(display).toEqual({
      title: 'Tokyo round trip 2026-03',
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
    });
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
