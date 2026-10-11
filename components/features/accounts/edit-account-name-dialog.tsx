'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { FormDialog } from '@/components/app/form-dialog';
import { Field } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateAccount } from '@/lib/actions/update-accounts-actions';
import { AccountType } from '@/lib/types/accounts';

interface EditAccountNameDialogProps {
  accountId: string;
  accountName: string;
  accountBalance: number;
  accountType: AccountType;
  currency: string;
}

export function EditAccountNameDialog({
  accountId,
  accountName,
  accountBalance,
  accountType,
  currency,
}: EditAccountNameDialogProps) {
  const [name, setName] = useState(accountName);
  const [balance, setBalance] = useState(String(accountBalance));
  const isMileageAccount = accountType === AccountType.AIRLINE_MILES;

  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Pencil className="size-4" />
          Edit
        </Button>
      }
      title="Edit Account"
      description="Update the display name and current balance for this account."
      submitLabel="Save"
      onOpenChange={(open) => {
        if (open) {
          setName(accountName);
          setBalance(String(accountBalance));
        }
      }}
      onSubmit={async () => {
        const parsedBalance = Number(balance);
        if (!Number.isFinite(parsedBalance)) throw new Error('Enter a valid balance');

        await updateAccount({ id: accountId, name, balance: parsedBalance });
      }}
    >
      <Field label="Name" htmlFor="edit-account-name">
        <Input
          id="edit-account-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      <Field
        label={`Balance ${isMileageAccount ? '(miles)' : `(${currency})`}`}
        htmlFor="edit-account-balance"
      >
        <Input
          id="edit-account-balance"
          type="number"
          inputMode="decimal"
          step={isMileageAccount ? '1' : '0.01'}
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          required
        />
      </Field>
    </FormDialog>
  );
}
