import { Suspense } from 'react';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  type AccountDetailSupportData,
  loadAccountDetailCore,
  loadAccountDetailSupport,
  loadAccountTransactions,
} from '@/lib/actions/account-read-actions';
import { getSessionContext } from '@/lib/supabase/server';
import { CLOUD_REWARD_RULE_SETS } from '@/lib/data/cloud-rules';
import { AccountType, type AccountWithStats } from '@/lib/types/accounts';
import {
  formatAccountBalance,
  formatCurrencyAmount,
  getLiabilityBalanceToneClass,
} from '@/lib/utils/account-balance-display';
import { getAirlineProgramLabel } from '@/lib/utils/display-labels';
import { EditAccountNameDialog } from '@/components/features/accounts/edit-account-name-dialog';
import {
  AccountDetailActionSkeleton,
  AccountDetailHeaderSkeleton,
  AccountDetailSupportSkeleton,
  AccountDetailTransactionsSkeleton,
  InlineLinkLoading,
} from '@/components/features/navigation/loading-ui';
import { SharePriceSync } from '@/components/features/accounts/share-price-sync';
import {
  ApplyCloudRulesDialog,
  ImportRewardRulesDialog,
  MileageBalanceCard,
  RewardBalanceList,
  RewardRuleInlineRow,
} from '@/components/features/rewards';
import { AdjustAssetBalanceDialog } from '@/components/features/transactions/adjust-asset-balance-dialog';
import { CreateAssetExpenseDialog } from '@/components/features/transactions/create-asset-expense-dialog';
import { CreateMileageManualInDialog } from '@/components/features/transactions/create-mileage-manual-in-dialog';
import { CreateRewardTransactionDialog } from '@/components/features/transactions/create-reward-transaction-dialog';
import { CreateTransactionDialog } from '@/components/features/transactions/create-transaction-dialog';
import { CreateTransferDialog } from '@/components/features/transactions/create-transfer-dialog';
import { RedeemMileageFlightDialog } from '@/components/features/transactions/redeem-mileage-flight-dialog';
import { TransactionList } from '@/components/features/transactions/transaction-list';
import { TransferRewardsToMileageDialog } from '@/components/features/transactions/transfer-rewards-to-mileage-dialog';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel } from '@/components/ui/progress';

function formatShares(amount: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(amount);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function awaitRequiredAccount(accountPromise: Promise<AccountWithStats | null>) {
  const account = await accountPromise;

  if (!account) {
    notFound();
  }

  return account;
}

async function AccountDetailActionBar({
  account,
  supportDataPromise,
}: {
  account: AccountWithStats;
  supportDataPromise: Promise<AccountDetailSupportData>;
}) {
  const { accounts } = await supportDataPromise;
  const isLiability = account.type === AccountType.LIABILITY;
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const isAsset = account.type === AccountType.ASSET;
  const isShare = account.type === AccountType.SHARE;
  const liabilityAccounts = accounts.filter(
    (item) => item.type === AccountType.LIABILITY,
  );
  const mileageAccounts = accounts.filter(
    (item) => item.type === AccountType.AIRLINE_MILES,
  );
  const hasRewardCurrency = isLiability && account.reward_currency !== null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!isShare && (
        <EditAccountNameDialog
          accountId={account.id}
          accountName={account.name}
          accountBalance={account.balance}
          accountType={account.type}
          currency={account.currency}
        />
      )}

      {isAsset && (
        <>
          <CreateAssetExpenseDialog
            accountId={account.id}
            accountCurrency={account.currency}
          />
          <AdjustAssetBalanceDialog
            accountId={account.id}
            accountCurrency={account.currency}
          />
        </>
      )}

      {account.type === AccountType.ASSET && (
        <CreateTransferDialog
          mode="transfer"
          accounts={accounts}
          fromAccountId={account.id}
          triggerLabel="Transfer"
        />
      )}

      {isShare && (
        <>
          <CreateTransferDialog
            mode="buy-share"
            accounts={accounts}
            shareAccountId={account.id}
            triggerLabel="Buy"
          />
          <CreateTransferDialog
            mode="sell-share"
            accounts={accounts}
            shareAccountId={account.id}
            triggerLabel="Sell"
          />
          <SharePriceSync auto showButton />
        </>
      )}

      {isLiability && (
        <>
          <CreateTransferDialog
            mode="repay"
            accounts={accounts}
            toAccountId={account.id}
            triggerLabel="Repay"
          />
          <CreateTransactionDialog
            accountId={account.id}
            accountCurrency={account.currency}
          />
          {hasRewardCurrency && (
            <>
              <CreateRewardTransactionDialog
                accountId={account.id}
                triggerLabel="Adjust Points"
              />
              <TransferRewardsToMileageDialog
                liabilityAccounts={liabilityAccounts}
                mileageAccounts={mileageAccounts}
                fixedSourceAccountId={account.id}
              />
            </>
          )}
        </>
      )}

      {isAirlineMiles && (
        <>
          <TransferRewardsToMileageDialog
            liabilityAccounts={liabilityAccounts}
            mileageAccounts={mileageAccounts}
            fixedMileageAccountId={account.id}
          />
          <CreateMileageManualInDialog accountId={account.id} />
          <RedeemMileageFlightDialog
            mileageAccountId={account.id}
            taxAccounts={liabilityAccounts}
          />
        </>
      )}
    </div>
  );
}

