import { redirect } from 'next/navigation';
import { getAccounts } from '@/lib/actions/account-read-actions';
import { getRewardRates } from '@/lib/actions/reward-actions';
import { getSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import { AccountList } from '@/components/features/accounts/account-list';
import { CreateAccountDialog } from '@/components/features/accounts/create-account-dialog';
import { SharePriceSync } from '@/components/features/accounts/share-price-sync';

export default async function AccountsPage() {
  const context = await getSessionContext();

  if (!context) {
    redirect('/login');
  }

  const [result, rewardRates] = await Promise.all([
    getAccounts(context),
    getRewardRates(context),
  ]);
  const accounts = result;
  const hasShareAccounts = accounts.some(
    (account) => account.type === AccountType.SHARE,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[2rem] border border-border/80 bg-card/90 px-6 py-6 shadow-[0_12px_40px_rgba(48,33,22,0.08)] backdrop-blur sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex w-fit rounded-full border border-border/80 bg-accent/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Account Overview
            </span>
            <div className="space-y-2">
              <h1 className="text-4xl leading-none font-medium tracking-tight [font-family:var(--font-display)] sm:text-5xl">
                Accounts
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Track cash, cards, airline miles, and investments in one warm ledger.
              </p>
            </div>
            <span className="text-sm text-muted-foreground">{context.userEmail}</span>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {hasShareAccounts && (
              <SharePriceSync auto showButton triggerLabel="Refresh Prices" />
            )}
            <CreateAccountDialog accounts={accounts} />
          </div>
        </div>
      </div>
      <AccountList accounts={accounts} rewardRates={rewardRates} />
    </div>
  );
}
