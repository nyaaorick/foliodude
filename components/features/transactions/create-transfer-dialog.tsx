'use client';

import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { revalidate } from '@/lib/data/store';
import { createTransfer } from '@/lib/actions/createTransfer';
import { buyShare, sellShare } from '@/lib/actions/share-actions';
import { AccountType, type AccountOption } from '@/lib/types/accounts';
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

interface CreateTransferDialogProps {
  mode: 'transfer' | 'repay' | 'buy-share' | 'sell-share';
  accounts: AccountOption[];
  fromAccountId?: string;
  toAccountId?: string;
  shareAccountId?: string;
  triggerLabel: string;
}

function formatAccountOption(account: AccountOption) {
  return `${account.name} (${account.currency})`;
}

function getDialogCopy(mode: CreateTransferDialogProps['mode']) {
  switch (mode) {
    case 'repay':
      return {
        title: 'Repay Card',
        description: 'Move money from an asset account to this liability account.',
        submitLabel: 'Save Repayment',
      };
    case 'buy-share':
      return {
        title: 'Buy Shares',
        description: 'Record a stock purchase using the linked brokerage cash account.',
        submitLabel: 'Save Buy',
      };
    case 'sell-share':
      return {
        title: 'Sell Shares',
        description: 'Record a stock sale and move proceeds into the linked brokerage cash account.',
        submitLabel: 'Save Sale',
      };
    default:
      return {
        title: 'Transfer Funds',
        description: 'Transfer funds between your accounts.',
        submitLabel: 'Save Transfer',
      };
  }
}

