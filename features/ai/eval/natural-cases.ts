import type { HarnessCase } from '@/features/ai/eval/cases';
import { AccountType } from '@/lib/types/accounts';

// Evaluation-only templates: never included in the model prompt. Reproducible random
// names, amounts and phrasing; every case gets an independent synthetic ledger.
const requestedSeed = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('seed');
export const NATURAL_SEED = requestedSeed === null ? 20261011 : Number(requestedSeed);
if (!Number.isSafeInteger(NATURAL_SEED) || NATURAL_SEED < 0 || NATURAL_SEED > 0xffffffff) throw Error('Invalid natural-language evaluation seed.');
export function naturalCases(): HarnessCase[] {
  let state = NATURAL_SEED;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const money = () => Math.floor(random() * 450 + 50);
  const asset = (name: string, balance: number) => ({ name, balance, type: AccountType.ASSET, currency: 'USD' as const });
  const cases: HarnessCase[] = [];
  const openings = {
    en: [
      (name: string, amount: number) => `set a new ${name} account, with ${amount} assest`,
      (name: string, amount: number) => `I'd like an account named ${name}. Starting cash: $${amount}.`,
      (name: string, amount: number) => `Please put ${name} on my account list with ${amount} USD to start.`,
    ],
    zh: [
      (name: string, amount: number) => `帮我弄个${name}账户，里面先放${amount}美金。`,
      (name: string, amount: number) => `账户列表添上“${name}”吧，资产余额${amount}美元。`,
      (name: string, amount: number) => `我想有个叫${name}的钱包，初始资金是${amount}刀。`,
    ],
  };
  const moves = {
    en: [
      (from: string, to: string) => `Empty ${from} into ${to}.`,
      (from: string, to: string) => `Move whatever money is in ${from} over to ${to}.`,
      (from: string, to: string) => `I'd like every dollar from ${from} moved to ${to}.`,
    ],
    zh: [
      (from: string, to: string) => `把${from}的钱全转进${to}。`,
      (from: string, to: string) => `${from}清空，钱挪到${to}。`,
      (from: string, to: string) => `${from}剩多少就搬多少去${to}吧。`,
    ],
  };
  for (const language of ['en', 'zh'] as const) {
    for (let index = 0; index < 3; index++) {
      const name = pick(language === 'en' ? ['chase', 'Daily Cash', 'Travel Fund'] : ['旅行钱包', '日常备用金', '储蓄罐']) + ` ${index + 1}`;
      const amount = money();
      cases.push({ id: `natural-open-${language}-${index + 1}`, text: pick(openings[language])(name, amount), seed: [], expected: { accounts: [asset(name, amount)], transactions: 0, outcome: 'success' } });
      const from = pick(language === 'en' ? ['Test Wallet', 'Spare Cash', 'Travel Cash'] : ['验证钱包', '零钱包', '备用金']);
      const to = pick(['chase checking', 'Chase Savings', 'Main Bank']);
      const target = money();
      cases.push({ id: `natural-all-${language}-${index + 1}`, text: pick(moves[language])(from, to), seed: [asset(from, amount), asset(to, target)], expected: { accounts: [asset(from, 0), asset(to, target + amount)], transactions: 1, amounts: [amount], outcome: 'success' } });
    }
  }
  cases.push(
    { id: 'natural-user-single', text: '创建一个账户, 叫chase', seed: [], expected: { accounts: [asset('chase', 0)], transactions: 0, outcome: 'success' } },
    { id: 'natural-user-typo', text: 'set a new chase account, with 300 assest', seed: [], expected: { accounts: [asset('chase', 300)], transactions: 0, outcome: 'success' } },
    { id: 'natural-user-all', text: '把验证钱包的钱全转进chase checking', seed: [asset('验证钱包', 137.25), asset('chase checking', 42.5)], expected: { accounts: [asset('验证钱包', 0), asset('chase checking', 179.75)], transactions: 1, amounts: [137.25], outcome: 'success' } },
    { id: 'natural-debt-en', text: 'Add a card called Amex Blue; I already owe $73 on it.', seed: [], expected: { accounts: [{ ...asset('Amex Blue', -73), type: AccountType.LIABILITY, credit_limit: 0 }], transactions: 0, outcome: 'success' } },
    { id: 'natural-debt-zh', text: '弄张叫旅行卡的信用卡，目前欠着46美金。', seed: [], expected: { accounts: [{ ...asset('旅行卡', -46), type: AccountType.LIABILITY, credit_limit: 0 }], transactions: 0, outcome: 'success' } },
    { id: 'natural-spend-en', text: 'Lunch cost me $17, paid from Test Wallet. Please log it.', seed: [asset('Test Wallet', 80)], expected: { accounts: [asset('Test Wallet', 63)], transactions: 1, amounts: [17], outcome: 'success' } },
    { id: 'natural-spend-zh', text: '午饭花了23刀，用的零钱包，帮我记一下。', seed: [asset('零钱包', 80)], expected: { accounts: [asset('零钱包', 57)], transactions: 1, amounts: [23], outcome: 'success' } },
    { id: 'natural-sequence', text: 'Set up Trip Cash with $70. Lunch was $12 from it; move the rest into chase checking.', seed: [asset('chase checking', 10)], expected: { accounts: [asset('Trip Cash', 0), asset('chase checking', 68)], transactions: 2, amounts: [12, 58], outcome: 'success' } },
    { id: 'natural-negation', text: "Don't empty Test Wallet into chase checking; leave the money where it is.", seed: [asset('Test Wallet', 80), asset('chase checking', 10)], expected: { accounts: [asset('Test Wallet', 80), asset('chase checking', 10)], transactions: 0, outcome: 'no_action' } },
    { id: 'natural-question', text: '如果把零钱包全部挪去chase checking，会怎么样？先别操作。', seed: [asset('零钱包', 80), asset('chase checking', 10)], expected: { accounts: [asset('零钱包', 80), asset('chase checking', 10)], transactions: 0, outcome: 'no_action' } },
    { id: 'natural-missing-target', text: 'Move all the money out of Test Wallet.', seed: [asset('Test Wallet', 80)], expected: { accounts: [asset('Test Wallet', 80)], transactions: 0, outcome: 'clarification' } },
    { id: 'natural-zero', text: '把零钱包的钱全转进chase checking', seed: [asset('零钱包', 0), asset('chase checking', 10)], expected: { accounts: [asset('零钱包', 0), asset('chase checking', 10)], transactions: 0, outcome: 'reject', error: 'No transferable balance' } },
    { id: 'natural-cross-currency', text: 'Move everything from Test Wallet to Euro Bank.', seed: [asset('Test Wallet', 80), { ...asset('Euro Bank', 10), currency: 'EUR' }], expected: { accounts: [asset('Test Wallet', 80), { ...asset('Euro Bank', 10), currency: 'EUR' }], transactions: 0, outcome: 'clarification' } },
  );
  return cases;
}
