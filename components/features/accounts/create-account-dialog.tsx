'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import { Field, OptionSelect, PrefixedInput, ReadOnlyValue } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createAccount } from '@/lib/actions/create-accounts-actions';
import {
  AccountType,
  SUPPORTED_CURRENCIES,
  type AccountWithStats,
  type CurrencyId,
} from '@/lib/types/accounts';
import { AIRLINE_PROGRAMS, type AirlineProgram } from '@/lib/types/mileage';
import { REWARD_CURRENCIES, type RewardCurrencyId } from '@/lib/types/rewards';
import {
  getAccountTypeLabel,
  getAirlineProgramLabel,
  getCurrencyLabel,
  getRewardCurrencyChoiceLabel,
} from '@/lib/utils/display-labels';
import { buildShareAccountName } from '@/lib/utils/share-account-name';

interface CreateAccountDialogProps {
  accounts: AccountWithStats[];
}

function formatAccountOption(account: AccountWithStats) {
  return `${account.name} (${account.currency})`;
}

const TYPE_OPTIONS = [
  { value: AccountType.ASSET, label: 'Asset (Checking, Savings, Brokerage Cash, etc.)' },
  { value: AccountType.LIABILITY, label: 'Liability (Credit Card or Loan)' },
  { value: AccountType.AIRLINE_MILES, label: 'Airline Miles' },
  { value: AccountType.SHARE, label: 'Share' },
].map((option) => ({ ...option, display: getAccountTypeLabel(option.value) }));

const PROGRAM_OPTIONS = AIRLINE_PROGRAMS.map((program) => ({
  value: program.id,
  label: `${program.displayName} · ${program.airlineName}`,
  display: getAirlineProgramLabel(program.id, 'full'),
}));

const CURRENCY_OPTIONS = Object.values(SUPPORTED_CURRENCIES).map((currency) => ({
  value: currency.id,
  label: `${currency.id} - ${currency.name}`,
  display: getCurrencyLabel(currency.id),
}));

const REWARD_OPTIONS = [
  { value: 'NONE', label: 'No rewards', display: getRewardCurrencyChoiceLabel('NONE', 'full') },
  ...REWARD_CURRENCIES.map((reward) => ({
    value: reward.id,
    label: `${reward.id} · ${reward.displayName}`,
    display: getRewardCurrencyChoiceLabel(reward.id, 'full'),
  })),
];

