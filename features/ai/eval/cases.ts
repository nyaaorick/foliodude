import { naturalCases } from '@/features/ai/eval/natural-cases';
import type { CreateAccountInput } from '@/lib/types/accounts';
import { AccountType } from '@/lib/types/accounts';
export interface HarnessCase {
  id: string; text: string; seed: CreateAccountInput[]; plan?: import('./expected-plans').ExpectedAction[];
  expected: { accounts: Array<{ name: string; type: string; currency: string; balance: number; credit_limit?: number }>; transactions: number; amounts?: number[]; error?: string; outcome: 'success' | 'reject' | 'no_action' | 'clarification' | 'cancel' };
}
const wallet = { name: '实机钱包', type: AccountType.ASSET, currency: 'USD' as const, balance: 100 };
const card = { name: '实机信用卡', type: AccountType.LIABILITY, currency: 'USD' as const, balance: -20, credit_limit: 1000 };
// A card brand or issuer named as the account (amex, Visa) opens a credit card: LIABILITY.
const amex = { name: 'amex', type: AccountType.LIABILITY, currency: 'USD' as const, balance: 0 };
export const HARNESS_CASES: HarnessCase[] = [
  ...naturalCases(),
  { id: 'default-opening', text: '我要创立一个amex账户', seed: [], expected: { accounts: [amex], transactions: 0, outcome: 'success' } },
  { id: 'category-debt', text: '我要建立一个信用卡，里面负债20刀', seed: [], expected: { accounts: [{ name: '信用卡', type: AccountType.LIABILITY, currency: 'USD', balance: -20, credit_limit: 0 }], transactions: 0, outcome: 'success' } },
  { id: 'opening-synonym', text: '我想开设一个Visa账户', seed: [], expected: { accounts: [{ ...amex, name: 'Visa' }], transactions: 0, outcome: 'success' } },
  { id: 'opening-inquiry', text: '如何建立一个信用卡账户？', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'no_action' } },
  { id: 'opening-hypothesis', text: '假设我创立一个信用卡', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'no_action' } },
  { id: 'opening-duplicate', text: '我要建立一个amex账户', seed: [amex], expected: { accounts: [amex], transactions: 0, outcome: 'reject', error: 'Account already exists' } },
  { id: 'expense-without-amount', text: '从实机钱包支付午饭', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'clarification' } },
  { id: 'transfer-without-amount', text: '从实机钱包转账到实机信用卡', seed: [wallet, card], expected: { accounts: [wallet, card], transactions: 0, outcome: 'clarification' } },
  { id: 'chinese-account', text: '创建一个名为实机钱包的美元现金账户，初始余额100美元。', seed: [], expected: { accounts: [wallet], transactions: 0, outcome: 'success' } },
  { id: 'asset-expense', text: '今天从实机钱包支付午饭12美元，备注实机午饭。', seed: [wallet], expected: { accounts: [{ ...wallet, balance: 88 }], transactions: 1, amounts: [12], outcome: 'success' } },
  { id: 'liability-account', text: '新增信用卡账户实机信用卡，币种美元，已欠款20美元，额度1000美元。', seed: [], expected: { accounts: [card], transactions: 0, outcome: 'success' } },
  { id: 'card-expense', text: '今天用实机信用卡支付咖啡5美元。', seed: [card], expected: { accounts: [{ ...card, balance: -25 }], transactions: 1, amounts: [5], outcome: 'success' } },
  { id: 'repayment', text: '从实机钱包转账10美元还款到实机信用卡。', seed: [wallet, card], expected: { accounts: [{ ...wallet, balance: 90 }, { ...card, balance: -10 }], transactions: 1, amounts: [10], outcome: 'success' } },
  { id: 'create-and-spend', text: '创建美元现金账户实机备用金，余额50美元，然后从这个新账户支付午饭8美元。', seed: [], expected: { accounts: [{ ...wallet, name: '实机备用金', balance: 42 }], transactions: 1, amounts: [8], outcome: 'success' } },
  { id: 'missing-account', text: '今天从不存在的钱包支付午饭12美元。', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'reject', error: 'Account not found' } },
  { id: 'ambiguous-account', text: '今天从实机钱包支付午饭12美元。', seed: [wallet, wallet], expected: { accounts: [wallet, wallet], transactions: 0, outcome: 'reject', error: 'Several accounts' } },
  { id: 'atomic-rollback', text: '创建现金账户实机备用金，余额50美元，然后从实机备用金支付午饭60美元。', seed: [], expected: { accounts: [], transactions: 0, outcome: 'reject', error: 'Insufficient balance' } },
  { id: 'greeting', text: '你好。', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'no_action' } },
  { id: 'negated-creation', text: '不要创建账户实机钱包，余额100美元。', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'no_action' } },
  { id: 'cancel', text: '创建现金账户实机取消测试，余额100美元。', seed: [wallet], expected: { accounts: [wallet], transactions: 0, outcome: 'cancel' } },
  { id: 'after-cancel', text: '创建现金账户实机恢复测试，余额30美元。', seed: [], expected: { accounts: [{ ...wallet, name: '实机恢复测试', balance: 30 }], transactions: 0, outcome: 'success' } },
];
