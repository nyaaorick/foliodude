import type { CreateAccountInput, CurrencyId } from '@/lib/types/accounts';
import { AccountType } from '@/lib/types/accounts';
import { expectedActions, type ExpectedAction } from '@/features/ai/eval/expected-plans';

export interface HarnessCase {
  id: string; text: string; seed: CreateAccountInput[]; plan?: ExpectedAction[];
  expected: { accounts: Array<{ name: string; type: string; currency: string; balance: number; credit_limit?: number }>; transactions: number; amounts?: number[]; error?: string; outcome: 'success' | 'reject' | 'no_action' | 'clarification' | 'cancel' };
}

// Evaluation-only: never included in the model prompt. Weighted to everyday use: transfers, account creation,
// spending, recognizing existing accounts by part of their name, and multi-step plans; a small edge group follows.
type Seed = CreateAccountInput & { name: string; currency: CurrencyId };
const asset = (name: string, balance: number, currency: CurrencyId = 'USD'): Seed => ({ name, type: AccountType.ASSET, currency, balance });
const card = (name: string, balance: number, credit_limit: number, currency: CurrencyId = 'USD'): Seed => ({ name, type: AccountType.LIABILITY, currency, balance, credit_limit });
const { opening, expense, transfer } = expectedActions;
const cents = (value: number) => Math.round(value * 100) / 100;

/** Expected end state, derived from the seed and the plan so balances are never hand-computed. */
function settle(seed: Seed[], plan: ExpectedAction[]): HarnessCase['expected'] {
  const accounts = seed.map(account => ({ ...account }));
  const find = (name: unknown) => accounts.find(account => account.name === name)!;
  const amounts: number[] = [];
  for (const step of plan) {
    if (step.action === 'create_account') {
      const liability = step.type === AccountType.LIABILITY;
      accounts.push({ name: String(step.name), type: step.type as AccountType, currency: step.currency as CurrencyId,
        balance: liability ? -Math.abs(Number(step.balance)) : Number(step.balance), ...(liability ? { credit_limit: Number(step.credit_limit) } : {}) });
    } else if (step.action === 'expense') {
      const account = find(step.account); account.balance = cents(account.balance - Number(step.amount)); amounts.push(Number(step.amount));
    } else {
      const from = find(step.from), to = find(step.to);
      const amount = step.amount === 'all' ? from.balance : Number(step.amount);
      from.balance = cents(from.balance - amount); to.balance = cents(to.balance + Number(step.targetAmount ?? amount)); amounts.push(amount);
    }
  }
  return { accounts: accounts.map(({ name, type, currency, balance, credit_limit }) => ({ name, type, currency, balance, ...(credit_limit === undefined ? {} : { credit_limit }) })),
    transactions: amounts.length, amounts, outcome: 'success' };
}
const ok = (id: string, text: string, seed: Seed[], plan: ExpectedAction[]): HarnessCase => ({ id, text, seed, plan, expected: settle(seed, plan) });
const unchanged = (seed: Seed[]) => settle(seed, []).accounts;
const none = (id: string, text: string, seed: Seed[]): HarnessCase => ({ id, text, seed, plan: [], expected: { accounts: unchanged(seed), transactions: 0, outcome: 'no_action' } });
const ask = (id: string, text: string, seed: Seed[]): HarnessCase => ({ id, text, seed, plan: [], expected: { accounts: unchanged(seed), transactions: 0, outcome: 'clarification' } });
const reject = (id: string, text: string, seed: Seed[], plan: ExpectedAction[], error: string): HarnessCase => ({ id, text, seed, plan, expected: { accounts: unchanged(seed), transactions: 0, outcome: 'reject', error } });

const chase = asset('chase checking', 1200), wallet = asset('Cash Wallet', 300), amex = card('Amex Gold', -250, 5000);
const bank = asset('招商银行', 8000, 'CNH'), cash = asset('现金钱包', 600, 'CNH'), alipay = asset('支付宝', 900, 'CNH'), cnCard = card('招行信用卡', -1500, 50000, 'CNH');

