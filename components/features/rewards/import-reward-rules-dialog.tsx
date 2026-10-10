'use client';

import { FormDialog } from '@/components/app/form-dialog';
import { Field } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { importRewardRules } from '@/lib/actions/reward-actions';

interface ImportRewardRulesDialogProps {
  accountId: string;
}

export function ImportRewardRulesDialog({ accountId }: ImportRewardRulesDialogProps) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          Import JSON
        </Button>
      }
      title="Import Reward Rules"
      description="Import a local JSON rule set. This replaces all existing rules on this account."
      submitLabel="Import"
      pendingLabel="Importing..."
      onSubmit={async (form) => {
        const file = form.get('reward-rule-file');
        if (!(file instanceof File) || file.size === 0) throw new Error('Choose a JSON file first');

        await importRewardRules({ accountId, ruleSet: JSON.parse(await file.text()) });
      }}
    >
      <Field label="JSON File" htmlFor="reward-rule-file">
        <Input
          id="reward-rule-file"
          name="reward-rule-file"
          type="file"
          accept="application/json,.json"
          required
        />
      </Field>
    </FormDialog>
  );
}
