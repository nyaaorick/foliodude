import { useEffect, useRef, useState } from 'react';
import { prepareIntentDraft, commitIntentDraft, refreshIntentDraft, discardIntentDraft, reviewIntentDraft, IntentDraftError, type IntentReceipt } from '@/features/ai/application/intent-draft-actions';
import { intentError, type IntentDraft, type IntentReview } from '@/features/ai/application/intent-draft';
import { normalizeName } from '@/features/ai/protocol/action-registry';
import { Field, OptionSelect, ReadOnlyValue } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';
import { revalidate } from '@/lib/data/store';

type EditableAction = Record<string, unknown>;
type Phase = 'idle' | 'planning' | 'review' | 'saving' | 'saved';
const money = (amount: number, currency: CurrencyId) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
const currencies = Object.keys(SUPPORTED_CURRENCIES).map(value => ({ value, label: value }));
const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
const inputNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : '';

export function IntentEntry({ disabled, onBusy }: { disabled: boolean; onBusy: (busy: boolean) => void }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [actions, setActions] = useState<EditableAction[]>([]);
  const [notice, setNotice] = useState<{ kind: 'clarification' | 'no_action'; reply: string } | null>(null);
  const [error, setError] = useState<ReturnType<typeof intentError> | null>(null);
  const [stale, setStale] = useState(false);
  const [receipt, setReceipt] = useState<IntentReceipt | null>(null);
  const active = useRef(false), request = useRef<AbortController | null>(null), draftRef = useRef<IntentDraft | null>(null);
  const busy = phase === 'planning' || phase === 'saving';
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => () => { request.current?.abort(); if (draftRef.current) discardIntentDraft(draftRef.current); }, []);
  let review: IntentReview | undefined, validation: string | undefined;
  if (draft) { try { review = reviewIntentDraft(draft, actions); } catch (cause) { validation = intentError(cause).message; } }

  const replaceDraft = (next: IntentDraft | null) => {
    if (draftRef.current) discardIntentDraft(draftRef.current);
    draftRef.current = next; setDraft(next);
    setActions(next ? structuredClone(next.actions) : []);
  };
  const updateText = (next: string) => {
    replaceDraft(null); setText(next); setPhase('idle'); setNotice(null); setReceipt(null); setError(null); setStale(false);
  };
  const run = async (operation: 'prepare' | 'save' | 'refresh') => {
    if (active.current || disabled) return;
    active.current = true;
    const controller = new AbortController(); request.current = controller;
    setError(null); setNotice(null); setPhase(operation === 'save' ? 'saving' : 'planning');
    try {
      if (operation === 'prepare') {
        replaceDraft(null); setReceipt(null);
        const result = await prepareIntentDraft({ text }, { signal: controller.signal });
        if (result.status === 'ready') { replaceDraft(result.draft); setPhase('review'); setStale(false); }
        else { setNotice({ kind: result.status, reply: result.reply }); setPhase('idle'); }
      } else if (operation === 'refresh') {
        const refreshed = await refreshIntentDraft(draft!, actions, { signal: controller.signal });
        replaceDraft(refreshed); setStale(false); setPhase('review');
      } else {
        const saved = await commitIntentDraft(draft!, actions, { signal: controller.signal });
        setReceipt(saved); replaceDraft(null); setPhase('saved'); revalidate();
      }
    } catch (cause) {
      setError(controller.signal.aborted ? { message: 'Cancelled. No ledger changes were saved.', detail: String(controller.signal.reason) } : intentError(cause));
      if (cause instanceof IntentDraftError && cause.code === 'stale_draft') setStale(true);
      setPhase(draftRef.current ? 'review' : 'idle');
    } finally { request.current = null; active.current = false; }
  };
  const change = (index: number, key: string, value: unknown) => {
    setError(null);
    setActions(previous => {
      const oldName = previous[index].name;
      return previous.map((step, position) => {
        if (position === index) return { ...step, [key]: value };
        if ((key !== 'name' && key !== 'currency') || position < index) return step;
        const next = { ...step };
        for (const reference of ['account', 'from', 'to']) if (next[reference] === oldName) {
          if (key === 'name') next[reference] = value;
          else next[reference === 'from' ? 'fromCurrency' : reference === 'to' ? 'toCurrency' : 'currency'] = value;
        }
        return next;
      });
    });
  };

  return <section className="space-y-5 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6" aria-labelledby="intent-heading" aria-busy={busy}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="intent-heading" className="text-lg font-medium tracking-tight">Create by intent</h2><p className="mt-1 text-sm text-muted-foreground">Describe an account, expense, or transfer. Review every change before saving.</p></div>
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Experimental</span>
    </div>
    <ol className="flex gap-4 text-xs text-muted-foreground" aria-label="Entry progress">
      {['Describe', 'Review', 'Save', 'Receipt'].map((label, index) => <li key={label} aria-current={(phase === 'saving' ? index === 2 : phase === 'saved' ? index === 3 : draft ? index === 1 : index === 0) ? 'step' : undefined} className="aria-[current=step]:font-semibold aria-[current=step]:text-foreground">{index + 1}. {label}</li>)}
    </ol>
    <Field label="What would you like to record?" htmlFor="intent-request"><Textarea id="intent-request" rows={4} value={text} onChange={event => updateText(event.target.value)} disabled={busy || disabled} placeholder="Create chase with $300, or move everything from my wallet to chase checking." aria-describedby="intent-help" /></Field>
    <p id="intent-help" className="text-xs text-muted-foreground">English and Chinese supported. An opening balance defaults to 0. Generating a preview does not save anything.</p>
    <div className="flex flex-wrap gap-2"><Button onClick={() => void run('prepare')} disabled={busy || disabled || !text.trim()}>{phase === 'planning' ? 'Generating preview…' : 'Generate preview'}</Button>{busy && <Button variant="outline" onClick={() => request.current?.abort()}>Cancel</Button>}</div>
    <div role="status" aria-live="polite" className="text-sm">{phase === 'planning' ? 'Preparing a preview. Your ledger has not changed.' : phase === 'saving' ? 'Saving all reviewed changes…' : notice && <div className="rounded-xl bg-muted/50 p-4"><p className="font-medium">{notice.kind === 'clarification' ? 'One more detail' : 'No changes to save'}</p><p className="mt-1">{notice.reply}</p>{notice.kind === 'clarification' && <p className="mt-2 text-xs text-muted-foreground">Add the missing detail to your request, then generate a new preview.</p>}</div>}</div>
    {draft && <div className="space-y-4 border-t border-border/70 pt-5">
      <div><h3 className="font-medium">Review {actions.length} {actions.length === 1 ? 'change' : 'changes'}</h3><p className="mt-1 text-sm text-muted-foreground">Check the names, amounts, and order. You can edit the fields below.</p></div>
      <fieldset disabled={busy || disabled} className="space-y-4">
        {actions.map((action, index) => {
          const id = (key: string) => `intent-${index}-${key}`;
          const numberField = (key: string, label: string, value = action[key], owed = false) => <Field label={label} htmlFor={id(key)}><Input id={id(key)} type="number" step="0.01" value={inputNumber(owed && typeof value === 'number' ? Math.abs(value) : value)} onChange={event => change(index, key, owed ? -Math.abs(numeric(event.target.value)) : numeric(event.target.value))} /></Field>;
          const choices = [...draft.accounts, ...actions.slice(0, index).filter(step => step.action === 'create_account').map((step, position) => ({ id: `new-${position}`, name: String(step.name ?? ''), currency: (step.currency ?? 'USD') as CurrencyId, type: step.type ?? 'ASSET', balance: Number(step.balance ?? 0) }))];
          const selectedAccount = (key: string) => { const currency = action[key === 'from' ? 'fromCurrency' : key === 'to' ? 'toCurrency' : 'currency']; return choices.find(account => normalizeName(account.name) === normalizeName(String(action[key] ?? '')) && (!currency || account.currency === currency)); };
          const accountField = (key: 'account' | 'from' | 'to', label: string) => <Field label={label} htmlFor={id(key)}><OptionSelect id={id(key)} value={selectedAccount(key)?.id ?? ''} options={choices.filter(account => key !== 'from' || account.type === AccountType.ASSET).map(account => ({ value: account.id, label: `${account.name} (${account.currency})` }))} placeholder="Choose an account" onChange={value => { const account = choices.find(item => item.id === value)!; change(index, key, account.name); change(index, key === 'from' ? 'fromCurrency' : key === 'to' ? 'toCurrency' : 'currency', account.currency); }} /></Field>;
          const preview = review?.steps[index];
          return <article key={index} className="space-y-4 rounded-xl border border-border/70 bg-background/50 p-4" aria-labelledby={id('heading')}>
            <h4 id={id('heading')} className="font-medium">{index + 1}. {action.action === 'create_account' ? 'Create account' : action.action === 'expense' ? 'Record expense' : 'Transfer money'}</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              {action.action === 'create_account' ? <>
                <Field label="Account name" htmlFor={id('name')}><Input id={id('name')} value={String(action.name ?? '')} onChange={event => change(index, 'name', event.target.value)} /></Field>
                <Field label="Account type" htmlFor={id('type')}><OptionSelect id={id('type')} value={String(action.type)} onChange={value => { change(index, 'type', value); if (typeof action.balance === 'number') change(index, 'balance', value === 'LIABILITY' ? -Math.abs(action.balance) : Math.abs(action.balance)); }} options={[{ value: 'ASSET', label: 'Asset / cash' }, { value: 'LIABILITY', label: 'Credit card / debt' }]} /></Field>
                <Field label="Currency" htmlFor={id('currency')}><OptionSelect id={id('currency')} value={String(action.currency)} onChange={value => change(index, 'currency', value)} options={currencies} /></Field>
                {numberField('balance', action.type === 'LIABILITY' ? 'Amount owed' : 'Starting balance', action.balance, action.type === 'LIABILITY')}
                {action.type === 'LIABILITY' && <>{numberField('credit_limit', 'Credit limit')}<Field label="Reward currency" htmlFor={id('reward_currency')}><OptionSelect id={id('reward_currency')} value={String(action.reward_currency ?? 'none')} onChange={value => change(index, 'reward_currency', value === 'none' ? null : value)} options={[{ value: 'none', label: 'None' }, ...REWARD_CURRENCY_IDS.map(value => ({ value, label: value }))]} /></Field></>}
              </> : action.action === 'expense' ? <>
                {accountField('account', 'Paying account')}{numberField('amount', 'Expense amount')}
                <Field label="Date" htmlFor={id('date')}><Input id={id('date')} type="date" value={String(action.date ?? draft.today)} onChange={event => change(index, 'date', event.target.value)} /></Field>
                {selectedAccount('account')?.type === AccountType.LIABILITY ? <Field label="Category" htmlFor={id('category')}><OptionSelect id={id('category')} value={String(action.category ?? 'Other')} onChange={value => change(index, 'category', value)} options={EXPENSE_CATEGORIES.map(value => ({ value, label: value }))} /></Field> : <ReadOnlyValue label="Category">Other</ReadOnlyValue>}
              </> : <>
                {accountField('from', 'From')}{accountField('to', 'To')}
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={action.amount === 'all'} onChange={event => change(index, 'amount', event.target.checked ? 'all' : 1)} />Entire remaining balance</label>
                {action.amount !== 'all' && numberField('amount', 'Transfer amount')}
                {selectedAccount('from')?.currency !== selectedAccount('to')?.currency && numberField('targetAmount', 'Amount received (destination currency)')}
              </>}
              {action.action !== 'create_account' && <Field label="Memo (optional)" htmlFor={id('memo')}><Input id={id('memo')} value={String(action.memo ?? '')} onChange={event => change(index, 'memo', event.target.value)} /></Field>}
            </div>
            {preview && <div className="rounded-lg bg-muted/40 p-3 text-sm" aria-live="polite">
              <p className="font-medium">{preview.title}</p>
              {action.action === 'create_account' ? <><p>{action.type === 'LIABILITY' ? 'Amount owed: ' : 'Starting balance: '}{money(action.type === 'LIABILITY' ? Math.abs(preview.amount) : preview.amount, preview.currency)}</p><p className="text-muted-foreground">No transaction will be created.</p></> : <><p>{action.amount === 'all' ? 'Estimated transfer: ' : 'Amount: '}{money(preview.amount, preview.currency)}</p>{preview.changes.map(item => <p key={item.id} className="text-muted-foreground">{item.name}: {money(item.before, item.currency)} → {money(item.after, item.currency)}</p>)}</>}
            </div>}
          </article>;
        })}
      </fieldset>
      {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
      {stale && <Button variant="outline" onClick={() => void run('refresh')} disabled={busy || disabled}>Refresh preview</Button>}
      <Button size="lg" onClick={() => void run('save')} disabled={busy || disabled || stale || !review}>Save {actions.length} {actions.length === 1 ? 'change' : 'changes'}</Button>
    </div>}
    {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 p-4 text-sm"><p className="text-destructive">{error.message}</p><details className="text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{error.detail}</pre></details></div>}
    {receipt && <div role="status" className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"><h3 className="font-medium">Saved {receipt.steps.length} {receipt.steps.length === 1 ? 'change' : 'changes'}</h3><ol className="space-y-2 text-sm">{receipt.preview.map((step, index) => <li key={index}>{index + 1}. {step.title} — {money(step.amount, step.currency)}</li>)}</ol><p className="text-xs text-muted-foreground">All changes were saved together.</p></div>}
  </section>;
}
