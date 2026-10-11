'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { FormDialog } from '@/components/app/form-dialog';
import { Field } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateMileageTransferRates } from '@/lib/actions/mileage-actions';
import type { MileageTransferRateMap } from '@/lib/types/mileage';
import { REWARD_CURRENCIES } from '@/lib/types/rewards';
import { unwrap } from '@/lib/actions/result';

interface MileageTransferRatesDialogProps {
  accountId: string;
  transferRates: MileageTransferRateMap;
  onSaved: (rates: MileageTransferRateMap) => void;
}

function buildDraftRates(transferRates: MileageTransferRateMap) {
  return Object.fromEntries(
    REWARD_CURRENCIES.map((currency) => [currency.id, String(transferRates[currency.id] ?? 0)]),
  );
}

export function MileageTransferRatesDialog({
  accountId,
  transferRates,
  onSaved,
}: MileageTransferRatesDialogProps) {
  const [draftRates, setDraftRates] = useState<Record<string, string>>(
    buildDraftRates(transferRates),
  );

  useEffect(() => {
    setDraftRates(buildDraftRates(transferRates));
  }, [transferRates]);

  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Settings2 className="size-4" />
          Edit Rates
        </Button>
      }
      title="Edit Transfer Rates"
      description="Set how many airline miles each reward point converts into."
      submitLabel="Save"
      onOpenChange={(open) => {
        if (!open) setDraftRates(buildDraftRates(transferRates));
      }}
      onSubmit={async () => {
        const rates = Object.fromEntries(
          REWARD_CURRENCIES.map((currency) => [currency.id, Number(draftRates[currency.id] || 0)]),
        );

        const invalid = REWARD_CURRENCIES.find(
          (currency) => !Number.isInteger(rates[currency.id]) || rates[currency.id]! < 0,
        );
        if (invalid) {
          throw new Error(`Transfer rate for ${invalid.id} must be a non-negative integer`);
        }

        onSaved(unwrap(await updateMileageTransferRates({ accountId, rates })).rates);
      }}
    >
      {REWARD_CURRENCIES.map((currency) => (
        <Field
          key={currency.id}
          label={`1 ${currency.id} = ? miles`}
          htmlFor={`transfer-rate-${currency.id}`}
        >
          <Input
            id={`transfer-rate-${currency.id}`}
            type="number"
            min="0"
            step="1"
            value={draftRates[currency.id] ?? '0'}
            onChange={(event) =>
              setDraftRates((prev) => ({ ...prev, [currency.id]: event.target.value }))
            }
          />
        </Field>
      ))}
    </FormDialog>
  );
}
