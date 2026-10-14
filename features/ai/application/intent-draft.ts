import { z } from 'zod';
import Decimal from 'decimal.js';
import { ACTION_REGISTRY, type MlpAccount } from '@/features/ai/protocol/action-registry';
import { MlpError, normalizeMlp, type MlpAction, type MlpPlan } from '@/features/ai/protocol/mlp';
import { normalizeMoneyAmount, roundMoneyNumber } from '@/lib/utils/financial-analytics';
import type { CurrencyId } from '@/lib/types/accounts';

export interface IntentAccount extends MlpAccount {
  balance: number;
  credit_limit: number | null;
  reward_currency: string | null;
  reward_balance: number;
}
export interface IntentDraft {
  readonly id: string;
  readonly actions: MlpAction[];
  readonly accounts: IntentAccount[];
  readonly today: string;
}
export interface PreviewStep {
  action: MlpAction['action'];
  title: string;
  amount: number;
  currency: CurrencyId;
  changes: Array<{ id: string; name: string; before: number; after: number; currency: CurrencyId }>;
}
export interface IntentReview { plan: MlpPlan; steps: PreviewStep[]; referencedIds: string[] }

/** Estimate ordered balances for review only. Executors independently read live balances. */
export function reviewActions(actions: unknown, accounts: IntentAccount[], today: string): IntentReview {
  const plan = normalizeMlp(actions, accounts, today);
  if (!plan.steps.length) throw Error('Add an action before saving.');
  const balances = new Map(accounts.map(account => [account.id, { ...account }]));
  const referencedIds = new Set<string>();
  const steps = plan.steps.map((step): PreviewStep => {
    if (step.name === 'create_account') {
      const value = ACTION_REGISTRY.create_account.inputSchema.parse(step.arguments);
      const id = `@${step.resultAlias}`;
      const balance = roundMoneyNumber(value.balance);
      balances.set(id, { ...value, id, balance, reward_balance: 0 });
      return { action: step.name, title: `Create ${value.name}`, amount: balance, currency: value.currency,
        changes: [{ id, name: value.name, before: 0, after: balance, currency: value.currency }] };
    }
    const changes: PreviewStep['changes'] = [];
    const change = (id: string, delta: number) => {
      const account = balances.get(id)!;
      if (!id.startsWith('@')) referencedIds.add(id);
      const before = account.balance;
      account.balance = new Decimal(before).plus(delta).toNumber();
      changes.push({ id, name: account.name, before, after: account.balance, currency: account.currency });
    };
    if (step.name === 'expense') {
      const value = ACTION_REGISTRY.expense.inputSchema.parse(step.arguments);
      const amount = normalizeMoneyAmount(value.amount);
      const account = balances.get(value.accountId)!;
      change(value.accountId, -amount);
      return { action: step.name, title: `Spend from ${account.name}`, amount, currency: value.expectedCurrency, changes };
    }
    const value = ACTION_REGISTRY.transfer.inputSchema.parse(step.arguments);
    const from = balances.get(value.fromAccountId)!, to = balances.get(value.toAccountId)!;
    const amount = value.amount === 'all' ? from.balance : normalizeMoneyAmount(value.amount);
    if (amount <= 0) throw Error('No transferable balance in the source account.');
    const received = from.currency === to.currency ? amount : normalizeMoneyAmount(value.targetAmount!);
    change(from.id, -amount); change(to.id, received);
    return { action: step.name, title: `${from.name} → ${to.name}`, amount, currency: from.currency, changes };
  });
  return { plan, steps, referencedIds: [...referencedIds] };
}

/** Keep parsing errors out of the product flow, while retaining full diagnostics. */
export function intentError(cause: unknown): { message: string; detail: string } {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof MlpError && cause.stage === 'format') return { message: 'The AI could not produce a valid preview. Rephrase the request and generate it again.', detail };
  if (cause instanceof z.ZodError) {
    const issue = cause.issues[0];
    const field = issue?.path.filter(part => typeof part === 'string').join(' / ');
    return { message: field ? `Check ${field}: enter a valid value.` : 'The AI could not produce a valid preview. Rephrase the request and generate it again.', detail };
  }
  if (detail.startsWith('Invalid AI plan JSON')) return { message: 'The AI returned an unreadable preview. Rephrase the request and generate it again.', detail };
  if (detail.includes('Account name must remain verbatim')) return { message: 'The AI changed an account name. Use the exact account name and generate the preview again.', detail };
  if (detail.includes('extracted amount')) return { message: 'The AI returned an amount that was not in your request. Include the amount and generate the preview again.', detail };
  return { message: detail, detail };
}
