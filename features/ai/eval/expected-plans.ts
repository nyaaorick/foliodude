import type { HarnessCase } from '@/features/ai/eval/cases';
import type { MlpAction } from '@/features/ai/protocol/mlp';
import { AccountType } from '@/lib/types/accounts';

export type ExpectedAction = Record<string, string | number>;
const opening = (name: string, balance = 0, type = 'ASSET', currency = 'USD', credit_limit = 0): ExpectedAction => ({ action: 'create_account', name, balance, type, currency, credit_limit });
const expense = (account: string, amount: number): ExpectedAction => ({ action: 'expense', account, amount });
const transfer = (from: string, to: string, amount: number | 'all', targetAmount?: number): ExpectedAction => ({ action: 'transfer', from, to, amount, ...(targetAmount === undefined ? {} : { targetAmount }) });
export const expectedActions = { opening, expense, transfer };
export function expectedPlan(fixture: HarnessCase): ExpectedAction[] {
  if (fixture.plan) return fixture.plan;
  const { id, seed, expected } = fixture;
  if (id.startsWith('natural-open-')) { const a = expected.accounts[0]; return [opening(a.name, a.balance)]; }
  if (id.startsWith('natural-all-')) return [transfer(seed[0].name!, seed[1].name!, 'all')];
  const fixed: Record<string, ExpectedAction[]> = {
    'natural-user-single': [opening('chase')], 'natural-user-typo': [opening('chase', 300)],
    'natural-user-all': [transfer('验证钱包', 'chase checking', 'all')],
    'natural-debt-en': [opening('Amex Blue', -73, 'LIABILITY')], 'natural-debt-zh': [opening('旅行卡', -46, 'LIABILITY')],
    'natural-spend-en': [expense('Test Wallet', 17)], 'natural-spend-zh': [expense('零钱包', 23)],
    'natural-sequence': [opening('Trip Cash', 70), expense('Trip Cash', 12), transfer('Trip Cash', 'chase checking', 'all')],
    'natural-zero': [transfer('零钱包', 'chase checking', 'all')],
    'default-opening': [opening('amex')], 'category-debt': [opening('信用卡', -20, 'LIABILITY')], 'opening-synonym': [opening('Visa')],
    'opening-duplicate': [opening('amex')], 'chinese-account': [opening('实机钱包', 100)],
    'asset-expense': [{ ...expense('实机钱包', 12), memo: '实机午饭' }],
    'liability-account': [opening('实机信用卡', -20, 'LIABILITY', 'USD', 1000)],
    'card-expense': [expense('实机信用卡', 5)], 'repayment': [transfer('实机钱包', '实机信用卡', 10)],
    'create-and-spend': [opening('实机备用金', 50), expense('实机备用金', 8)],
    'missing-account': [expense('不存在的钱包', 12)], 'ambiguous-account': [expense('实机钱包', 12)],
    'atomic-rollback': [opening('实机备用金', 50), expense('实机备用金', 60)],
    'cancel': [opening('实机取消测试', 100)], 'after-cancel': [opening('实机恢复测试', 30)],
  };
  if (fixed[id]) return fixed[id];
  if (expected.outcome === 'no_action' || expected.outcome === 'clarification') return [];
  throw Error(`Missing expected plan: ${id}`);
}
/** Exact sequence and operational parameters. Unrequested optional prose/category/date are not scored. */
export function planMatches(actions: MlpAction[], expected: ExpectedAction[]): boolean {
  return actions.length === expected.length && expected.every((step, index) => Object.entries(step).every(([key, value]) => {
    const actual = actions[index];
    if (key === 'balance' && actual.action === 'create_account') return (actual.type === AccountType.LIABILITY ? -Math.abs(actual.balance) : actual.balance) === value;
    return (actual as unknown as Record<string, unknown>)[key] === value;
  }));
}
