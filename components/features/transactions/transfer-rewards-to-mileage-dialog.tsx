'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { transferRewardsToMileageAccount } from '@/lib/actions/mileage-actions';
import { AccountType, type AccountOption } from '@/lib/types/accounts';
import {
  getAirlineProgramLabel,
  getRewardCurrencyLabel,
} from '@/lib/utils/display-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface TransferRewardsToMileageDialogProps {
  liabilityAccounts: AccountOption[];
  mileageAccounts: AccountOption[];
  fixedMileageAccountId?: string;
  fixedSourceAccountId?: string;
}

interface SourceDraft {
  accountId: string;
  points: string;
}

function renderAccountOption(account: AccountOption) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span className="max-w-full truncate text-sm leading-tight">{account.name}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">
        {account.currency}
        {account.reward_currency
          ? ` · ${account.reward_balance.toLocaleString()} ${getRewardCurrencyLabel(account.reward_currency)}`
          : ''}
      </span>
    </span>
  );
}

function formatMileageAccountOption(account: AccountOption) {
  if (!account.airline_program) {
    throw new Error(`Mileage account ${account.id} is missing airline_program`);
  }

  return getAirlineProgramLabel(account.airline_program, 'full');
}

function buildInitialSources(
  fixedSourceAccountId?: string,
): SourceDraft[] {
  return [{ accountId: fixedSourceAccountId ?? '', points: '' }];
}

