'use client';

import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import { Field, MemoField, OptionSelect, ReadOnlyValue } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTransfer } from '@/lib/actions/createTransfer';
import { unwrap } from '@/lib/actions/result';
import { buyShare, sellShare } from '@/lib/actions/share-actions';
import { AccountType, type AccountOption } from '@/lib/types/accounts';

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

function toOptions(accounts: AccountOption[]) {
  return accounts.map((account) => ({ value: account.id, label: formatAccountOption(account) }));
}

export function CreateTransferDialog({
  mode,
  accounts,
  fromAccountId,
  toAccountId,
  shareAccountId,
  triggerLabel,
}: CreateTransferDialogProps) {
  const byId = (id?: string) => (id ? (accounts.find((account) => account.id === id) ?? null) : null);

  const fixedFromAccount = byId(fromAccountId);
  const fixedToAccount = byId(toAccountId);
  const shareAccount = byId(shareAccountId);
  const linkedBrokerageAccount = byId(shareAccount?.brokerage_account_id ?? undefined);

  const sourceOptions = fixedToAccount
    ? accounts.filter((account) => account.type === AccountType.ASSET)
    : [];
  const targetOptions = fixedFromAccount
    ? accounts.filter(
        (account) =>
          account.id !== fixedFromAccount.id &&
          (account.type === AccountType.ASSET || account.type === AccountType.LIABILITY),
      )
    : [];

  const [selectedFromAccountId, setSelectedFromAccountId] = useState(
    fromAccountId ?? sourceOptions[0]?.id ?? '',
  );
  const [selectedToAccountId, setSelectedToAccountId] = useState(
    toAccountId ?? targetOptions[0]?.id ?? '',
  );

  const selectedFromAccount =
    fixedFromAccount ?? sourceOptions.find((account) => account.id === selectedFromAccountId) ?? null;
  const selectedToAccount =
    fixedToAccount ?? targetOptions.find((account) => account.id === selectedToAccountId) ?? null;

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

  const submitShareTrade = async (form: FormData) => {
    if (!shareAccount || !linkedBrokerageAccount) {
      throw new Error('Linked brokerage cash account is missing');
    }

    const quantity = formNumber(form, 'quantity');
    const price = formNumber(form, 'sharePrice');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than 0');
    if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be greater than 0');

    const trade = mode === 'buy-share' ? buyShare : sellShare;
    unwrap(
      await trade({
        shareAccountId: shareAccount.id,
        brokerageAccountId: linkedBrokerageAccount.id,
        quantity,
        price,
        memo: formText(form, 'memo'),
      }),
    );
  };

  const submitTransfer = async (form: FormData) => {
    if (!selectedFromAccount || !selectedToAccount) throw new Error('Select both accounts');

    const amount = formNumber(form, 'amount');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0');

    const targetAmount = isCrossCurrency ? formNumber(form, 'targetAmount') : undefined;
    if (isCrossCurrency && !(targetAmount! > 0)) {
      throw new Error('Target amount must be greater than 0');
    }

    await createTransfer({
      fromAccountId: selectedFromAccount.id,
      toAccountId: selectedToAccount.id,
      amount,
      targetAmount,
      memo: formText(form, 'memo'),
    });
  };

  return (
    <FormDialog
      trigger={
        <Button size="sm" variant={mode === 'repay' || mode === 'sell-share' ? 'outline' : 'default'}>
          <ArrowRightLeft className="size-4" />
          {triggerLabel}
        </Button>
      }
      title={copy.title}
      description={copy.description}
      submitLabel={copy.submitLabel}
      submitDisabled={!hasCompatibleAccounts}
      onSubmit={isShareMode ? submitShareTrade : submitTransfer}
    >
      {isShareMode ? (
        <>
          <ReadOnlyValue label={mode === 'buy-share' ? 'From Cash Account' : 'To Cash Account'}>
            {linkedBrokerageAccount
              ? formatAccountOption(linkedBrokerageAccount)
              : 'Missing linked brokerage account'}
          </ReadOnlyValue>

          <ReadOnlyValue label={mode === 'buy-share' ? 'To Share Account' : 'From Share Account'}>
            {shareAccount ? formatAccountOption(shareAccount) : 'Missing share account'}
          </ReadOnlyValue>

          <Field label="Quantity" htmlFor="quantity">
            <Input
              id="quantity"
              name="quantity"
              type="number"
              min="0.000001"
              step="0.000001"
              required
              placeholder="0"
            />
          </Field>

          <Field label="Price" htmlFor="sharePrice">
            <Input
              id="sharePrice"
              name="sharePrice"
              type="number"
              min="0.0001"
              step="0.0001"
              required
              placeholder="0.0000"
            />
          </Field>
        </>
      ) : (
        <>
          {fixedFromAccount ? (
            <ReadOnlyValue label="From">{formatAccountOption(fixedFromAccount)}</ReadOnlyValue>
          ) : (
            <Field label="From">
              <OptionSelect
                value={selectedFromAccountId}
                onChange={setSelectedFromAccountId}
                options={toOptions(sourceOptions)}
                placeholder="Select source account"
              />
            </Field>
          )}

          {fixedToAccount ? (
            <ReadOnlyValue label="To">{formatAccountOption(fixedToAccount)}</ReadOnlyValue>
          ) : (
            <Field label="To">
              <OptionSelect
                value={selectedToAccountId}
                onChange={setSelectedToAccountId}
                options={toOptions(targetOptions)}
                placeholder="Select destination account"
              />
            </Field>
          )}

          <Field label="Amount" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="0.00"
            />
          </Field>

          {isCrossCurrency && (
            <Field label={`${selectedToAccount?.currency} Amount`} htmlFor="targetAmount">
              <Input
                id="targetAmount"
                name="targetAmount"
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="0.00"
              />
            </Field>
          )}
        </>
      )}

      <MemoField placeholder={isShareMode ? 'e.g. Buy after earnings' : 'e.g. Monthly payment'} />

      {!hasCompatibleAccounts && (
        <p className="text-sm text-muted-foreground">
          {isShareMode
            ? 'No linked brokerage cash account is available.'
            : 'No compatible accounts available.'}
        </p>
      )}
    </FormDialog>
  );
}