export function CreateTransferDialog({
  mode,
  accounts,
  fromAccountId,
  toAccountId,
  shareAccountId,
  triggerLabel,
}: CreateTransferDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetAmountTouched, setTargetAmountTouched] = useState(false);
  const [targetAmountLoading, setTargetAmountLoading] = useState(false);

  const fixedFromAccount = fromAccountId
    ? accounts.find((account) => account.id === fromAccountId) ?? null
    : null;
  const fixedToAccount = toAccountId
    ? accounts.find((account) => account.id === toAccountId) ?? null
    : null;
  const shareAccount = shareAccountId
    ? accounts.find((account) => account.id === shareAccountId) ?? null
    : null;
  const linkedBrokerageAccount =
    shareAccount?.brokerage_account_id
      ? accounts.find((account) => account.id === shareAccount.brokerage_account_id) ??
        null
      : null;

  const sourceOptions = fixedToAccount
    ? accounts.filter((account) => account.type === AccountType.ASSET)
    : [];

  const targetOptions = fixedFromAccount
    ? accounts.filter(
        (account) =>
          account.id !== fixedFromAccount.id &&
          (account.type === AccountType.ASSET ||
            account.type === AccountType.LIABILITY),
      )
    : [];

  const [selectedFromAccountId, setSelectedFromAccountId] = useState(
    fromAccountId ?? sourceOptions[0]?.id ?? '',
  );
  const [selectedToAccountId, setSelectedToAccountId] = useState(
    toAccountId ?? targetOptions[0]?.id ?? '',
  );

  const selectedFromAccount = fixedFromAccount
    ? fixedFromAccount
    : sourceOptions.find((account) => account.id === selectedFromAccountId) ?? null;
  const selectedToAccount = fixedToAccount
    ? fixedToAccount
    : targetOptions.find((account) => account.id === selectedToAccountId) ?? null;

  const isShareMode = mode === 'buy-share' || mode === 'sell-share';
  const isCrossCurrency = Boolean(
    !isShareMode &&
      selectedFromAccount &&
      selectedToAccount &&
      selectedFromAccount.currency !== selectedToAccount.currency,
  );
  const hasCompatibleAccounts = isShareMode
    ? Boolean(shareAccount && linkedBrokerageAccount)
    : mode === 'transfer'
      ? targetOptions.length > 0
      : sourceOptions.length > 0;

  const copy = getDialogCopy(mode);

  useEffect(() => {
    if (!open || isShareMode || !isCrossCurrency || !selectedFromAccount || !selectedToAccount) {
      if (!isCrossCurrency) {
        setTargetAmount('');
        setTargetAmountTouched(false);
        setTargetAmountLoading(false);
      }
      return;
    }

    if (targetAmountTouched) {
      return;
    }

    let cancelled = false;
    const fromCurrency = selectedFromAccount.currency;
    const toCurrency = selectedToAccount.currency;

    async function loadTargetAmount() {
      setTargetAmountLoading(true);

      try {
        const response = await fetch(
          `/api/exchange-rate?from=${fromCurrency}&to=${toCurrency}`,
        );

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { rate?: number };
        if (
          cancelled ||
          typeof payload.rate !== 'number' ||
          !Number.isFinite(payload.rate) ||
          payload.rate <= 0
        ) {
          return;
        }

        const sourceAmount = Number(amount || '0');
        setTargetAmount(
          sourceAmount > 0 ? (sourceAmount * payload.rate).toFixed(2) : '',
        );
      } finally {
        if (!cancelled) {
          setTargetAmountLoading(false);
        }
      }
    }

    void loadTargetAmount();

    return () => {
      cancelled = true;
    };
  }, [
    amount,
    isCrossCurrency,
    isShareMode,
    open,
    selectedFromAccount,
    selectedToAccount,
    targetAmountTouched,
  ]);

  const resetTransferState = () => {
    setAmount('');
    setTargetAmount('');
    setTargetAmountTouched(false);
    setTargetAmountLoading(false);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    const form = new FormData(e.currentTarget);
    const memo = form.get('memo') as string;

    if (isShareMode) {
      if (!shareAccount || !linkedBrokerageAccount) {
        setError('Linked brokerage cash account is missing');
        return;
      }

      const quantity = Number(form.get('quantity') || '0');
      const price = Number(form.get('sharePrice') || '0');

      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Quantity must be greater than 0');
        return;
      }

      if (!Number.isFinite(price) || price <= 0) {
        setError('Price must be greater than 0');
        return;
      }

      setSubmitting(true);

      const result =
        mode === 'buy-share'
          ? await buyShare({
              shareAccountId: shareAccount.id,
              brokerageAccountId: linkedBrokerageAccount.id,
              quantity,
              price,
              memo: memo || undefined,
            })
          : await sellShare({
              shareAccountId: shareAccount.id,
              brokerageAccountId: linkedBrokerageAccount.id,
              quantity,
              price,
              memo: memo || undefined,
            });

      setSubmitting(false);

      if (!result.success) {
        setError(result.error);
        return;
      }

      setOpen(false);
      revalidate();
      return;
    }

    const currentFromAccountId = fixedFromAccount?.id ?? selectedFromAccountId;
    const currentToAccountId = fixedToAccount?.id ?? selectedToAccountId;

    if (!currentFromAccountId || !currentToAccountId) {
      setError('Select both accounts');
      return;
    }

    const parsedAmount = Number(amount || '0');

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be greater than 0');
      return;
    }

    const parsedTargetAmount = isCrossCurrency ? Number(targetAmount || '0') : undefined;

    if (
      isCrossCurrency &&
      (!parsedTargetAmount ||
        !Number.isFinite(parsedTargetAmount) ||
        parsedTargetAmount <= 0)
    ) {
      setError('Target amount must be greater than 0');
      return;
    }

    setSubmitting(true);

    try {
      await createTransfer({
        fromAccountId: currentFromAccountId,
        toAccountId: currentToAccountId,
        amount: parsedAmount,
        targetAmount: parsedTargetAmount,
        memo: memo || undefined,
      });

      setOpen(false);
      resetTransferState();
      revalidate();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const triggerVariant =
    mode === 'repay' || mode === 'sell-share' ? 'outline' : 'default';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetTransferState();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant={triggerVariant}>
            <ArrowRightLeft className="size-4" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isShareMode ? (
            <>
              <div className="space-y-2">
                <Label>
                  {mode === 'buy-share' ? 'From Cash Account' : 'To Cash Account'}
                </Label>
                <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                  {linkedBrokerageAccount
                    ? formatAccountOption(linkedBrokerageAccount)
                    : 'Missing linked brokerage account'}
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  {mode === 'buy-share' ? 'To Share Account' : 'From Share Account'}
                </Label>
                <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                  {shareAccount ? formatAccountOption(shareAccount) : 'Missing share account'}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  required
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sharePrice">Price</Label>
                <Input
                  id="sharePrice"
                  name="sharePrice"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  required
                  placeholder="0.0000"
                />
              </div>
            </>
          ) : (
            <>
              {fixedFromAccount ? (
                <div className="space-y-2">
                  <Label>From</Label>
                  <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                    {formatAccountOption(fixedFromAccount)}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>From</Label>
                  <Select
                    value={selectedFromAccountId}
                    onValueChange={(value) => value && setSelectedFromAccountId(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select source account">
                        {selectedFromAccount
                          ? formatAccountOption(selectedFromAccount)
                          : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {sourceOptions.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {formatAccountOption(account)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {fixedToAccount ? (
                <div className="space-y-2">
                  <Label>To</Label>
                  <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                    {formatAccountOption(fixedToAccount)}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>To</Label>
                  <Select
                    value={selectedToAccountId}
                    onValueChange={(value) => value && setSelectedToAccountId(value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select destination account">
                        {selectedToAccount ? formatAccountOption(selectedToAccount) : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {targetOptions.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {formatAccountOption(account)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {isCrossCurrency && (
                <div className="space-y-2">
                  <Label htmlFor="targetAmount">
                    {selectedToAccount?.currency} Amount
                  </Label>
                  <Input
                    id="targetAmount"
                    name="targetAmount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={targetAmount}
                    onChange={(e) => {
                      setTargetAmount(e.target.value);
                      setTargetAmountTouched(true);
                    }}
                  />
                  {targetAmountLoading && (
                    <p className="text-xs text-muted-foreground">
                      Loading current exchange rate...
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="memo">Memo (optional)</Label>
            <Input
              id="memo"
              name="memo"
              placeholder={isShareMode ? 'e.g. Buy after earnings' : 'e.g. Monthly payment'}
            />
          </div>

          {!hasCompatibleAccounts && (
            <p className="text-sm text-muted-foreground">
              {isShareMode
                ? 'No linked brokerage cash account is available.'
                : 'No compatible accounts available.'}
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || !hasCompatibleAccounts}>
              {submitting ? 'Saving...' : copy.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
