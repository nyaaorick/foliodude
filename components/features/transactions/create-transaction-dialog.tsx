'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import {
  DateField,
  Field,
  MemoField,
  OptionSelect,
  PrefixedInput,
} from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { createTransaction } from '@/lib/actions/createTransaction';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';

interface CreateTransactionDialogProps {
  accountId: string;
  accountCurrency: string;
}

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((category) => ({
  value: category,
  label: category,
}));

export function CreateTransactionDialog({
  accountId,
  accountCurrency,
}: CreateTransactionDialogProps) {
  const [category, setCategory] = useState<string>('Dining');

  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus className="size-4" />
          Add Transaction
        </Button>
      }
      title="New Expense"
      description="Record a credit card expense. Reward points will be calculated automatically."
      submitLabel="Save Expense"
      onSubmit={async (form) => {
        await createTransaction({
          accountId,
          category,
          amount: formNumber(form, 'amount'),
          memo: formText(form, 'memo'),
          date: String(form.get('date')),
        });
      }}
    >
      <Field label="Category">
        <OptionSelect value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
      </Field>
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
      <MemoField placeholder="e.g. Sushi Omakase" />
      <DateField />
    </FormDialog>
  );
}
