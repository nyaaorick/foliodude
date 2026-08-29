'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createMileageManualIn } from '@/lib/actions/mileage-actions';
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

interface CreateMileageManualInDialogProps {
  accountId: string;
}

export function CreateMileageManualInDialog({
  accountId,
}: CreateMileageManualInDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
            <Plus className="size-4" />
            Add Miles
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual Mileage Transfer In</DialogTitle>
          <DialogDescription>
            Add miles directly to this airline account with a source note.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setSubmitting(true);

            const form = new FormData(event.currentTarget);
            const miles = Number.parseInt((form.get('miles') as string) || '0', 10);
            const sourceDescription = form.get('sourceDescription') as string;
            const date = form.get('date') as string;

            try {
              await createMileageManualIn({
                accountId,
                miles,
                sourceDescription,
                date: new Date(date).toISOString(),
              });

              setOpen(false);
              router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Failed to add miles');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="sourceDescription">Source Description</Label>
            <Input
              id="sourceDescription"
              name="sourceDescription"
              required
              placeholder="e.g. Hotel partner transfer"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="miles">Miles</Label>
            <Input
              id="miles"
              name="miles"
              type="number"
              min="1"
              step="1"
              required
              placeholder="10000"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