export const HARNESS_CASES: HarnessCase[] = [
  // Transfers: stated amounts, everything, card repayment, currency conversion, pronouns.
  ok('transfer-amount-en-1', 'Move $200 from chase checking to Wise Savings.', [chase, asset('Wise Savings', 50)], [transfer('chase checking', 'Wise Savings', 200)]),
  ok('transfer-amount-en-2', 'Transfer 45.50 from Cash Wallet to chase checking', [chase, wallet], [transfer('Cash Wallet', 'chase checking', 45.5)]),
  ok('transfer-amount-en-3', 'Send 1,000 from chase checking into Fidelity.', [chase, asset('Fidelity', 0)], [transfer('chase checking', 'Fidelity', 1000)]),
  ok('transfer-amount-zh-1', '从现金钱包转300到招商银行', [bank, cash], [transfer('现金钱包', '招商银行', 300)]),
  ok('transfer-amount-zh-2', '招商银行转给支付宝88.8', [bank, alipay], [transfer('招商银行', '支付宝', 88.8)]),
  ok('transfer-amount-zh-3', '往支付宝里存500，钱从招商银行出', [bank, alipay], [transfer('招商银行', '支付宝', 500)]),
  ok('transfer-pronoun-en', 'Take 60 out of Rainy Day Fund and put it into chase checking.', [chase, asset('Rainy Day Fund', 400)], [transfer('Rainy Day Fund', 'chase checking', 60)]),
  ok('transfer-repay-en', 'Pay $250 toward Amex Gold from chase checking.', [chase, amex], [transfer('chase checking', 'Amex Gold', 250)]),
  ok('transfer-repay-zh', '用招商银行还招行信用卡1500', [bank, cnCard], [transfer('招商银行', '招行信用卡', 1500)]),
  ok('transfer-all-en-1', 'Empty Cash Wallet into chase checking.', [chase, wallet], [transfer('Cash Wallet', 'chase checking', 'all')]),
  ok('transfer-all-en-2', 'Move everything left in Travel Fund back to chase checking.', [chase, asset('Travel Fund', 137.25)], [transfer('Travel Fund', 'chase checking', 'all')]),
  ok('transfer-all-zh-1', '把现金钱包的钱全部转到招商银行', [bank, cash], [transfer('现金钱包', '招商银行', 'all')]),
  ok('transfer-all-zh-2', '支付宝里剩下的都转回招商银行', [bank, alipay], [transfer('支付宝', '招商银行', 'all')]),
  ok('transfer-cross-en', 'Convert 100 from chase checking to Wise EUR; I received 92 euros.', [chase, asset('Wise EUR', 40, 'EUR')], [transfer('chase checking', 'Wise EUR', 100, 92)]),
  ok('transfer-cross-zh', '从招商银行换500到港币账户，到账540港币', [bank, asset('港币账户', 0, 'HKD')], [transfer('招商银行', '港币账户', 500, 540)]),
  // Account creation: assets, cards and card brands, opening debt, currencies, several at once.
  ok('create-asset-en-1', 'Create an account called Rainy Day Fund with $500.', [], [opening('Rainy Day Fund', 500)]),
  ok('create-asset-en-2', 'Add a checking account named BoA Checking.', [], [opening('BoA Checking')]),
  ok('create-asset-en-3', 'New savings account Ally Savings, balance 2,300.', [], [opening('Ally Savings', 2300)]),
  ok('create-asset-zh-1', '新建一个现金账户叫零花钱，余额200人民币', [], [opening('零花钱', 200, 'ASSET', 'CNH')]),
  ok('create-asset-zh-2', '开一个叫微信零钱的账户', [], [opening('微信零钱')]),
  ok('create-asset-zh-3', '帮我记一个余额宝，余额3000美元', [], [opening('余额宝', 3000)]),
  ok('create-card-en-1', 'Add my Chase Sapphire credit card, limit 10,000.', [], [opening('Chase Sapphire', 0, 'LIABILITY', 'USD', 10000)]),
  ok('create-card-en-2', 'I have an Amex Platinum card and owe 430 on it.', [], [opening('Amex Platinum', -430, 'LIABILITY')]),
  ok('create-card-zh-1', '新增一张招行信用卡，额度50000人民币', [], [opening('招行信用卡', 0, 'LIABILITY', 'CNH', 50000)]),
  ok('create-card-zh-2', '添加花呗，目前欠款800人民币', [], [opening('花呗', -800, 'LIABILITY', 'CNH')]),
  ok('create-brand-en', 'Open a Visa account.', [], [opening('Visa', 0, 'LIABILITY')]),
  ok('create-currency-en', 'Create a euro account Wise EUR with 400 euros.', [], [opening('Wise EUR', 400, 'ASSET', 'EUR')]),
  ok('create-currency-zh', '开一个港币账户叫香港汇丰，余额1000港币', [], [opening('香港汇丰', 1000, 'ASSET', 'HKD')]),
  ok('create-several-en', 'Add Lunch Money with 20 and Bus Pass with 30.', [], [opening('Lunch Money', 20), opening('Bus Pass', 30)]),
  // Spending from assets and cards, with stated notes.
  ok('spend-asset-en-1', 'Spent $14 on lunch from Cash Wallet.', [wallet], [expense('Cash Wallet', 14)]),
  ok('spend-asset-en-2', 'Paid 60 for groceries with chase checking.', [chase], [expense('chase checking', 60)]),
  ok('spend-card-en', 'Coffee was $5.25 on Amex Gold.', [amex], [expense('Amex Gold', 5.25)]),
  ok('spend-asset-zh-1', '用微信零钱买了杯奶茶18', [asset('微信零钱', 120, 'CNH')], [expense('微信零钱', 18)]),
  ok('spend-asset-zh-2', '现金钱包付了打车费35', [cash], [expense('现金钱包', 35)]),
  ok('spend-card-zh', '招行信用卡刷了一顿火锅268', [cnCard], [expense('招行信用卡', 268)]),
  ok('spend-memo-en', 'Log $40 from Cash Wallet, note: birthday gift.', [wallet], [{ ...expense('Cash Wallet', 40), memo: 'birthday gift' }]),
  ok('spend-memo-zh', '从招商银行支出120，备注水电费', [bank], [{ ...expense('招商银行', 120), memo: '水电费' }]),
  // Existing accounts named by part of their name are used, never re-created.
  ok('match-part-zh', '把我chase里记录一笔debit消费30', [chase], [expense('chase checking', 30)]),
  ok('match-part-en', 'Record a $12 debit purchase in my chase.', [chase, wallet], [expense('chase checking', 12)]),
  ok('match-part-transfer-en', 'move 50 from chase to cash wallet', [chase, wallet], [transfer('chase checking', 'Cash Wallet', 50)]),
  ok('match-part-transfer-zh', '从招商转200到现金', [bank, cash], [transfer('招商银行', '现金钱包', 200)]),
  ok('match-part-card-zh', '用招商银行还信用卡账单1500', [bank, cnCard], [transfer('招商银行', '招行信用卡', 1500)]),
  ok('match-case-en', 'Spent 9 from CASH WALLET', [wallet], [expense('Cash Wallet', 9)]),
  reject('match-ambiguous-en', 'move 100 from chase to Cash Wallet', [chase, asset('Chase Savings', 500), wallet], [transfer('chase', 'Cash Wallet', 100)], 'Several accounts match'),
  // Multi-step plans that depend on earlier steps.
  ok('multi-create-spend-en', 'Open Trip Fund with $300 and spend 45 from it on a train ticket.', [], [opening('Trip Fund', 300), expense('Trip Fund', 45)]),
  ok('multi-create-transfer-zh', '新建人民币账户旅行基金，然后从招商银行转1000进去', [bank], [opening('旅行基金', 0, 'ASSET', 'CNH'), transfer('招商银行', '旅行基金', 1000)]),
  ok('multi-spend-all-en', 'Paid 12 for lunch from Cash Wallet, then move the rest to chase checking.', [chase, wallet], [expense('Cash Wallet', 12), transfer('Cash Wallet', 'chase checking', 'all')]),
  ok('multi-two-transfers-zh', '从招商银行转500到支付宝，再从招商银行转200到现金钱包', [bank, alipay, cash], [transfer('招商银行', '支付宝', 500), transfer('招商银行', '现金钱包', 200)]),
  ok('multi-repay-spend-en', 'Pay 100 to Amex Gold from chase checking, then log a $30 dinner on Amex Gold.', [chase, amex], [transfer('chase checking', 'Amex Gold', 100), expense('Amex Gold', 30)]),
  ok('multi-three-en', 'Create Gym Fund with 100, spend 40 from it, and move the rest to chase checking.', [chase], [opening('Gym Fund', 100), expense('Gym Fund', 40), transfer('Gym Fund', 'chase checking', 'all')]),
  // Edge group: nothing to do, missing information, host rejection, cancellation.
  none('edge-question-en', 'How much is in chase checking?', [chase]),
  none('edge-negation-zh', '别把现金钱包的钱转走', [bank, cash]),
  ask('edge-ask-amount-en', 'Transfer from chase checking to Cash Wallet.', [chase, wallet]),
  { id: 'edge-cancel', text: 'Create Cancel Probe with 100.', seed: [wallet], plan: [opening('Cancel Probe', 100)], expected: { accounts: unchanged([wallet]), transactions: 0, outcome: 'cancel' } },
  ask('edge-ask-target-zh', '从招商银行转500', [bank, cash]),
  reject('edge-missing-account-en', 'Spent 20 from Blue Jar.', [wallet], [expense('Blue Jar', 20)], 'Account not found'),
  reject('edge-rollback-en', 'Open Snack Fund with 10 and spend 25 from it.', [], [opening('Snack Fund', 10), expense('Snack Fund', 25)], 'Insufficient balance'),
];
