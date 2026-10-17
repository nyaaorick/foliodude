import fx from './fixtures/exchange-rates.json';
import type { HarnessCase } from '@/features/ai/eval/cases';
import { expectedActions as p } from '@/features/ai/eval/expected-plans';
import { AccountType } from '@/lib/types/accounts';

// Frozen evaluation wording. Never import this file into the planner or use it to tune prompts.
// Groups that fully passed keep one instance per language; groups with failures keep all five (numbers matter there).
const INSTANCES: Record<string, number> = { opening: 1, debt: 1, expense: 1, hypothetical: 1 };
export function holdoutCases(): HarnessCase[] {
  const cases: HarnessCase[] = [];
  const asset = (name: string, balance: number, currency: 'USD' | 'EUR' = 'USD') => ({ name, balance, type: AccountType.ASSET, currency });
  for (const language of ['en', 'zh'] as const) for (let i = 1; i <= 5; i++) {
    const cash = language === 'en' ? `Reserve Pocket ${i}` : `备用口袋 ${i}`;
    const bank = language === 'en' ? `Harbor Deposit ${i}` : `港湾存款 ${i}`;
    const card = language === 'en' ? `Silver Card ${i}` : `银色信用卡 ${i}`;
    const fresh = language === 'en' ? `Weekend Fund ${i}` : `周末基金 ${i}`;
    const amount = 31 + i * 13, spend = 3 + i, source = 100 + i, target = 10 + i;
    const add = (group: string, text: string, seed: HarnessCase['seed'], expected: HarnessCase['expected'], plan: HarnessCase['plan']) => i <= (INSTANCES[group] ?? 5) && cases.push({ id: `holdout-${language}-${group}-${i}`, text, seed, expected, plan });
    add('opening', language === 'en' ? `For my records, start a cash account titled ${fresh}; its opening funds are ${amount} USD.` : `账本里给我添一个现金户，名称是“${fresh}”，开户资金为${amount}美元。`, [], { accounts: [asset(fresh, amount)], transactions: 0, outcome: 'success' }, [p.opening(fresh, amount)]);
    add('debt', language === 'en' ? `Please register ${card} as my credit card. The outstanding debt at opening is ${amount} dollars.` : `登记一张信用卡，名字定为“${card}”，刚开户时欠款${amount}美元。`, [], { accounts: [{ ...asset(card, -amount), type: AccountType.LIABILITY, credit_limit: 0 }], transactions: 0, outcome: 'success' }, [p.opening(card, -amount, 'LIABILITY')]);
    add('expense', language === 'en' ? `My ${spend} dollar grocery purchase came out of ${cash}. Add that purchase to the ledger.` : `买日用品的${spend}美元是从“${cash}”付的，把这笔消费登记一下。`, [asset(cash, source)], { accounts: [asset(cash, source - spend)], transactions: 1, amounts: [spend], outcome: 'success' }, [p.expense(cash, spend)]);
    add('transfer', language === 'en' ? `Shift ${spend} USD out of ${cash} and into ${bank}, please.` : `麻烦从“${cash}”划出${spend}美元，转入“${bank}”。`, [asset(cash, source), asset(bank, target)], { accounts: [asset(cash, source-spend), asset(bank, target+spend)], transactions: 1, amounts: [spend], outcome: 'success' }, [p.transfer(cash, bank, spend)]);
    add('all', language === 'en' ? `Consolidate the whole remaining balance of ${cash} in ${bank}.` : `“${cash}”的余额一分不留，全部归到“${bank}”里。`, [asset(cash, source), asset(bank, target)], { accounts: [asset(cash, 0), asset(bank, source+target)], transactions: 1, amounts: [source], outcome: 'success' }, [p.transfer(cash, bank, 'all')]);
    add('sequence', language === 'en' ? `First open ${fresh} with ${amount} USD; next record ${spend} USD spent from that new account; finally send its leftover funds to ${bank}.` : `先开户“${fresh}”，带入${amount}美元；接着记它的一笔${spend}美元支出；最后将该户剩余资金全数交给“${bank}”。`, [asset(bank, target)], { accounts: [asset(fresh, 0), asset(bank, target+amount-spend)], transactions: 2, amounts: [spend, amount-spend], outcome: 'success' }, [p.opening(fresh, amount), p.expense(fresh, spend), p.transfer(fresh, bank, 'all')]);
    add('negation', language === 'en' ? `Keep ${cash} untouched. Do not send its funds to ${bank}.` : `“${cash}”里的钱保持原样，千万不要打入“${bank}”。`, [asset(cash, source), asset(bank, target)], { accounts: [asset(cash, source), asset(bank, target)], transactions: 0, outcome: 'clarification' }, []);
    add('hypothetical', language === 'en' ? `Would putting ${spend} dollars from ${cash} into ${bank} be possible? This is just a question; make no changes.` : `假如从“${cash}”拨${spend}美元到“${bank}”，可以吗？只问问，别改账。`, [asset(cash, source), asset(bank, target)], { accounts: [asset(cash, source), asset(bank, target)], transactions: 0, outcome: 'clarification' }, []);
    add('clarification', language === 'en' ? `Send ${spend} dollars from ${cash}; I have not specified where to put them yet.` : `从“${cash}”转出${spend}美元，不过我还没指定收款户。`, [asset(cash, source)], { accounts: [asset(cash, source)], transactions: 0, outcome: 'clarification' }, []);
    add('currency', language === 'en' ? `Transfer ${spend} USD from ${cash} to ${bank}; the receiving EUR account gets exactly ${i+2} euros.` : `“${cash}”汇出${spend}美元到欧元户“${bank}”，到账额明确是${i+2}欧元。`, [asset(cash, source), asset(bank, target, 'EUR')], { accounts: [asset(cash, source-spend), asset(bank, Math.round((target + spend * fx.conversion_rates.EUR) * 100) / 100, 'EUR')], transactions: 1, amounts: [spend], outcome: 'success' }, [p.transfer(cash, bank, spend)]);
  }
  return cases;
}
