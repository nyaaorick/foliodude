'use client';

import { Plus } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import { DateField, Field, MemoField, PrefixedInput } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';

interface CreateAssetExpenseDialogProps {
  accountId: string;
  accountCurrency: string;
}

export function CreateAssetExpenseDialog({
  accountId,
  accountCurrency,
}: CreateAssetExpenseDialogProps) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus className="size-4" />
          Add Debit Card Transaction
        </Button>
      }
      title="New Debit Card Transaction"
      description="Record a direct expense from this asset account."
      submitLabel="Save Transaction"
      onSubmit={async (form) => {
        await createAssetsExpense({
          accountId,
          amount: formNumber(form, 'amount'),
          memo: formText(form, 'memo'),
          date: String(form.get('date')),
        });
      }}
    >
      <Field label={`Amount (${accountCurrency})`} htmlFor="amount">
        <PrefixedInput
          prefix="$"
          id="amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          placeholder="0.00"
        />
      </Field>
      <MemoField placeholder="e.g. Coffee" />
      <DateField />
    </FormDialog>
  );
}
