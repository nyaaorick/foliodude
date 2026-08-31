'use client';

import { useRef, useState } from 'react';
import { revalidate } from '@/lib/data/store';
import { importRewardRules } from '@/lib/actions/reward-actions';
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

interface ImportRewardRulesDialogProps {
  accountId: string;
}

export function ImportRewardRulesDialog({
  accountId,
}: ImportRewardRulesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a JSON file first');
      setSubmitting(false);
      return;
    }

    try {
      const parsedJson = JSON.parse(await file.text());
      await importRewardRules({
        accountId,
        ruleSet: parsedJson,
      });

      setOpen(false);
      revalidate();
    } catch (parseError) {
      if (!(parseError instanceof Error)) {
        throw parseError;
      }

      setError(parseError.message);
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
          <Button size="sm" variant="outline">
            Import JSON
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Reward Rules</DialogTitle>
          <DialogDescription>
            Import a local JSON rule set. This replaces all existing rules on this
            account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reward-rule-file">JSON File</Label>
            <Input
              ref={fileInputRef}
              id="reward-rule-file"
              name="reward-rule-file"
              type="file"
              accept="application/json,.json"
              required
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
