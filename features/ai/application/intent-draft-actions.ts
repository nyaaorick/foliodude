import { z } from 'zod';
import { getSessionContext, type Queryable } from '@/lib/db/session';
import { assertWritable } from '@/lib/sync/writer';
import { localToday } from '@/lib/utils/local-date';
import { prepareMlp, executeMlp, type MlpAction } from '@/features/ai/protocol/mlp';
import { reviewActions, type IntentAccount, type IntentDraft, type IntentReview } from '@/features/ai/application/intent-draft';
import type { MlpActionResult } from '@/features/ai/protocol/action-registry';

const InputSchema = z.object({ text: z.string().trim().min(1), traceId: z.string().trim().min(1).optional() }).strict();
export type PrepareIntentInput = z.infer<typeof InputSchema>;
export type PrepareIntentResult = { status: 'ready'; draft: IntentDraft } | { status: 'clarification' | 'no_action'; reply: string };
export interface IntentReceipt { draftId: string; steps: MlpActionResult[]; preview: IntentReview['steps']; traceId: string | null }
export class IntentDraftError extends Error {
  constructor(public readonly code: 'stale_draft' | 'already_saved' | 'saving' | 'unknown_draft', message: string) { super(message); }
}
interface DraftState { accounts: IntentAccount[]; today: string; traceId: string | null; status: 'ready' | 'saving' | 'saved' | 'stale' }
// The draft object is an in-memory capability. Private baseline state cannot be replaced
// by changing a public snapshot, and discarded/unmounted drafts can be garbage-collected.
const drafts = new WeakMap<IntentDraft, DraftState>();
async function loadAccounts(db: Queryable): Promise<IntentAccount[]> {
  return (await db.query<IntentAccount>(`SELECT id,name,type,currency,balance,credit_limit,reward_currency,reward_balance
    FROM accounts_flat WHERE type IN ('ASSET','LIABILITY') ORDER BY id`)).rows;
}
function stateOf(draft: IntentDraft): DraftState {
  const state = drafts.get(draft);
  if (!state) throw new IntentDraftError('unknown_draft', 'This preview has expired. Generate a new preview.');
  return state;
}
function makeDraft(actions: MlpAction[], accounts: IntentAccount[], today: string, traceId: string | null): IntentDraft {
  const draft: IntentDraft = { id: crypto.randomUUID(), actions, accounts: structuredClone(accounts), today };
  drafts.set(draft, { accounts: structuredClone(accounts), today, traceId, status: 'ready' });
  return draft;
}
export function discardIntentDraft(draft: IntentDraft): void { drafts.delete(draft); }
export function reviewIntentDraft(draft: IntentDraft, actions: unknown = draft.actions): IntentReview {
  const state = stateOf(draft);
  return reviewActions(actions, state.accounts, state.today);
}
/** Read-only planning. No transaction or ledger writes are opened here. */
export async function prepareIntentDraft(input: PrepareIntentInput, options: { signal?: AbortSignal } = {}): Promise<PrepareIntentResult> {
  const { text, traceId } = InputSchema.parse(input);
  const { db } = await getSessionContext();
  const accounts = await loadAccounts(db);
  const today = localToday();
  const plan = await prepareMlp(text, accounts, options.signal, today);
  if (plan.clarification) return { status: 'clarification', reply: plan.clarification };
  if (!plan.steps.length) return { status: 'no_action', reply: 'No ledger changes were requested. Describe an account, expense, or transfer to preview.' };
  return { status: 'ready', draft: makeDraft(plan.actions, accounts, today, traceId ?? null) };
}
/** Refresh changed balances without rerunning the model; the refreshed draft must be reviewed again. */
export async function refreshIntentDraft(draft: IntentDraft, actions: unknown, options: { signal?: AbortSignal } = {}): Promise<IntentDraft> {
  const state = stateOf(draft);
  options.signal?.throwIfAborted();
  if (state.status === 'saved' || state.status === 'saving') throw new IntentDraftError('already_saved', 'This preview is already saved or saving.');
  const { db } = await getSessionContext();
  const accounts = await loadAccounts(db), today = localToday();
  options.signal?.throwIfAborted();
  const review = reviewActions(actions, accounts, today);
  const refreshed = makeDraft(review.plan.actions, accounts, today, state.traceId);
  discardIntentDraft(draft);
  return refreshed;
}
/** Explicit Save only: validated user edits, fresh-state check and atomic registry execution. No inference. */
export async function commitIntentDraft(draft: IntentDraft, actions: unknown = draft.actions, options: { signal?: AbortSignal } = {}): Promise<IntentReceipt> {
  const state = stateOf(draft);
  if (state.status === 'saved') throw new IntentDraftError('already_saved', 'This preview has already been saved. Generate a new preview for another entry.');
  if (state.status === 'saving') throw new IntentDraftError('saving', 'This preview is already saving.');
  if (state.status === 'stale') throw new IntentDraftError('stale_draft', 'Accounts changed. Refresh the preview and review it before saving.');
  const review = reviewActions(actions, state.accounts, state.today);
  options.signal?.throwIfAborted();
  state.status = 'saving';
  try {
    const { db } = await getSessionContext();
    const steps = await db.transaction(async tx => {
      assertWritable(); options.signal?.throwIfAborted();
      await tx.query('SELECT id FROM accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE', [review.referencedIds]);
      const current = await loadAccounts(tx);
      const stale = state.today !== localToday() || review.referencedIds.some(id => {
        const before = state.accounts.find(account => account.id === id), now = current.find(account => account.id === id);
        return !now || JSON.stringify(before) !== JSON.stringify(now);
      });
      if (stale) throw new IntentDraftError('stale_draft', 'Accounts changed. Refresh the preview and review it before saving.');
      // Revalidate edited names, types, references, permissions and schemas against live state.
      const live = reviewActions(review.plan.actions, current, state.today);
      return executeMlp(tx, live.plan, options.signal);
    });
    state.status = 'saved';
    return { draftId: draft.id, steps, preview: review.steps, traceId: state.traceId };
  } catch (cause) {
    state.status = cause instanceof IntentDraftError && cause.code === 'stale_draft' ? 'stale' : 'ready';
    throw cause;
  }
}
