'use client';

import { Plus } from 'lucide-react';
import { FormDialog, formNumber } from '@/components/app/form-dialog';
import { DateField, Field } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createMileageManualIn } from '@/lib/actions/mileage-actions';

interface CreateMileageManualInDialogProps {
  accountId: string;
}

export function CreateMileageManualInDialog({ accountId }: CreateMileageManualInDialogProps) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add Miles
        </Button>
      }
      title="Manual Mileage Transfer In"
      description="Add miles directly to this airline account with a source note."
      submitLabel="Save"
      onSubmit={async (form) => {
        await createMileageManualIn({
          accountId,
          miles: formNumber(form, 'miles'),
          sourceDescription: String(form.get('sourceDescription')),
          date: String(form.get('date')),
        });
      }}
    >
      <Field label="Source Description" htmlFor="sourceDescription">
        <Input
          id="sourceDescription"
          name="sourceDescription"
          required
          placeholder="e.g. Hotel partner transfer"
        />
      </Field>
      <Field label="Miles" htmlFor="miles">
        <Input id="miles" name="miles" type="number" min="1" step="1" required placeholder="10000" />
      </Field>
      <DateField />
    </FormDialog>
  );
}
