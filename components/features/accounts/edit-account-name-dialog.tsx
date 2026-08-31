'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { revalidate } from '@/lib/data/store';
import { updateAccount } from '@/lib/actions/update-accounts-actions';
import { AccountType } from '@/lib/types/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(accountName);
  const [balance, setBalance] = useState(String(accountBalance));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const isMileageAccount = accountType === AccountType.AIRLINE_MILES;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setName(accountName);
          setBalance(String(accountBalance));
          setError('');
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Pencil className="size-4" />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
          <DialogDescription>
            Update the display name and current balance for this account.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError('');

            try {
              const parsedBalance = Number(balance);

              if (!Number.isFinite(parsedBalance)) {
                throw new Error('Enter a valid balance');
              }

              await updateAccount({
                id: accountId,
                name,
                balance: parsedBalance,
              });

              setOpen(false);
              revalidate();
            } catch (caughtError) {
              if (!(caughtError instanceof Error)) {
                throw caughtError;
              }

              setError(caughtError.message);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="edit-account-name">Name</Label>
            <Input
              id="edit-account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-account-balance">
              Balance {isMileageAccount ? '(miles)' : `(${currency})`}
            </Label>
            <Input
              id="edit-account-balance"
              type="number"
              inputMode="decimal"
              step={isMileageAccount ? '1' : '0.01'}
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
