'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountType,
  SUPPORTED_CURRENCIES,
  type AccountWithStats,
  type CurrencyId,
} from '@/lib/types/accounts';
import { createAccount } from '@/lib/actions/create-accounts-actions';
import { AIRLINE_PROGRAMS, type AirlineProgram } from '@/lib/types/mileage';
import { REWARD_CURRENCIES, type RewardCurrencyId } from '@/lib/types/rewards';
import {
  getAccountTypeLabel,
  getAirlineProgramLabel,
  getCurrencyLabel,
  getRewardCurrencyChoiceLabel,
} from '@/lib/utils/display-labels';
import { buildShareAccountName } from '@/lib/utils/share-account-name';
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
import { Plus } from 'lucide-react';

interface CreateAccountDialogProps {
  accounts: AccountWithStats[];
}

function formatAccountOption(account: AccountWithStats) {
  return `${account.name} (${account.currency})`;
}

export function CreateAccountDialog({ accounts }: CreateAccountDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AccountType>(AccountType.ASSET);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [airlineProgram, setAirlineProgram] = useState<AirlineProgram>(
    AIRLINE_PROGRAMS[0].id,
  );
  const [currency, setCurrency] = useState<CurrencyId>('USD');
  const [balance, setBalance] = useState('0');
  const [creditLimit, setCreditLimit] = useState('0');
  const [rewardCurrency, setRewardCurrency] = useState<RewardCurrencyId | 'NONE'>('NONE');
  const [usdPer10kMiles, setUsdPer10kMiles] = useState('0');
  const [brokerageAccountId, setBrokerageAccountId] = useState('');
  const [initialShares, setInitialShares] = useState('0');
  const [initialPrice, setInitialPrice] = useState('');
  const [initialFee, setInitialFee] = useState('0');
  const [deductFromBrokerage, setDeductFromBrokerage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const brokerageOptions = accounts.filter(
    (account) => account.type === AccountType.ASSET && account.currency === 'USD',
  );
  const effectiveBrokerageAccountId =
    brokerageOptions.some((account) => account.id === brokerageAccountId)
      ? brokerageAccountId
      : brokerageOptions[0]?.id ?? '';
  const selectedBrokerageAccount =
    brokerageOptions.find((account) => account.id === effectiveBrokerageAccountId) ??
    null;
  const shareNamePreview =
    ticker.trim() && selectedBrokerageAccount
      ? buildShareAccountName(ticker, selectedBrokerageAccount.name)
      : '';

  const handleTypeChange = (nextType: AccountType) => {
    if (nextType === AccountType.LIABILITY) {
      setBalance('');
    } else if (type === AccountType.LIABILITY && balance === '') {
      setBalance('0');
    }

    if (nextType === AccountType.AIRLINE_MILES) {
      setCurrency('USD');
      setCreditLimit('0');
    }

    setType(nextType);
  };

  const resetForm = () => {
    setType(AccountType.ASSET);
    setName('');
    setTicker('');
    setAirlineProgram(AIRLINE_PROGRAMS[0].id);
    setCurrency('USD');
    setBalance('0');
    setCreditLimit('0');
    setRewardCurrency('NONE');
    setUsdPer10kMiles('0');
    setBrokerageAccountId('');
    setInitialShares('0');
    setInitialPrice('');
    setInitialFee('0');
    setDeductFromBrokerage(false);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await createAccount({
        name: type === AccountType.SHARE ? undefined : name,
        type,
        currency:
          type === AccountType.SHARE || type === AccountType.AIRLINE_MILES
            ? 'USD'
            : currency,
        balance:
          type === AccountType.SHARE
            ? 0
            : type === AccountType.LIABILITY
              ? -Math.abs(Number(balance || 0))
              : Number(balance),
        credit_limit:
          type === AccountType.LIABILITY ? Number(creditLimit || 0) : undefined,
        reward_currency:
          type === AccountType.LIABILITY
            ? rewardCurrency === 'NONE'
              ? null
              : rewardCurrency
            : undefined,
        airline_program:
          type === AccountType.AIRLINE_MILES ? airlineProgram : undefined,
        usd_per_10k_miles:
          type === AccountType.AIRLINE_MILES ? Number(usdPer10kMiles || 0) : undefined,
        ticker: type === AccountType.SHARE ? ticker.trim() : undefined,
        brokerage_account_id:
          type === AccountType.SHARE
            ? effectiveBrokerageAccountId || undefined
            : undefined,
        initial_shares:
          type === AccountType.SHARE ? Number(initialShares || 0) : undefined,
        initial_price:
          type === AccountType.SHARE && initialPrice !== ''
            ? Number(initialPrice)
            : undefined,
        initial_fee:
          type === AccountType.SHARE ? Number(initialFee || 0) : undefined,
        deduct_from_brokerage:
          type === AccountType.SHARE ? deductFromBrokerage : undefined,
      });

      setOpen(false);
      resetForm();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetForm();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            Add Account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Account</DialogTitle>
          <DialogDescription>
            Add a new bank account, credit card, airline mileage account, or stock position.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(val) => handleTypeChange(val as AccountType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{getAccountTypeLabel(type)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AccountType.ASSET}>
                  Asset (Checking, Savings, Brokerage Cash, etc.)
                </SelectItem>
                <SelectItem value={AccountType.LIABILITY}>
                  Liability (Credit Card or Loan)
                </SelectItem>
                <SelectItem value={AccountType.AIRLINE_MILES}>Airline Miles</SelectItem>
                <SelectItem value={AccountType.SHARE}>Share</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === AccountType.SHARE ? (
            <>
              <div className="space-y-2">
                <Label>Name</Label>
                <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                  {shareNamePreview || 'Ticker · Brokerage Cash Account'}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ticker">Ticker</Label>
                <Input
                  id="ticker"
                  name="ticker"
                  placeholder="e.g. AAPL"
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Brokerage Cash Account</Label>
                <Select
                  value={effectiveBrokerageAccountId}
                  onValueChange={(value) => value && setBrokerageAccountId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a USD asset account">
                      {selectedBrokerageAccount
                        ? formatAccountOption(selectedBrokerageAccount)
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {brokerageOptions.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {formatAccountOption(account)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                  USD
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial-shares">Initial Shares</Label>
                <Input
                  id="initial-shares"
                  name="initial_shares"
                  type="number"
                  step="0.000001"
                  min="0"
                  value={initialShares}
                  onChange={(event) => setInitialShares(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial-price">Cost Per Share</Label>
                <Input
                  id="initial-price"
                  name="initial_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={initialPrice}
                  onChange={(event) => setInitialPrice(event.target.value)}
                  placeholder="Required when initial shares > 0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial-fee">Fee</Label>
                <Input
                  id="initial-fee"
                  name="initial_fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={initialFee}
                  onChange={(event) => setInitialFee(event.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={deductFromBrokerage}
                  disabled={Number(initialShares || 0) <= 0}
                  onChange={(event) => setDeductFromBrokerage(event.target.checked)}
                />
                Deduct initial cost from linked cash account
              </label>
            </>
          ) : type === AccountType.AIRLINE_MILES ? (
            <>
              <div className="space-y-2">
                <Label>Account Name</Label>
                <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                  {getAirlineProgramLabel(airlineProgram)}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Airline Program</Label>
                <Select
                  value={airlineProgram}
                  onValueChange={(value) => setAirlineProgram(value as AirlineProgram)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{getAirlineProgramLabel(airlineProgram, 'full')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {AIRLINE_PROGRAMS.map((program) => (
                      <SelectItem key={program.id} value={program.id}>
                        {program.displayName} · {program.airlineName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="balance">Initial Miles</Label>
                <Input
                  id="balance"
                  name="balance"
                  type="number"
                  min="0"
                  step="1"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="usd_per_10k_miles">10k miles = ? USD</Label>
                <Input
                  id="usd_per_10k_miles"
                  name="usd_per_10k_miles"
                  type="number"
                  min="0"
                  step="1"
                  value={usdPer10kMiles}
                  onChange={(event) => setUsdPer10kMiles(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder={
                    type === AccountType.LIABILITY
                      ? 'e.g. Amex Aspire'
                      : 'e.g. Chase Checking'
                  }
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={currency}
                  onValueChange={(value) => setCurrency(value as CurrencyId)}
                >
                  <SelectTrigger className="w-full" id="currency">
                    <SelectValue>{getCurrencyLabel(currency)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(SUPPORTED_CURRENCIES).map((currencyOption) => (
                      <SelectItem key={currencyOption.id} value={currencyOption.id}>
                        {currencyOption.id} - {currencyOption.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="balance">Balance</Label>
                {type === AccountType.LIABILITY ? (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      -
                    </span>
                    <Input
                      id="balance"
                      name="balance"
                      type="number"
                      min="0"
                      step="0.01"
                      value={balance}
                      onChange={(event) => setBalance(event.target.value)}
                      className="pl-7"
                      required
                    />
                  </div>
                ) : (
                  <Input
                    id="balance"
                    name="balance"
                    type="number"
                    step="0.01"
                    value={balance}
                    onChange={(event) => setBalance(event.target.value)}
                    required
                  />
                )}
              </div>
            </>
          )}

          {type === AccountType.LIABILITY && (
            <>
              <div className="space-y-2">
                <Label htmlFor="credit_limit">Credit Limit</Label>
                <Input
                  id="credit_limit"
                  name="credit_limit"
                  type="number"
                  step="0.01"
                  value={creditLimit}
                  onChange={(event) => setCreditLimit(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Reward Currency</Label>
                <Select
                  value={rewardCurrency}
                  onValueChange={(value) =>
                    value && setRewardCurrency(value as RewardCurrencyId | 'NONE')
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{getRewardCurrencyChoiceLabel(rewardCurrency, 'full')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No rewards</SelectItem>
                    {REWARD_CURRENCIES.map((rewardOption) => (
                      <SelectItem key={rewardOption.id} value={rewardOption.id}>
                        {rewardOption.id} · {rewardOption.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {type === AccountType.SHARE && brokerageOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add a USD asset account first so this share account has a cash ledger.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                submitting || (type === AccountType.SHARE && brokerageOptions.length === 0)
              }
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