export function TransferRewardsToMileageDialog({
  liabilityAccounts,
  mileageAccounts,
  fixedMileageAccountId,
  fixedSourceAccountId,
}: TransferRewardsToMileageDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mileageAccountId, setMileageAccountId] = useState(fixedMileageAccountId ?? '');
  const [sources, setSources] = useState<SourceDraft[]>(
    buildInitialSources(fixedSourceAccountId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const eligibleLiabilityAccounts = useMemo(
    () =>
      liabilityAccounts.filter(
        (account) =>
          account.type === AccountType.LIABILITY &&
          account.reward_currency !== null &&
          account.reward_balance > 0,
      ),
    [liabilityAccounts],
  );

  const primarySourceAccount = useMemo(() => {
    const primaryId = fixedSourceAccountId ?? sources[0]?.accountId ?? '';
    return eligibleLiabilityAccounts.find((account) => account.id === primaryId) ?? null;
  }, [eligibleLiabilityAccounts, fixedSourceAccountId, sources]);

  const activeRewardCurrency = primarySourceAccount?.reward_currency ?? null;

  const selectedSourceIds = new Set(sources.map((source) => source.accountId).filter(Boolean));

  const getSourceOptions = (index: number) => {
    if (fixedSourceAccountId && index === 0) {
      return primarySourceAccount ? [primarySourceAccount] : [];
    }

    if (index === 0 && !activeRewardCurrency) {
      return eligibleLiabilityAccounts;
    }

    return eligibleLiabilityAccounts.filter((account) => {
      if (account.reward_currency !== activeRewardCurrency) {
        return false;
      }

      if (sources[index]?.accountId === account.id) {
        return true;
      }

      return !selectedSourceIds.has(account.id);
    });
  };

  const canAddSource =
    sources.length < 3 &&
    activeRewardCurrency !== null &&
    eligibleLiabilityAccounts.some(
      (account) =>
        account.reward_currency === activeRewardCurrency &&
        !selectedSourceIds.has(account.id),
    );
  const hasMileageAccounts = mileageAccounts.length > 0;

  const updateSource = (index: number, nextSource: SourceDraft) => {
    setSources((prev) => prev.map((source, i) => (i === index ? nextSource : source)));
  };

  const resetState = () => {
    setMileageAccountId(fixedMileageAccountId ?? '');
    setSources(buildInitialSources(fixedSourceAccountId));
    setSubmitting(false);
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const form = new FormData(event.currentTarget);
    const date = form.get('date') as string;
    const memo = form.get('memo') as string;
    const targetMileageAccountId = fixedMileageAccountId ?? mileageAccountId;
    const normalizedSources = sources.map((source) => ({
      accountId: source.accountId,
      points: Number.parseInt(source.points || '0', 10),
    }));

    if (!targetMileageAccountId) {
      setError('Select an airline mileage account');
      return;
    }

    if (normalizedSources.some((source) => !source.accountId || source.points <= 0)) {
      setError('Each source must include a card and positive points');
      return;
    }

    setSubmitting(true);
    const result = await transferRewardsToMileageAccount({
      mileageAccountId: targetMileageAccountId,
      sources: normalizedSources,
      memo: memo || undefined,
      date: new Date(date).toISOString(),
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    resetState();
    router.refresh();
  };

  const title = fixedMileageAccountId
    ? 'Transfer Points to This Mileage Account'
    : 'Redeem Points to Airline Miles';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant={fixedSourceAccountId ? 'outline' : 'default'}
            disabled={!hasMileageAccounts}
          >
            <ArrowRightLeft className="size-4" />
            Redeem
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Use up to 3 cards with the same fixed reward currency and transfer into an existing airline mileage account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {fixedMileageAccountId ? (
            <div className="space-y-2">
              <Label>Target Mileage Account</Label>
              <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                {formatMileageAccountOption(
                  mileageAccounts.find((account) => account.id === fixedMileageAccountId)!,
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Target Mileage Account</Label>
              <Select
                value={mileageAccountId}
                onValueChange={(value) => value && setMileageAccountId(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select airline mileage account">
                    {mileageAccountId
                      ? formatMileageAccountOption(
                          mileageAccounts.find((account) => account.id === mileageAccountId)!,
                        )
                      : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {mileageAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {formatMileageAccountOption(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reward Currency</Label>
            <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
              {activeRewardCurrency
                ? getRewardCurrencyLabel(activeRewardCurrency, 'full')
                : 'Select the first card to lock the reward currency'}
            </div>
          </div>

          <div className="space-y-3">
            {sources.map((source, index) => {
              const sourceOptions = getSourceOptions(index);
              const currentAccount = source.accountId
                ? liabilityAccounts.find((account) => account.id === source.accountId) ?? null
                : null;
              const sourcePoints = Number.parseInt(source.points || '0', 10);
              const remainingPoints =
                currentAccount && Number.isFinite(sourcePoints)
                  ? currentAccount.reward_balance - Math.max(sourcePoints, 0)
                  : null;

              return (
                <div key={index} className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                    {fixedSourceAccountId && index === 0 ? (
                      <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                        {currentAccount ? renderAccountOption(currentAccount) : 'Missing card'}
                      </div>
                    ) : (
                      <Select
                        value={source.accountId}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateSource(index, { ...source, accountId: value });
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select card">
                            {currentAccount ? renderAccountOption(currentAccount) : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {sourceOptions.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {renderAccountOption(account)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Points"
                      value={source.points}
                      onChange={(event) =>
                        updateSource(index, { ...source, points: event.target.value })
                      }
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={sources.length === 1}
                      onClick={() =>
                        setSources((prev) =>
                          prev.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {currentAccount?.reward_currency && (
                    <p className="text-xs text-muted-foreground">
                      Available {currentAccount.reward_balance.toLocaleString()}{' '}
                      {getRewardCurrencyLabel(currentAccount.reward_currency)}
                      {remainingPoints !== null &&
                        source.points &&
                        ` · Remaining ${Math.max(remainingPoints, 0).toLocaleString()} ${getRewardCurrencyLabel(currentAccount.reward_currency)}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canAddSource}
            onClick={() =>
              setSources((prev) => [...prev, { accountId: '', points: '' }])
            }
          >
            <Plus className="size-4" />
            Add Source
          </Button>

          <div className="space-y-2">
            <Label htmlFor="memo">Memo (optional)</Label>
            <Input id="memo" name="memo" placeholder="e.g. Family trip transfer" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>

          {!hasMileageAccounts && (
            <p className="text-sm text-muted-foreground">
              Create an airline mileage account first.
            </p>
          )}

          {hasMileageAccounts && eligibleLiabilityAccounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No liability accounts currently have a fixed reward currency with a positive point balance.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button
              type="submit"
              disabled={submitting || !hasMileageAccounts || eligibleLiabilityAccounts.length === 0}
            >
              {submitting ? 'Saving...' : 'Redeem'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
