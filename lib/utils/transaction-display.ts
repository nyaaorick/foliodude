import { AccountType } from '@/lib/types/accounts';
import {
  TransactionType,
  type CrossCurrencyTransferMetadata,
  type Transaction,
  type TransactionWithReward,
} from '@/lib/types/transactions';

export interface TransactionDisplay {
  amountPrefix: '+' | '-';
  amountToneClassName: string;
  title: string;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    amount,
  );
}

function getCrossCurrencyTransferMetadata(
  transaction: Transaction,
): CrossCurrencyTransferMetadata | null {
  const metadata =
    transaction.metadata && typeof transaction.metadata === 'object'
      ? transaction.metadata
      : null;

  if (
    !metadata ||
    !('source_currency' in metadata) ||
    !('target_currency' in metadata) ||
    !('target_amount' in metadata)
  ) {
    return null;
  }

  if (
    typeof metadata.source_currency !== 'string' ||
    typeof metadata.target_currency !== 'string' ||
    typeof metadata.target_amount !== 'number'
  ) {
    return null;
  }

  return metadata as CrossCurrencyTransferMetadata;
}

function isAssetBalanceAdjustment(transaction: Transaction) {
  const metadata =
    transaction.metadata && typeof transaction.metadata === 'object'
      ? transaction.metadata
      : null;

  return (
    metadata !== null &&
    'kind' in metadata &&
    metadata.kind === 'asset_balance_adjustment'
  );
}

export function getTransactionAmountLabel(
  transaction: Transaction,
  accountId: string,
  currency: string,
): string {
  if (transaction.type === TransactionType.TRANSFER) {
    const crossCurrencyMetadata = getCrossCurrencyTransferMetadata(transaction);
    if (crossCurrencyMetadata && transaction.to_account === accountId) {
      return formatCurrency(
        crossCurrencyMetadata.target_amount,
        crossCurrencyMetadata.target_currency,
      );
    }
  }

  return formatCurrency(transaction.amount, transaction.currency ?? currency);
}

export function getTransferTargetAccountId(
  transaction: Transaction,
  accountId: string,
): string | null {
  if (transaction.type !== TransactionType.TRANSFER) {
    return null;
  }

  if (transaction.from_account === accountId) {
    return transaction.to_account;
  }

  if (transaction.to_account === accountId) {
    return transaction.from_account;
  }

  return null;
}

export function getLinkedAccountTargetId(
  transaction: TransactionWithReward,
  accountId: string,
): string | null {
  const transferTarget = getTransferTargetAccountId(transaction, accountId);
  if (transferTarget) {
    return transferTarget;
  }

  if (
    transaction.type === TransactionType.SHARE_BUY ||
    transaction.type === TransactionType.SHARE_SELL
  ) {
    if (transaction.from_account === accountId) {
      return transaction.to_account;
    }

    if (transaction.to_account === accountId) {
      return transaction.from_account;
    }
  }

  if (
    transaction.type === TransactionType.REWARD_REDEEM &&
    transaction.from_account === accountId &&
    transaction.reference_transaction?.type === TransactionType.MILEAGE_TRANSFER_IN
  ) {
    return transaction.reference_transaction.to_account;
  }

  if (transaction.type === TransactionType.MILEAGE_TRANSFER_IN) {
    const metadata =
      transaction.metadata && typeof transaction.metadata === 'object'
        ? transaction.metadata
        : null;
    const sources =
      metadata &&
      'sources' in metadata &&
      Array.isArray(metadata.sources)
        ? metadata.sources
        : [];
    const firstSource = sources[0];

    if (
      transaction.to_account === accountId &&
      firstSource &&
      typeof firstSource === 'object' &&
      'account_id' in firstSource &&
      typeof firstSource.account_id === 'string'
    ) {
      return firstSource.account_id;
    }
  }

  return null;
}

export function getTransactionDisplay(
  transaction: Transaction,
  accountId: string,
  accountType: AccountType,
): TransactionDisplay {
  const metadata =
    transaction.metadata && typeof transaction.metadata === 'object'
      ? transaction.metadata
      : null;

  if (
    transaction.type === TransactionType.SHARE_BUY ||
    transaction.type === TransactionType.SHARE_SELL
  ) {
    const isIncoming = transaction.to_account === accountId;
    const verb =
      transaction.type === TransactionType.SHARE_BUY ? 'Buy' : 'Sell';

    return {
      amountPrefix: isIncoming ? '+' : '-',
      amountToneClassName: isIncoming ? 'text-green-600' : 'text-red-500',
      title: `${verb} ${transaction.share_ticker ?? ''}`.trim(),
    };
  }

  if (transaction.type === TransactionType.TRANSFER) {
    const isIncoming = transaction.to_account === accountId;

    return {
      amountPrefix: isIncoming ? '+' : '-',
      amountToneClassName: isIncoming ? 'text-green-600' : 'text-red-500',
      title: isIncoming
        ? accountType === AccountType.LIABILITY
          ? 'Repayment'
          : 'Transfer In'
        : 'Transfer Out',
    };
  }

  if (transaction.type === TransactionType.EXPENSE) {
    return {
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
      title: isAssetBalanceAdjustment(transaction)
        ? 'Balance Adjustment'
        : (transaction.category ?? 'Uncategorized'),
    };
  }

  if (transaction.type === TransactionType.INCOME) {
    return {
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
      title: isAssetBalanceAdjustment(transaction)
        ? 'Balance Adjustment'
        : (transaction.category ?? 'Income'),
    };
  }

  if (transaction.type === TransactionType.REWARD_EARN) {
    return {
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
      title: transaction.category ? `${transaction.category} Reward` : 'Reward Earned',
    };
  }

  if (transaction.type === TransactionType.REWARD_TRANSFER_IN) {
    return {
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
      title: 'Reward Transfer In',
    };
  }

  if (transaction.type === TransactionType.REWARD_REDEEM) {
    return {
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
      title: 'Reward Redeem',
    };
  }

  if (transaction.type === TransactionType.MILEAGE_TRANSFER_IN) {
    return {
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
      title: 'Points Transfer In',
    };
  }

  if (transaction.type === TransactionType.MILEAGE_MANUAL_IN) {
    return {
      amountPrefix: '+',
      amountToneClassName: 'text-green-600',
      title: 'Manual Transfer In',
    };
  }

  if (transaction.type === TransactionType.MILEAGE_REDEEM_FLIGHT) {
    const ticketName =
      metadata &&
      'ticket_name' in metadata &&
      typeof metadata.ticket_name === 'string'
        ? metadata.ticket_name
        : null;

    return {
      amountPrefix: '-',
      amountToneClassName: 'text-red-500',
      title: ticketName ?? '兑换机票',
    };
  }

  return {
    amountPrefix: '+',
    amountToneClassName: 'text-muted-foreground',
    title: transaction.category ?? transaction.type,
  };
}
