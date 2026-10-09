'use client';

import { useState } from 'react';
import { revalidate } from '@/lib/data/store';
import { createRewardTransaction } from '@/lib/actions/reward-actions';
import { TransactionType } from '@/lib/types/transactions';
import { getTransactionTypeLabel } from '@/lib/utils/display-labels';
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
import { localToday } from '@/lib/utils/local-date';

interface CreateRewardTransactionDialogProps {
  accountId: string;
  triggerLabel: string;
}

export function CreateRewardTransactionDialog({
  accountId,
  triggerLabel,
}: CreateRewardTransactionDialogProps) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<
    TransactionType.REWARD_TRANSFER_IN | TransactionType.REWARD_REDEEM
  >(
    TransactionType.REWARD_TRANSFER_IN,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const amountStr = form.get('amount') as string;
    const memo = form.get('memo') as string;
    const date = form.get('date') as string;
    const amount = Math.round(parseFloat(amountStr || '0'));

    if (amount <= 0) {
      setError('Points must be greater than 0');
      setSubmitting(false);
      return;
    }

    try {
      await createRewardTransaction({
        accountId,
        type: direction,
        amount,
        memo: memo || undefined,
        date: new Date(date).toISOString(),
      });

      setOpen(false);
      revalidate();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      setError(error.message);
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
          setError('');
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Points</DialogTitle>
          <DialogDescription>
            Manually add or deduct points from this card&apos;s fixed reward balance.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Direction</Label>
            <Select
              value={direction}
              onValueChange={(value) =>
                value &&
                setDirection(
                  value as
                    | TransactionType.REWARD_TRANSFER_IN
                    | TransactionType.REWARD_REDEEM,
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{getTransactionTypeLabel(direction)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TransactionType.REWARD_TRANSFER_IN}>
                  {getTransactionTypeLabel(TransactionType.REWARD_TRANSFER_IN)}
                </SelectItem>
                <SelectItem value={TransactionType.REWARD_REDEEM}>
                  {getTransactionTypeLabel(TransactionType.REWARD_REDEEM)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Points</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="1"
              step="1"
              required
              placeholder="10000"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="memo">Memo (optional)</Label>
            <Input
              id="memo"
              name="memo"
              placeholder={
                direction === TransactionType.REWARD_TRANSFER_IN
                  ? 'e.g. Welcome bonus'
                  : 'e.g. Manual correction'
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={localToday()}
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