async function AccountDetailSupportSection({
  account,
  supportDataPromise,
}: {
  account: AccountWithStats;
  supportDataPromise: Promise<AccountDetailSupportData>;
}) {
  const { accounts, rewardRates } = await supportDataPromise;
  const isLiability = account.type === AccountType.LIABILITY;
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const isShare = account.type === AccountType.SHARE;
  const hasCredit = isLiability && account.credit_limit !== null;
  const linkedBrokerageAccount = account.brokerage_account_id
    ? accounts.find((item) => item.id === account.brokerage_account_id) ?? null
    : null;
  const usedAmount = hasCredit ? Math.max(-account.balance, 0) : 0;
  const displayTotal = hasCredit
    ? (account.credit_limit ?? 0) + Math.max(account.balance, 0)
    : 0;
  const usedPercent = displayTotal > 0 ? (usedAmount / displayTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {isShare && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Position
            </p>
            <p className="mt-2 text-lg font-semibold">{formatShares(account.shares)} shares</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Linked cash account:{' '}
              {linkedBrokerageAccount ? linkedBrokerageAccount.name : 'Deleted account'}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Cost Basis
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrencyAmount(account.cost_basis, 'USD')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Unrealized P/L:{' '}
              <span
                className={
                  account.balance - account.cost_basis >= 0
                    ? 'text-green-600'
                    : 'text-red-500'
                }
              >
                {formatCurrencyAmount(account.balance - account.cost_basis, 'USD')}
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Last Price
            </p>
            <p className="mt-2 text-lg font-semibold">
              {account.last_price === null
                ? 'Unavailable'
                : formatCurrencyAmount(account.last_price, 'USD')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Updated {formatDateTime(account.last_price_at)}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Market Value
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrencyAmount(account.balance, 'USD')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Prices auto-refresh after page load and can be refreshed manually.
            </p>
          </div>
        </div>
      )}

      {isAirlineMiles && account.airline_program && (
        <MileageBalanceCard
          accountId={account.id}
          airlineProgram={account.airline_program}
          miles={Math.trunc(account.balance)}
          usdPer10kMiles={account.usd_per_10k_miles}
          transferRates={account.transfer_rates}
        />
      )}

      {hasCredit && (
        <Progress value={usedPercent}>
          <ProgressLabel className="text-xs text-muted-foreground">
            Used {formatCurrencyAmount(usedAmount, account.currency)}
            {' / '}
            {formatCurrencyAmount(displayTotal, account.currency)}
          </ProgressLabel>
        </Progress>
      )}

      {isLiability && (
        <RewardBalanceList
          rewardCurrency={account.reward_currency}
          rewardBalance={account.reward_balance}
          rewardRates={rewardRates}
        />
      )}

      {isLiability && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Reward Rules
            </h2>
            <div className="flex flex-wrap gap-2">
              <ImportRewardRulesDialog accountId={account.id} />
              <ApplyCloudRulesDialog
                accountId={account.id}
                ruleSets={CLOUD_REWARD_RULE_SETS}
              />
            </div>
          </div>
          <div className="grid gap-2">
            {account.reward_rules.map((rule) => (
              <RewardRuleInlineRow
                key={rule.category}
                accountId={account.id}
                rule={rule}
                rewardCurrency={account.reward_currency}
              />
            ))}
          </div>
          {account.reward_rules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No reward rules configured. Import a rule set or apply cloud rules to
              start editing them here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

async function AccountDetailTransactionsSection({
  accountPromise,
  transactionsPromise,
}: {
  accountPromise: Promise<AccountWithStats | null>;
  transactionsPromise: ReturnType<typeof loadAccountTransactions>;
}) {
  const account = await awaitRequiredAccount(accountPromise);
  const transactions = await transactionsPromise;

  return (
    <div className="space-y-3 animate-in fade-in-0 duration-200">
      <h2 className="text-lg font-semibold">Transactions</h2>
      <TransactionList
        transactions={transactions}
        accountId={account.id}
        accountType={account.type}
        currency={account.currency}
      />
    </div>
  );
}

async function AccountDetailHeaderSection({
  accountPromise,
  supportDataPromise,
}: {
  accountPromise: Promise<AccountWithStats | null>;
  supportDataPromise: Promise<AccountDetailSupportData>;
}) {
  const account = await awaitRequiredAccount(accountPromise);
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const isShare = account.type === AccountType.SHARE;
  const balanceToneClass =
    account.type === AccountType.LIABILITY
      ? getLiabilityBalanceToneClass(account.balance)
      : account.balance < 0
        ? 'text-red-500'
        : '';

  return (
    <div className="rounded-[2rem] border border-border/80 bg-card/95 p-6 shadow-[0_12px_40px_rgba(48,33,22,0.08)] sm:p-8 animate-in fade-in-0 duration-200">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Link href="/accounts" className="relative inline-flex">
            <InlineLinkLoading className="absolute -right-1 -top-1" />
            <Button variant="ghost" size="icon-sm" className="rounded-full">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl leading-none font-medium tracking-tight [font-family:var(--font-display)] sm:text-4xl">
                {account.name}
              </h1>
              <span className="rounded-full border border-border/80 bg-accent/60 px-2.5 py-1 text-[11px] tracking-[0.18em] text-muted-foreground">
                {isAirlineMiles
                  ? getAirlineProgramLabel(account.airline_program!)
                  : account.currency}
              </span>
              {isShare && account.ticker && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                  {account.ticker}
                </span>
              )}
            </div>
            <p
              className={`mt-3 text-2xl font-medium tracking-tight tabular-nums [font-family:var(--font-display)] ${balanceToneClass}`}
            >
              {isAirlineMiles
                ? `${Math.trunc(account.balance).toLocaleString()} miles`
                : formatAccountBalance(account.balance, account.currency, account.type)}
            </p>
          </div>
        </div>

        <div className="lg:max-w-[55%] lg:flex-1">
          <Suspense fallback={<AccountDetailActionSkeleton />}>
            <AccountDetailActionBar
              account={account}
              supportDataPromise={supportDataPromise}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function AccountDetailSupportStream({
  accountPromise,
  supportDataPromise,
}: {
  accountPromise: Promise<AccountWithStats | null>;
  supportDataPromise: Promise<AccountDetailSupportData>;
}) {
  const account = await awaitRequiredAccount(accountPromise);

  return (
    <div className="animate-in fade-in-0 duration-200">
      <AccountDetailSupportSection
        account={account}
        supportDataPromise={supportDataPromise}
      />
    </div>
  );
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);

  if (!context) {
    redirect('/login');
  }

  const accountPromise = loadAccountDetailCore(context, id);
  const supportDataPromise = loadAccountDetailSupport(context);
  const transactionsPromise = loadAccountTransactions(context, id);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Suspense fallback={<AccountDetailHeaderSkeleton />}>
        <AccountDetailHeaderSection
          accountPromise={accountPromise}
          supportDataPromise={supportDataPromise}
        />
      </Suspense>

      <Suspense fallback={<AccountDetailSupportSkeleton />}>
        <AccountDetailSupportStream
          accountPromise={accountPromise}
          supportDataPromise={supportDataPromise}
        />
      </Suspense>

      <Suspense fallback={<AccountDetailTransactionsSkeleton />}>
        <AccountDetailTransactionsSection
          accountPromise={accountPromise}
          transactionsPromise={transactionsPromise}
        />
      </Suspense>
    </div>
  );
}
