'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FormDialog, formNumber, formText } from '@/components/app/form-dialog';
import { DateField, Field, MemoField, OptionSelect } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createRewardTransaction } from '@/lib/actions/reward-actions';
import { TransactionType } from '@/lib/types/transactions';
import { getTransactionTypeLabel } from '@/lib/utils/display-labels';

type Direction = TransactionType.REWARD_TRANSFER_IN | TransactionType.REWARD_REDEEM;

const DIRECTION_OPTIONS = [TransactionType.REWARD_TRANSFER_IN, TransactionType.REWARD_REDEEM].map(
  (type) => ({ value: type, label: getTransactionTypeLabel(type) }),
);

interface CreateRewardTransactionDialogProps {
  accountId: string;
  triggerLabel: string;
}

export function CreateRewardTransactionDialog({
  accountId,
  triggerLabel,
}: CreateRewardTransactionDialogProps) {
  const [direction, setDirection] = useState<Direction>(TransactionType.REWARD_TRANSFER_IN);

  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      }
      title="Adjust Points"
      description="Manually add or deduct points from this card's fixed reward balance."
      submitLabel="Save"
      onSubmit={async (form) => {
        await createRewardTransaction({
          accountId,
          type: direction,
          amount: Math.round(formNumber(form, 'amount')),
          memo: formText(form, 'memo'),
          date: String(form.get('date')),
        });
      }}
    >
      <Field label="Direction">
        <OptionSelect
          value={direction}
          onChange={(value) => setDirection(value as Direction)}
          options={DIRECTION_OPTIONS}
        />
      </Field>
      <Field label="Points" htmlFor="amount">
        <Input
          id="amount"
          name="amount"
          type="number"
          min="1"
          step="1"
          required
          placeholder="10000"
        />
      </Field>
      <MemoField
        placeholder={
          direction === TransactionType.REWARD_TRANSFER_IN
            ? 'e.g. Welcome bonus'
            : 'e.g. Manual correction'
        }
      />
      <DateField />
    </FormDialog>
  );
}
