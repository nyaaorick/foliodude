import type { HarnessCase } from '@/features/ai/eval/cases';
import type { MlpAction } from '@/features/ai/protocol/mlp';
import { AccountType } from '@/lib/types/accounts';

export type ExpectedAction = Record<string, string | number>;
const opening = (name: string, balance = 0, type = 'ASSET', currency = 'USD', credit_limit = 0): ExpectedAction => ({ action: 'create_account', name, balance, type, currency, credit_limit });
const expense = (account: string, amount: number): ExpectedAction => ({ action: 'expense', account, amount });
const transfer = (from: string, to: string, amount: number | 'all'): ExpectedAction => ({ action: 'transfer', from, to, amount });
export const expectedActions = { opening, expense, transfer };
export function expectedPlan(fixture: HarnessCase): ExpectedAction[] {
  if (!fixture.plan) throw Error(`Missing expected plan: ${fixture.id}`);
  return fixture.plan;
}

/** Exact sequence and operational parameters. Unrequested optional prose/category/date are not scored. */
export function planMatches(actions: MlpAction[], expected: ExpectedAction[]): boolean {
  return actions.length === expected.length && expected.every((step, index) => Object.entries(step).every(([key, value]) => {
    const actual = actions[index];
    if (key === 'balance' && actual.action === 'create_account') return (actual.type === AccountType.LIABILITY ? -Math.abs(actual.balance) : actual.balance) === value;
    return (actual as unknown as Record<string, unknown>)[key] === value;
  }));
}

/** A successful request must produce a validated draft, not merely matching rejected fields. */
export function planOutcomeMatches(fixture: HarnessCase, status: string | undefined, actions: MlpAction[], signal: AbortSignal): boolean {
  switch (fixture.expected.outcome) {
    case 'clarification': return status === 'clarification';
    case 'amount_required': return status === 'rejected' || status === 'clarification';
    case 'cancel': return signal.aborted && signal.reason?.name === 'AbortError';
    case 'success': return status === 'ready' && planMatches(actions, expectedPlan(fixture));
    case 'reject': return planMatches(actions, expectedPlan(fixture));
  }
}
