'use client';

import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { Field, OptionSelect } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { applyCloudRewardRules } from '@/lib/actions/reward-actions';
import type { RewardRuleSet } from '@/lib/types/rewards';

interface ApplyCloudRulesDialogProps {
  accountId: string;
  ruleSets: RewardRuleSet[];
}

export function ApplyCloudRulesDialog({ accountId, ruleSets }: ApplyCloudRulesDialogProps) {
  const [selectedRuleSetId, setSelectedRuleSetId] = useState(ruleSets[0]?.id ?? '');
  const selectedRuleSet = ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId) ?? null;

  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline" disabled={ruleSets.length === 0}>
          Cloud Rules
        </Button>
      }
      title="Apply Cloud Reward Rules"
      description="Load a preset cloud rule set. This replaces all existing rules on this account."
      submitLabel="Apply"
      pendingLabel="Applying..."
      submitDisabled={!selectedRuleSetId}
      onSubmit={async () => {
        await applyCloudRewardRules({ accountId, ruleSetId: selectedRuleSetId });
      }}
    >
      <Field label="Rule Set">
        <OptionSelect
          value={selectedRuleSetId}
          onChange={setSelectedRuleSetId}
          options={ruleSets.map((ruleSet) => ({ value: ruleSet.id, label: ruleSet.name }))}
          placeholder="Select a rule set"
        />
      </Field>

      {selectedRuleSet?.description && (
        <p className="text-sm text-muted-foreground">{selectedRuleSet.description}</p>
      )}
    </FormDialog>
  );
}
