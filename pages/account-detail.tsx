import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import {
  loadAccountDetailCore,
  loadAccountDetailSupport,
  loadAccountTransactions,
  type AccountDetailSupportData,
} from '@/lib/actions/account-read-actions';
import { useLiveQuery } from '@/lib/data/use-live-query';
import { CLOUD_REWARD_RULE_SETS } from '@/lib/data/cloud-rules';
import { AccountType, type AccountWithStats } from '@/lib/types/accounts';
import type { TransactionWithReward } from '@/lib/types/transactions';
import {
  formatAccountBalance,
  formatCurrencyAmount,
  getLiabilityBalanceToneClass,
} from '@/lib/utils/account-balance-display';
import { getAirlineProgramLabel } from '@/lib/utils/display-labels';
import { Loaded, Page } from '@/components/app/page-state';
import { EditAccountNameDialog } from '@/components/features/accounts/edit-account-name-dialog';
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

interface AccountDetail {
  account: AccountWithStats | null;
  support: AccountDetailSupportData;
  transactions: TransactionWithReward[];
}

function formatShares(amount: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  const [year, month, day] = value.split('-');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-base font-medium tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * Every action that applies to this account type.
 *
 * The buttons wrap rather than sitting in a fixed row: at 350px this is three
 * or four rows of full-height taps, and at desktop width it collapses back to
 * a single trailing row.
 */
function ActionBar({
  account,
  support,
}: {
  account: AccountWithStats;
  support: AccountDetailSupportData;
}) {
  const { accounts } = support;
  const isAsset = account.type === AccountType.ASSET;
  const isLiability = account.type === AccountType.LIABILITY;
  const isShare = account.type === AccountType.SHARE;
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const liabilityAccounts = accounts.filter((item) => item.type === AccountType.LIABILITY);
  const mileageAccounts = accounts.filter((item) => item.type === AccountType.AIRLINE_MILES);

  return (
    <div className="flex flex-wrap gap-2">
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
          <CreateAssetExpenseDialog accountId={account.id} accountCurrency={account.currency} />
          <AdjustAssetBalanceDialog accountId={account.id} accountCurrency={account.currency} />
          <CreateTransferDialog
            mode="transfer"
            accounts={accounts}
            fromAccountId={account.id}
            triggerLabel="Transfer"
          />
        </>
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
          <CreateTransactionDialog accountId={account.id} accountCurrency={account.currency} />
          {account.reward_currency !== null && (
            <>
              <CreateRewardTransactionDialog accountId={account.id} triggerLabel="Adjust Points" />
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

function SupportSection({
  account,
  support,
}: {
  account: AccountWithStats;
  support: AccountDetailSupportData;
}) {
  const { accounts, rewardRates } = support;
  const isLiability = account.type === AccountType.LIABILITY;
  const isShare = account.type === AccountType.SHARE;
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const hasCredit = isLiability && account.credit_limit !== null;
  const linkedBrokerage = account.brokerage_account_id
    ? accounts.find((item) => item.id === account.brokerage_account_id) ?? null
    : null;
  const usedAmount = hasCredit ? Math.max(-account.balance, 0) : 0;
  const displayTotal = hasCredit
    ? (account.credit_limit ?? 0) + Math.max(account.balance, 0)
    : 0;
  const unrealized = account.balance - account.cost_basis;

  return (
    <div className="space-y-4">
      {isShare && (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Position"
            value={`${formatShares(account.shares)} shares`}
            note={`Cash: ${linkedBrokerage ? linkedBrokerage.name : 'Deleted account'}`}
          />
          <Stat
            label="Cost Basis"
            value={formatCurrencyAmount(account.cost_basis, 'USD')}
            note={
              <>
                Unrealized{' '}
                <span className={unrealized >= 0 ? 'text-green-600' : 'text-red-500'}>
                  {formatCurrencyAmount(unrealized, 'USD')}
                </span>
              </>
            }
          />
          <Stat
            label="Last Price"
            value={
              account.last_price === null
                ? 'Unavailable'
                : formatCurrencyAmount(account.last_price, 'USD')
            }
            note={`Updated ${formatDate(account.last_price_date)}`}
          />
          <Stat label="Market Value" value={formatCurrencyAmount(account.balance, 'USD')} />
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
        <Progress value={displayTotal > 0 ? (usedAmount / displayTotal) * 100 : 0}>
          <ProgressLabel className="text-xs text-muted-foreground">
            Used {formatCurrencyAmount(usedAmount, account.currency)}
            {' / '}
            {formatCurrencyAmount(displayTotal, account.currency)}
          </ProgressLabel>
        </Progress>
      )}

      {isLiability && (
        <>
          <RewardBalanceList
            rewardCurrency={account.reward_currency}
            rewardBalance={account.reward_balance}
            rewardRates={rewardRates}
          />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Reward Rules</h2>
              <div className="flex flex-wrap gap-2">
                <ImportRewardRulesDialog accountId={account.id} />
                <ApplyCloudRulesDialog
                  accountId={account.id}
                  ruleSets={CLOUD_REWARD_RULE_SETS}
                />
              </div>
            </div>
            {account.reward_rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No reward rules configured. Import a rule set or apply cloud rules to start
                editing them here.
              </p>
            ) : (
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
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accountId = id!;

  const state = useLiveQuery<AccountDetail>(
    async () => {
      const [account, support, transactions] = await Promise.all([
        loadAccountDetailCore(accountId),
        loadAccountDetailSupport(),
        loadAccountTransactions(accountId),
      ]);
      return { account, support, transactions };
    },
    [accountId],
  );

  return (
    <Page>
      <Loaded state={state}>
        {({ account, support, transactions }) =>
          account === null ? (
            <div className="rounded-2xl border border-border/60 bg-card/70 p-8 text-center">
              <p className="text-sm text-muted-foreground">This account no longer exists.</p>
              <Link to="/accounts" className="mt-3 inline-block text-sm underline">
                Back to accounts
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-3 rounded-2xl border border-border/80 bg-card/95 p-4 md:p-6">
                <div className="flex items-start gap-2">
                  <Link to="/accounts" aria-label="Back to accounts">
                    <Button variant="ghost" size="icon-sm" className="rounded-full">
                      <ArrowLeft className="size-4" />
                    </Button>
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-medium tracking-tight [font-family:var(--font-display)] md:text-3xl">
                        {account.name}
                      </h1>
                      <span className="rounded-full border border-border/80 bg-accent/60 px-2.5 py-1 text-[11px] tracking-[0.18em] text-muted-foreground">
                        {account.type === AccountType.AIRLINE_MILES
                          ? getAirlineProgramLabel(account.airline_program!)
                          : account.currency}
                      </span>
                      {account.type === AccountType.SHARE && account.ticker && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                          {account.ticker}
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-2 text-2xl font-medium tabular-nums tracking-tight [font-family:var(--font-display)] ${
                        account.type === AccountType.LIABILITY
                          ? getLiabilityBalanceToneClass(account.balance)
                          : account.balance < 0
                            ? 'text-red-500'
                            : ''
                      }`}
                    >
                      {account.type === AccountType.AIRLINE_MILES
                        ? `${Math.trunc(account.balance).toLocaleString()} miles`
                        : formatAccountBalance(account.balance, account.currency, account.type)}
                    </p>
                  </div>
                </div>

                <ActionBar account={account} support={support} />
              </div>

              <SupportSection account={account} support={support} />

              <div className="space-y-2">
                <h2 className="text-base font-medium">Transactions</h2>
                <TransactionList
                  transactions={transactions}
                  accountId={account.id}
                  accountType={account.type}
                  currency={account.currency}
                />
              </div>
            </>
          )
        }
      </Loaded>
    </Page>
  );
}
