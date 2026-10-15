import type { RefObject } from 'react';
import { ReadOnlyValue } from '@/components/app/form-fields';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CurrencyId } from '@/lib/types/accounts';
import type { IntentReceipt } from '../application/intent-draft-actions';
import type { MlpAction } from '../protocol/mlp';

const money = (amount: number, currency: CurrencyId) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
const LABELS = { create_account: 'Create account', expense: 'Record expense', transfer: 'Transfer money' } as const;

/** The saved action chain, built only from the receipt's preview and the reviewed plan it executed. */
export function IntentReceiptDialog({ receipt, actions, open, onOpenChange, returnFocus }: {
  receipt: IntentReceipt; actions: MlpAction[]; open: boolean; onOpenChange: (open: boolean) => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const steps = receipt.preview;
  // A step depends on the latest earlier step that touched one of its accounts; created accounts keep their alias id.
  const dependencies = steps.map((step, index) => step.changes.flatMap(change => {
    const source = steps.slice(0, index).findLastIndex(earlier => earlier.changes.some(item => item.id === change.id));
    return source < 0 ? [] : [{ step: source, name: change.name }];
  }));
  const phrase = (index: number) => {
    const step = steps[index], action = actions[index];
    if (step.action !== 'transfer') return step.action === 'create_account' ? step.title : `spend ${money(step.amount, step.currency)} from ${step.changes[0].name}`;
    const [from, to] = step.changes;
    return action.action === 'transfer' && action.amount === 'all' ? `move ${from.name}'s remainder to ${to.name}` : `move ${money(step.amount, step.currency)} from ${from.name} to ${to.name}`;
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="md:max-w-md" finalFocus={returnFocus} showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Saved {steps.length} {steps.length === 1 ? 'change' : 'changes'}</DialogTitle>
        <DialogDescription>All changes were saved together, in this order.</DialogDescription>
      </DialogHeader>
      {steps.length > 1 && <p className="rounded-lg bg-muted/40 p-3 text-sm" data-receipt-chain>{steps.map((_, index) => phrase(index)).join(' → ')}</p>}
      <ol className="space-y-3" aria-label="Saved steps">
        {steps.map((step, index) => <li key={index} className="space-y-3 rounded-xl border border-border/70 p-3" data-receipt-step>
          <div>
            <p className="font-medium"><span className="text-muted-foreground">{index + 1}. {LABELS[step.action]} · </span><span data-step-title>{step.title}</span></p>
            {dependencies[index].map(link => <p key={link.name} className="mt-1 text-xs text-muted-foreground">Uses {link.name} from step {link.step + 1}</p>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyValue label={step.action !== 'create_account' ? 'Amount' : step.amount < 0 ? 'Amount owed' : 'Opening balance'}>{money(Math.abs(step.amount), step.currency)}</ReadOnlyValue>
            <ReadOnlyValue label="Balance before → after">{step.changes.map(change => <p key={change.id}>{change.name}: {step.action === 'create_account' ? 'new' : money(change.before, change.currency)} → {money(change.after, change.currency)}</p>)}</ReadOnlyValue>
          </div>
        </li>)}
      </ol>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
