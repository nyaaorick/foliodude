'use client';

import { Plus } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import { DateField, Field, MemoField } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createAssetBalanceAdjustment } from '@/lib/actions/createAssetBalanceAdjustment';

interface AdjustAssetBalanceDialogProps {
  accountId: string;
  accountCurrency: string;
}

export function AdjustAssetBalanceDialog({
  accountId,
  accountCurrency,
}: AdjustAssetBalanceDialogProps) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Adjust Balance
        </Button>
      }
      title="Adjust Balance"
      description="Use a positive amount to add funds and a negative amount to deduct funds."
      submitLabel="Save"
      onSubmit={async (form) => {
        await createAssetBalanceAdjustment({
          accountId,
          amount: formNumber(form, 'amount'),
          memo: formText(form, 'memo'),
          date: String(form.get('date')),
        });
      }}
    >
      <Field label={`Amount (${accountCurrency})`} htmlFor="amount">
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          required
          placeholder="100.00 or -100.00"
        />
      </Field>
      <MemoField placeholder="e.g. Salary" />
      <DateField />
    </FormDialog>
  );
}
