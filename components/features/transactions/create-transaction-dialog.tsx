'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTransaction } from '@/lib/actions/createTransaction';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
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

interface CreateTransactionDialogProps {
  accountId: string;
  accountCurrency: string;
}

export function CreateTransactionDialog({
  accountId,
  accountCurrency,
}: CreateTransactionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('Dining');
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

    const amount = Number.parseFloat(amountStr || '0');
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than 0');
      setSubmitting(false);
      return;
    }

    try {
      await createTransaction({
        accountId,
        category,
        amount,
        memo: memo || undefined,
        date: new Date(date).toISOString(),
      });

      setOpen(false);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create transaction');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            Add Transaction
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Expense</DialogTitle>
          <DialogDescription>
            Record a credit card expense. Reward points will be calculated
            automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={(val) => val && setCategory(val)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount ({accountCurrency})</Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="amount"
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
            <Label htmlFor="memo">Memo (optional)</Label>
            <Input id="memo" name="memo" placeholder="e.g. Sushi Omakase" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
