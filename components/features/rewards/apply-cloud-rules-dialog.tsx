'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyCloudRewardRules } from '@/lib/actions/reward-actions';
import type { RewardRuleSet } from '@/lib/types/rewards';
import { Button } from '@/components/ui/button';
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

interface ApplyCloudRulesDialogProps {
  accountId: string;
  ruleSets: RewardRuleSet[];
}

export function ApplyCloudRulesDialog({
  accountId,
  ruleSets,
}: ApplyCloudRulesDialogProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState(ruleSets[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedRuleSet =
    ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId) ?? null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await applyCloudRewardRules({
        accountId,
        ruleSetId: selectedRuleSetId,
      });

      setOpen(false);
      navigate(0);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      setError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError('');
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" disabled={ruleSets.length === 0}>
            Cloud Rules
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply Cloud Reward Rules</DialogTitle>
          <DialogDescription>
            Load a preset cloud rule set. This replaces all existing rules on this
            account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Rule Set</Label>
            <Select
              value={selectedRuleSetId}
              onValueChange={(value) => value && setSelectedRuleSetId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a rule set" />
              </SelectTrigger>
              <SelectContent>
                {ruleSets.map((ruleSet) => (
                  <SelectItem key={ruleSet.id} value={ruleSet.id}>
                    {ruleSet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRuleSet?.description && (
            <p className="text-sm text-muted-foreground">
              {selectedRuleSet.description}
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || !selectedRuleSetId}>
              {submitting ? 'Applying...' : 'Apply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
