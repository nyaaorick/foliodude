import { getAccounts } from '@/lib/actions/account-read-actions';
import { getRewardRates } from '@/lib/actions/reward-actions';
import { useLiveQuery } from '@/lib/data/use-live-query';
import { AccountType } from '@/lib/types/accounts';
import { Loaded, Page, PageHeader } from '@/components/app/page-state';
import { AccountList } from '@/components/features/accounts/account-list';
import { CreateAccountDialog } from '@/components/features/accounts/create-account-dialog';
import { SharePriceSync } from '@/components/features/accounts/share-price-sync';

export default function AccountsPage() {
  const state = useLiveQuery(async () => {
    const [accounts, rewardRates] = await Promise.all([getAccounts(), getRewardRates()]);
    return { accounts, rewardRates };
  });

  return (
    <Page>
      <Loaded state={state}>
        {({ accounts, rewardRates }) => (
          <>
            <PageHeader
              eyebrow="Account Overview"
              title="Accounts"
              description="Track cash, cards, airline miles, and investments in one warm ledger."
              actions={
                <>
                  {accounts.some((account) => account.type === AccountType.SHARE) && (
                    <SharePriceSync auto showButton triggerLabel="Refresh Prices" />
                  )}
                  <CreateAccountDialog accounts={accounts} />
                </>
              }
            />
            <AccountList accounts={accounts} rewardRates={rewardRates} />
          </>
        )}
      </Loaded>
    </Page>
  );
}
