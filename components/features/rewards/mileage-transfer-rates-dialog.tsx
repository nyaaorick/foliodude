'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { updateMileageTransferRates } from '@/lib/actions/mileage-actions';
import { REWARD_CURRENCIES } from '@/lib/types/rewards';
import type { MileageTransferRateMap } from '@/lib/types/mileage';
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

interface MileageTransferRatesDialogProps {
  accountId: string;
  transferRates: MileageTransferRateMap;
  compact?: boolean;
  onSaved: (rates: MileageTransferRateMap) => void;
}

function buildDraftRates(transferRates: MileageTransferRateMap) {
  return Object.fromEntries(
    REWARD_CURRENCIES.map((currency) => [
      currency.id,
      String(transferRates[currency.id] ?? 0),
    ]),
  );
}

export function MileageTransferRatesDialog({
  accountId,
  transferRates,
  compact = false,
  onSaved,
}: MileageTransferRatesDialogProps) {
  const [open, setOpen] = useState(false);
  const [draftRates, setDraftRates] = useState<Record<string, string>>(
    buildDraftRates(transferRates),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraftRates(buildDraftRates(transferRates));
  }, [transferRates]);

  const resetState = () => {
    setDraftRates(buildDraftRates(transferRates));
    setSubmitting(false);
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const rates = Object.fromEntries(
      REWARD_CURRENCIES.map((currency) => {
        const value = Number.parseInt(draftRates[currency.id] || '0', 10);
        return [currency.id, value];
      }),
    );

    const invalidCurrency = REWARD_CURRENCIES.find((currency) => {
      const value = rates[currency.id];
      return !Number.isInteger(value) || value < 0;
    });

    if (invalidCurrency) {
      setError(`Transfer rate for ${invalidCurrency.id} must be a non-negative integer`);
      return;
    }

    setSubmitting(true);
    const result = await updateMileageTransferRates({
      accountId,
      rates,
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    onSaved(result.data.rates);
    setOpen(false);
    resetState();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size={compact ? 'sm' : 'sm'}>
            <Settings2 className="size-4" />
            Edit Rates
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Transfer Rates</DialogTitle>
          <DialogDescription>
            Set how many airline miles each reward point converts into.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {REWARD_CURRENCIES.map((currency) => (
            <div key={currency.id} className="space-y-2">
              <Label htmlFor={`transfer-rate-${currency.id}`}>
                1 {currency.id} = ? miles
              </Label>
              <Input
                id={`transfer-rate-${currency.id}`}
                type="number"
                min="0"
                step="1"
                value={draftRates[currency.id] ?? '0'}
                onChange={(event) =>
                  setDraftRates((prev) => ({
                    ...prev,
                    [currency.id]: event.target.value,
                  }))
                }
              />
            </div>
          ))}

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
