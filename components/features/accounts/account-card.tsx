'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { Link } from 'react-router-dom';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { revalidate } from '@/lib/data/store';
import { setAssetApy } from '@/lib/actions/update-accounts-actions';
import { AccountType, type AccountWithStats } from '@/lib/types/accounts';
import type { RewardRateMap } from '@/lib/types/rewards';
import {
  formatAccountBalance,
  formatCurrencyAmount,
  getLiabilityBalanceToneClass,
} from '@/lib/utils/account-balance-display';
import { getAirlineProgramLabel } from '@/lib/utils/display-labels';
import { MileageBalanceCard, RewardBalanceList } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress, ProgressLabel } from '@/components/ui/progress';

function formatShares(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

const DEFAULT_ASSET_APY = 3.6;

function getAssetApy(autoPayConfig: unknown) {
  if (!autoPayConfig || typeof autoPayConfig !== 'object' || Array.isArray(autoPayConfig)) {
    return DEFAULT_ASSET_APY;
  }

  const rawApy = (autoPayConfig as Record<string, unknown>).asset_apy;
  if (typeof rawApy !== 'number' || !Number.isFinite(rawApy) || rawApy < 0) {
    return DEFAULT_ASSET_APY;
  }

  return rawApy;
}

function estimateOneYearProfit(balance: number, apy: number) {
  const principal = new Decimal(balance);
  return principal
    .mul(new Decimal(1).plus(new Decimal(apy).div(100)))
    .minus(principal)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

interface AccountCardProps {
  account: AccountWithStats;
  rewardRates: RewardRateMap;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
}

export function AccountCard({
  account,
  rewardRates,
  onDelete,
  isDeleting = false,
}: AccountCardProps) {
  const isLiability = account.type === AccountType.LIABILITY;
  const isAirlineMiles = account.type === AccountType.AIRLINE_MILES;
  const isShare = account.type === AccountType.SHARE;
  const isAsset = account.type === AccountType.ASSET;
  const hasCredit = isLiability && account.credit_limit !== null;
  const [apyDialogOpen, setApyDialogOpen] = useState(false);
  const [apyInput, setApyInput] = useState(getAssetApy(account.auto_pay_config).toString());
  const [apySubmitting, setApySubmitting] = useState(false);
  const [apyError, setApyError] = useState('');

  const usedAmount = hasCredit ? Math.max(-account.balance, 0) : 0;
  const displayTotal = hasCredit
    ? (account.credit_limit ?? 0) + Math.max(account.balance, 0)
    : 0;
  const usedPercent = displayTotal > 0 ? (usedAmount / displayTotal) * 100 : 0;
  const balanceToneClass = isLiability
    ? getLiabilityBalanceToneClass(account.balance)
    : account.balance < 0
      ? 'text-red-500'
      : '';
  const assetApy = getAssetApy(account.auto_pay_config);
  const estimatedOneYearProfit = estimateOneYearProfit(account.balance, assetApy);
  const draftApy = Number(apyInput);
  const draftProfit = estimateOneYearProfit(
    account.balance,
    Number.isFinite(draftApy) && draftApy >= 0 ? draftApy : 0,
  );

  return (
    <div className="flex items-start justify-between gap-4 rounded-[1.4rem] border border-border/80 bg-card/95 p-5 shadow-[0_10px_24px_rgba(48,33,22,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(48,33,22,0.09)]">
      <div className="min-w-0 flex-1 space-y-4">
        <Link to={`/accounts/${account.id}`} className="block space-y-3">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium tracking-tight">{account.name}</span>
            <span className="shrink-0 rounded-full border border-border/80 bg-accent/60 px-2.5 py-1 text-[11px] tracking-[0.18em] text-muted-foreground">
              {isAirlineMiles
                ? getAirlineProgramLabel(account.airline_program!)
                : account.currency}
            </span>
          </div>

          <p
            className={`text-2xl font-medium tracking-tight tabular-nums [font-family:var(--font-display)] ${balanceToneClass}`}
          >
            {isAirlineMiles
              ? `${Math.trunc(account.balance).toLocaleString()} miles`
              : formatAccountBalance(account.balance, account.currency, account.type)}
          </p>

          {isShare && (
            <p className="text-sm text-muted-foreground">
              {account.ticker ?? 'Ticker pending'}
              {' · '}
              {formatShares(account.shares)} shares
            </p>
          )}

          {hasCredit && (
            <Progress value={usedPercent} className="gap-2">
              <ProgressLabel className="text-xs text-muted-foreground">
                Used {formatCurrencyAmount(usedAmount, account.currency)}
                {' / '}
                {formatCurrencyAmount(displayTotal, account.currency)}
              </ProgressLabel>
            </Progress>
          )}
        </Link>

        {isAirlineMiles && account.airline_program && (
          <MileageBalanceCard
            accountId={account.id}
            airlineProgram={account.airline_program}
            miles={Math.trunc(account.balance)}
            usdPer10kMiles={account.usd_per_10k_miles}
            transferRates={account.transfer_rates}
            compact
          />
        )}

        {isLiability && (
          <RewardBalanceList
            rewardCurrency={account.reward_currency}
            rewardBalance={account.reward_balance}
            rewardRates={rewardRates}
            compact
          />
        )}

        {isAsset && (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              APY {assetApy.toFixed(2)}% · 1Y est{' '}
              {formatCurrencyAmount(estimatedOneYearProfit, account.currency)} · (estimate only, not added)
            </p>
            <Dialog
              open={apyDialogOpen}
              onOpenChange={(nextOpen) => {
                setApyDialogOpen(nextOpen);
                setApyError('');
                if (nextOpen) {
                  setApyInput(assetApy.toString());
                }
              }}
            >
              <DialogTrigger
                render={
                  <Button size="icon-sm" variant="ghost" className="rounded-full">
                    <Pencil className="size-3.5 text-muted-foreground" />
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit APY</DialogTitle>
                </DialogHeader>

                <form
                  className="space-y-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setApyError('');

                    const nextApy = Number(apyInput);
                    if (!Number.isFinite(nextApy) || nextApy < 0) {
                      setApyError('APY must be a non-negative number');
                      return;
                    }

                    setApySubmitting(true);

                    try {
                      await setAssetApy({
                        id: account.id,
                        apy: nextApy,
                      });
                      setApyDialogOpen(false);
                      revalidate();
                    } catch (caughtError) {
                      if (!(caughtError instanceof Error)) {
                        throw caughtError;
                      }
                      setApyError(caughtError.message);
                    } finally {
                      setApySubmitting(false);
                    }
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor={`asset-apy-${account.id}`}>APY (%)</Label>
                    <Input
                      id={`asset-apy-${account.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={apyInput}
                      onChange={(event) => setApyInput(event.target.value)}
                      required
                    />
                  </div>

                  <p className="text-sm text-muted-foreground">
                    1Y estimated profit:{' '}
                    <span className="font-medium text-foreground">
                      {formatCurrencyAmount(draftProfit, account.currency)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    (estimate only, not added)
                  </p>

                  {apyError && <p className="text-sm text-red-500">{apyError}</p>}

                  <DialogFooter>
                    <Button type="submit" disabled={apySubmitting}>
                      {apySubmitting ? 'Saving...' : 'Save APY'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full"
        disabled={isDeleting}
        onClick={(e) => {
          e.preventDefault();
          onDelete(account.id);
        }}
      >
        {isDeleting ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Trash2 className="size-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
