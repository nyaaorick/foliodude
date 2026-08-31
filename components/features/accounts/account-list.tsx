'use client';

import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountType, type AccountWithStats } from '@/lib/types/accounts';
import { deleteAction } from '@/lib/actions/delete-actions';
import type { RewardRateMap } from '@/lib/types/rewards';
import { AccountCard } from './account-card';

interface AccountListProps {
  accounts: AccountWithStats[];
  rewardRates: RewardRateMap;
}

const SECTION_LABELS: Partial<Record<AccountType, string>> = {
  [AccountType.ASSET]: 'Assets',
  [AccountType.LIABILITY]: 'Liabilities',
  [AccountType.AIRLINE_MILES]: 'Airline Miles',
  [AccountType.SHARE]: 'Shares',
};

const ACCOUNT_COLUMNS: Array<{
  id: string;
  types: AccountType[];
}> = [
  {
    id: 'left',
    types: [AccountType.ASSET, AccountType.LIABILITY],
  },
  {
    id: 'right',
    types: [AccountType.AIRLINE_MILES, AccountType.SHARE],
  },
];

export function AccountList({ accounts, rewardRates }: AccountListProps) {
  const navigate = useNavigate();
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const handleDelete = (id: string) => {
    setError('');
    setDeletingAccountId(id);

    startTransition(async () => {
      const result = await deleteAction({ kind: 'account', id });

      if (!result.success) {
        setDeletingAccountId(null);
        setError(result.error);
        return;
      }

      navigate(0);
    });
  };

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        {ACCOUNT_COLUMNS.map((column) => {
          const sections = column.types
            .map((type) => ({
              type,
              label: SECTION_LABELS[type],
              items: accounts.filter((account) => account.type === type),
            }))
            .filter((section) => section.items.length > 0);

          if (sections.length === 0) {
            return null;
          }

          return (
            <div key={column.id} className="space-y-8">
              {sections.map((section) => (
                <section key={section.type} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-medium tracking-tight [font-family:var(--font-display)]">
                      {section.label}
                    </h2>
                    <div className="h-px flex-1 bg-border/80" />
                  </div>
                  <div className="space-y-2">
                    {section.items.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        rewardRates={rewardRates}
                        onDelete={handleDelete}
                        isDeleting={isPending && deletingAccountId === account.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          );
        })}
      </div>
      {accounts.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No accounts yet. Create one to get started.
        </p>
      )}
    </div>
  );
}
