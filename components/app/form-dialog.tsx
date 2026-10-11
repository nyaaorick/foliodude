import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { revalidate } from '@/lib/data/store';

interface FormDialogProps {
  /** The button that opens the dialog. */
  trigger: React.ReactElement;
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitDisabled?: boolean;
  contentClassName?: string;
  /** Called whenever the dialog opens or closes, and after a successful submit. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Does the work. Throw an `Error` to show its message in the dialog; return
   * normally to close it and refresh every open view.
   */
  onSubmit: (form: FormData) => Promise<void>;
  children: React.ReactNode;
}

/**
 * The shared shell of every "fill in a form, press save" dialog: it owns the
 * open state, the pending state, the error line and the refresh after a
 * successful write, so a dialog only supplies its fields and its action.
 */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  pendingLabel = 'Saving...',
  submitDisabled = false,
  contentClassName,
  onOpenChange,
  onSubmit,
  children,
}: FormDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setError('');
    onOpenChange?.(next);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setSubmitting(true);

    try {
      await onSubmit(form);
      changeOpen(false);
      revalidate();
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {children}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || submitDisabled}>
              {submitting ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A text field's trimmed value, or `undefined` when it was left empty. */
export function formText(form: FormData, name: string): string | undefined {
  return String(form.get(name) ?? '').trim() || undefined;
}

/** A numeric field's value (an empty field is 0, which the actions reject). */
export function formNumber(form: FormData, name: string): number {
  return Number(form.get(name));
}
