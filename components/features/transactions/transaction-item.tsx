import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { deleteAction } from '@/lib/actions/delete-actions';
import { AccountType } from '@/lib/types/accounts';
import { getRewardCurrencyDefinition } from '@/lib/types/rewards';
import { TransactionType, type TransactionWithReward } from '@/lib/types/transactions';
import { canDeleteTransactionType } from '@/lib/utils/delete-support';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineLinkLoading } from '@/components/features/navigation/loading-ui';
import {
  getTransactionAmountLabel,
  getTransactionDisplay,
  getLinkedAccountTargetId,
} from '@/lib/utils/transaction-display';

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    amount,
  );
}

function formatRewardAmount(amount: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShares(amount: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(amount);
}

function formatShareMeta(transaction: TransactionWithReward) {
  if (
    transaction.type !== TransactionType.SHARE_BUY &&
    transaction.type !== TransactionType.SHARE_SELL
  ) {
    return null;
  }

  const parts = [
    transaction.share_quantity !== null
      ? `${formatShares(transaction.share_quantity)} shares`
      : null,
    transaction.share_price !== null
      ? `at ${formatCurrency(transaction.share_price, transaction.currency ?? 'USD')}`
      : null,
    transaction.fee !== null
      ? `fee ${formatCurrency(transaction.fee, transaction.currency ?? 'USD')}`
      : null,
  ].filter(Boolean);

  return parts.join(' · ');
}

function isRewardTransaction(transaction: TransactionWithReward) {
  return (
    transaction.type === TransactionType.REWARD_EARN ||
    transaction.type === TransactionType.REWARD_TRANSFER_IN ||
    transaction.type === TransactionType.REWARD_REDEEM
  );
}

function isMileageTransaction(transaction: TransactionWithReward) {
  return (
    transaction.type === TransactionType.MILEAGE_TRANSFER_IN ||
    transaction.type === TransactionType.MILEAGE_MANUAL_IN ||
    transaction.type === TransactionType.MILEAGE_REDEEM_FLIGHT
  );
}

function canDeleteTransaction(transaction: TransactionWithReward) {
  return canDeleteTransactionType(transaction.type);
}

function getMileageMetaText(transaction: TransactionWithReward) {
  const metadata =
    transaction.metadata && typeof transaction.metadata === 'object'
      ? transaction.metadata
      : null;

  if (!metadata) {
    return null;
  }

  if (transaction.type === TransactionType.MILEAGE_TRANSFER_IN) {
    const rewardCurrency =
      'reward_currency' in metadata && typeof metadata.reward_currency === 'string'
        ? metadata.reward_currency
        : null;
    const sources =
      'sources' in metadata && Array.isArray(metadata.sources)
        ? metadata.sources
        : [];

    const sourceLabel = sources
      .map((source) => {
        if (
          !source ||
          typeof source !== 'object' ||
          !('account_name_snapshot' in source) ||
          !('points_deducted' in source)
        ) {
          return null;
        }

        const accountName =
          typeof source.account_name_snapshot === 'string'
            ? source.account_name_snapshot
            : null;
        const points =
          typeof source.points_deducted === 'number'
            ? source.points_deducted
            : null;

        if (!accountName || points === null) {
          return null;
        }

        return `${accountName} -${points.toLocaleString()}`;
      })
      .filter(Boolean)
      .join(' · ');

    return [rewardCurrency, sourceLabel].filter(Boolean).join(' · ');
  }

  if (transaction.type === TransactionType.MILEAGE_MANUAL_IN) {
    return 'source_description' in metadata &&
      typeof metadata.source_description === 'string'
      ? metadata.source_description
      : null;
  }

  if (transaction.type === TransactionType.MILEAGE_REDEEM_FLIGHT) {
    const taxAmount =
      'tax_amount' in metadata && typeof metadata.tax_amount === 'number'
        ? metadata.tax_amount
        : null;
    const taxCurrency =
      'tax_currency' in metadata && typeof metadata.tax_currency === 'string'
        ? metadata.tax_currency
        : null;
    const taxAccountName =
      'tax_account_name_snapshot' in metadata &&
      typeof metadata.tax_account_name_snapshot === 'string'
        ? metadata.tax_account_name_snapshot
        : null;

    if (taxAmount === null || !taxCurrency || !taxAccountName) {
      return null;
    }

    return `Tax ${formatCurrency(taxAmount, taxCurrency)} via ${taxAccountName}`;
  }

  return null;
}

interface TransactionItemProps {
  transaction: TransactionWithReward;
  accountId: string;
  accountType: AccountType;
  currency: string;
}

export function TransactionItem({
  transaction,
  accountId,
  accountType,
  currency,
}: TransactionItemProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [error, setError] = useState('');
  const display = getTransactionDisplay(transaction, accountId, accountType);
  const linkedTargetAccountId = getLinkedAccountTargetId(transaction, accountId);
  const shareMeta = formatShareMeta(transaction);
  const rewardCurrency = transaction.reward_currency
    ? getRewardCurrencyDefinition(transaction.reward_currency)
    : null;
  const mileageMeta = getMileageMetaText(transaction);
  const amountLabel = isMileageTransaction(transaction)
    ? `${Math.trunc(transaction.amount).toLocaleString()} miles`
    : isRewardTransaction(transaction)
      ? `${formatRewardAmount(transaction.amount)} ${transaction.reward_currency ?? ''}`.trim()
      : getTransactionAmountLabel(transaction, accountId, currency);
  const isDeletable = canDeleteTransaction(transaction);

  if (isHidden) {
    return null;
  }

  const content = (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{display.title}</span>
        <span
          className={`shrink-0 font-semibold tabular-nums ${display.amountToneClassName}`}
        >
          {display.amountPrefix} {amountLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDate(transaction.transaction_date)}</span>
        {rewardCurrency && (
          <>
            <span>&middot;</span>
            <span>{rewardCurrency.displayName}</span>
          </>
        )}
        {transaction.memo && (
          <>
            <span>&middot;</span>
            <span className="truncate">{transaction.memo}</span>
          </>
        )}
        {mileageMeta && (
          <>
            <span>&middot;</span>
            <span className="truncate">{mileageMeta}</span>
          </>
        )}
        {transaction.reward && (
          <Badge
            variant="outline"
            className="ml-auto border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
          >
            + {transaction.reward.points.toLocaleString()}{' '}
            {transaction.reward.currency}
          </Badge>
        )}
      </div>

      {shareMeta && <p className="text-xs text-muted-foreground">{shareMeta}</p>}
    </div>
  );

  const mainContent = linkedTargetAccountId ? (
    <Link
      to={`/accounts/${linkedTargetAccountId}`}
      className="relative block min-w-0 flex-1 rounded-lg transition-colors hover:bg-muted/20"
    >
      <InlineLinkLoading className="absolute right-3 top-3" />
      {content}
    </Link>
  ) : (
    content
  );

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-border px-4 py-3 transition-colors">
        {mainContent}
        <div className="flex shrink-0 items-start gap-1">
          {isDeletable && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Hide transaction"
              disabled={submitting}
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                setSubmitting(true);
                setError('');
                setIsHidden(true);

                const result = await deleteAction({
                  kind: 'transaction',
                  id: transaction.id,
                });

                setSubmitting(false);

                if (!result.success) {
                  setIsHidden(false);
                  setError(result.error);
                  return;
                }

                navigate(0);
              }}
            >
              <EyeOff className="size-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
      {error && <p className="px-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
