'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';
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

interface CreateAssetExpenseDialogProps {
  accountId: string;
  accountCurrency: string;
}

export function CreateAssetExpenseDialog({
  accountId,
  accountCurrency,
}: CreateAssetExpenseDialogProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError('');
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            Add Debit Card Transaction
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Debit Card Transaction</DialogTitle>
          <DialogDescription>
            Record a direct expense from this asset account.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setSubmitting(true);

            const form = new FormData(event.currentTarget);
            const amountInput = form.get('amount') as string;
            const memo = form.get('memo') as string;
            const transactionDate = form.get('date') as string;
            const amount = Number.parseFloat(amountInput || '0');

            if (!Number.isFinite(amount) || amount <= 0) {
              setSubmitting(false);
              setError('Amount must be greater than 0');
              return;
            }

            try {
              await createAssetsExpense({
                accountId,
                amount,
                memo: memo || undefined,
                date: new Date(transactionDate).toISOString(),
              });

              setOpen(false);
              navigate(0);
            } catch (submitError) {
              setError(
                submitError instanceof Error
                  ? submitError.message
                  : 'Failed to create debit card transaction',
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="asset-expense-amount">Amount ({accountCurrency})</Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="asset-expense-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                className="pl-6"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-expense-memo">Memo (optional)</Label>
            <Input id="asset-expense-memo" name="memo" placeholder="e.g. Coffee" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-expense-date">Date</Label>
            <Input
              id="asset-expense-date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
