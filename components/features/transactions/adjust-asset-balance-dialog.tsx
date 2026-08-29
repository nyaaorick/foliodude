'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createAssetBalanceAdjustment } from '@/lib/actions/createAssetBalanceAdjustment';
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

interface AdjustAssetBalanceDialogProps {
  accountId: string;
  accountCurrency: string;
}

export function AdjustAssetBalanceDialog({
  accountId,
  accountCurrency,
}: AdjustAssetBalanceDialogProps) {
  const router = useRouter();
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
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            Adjust Balance
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Balance</DialogTitle>
          <DialogDescription>
            Use a positive amount to add funds and a negative amount to deduct funds.
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
            const amount = Number(amountInput || '0');

            if (!Number.isFinite(amount) || amount === 0) {
              setSubmitting(false);
              setError('Amount must not be 0');
              return;
            }

            try {
              await createAssetBalanceAdjustment({
                accountId,
                amount,
                memo: memo || undefined,
                date: new Date(transactionDate).toISOString(),
              });

              setOpen(false);
              router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Failed to adjust balance');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="adjust-amount">Amount ({accountCurrency})</Label>
            <Input
              id="adjust-amount"
              name="amount"
              type="number"
              step="0.01"
              required
              placeholder="100.00 or -100.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-memo">Memo (optional)</Label>
            <Input id="adjust-memo" name="memo" placeholder="e.g. Salary" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-date">Date</Label>
            <Input
              id="adjust-date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
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
