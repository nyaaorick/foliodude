'use client';

import { AccountType } from '@/lib/types/accounts';
import type { TransactionWithReward } from '@/lib/types/transactions';
import { TransactionItem } from './transaction-item';

interface TransactionListProps {
  transactions: TransactionWithReward[];
  accountId: string;
  accountType: AccountType;
  currency: string;
}

export function TransactionList({
  transactions,
  accountId,
  accountType,
  currency,
}: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No transactions yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {transactions.map((tx) => (
        <TransactionItem
          key={tx.id}
          transaction={tx}
          accountId={accountId}
          accountType={accountType}
          currency={currency}
        />
      ))}
    </div>
  );
}
