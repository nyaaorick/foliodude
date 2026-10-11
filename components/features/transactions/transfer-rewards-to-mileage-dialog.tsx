'use client';

import { useMemo, useState } from 'react';
import { ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { FormDialog } from '@/components/app/form-dialog';
import { DateField, Field, MemoField, OptionSelect, ReadOnlyValue } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { transferRewardsToMileageAccount } from '@/lib/actions/mileage-actions';
import { unwrap } from '@/lib/actions/result';
import { AccountType, type AccountOption } from '@/lib/types/accounts';
import { getAirlineProgramLabel, getRewardCurrencyLabel } from '@/lib/utils/display-labels';

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

function buildInitialSources(fixedSourceAccountId?: string): SourceDraft[] {
  return [{ accountId: fixedSourceAccountId ?? '', points: '' }];
}

export function TransferRewardsToMileageDialog({
  liabilityAccounts,
  mileageAccounts,
  fixedMileageAccountId,
  fixedSourceAccountId,
}: TransferRewardsToMileageDialogProps) {
  const [mileageAccountId, setMileageAccountId] = useState(fixedMileageAccountId ?? '');
  const [sources, setSources] = useState<SourceDraft[]>(buildInitialSources(fixedSourceAccountId));

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

  const primaryId = fixedSourceAccountId ?? sources[0]?.accountId ?? '';
  const primarySourceAccount =
    eligibleLiabilityAccounts.find((account) => account.id === primaryId) ?? null;
  const activeRewardCurrency = primarySourceAccount?.reward_currency ?? null;
  const selectedSourceIds = new Set(sources.map((source) => source.accountId).filter(Boolean));

  const getSourceOptions = (index: number) => {
    if (fixedSourceAccountId && index === 0) {
      return primarySourceAccount ? [primarySourceAccount] : [];
    }

    if (index === 0 && !activeRewardCurrency) return eligibleLiabilityAccounts;

    return eligibleLiabilityAccounts.filter(
      (account) =>
        account.reward_currency === activeRewardCurrency &&
        (sources[index]?.accountId === account.id || !selectedSourceIds.has(account.id)),
    );
  };

  const canAddSource =
    sources.length < 3 &&
    activeRewardCurrency !== null &&
    eligibleLiabilityAccounts.some(
      (account) =>
        account.reward_currency === activeRewardCurrency && !selectedSourceIds.has(account.id),
    );
  const hasMileageAccounts = mileageAccounts.length > 0;

  const updateSource = (index: number, nextSource: SourceDraft) => {
    setSources((prev) => prev.map((source, i) => (i === index ? nextSource : source)));
  };

  const fixedMileageAccount = fixedMileageAccountId
    ? mileageAccounts.find((account) => account.id === fixedMileageAccountId)
    : undefined;

  return (
    <FormDialog
      trigger={
        <Button
          size="sm"
          variant={fixedSourceAccountId ? 'outline' : 'default'}
          disabled={!hasMileageAccounts}
        >
          <ArrowRightLeft className="size-4" />
          Redeem
        </Button>
      }
      title={
        fixedMileageAccountId
          ? 'Transfer Points to This Mileage Account'
          : 'Redeem Points to Airline Miles'
      }
      description="Use up to 3 cards with the same fixed reward currency and transfer into an existing airline mileage account."
      contentClassName="sm:max-w-lg"
      submitLabel="Redeem"
      submitDisabled={!hasMileageAccounts || eligibleLiabilityAccounts.length === 0}
      onOpenChange={(open) => {
        if (open) return;
        setMileageAccountId(fixedMileageAccountId ?? '');
        setSources(buildInitialSources(fixedSourceAccountId));
      }}
      onSubmit={async (form) => {
        const targetMileageAccountId = fixedMileageAccountId ?? mileageAccountId;
        if (!targetMileageAccountId) throw new Error('Select an airline mileage account');

        const normalizedSources = sources.map((source) => ({
          accountId: source.accountId,
          points: Number.parseInt(source.points || '0', 10),
        }));
        if (normalizedSources.some((source) => !source.accountId || source.points <= 0)) {
          throw new Error('Each source must include a card and positive points');
        }

        unwrap(
          await transferRewardsToMileageAccount({
            mileageAccountId: targetMileageAccountId,
            sources: normalizedSources,
            memo: String(form.get('memo') ?? '') || undefined,
            date: String(form.get('date')),
          }),
        );
      }}
    >
      {fixedMileageAccount ? (
        <ReadOnlyValue label="Target Mileage Account">
          {formatMileageAccountOption(fixedMileageAccount)}
        </ReadOnlyValue>
      ) : (
        <Field label="Target Mileage Account">
          <OptionSelect
            value={mileageAccountId}
            onChange={setMileageAccountId}
            options={mileageAccounts.map((account) => ({
              value: account.id,
              label: formatMileageAccountOption(account),
            }))}
            placeholder="Select airline mileage account"
          />
        </Field>
      )}

      <ReadOnlyValue label="Reward Currency">
        {activeRewardCurrency
          ? getRewardCurrencyLabel(activeRewardCurrency, 'full')
          : 'Select the first card to lock the reward currency'}
      </ReadOnlyValue>

      <div className="space-y-3">
        {sources.map((source, index) => {
          const currentAccount = source.accountId
            ? (liabilityAccounts.find((account) => account.id === source.accountId) ?? null)
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
                  <OptionSelect
                    value={source.accountId}
                    onChange={(accountId) => updateSource(index, { ...source, accountId })}
                    options={getSourceOptions(index).map((account) => ({
                      value: account.id,
                      label: renderAccountOption(account),
                    }))}
                    placeholder="Select card"
                  />
                )}

                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Points"
                  value={source.points}
                  onChange={(event) => updateSource(index, { ...source, points: event.target.value })}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={sources.length === 1}
                  onClick={() => setSources((prev) => prev.filter((_, i) => i !== index))}
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
        onClick={() => setSources((prev) => [...prev, { accountId: '', points: '' }])}
      >
        <Plus className="size-4" />
        Add Source
      </Button>

      <MemoField placeholder="e.g. Family trip transfer" />
      <DateField />

      {!hasMileageAccounts && (
        <p className="text-sm text-muted-foreground">Create an airline mileage account first.</p>
      )}

      {hasMileageAccounts && eligibleLiabilityAccounts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No liability accounts currently have a fixed reward currency with a positive point balance.
        </p>
      )}
    </FormDialog>
  );
}