export function CreateAccountDialog({ accounts }: CreateAccountDialogProps) {
  const [type, setType] = useState<AccountType>(AccountType.ASSET);
  const [ticker, setTicker] = useState('');
  const [airlineProgram, setAirlineProgram] = useState<AirlineProgram>(AIRLINE_PROGRAMS[0].id);
  const [currency, setCurrency] = useState<CurrencyId>('USD');
  const [rewardCurrency, setRewardCurrency] = useState<RewardCurrencyId | 'NONE'>('NONE');
  const [brokerageAccountId, setBrokerageAccountId] = useState('');
  const [initialShares, setInitialShares] = useState('0');
  // Bumped on close so the uncontrolled fields below start over.
  const [formKey, setFormKey] = useState(0);

  const brokerageOptions = accounts.filter(
    (account) => account.type === AccountType.ASSET && account.currency === 'USD',
  );
  const selectedBrokerageAccount =
    brokerageOptions.find((account) => account.id === brokerageAccountId) ??
    brokerageOptions[0] ??
    null;
  const shareNamePreview =
    ticker.trim() && selectedBrokerageAccount
      ? buildShareAccountName(ticker, selectedBrokerageAccount.name)
      : '';

  const cannotCreateShare = type === AccountType.SHARE && brokerageOptions.length === 0;

  const reset = () => {
    setType(AccountType.ASSET);
    setTicker('');
    setAirlineProgram(AIRLINE_PROGRAMS[0].id);
    setCurrency('USD');
    setRewardCurrency('NONE');
    setBrokerageAccountId('');
    setInitialShares('0');
    setFormKey((key) => key + 1);
  };

  const isShare = type === AccountType.SHARE;
  const isMiles = type === AccountType.AIRLINE_MILES;
  const isLiability = type === AccountType.LIABILITY;

  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus className="size-4" />
          Add Account
        </Button>
      }
      title="Create Account"
      description="Add a new bank account, credit card, airline mileage account, or stock position."
      submitLabel="Create"
      pendingLabel="Creating..."
      submitDisabled={cannotCreateShare}
      onOpenChange={(open) => {
        if (!open) reset();
      }}
      onSubmit={async (form) => {
        const priceText = String(form.get('initial_price') ?? '');

        await createAccount({
          name: isShare ? undefined : formText(form, 'name'),
          type,
          currency: isShare || isMiles ? 'USD' : currency,
          balance: isShare
            ? 0
            : isLiability
              ? -Math.abs(formNumber(form, 'balance'))
              : formNumber(form, 'balance'),
          credit_limit: isLiability ? formNumber(form, 'credit_limit') : undefined,
          reward_currency: isLiability
            ? rewardCurrency === 'NONE'
              ? null
              : rewardCurrency
            : undefined,
          airline_program: isMiles ? airlineProgram : undefined,
          usd_per_10k_miles: isMiles ? formNumber(form, 'usd_per_10k_miles') : undefined,
          ticker: isShare ? ticker.trim() : undefined,
          brokerage_account_id: isShare ? selectedBrokerageAccount?.id : undefined,
          initial_shares: isShare ? Number(initialShares || 0) : undefined,
          initial_price: isShare && priceText !== '' ? Number(priceText) : undefined,
          deduct_from_brokerage: isShare ? form.get('deduct_from_brokerage') === 'on' : undefined,
        });
      }}
    >
      <Field label="Type">
        <OptionSelect
          value={type}
          onChange={(value) => setType(value as AccountType)}
          options={TYPE_OPTIONS}
        />
      </Field>

      {/* Keyed so switching type starts the type-specific fields from their defaults. */}
      <div key={`${type}-${formKey}`} className="space-y-4">
        {isShare ? (
          <>
            <ReadOnlyValue label="Name">
              {shareNamePreview || 'Ticker · Brokerage Cash Account'}
            </ReadOnlyValue>

            <Field label="Ticker" htmlFor="ticker">
              <Input
                id="ticker"
                name="ticker"
                placeholder="e.g. AAPL"
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                required
              />
            </Field>

            <Field label="Brokerage Cash Account">
              <OptionSelect
                value={selectedBrokerageAccount?.id ?? ''}
                onChange={setBrokerageAccountId}
                options={brokerageOptions.map((account) => ({
                  value: account.id,
                  label: formatAccountOption(account),
                }))}
                placeholder="Select a USD asset account"
              />
            </Field>

            <ReadOnlyValue label="Currency">USD</ReadOnlyValue>

            <Field label="Initial Shares" htmlFor="initial-shares">
              <Input
                id="initial-shares"
                name="initial_shares"
                type="number"
                step="0.000001"
                min="0"
                value={initialShares}
                onChange={(event) => setInitialShares(event.target.value)}
              />
            </Field>

            <Field label="Cost Per Share" htmlFor="initial-price">
              <Input
                id="initial-price"
                name="initial_price"
                type="number"
                step="0.01"
                min="0"
                placeholder="Required when initial shares > 0"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="deduct_from_brokerage"
                disabled={Number(initialShares || 0) <= 0}
              />
              Deduct initial cost from linked cash account
            </label>
          </>
        ) : isMiles ? (
          <>
            <ReadOnlyValue label="Account Name">{getAirlineProgramLabel(airlineProgram)}</ReadOnlyValue>

            <Field label="Airline Program">
              <OptionSelect
                value={airlineProgram}
                onChange={(value) => setAirlineProgram(value as AirlineProgram)}
                options={PROGRAM_OPTIONS}
              />
            </Field>

            <Field label="Initial Miles" htmlFor="balance">
              <Input
                id="balance"
                name="balance"
                type="number"
                min="0"
                step="1"
                defaultValue="0"
                required
              />
            </Field>

            <Field label="10k miles = ? USD" htmlFor="usd_per_10k_miles">
              <Input
                id="usd_per_10k_miles"
                name="usd_per_10k_miles"
                type="number"
                min="0"
                step="1"
                defaultValue="0"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Name" htmlFor="name">
              <Input
                id="name"
                name="name"
                placeholder={isLiability ? 'e.g. Amex Aspire' : 'e.g. Chase Checking'}
                required
              />
            </Field>

            <Field label="Currency">
              <OptionSelect
                value={currency}
                onChange={(value) => setCurrency(value as CurrencyId)}
                options={CURRENCY_OPTIONS}
                id="currency"
              />
            </Field>

            <Field label="Balance" htmlFor="balance">
              {isLiability ? (
                <PrefixedInput
                  prefix="-"
                  prefixClassName="left-3"
                  id="balance"
                  name="balance"
                  type="number"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  required
                />
              ) : (
                <Input id="balance" name="balance" type="number" step="0.01" defaultValue="0" required />
              )}
            </Field>
          </>
        )}

        {isLiability && (
          <>
            <Field label="Credit Limit" htmlFor="credit_limit">
              <Input id="credit_limit" name="credit_limit" type="number" step="0.01" defaultValue="0" />
            </Field>

            <Field label="Reward Currency">
              <OptionSelect
                value={rewardCurrency}
                onChange={(value) => setRewardCurrency(value as RewardCurrencyId | 'NONE')}
                options={REWARD_OPTIONS}
              />
            </Field>
          </>
        )}
      </div>

      {cannotCreateShare && (
        <p className="text-sm text-muted-foreground">
          Add a USD asset account first so this share account has a cash ledger.
        </p>
      )}
    </FormDialog>
  );
}
