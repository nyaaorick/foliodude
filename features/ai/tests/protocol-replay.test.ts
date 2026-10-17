import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/features/ai/providers/text-client', () => ({ generateAiText: generate }));
import { prepareMlp, MLP_OUTPUT_FORMAT } from '../protocol/mlp';
import { AccountType } from '@/lib/types/accounts';
import { HARNESS_CASES } from '../eval/cases';
import { holdoutCases } from '../eval/holdout-cases';
import { expectedPlan, planOutcomeMatches } from '../eval/expected-plans';

describe('frozen protocol evidence', () => {
  it('decodes strict-mode nulls as registry defaults and keeps bounds the decoder cannot express', async () => {
    // Synthetic output in the shape json_schema:strict forces: every optional key present as null.
    const step = { action: 'create_account', name: 'Cash', type: null, currency: null, balance: null, credit_limit: null };
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'create', steps: [step] } }));
    const plan = await prepareMlp('create Cash', []);
    expect(plan.actions).toEqual([{ action: 'create_account', name: 'Cash', type: 'ASSET', currency: 'USD', balance: 0, credit_limit: 0, reward_currency: null }]);
    expect(generate.mock.calls.at(-1)?.[2]).toBe(MLP_OUTPUT_FORMAT);
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'create', steps: [{ ...step, name: null }] } }));
    await expect(prepareMlp('create Cash', [])).rejects.toMatchObject({ stage: 'format' });
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'ask', clarification: '' } }));
    await expect(prepareMlp('create Cash', [])).rejects.toMatchObject({ stage: 'format' });
    // Invalid zero amounts must never silently turn into a transfer of the whole balance.
    const accounts = [{ id: crypto.randomUUID(), name: 'Cash', type: AccountType.ASSET, currency: 'USD' as const }, { id: crypto.randomUUID(), name: 'Bank', type: AccountType.ASSET, currency: 'USD' as const }];
    const transfer = { from: 'Cash', to: 'Bank', fromCurrency: null, toCurrency: null, memo: null };
    // A zero amount is a host rejection with a notice, never a model ask.
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer', ...transfer, amount: 0 }] } }));
    const zero = await prepareMlp('move money from Cash to Bank', accounts);
    expect(zero).toMatchObject({ steps: [], actions: [], rejection: 'A transfer needs a numeric amount. Add the amount to your request and generate a new preview.' });
    expect(zero.clarification).toBeUndefined();
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer', ...transfer, amount: 0 }] } }));
    await expect(prepareMlp('从Cash转钱到Bank', accounts)).resolves.toMatchObject({ rejection: '转账需要提供数字金额。请在请求里写明金额后重新生成预览。' });
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'spend', steps: [{ action: 'expense', account: 'Cash', amount: 0, currency: null, memo: null }] } }));
    await expect(prepareMlp('spent money from Cash', accounts)).resolves.toMatchObject({ rejection: expect.stringMatching(/^An expense needs a numeric amount/) });
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer', ...transfer, amount: 10, targetAmount: 9 }] } }));
    await expect(prepareMlp('move 10 from Cash to Bank', accounts)).rejects.toMatchObject({ stage: 'format' });
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer', ...transfer, to: null, amount: 0 }] } }));
    await expect(prepareMlp('move money from Cash', accounts)).rejects.toMatchObject({ stage: 'format' });
    // Zero correction must not hide a multi plan whose steps are all transfers.
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'multi', steps: [
      { action: 'transfer', ...transfer, amount: 0 }, { action: 'transfer_all', ...transfer },
    ] } }));
    await expect(prepareMlp('move money from Cash to Bank, then send the rest', accounts)).rejects.toMatchObject({ stage: 'format' });
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer_all', ...transfer }] } }));
    expect((await prepareMlp('move everything from Cash to Bank', accounts)).actions).toMatchObject([{ action: 'transfer', amount: 'all' }]);
    // An existing account named by a unique part of its name is used, never re-created; an ambiguous part is rejected.
    const chase = { id: crypto.randomUUID(), name: 'chase checking', type: AccountType.ASSET, currency: 'USD' as const };
    const debit = (account: string) => JSON.stringify({ result: { intent: 'spend', steps: [{ action: 'expense', account, amount: 12, currency: null, memo: null }] } });
    for (const account of ['chase', 'chase checking']) {
      generate.mockResolvedValueOnce(debit(account));
      expect((await prepareMlp('把我chase里记录一笔debit消费12', [chase])).actions).toMatchObject([{ action: 'expense', account: 'chase checking' }]);
    }
    generate.mockResolvedValueOnce(debit('chase'));
    await expect(prepareMlp('把我chase里记录一笔debit消费12', [chase, { ...chase, id: crypto.randomUUID(), name: 'chase savings' }])).rejects.toThrow('Several accounts match chase');
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'multi', steps: [step, { ...step, name: 'Bank' }] } }));
    await expect(prepareMlp('create Cash and Bank', [])).rejects.toMatchObject({ stage: 'format' });
    // Optional prose and reward programs are kept only when the request states them; invented values are dropped, not saved.
    const card = { ...step, name: 'Gold', type: 'LIABILITY', reward_currency: 'MR' };
    const wallet = { id: crypto.randomUUID(), name: 'Wallet', type: AccountType.ASSET, currency: 'USD' as const };
    const spend = { action: 'expense', account: 'Wallet', amount: 12, currency: null, memo: '午饭' };
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'multi', steps: [card, spend] } }));
    const invented = await prepareMlp('新增信用卡Gold；Wallet支付12，备注咖啡', [wallet]);
    expect([invented.actions[0].action === 'create_account' && invented.actions[0].reward_currency, 'memo' in invented.actions[1], invented.steps[1].arguments.memo]).toEqual([null, false, undefined]);
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'multi', steps: [card, spend] } }));
    const stated = await prepareMlp('新增信用卡Gold，积分MR；Wallet支付12，备注午饭', [wallet]);
    expect([stated.actions[0], stated.steps[1].arguments]).toMatchObject([{ reward_currency: 'MR' }, { memo: '午饭' }]);
    // Non-executing requests must carry an ask reply; removed none and empty plans are format errors.
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'ask', clarification: 'What would you like to record?' } }));
    expect(await prepareMlp('Hello', [])).toEqual({ steps: [], actions: [], clarification: 'What would you like to record?' });
    for (const result of [{ intent: 'none' }, { intent: 'create', steps: [] }]) {
      generate.mockResolvedValueOnce(JSON.stringify({ result }));
      await expect(prepareMlp('Hello', [])).rejects.toMatchObject({ stage: 'format' });
    }
    generate.mockClear();
  });
  it('every regression fixture is achievable by a perfect answer', async () => {
    const intents: Record<string, string> = { create_account: 'create', expense: 'spend', transfer: 'transfer' };
    for (const fixture of HARNESS_CASES.filter(x => x.expected.outcome === 'success' || (x.expected.outcome === 'reject' && x.expected.error !== 'Insufficient balance'))) {
      const steps: Array<Record<string, unknown>> = fixture.plan!.map(({ amount, ...step }) => step.action === 'transfer' && amount === 'all' ? { ...step, action: 'transfer_all' } : { ...step, amount });
      generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: new Set(steps.map(step => String(step.action).replace('_all', ''))).size > 1 ? 'multi' : intents[String(fixture.plan![0].action)], steps } }));
      const accounts = fixture.seed.map((account, index) => ({ id: crypto.randomUUID(), name: account.name!, type: account.type, currency: account.currency, index }));
      const prepared = prepareMlp(fixture.text, accounts);
      if (fixture.expected.outcome === 'success') await expect(prepared, fixture.id).resolves.toMatchObject({ actions: fixture.plan!.map(step => ({ action: step.action })) });
      else await expect(prepared, fixture.id).rejects.toThrow(fixture.expected.error);
    }
    for (const fixture of [...HARNESS_CASES, ...holdoutCases()].filter(f => f.expected.outcome === 'clarification')) {
      generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'ask', clarification: 'Please clarify your request.' } }));
      const accounts = fixture.seed.map(account => ({ id: crypto.randomUUID(), name: account.name!, type: account.type, currency: account.currency }));
      const plan = await prepareMlp(fixture.text, accounts);
      expect(plan.actions, fixture.id).toEqual([]);
      expect(planOutcomeMatches(fixture, 'clarification', plan.actions, new AbortController().signal), fixture.id).toBe(true);
    }
    // amount_required: a zero amount yields the host rejection, which passes; a ready draft never does.
    for (const fixture of HARNESS_CASES.filter(f => f.expected.outcome === 'amount_required')) {
      const accounts = fixture.seed.map(account => ({ id: crypto.randomUUID(), name: account.name!, type: account.type, currency: account.currency }));
      const [from, to] = fixture.seed.map(account => account.name!);
      generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'transfer', steps: [{ action: 'transfer', from, to, amount: 0, fromCurrency: null, toCurrency: null, memo: null }] } }));
      const plan = await prepareMlp(fixture.text, accounts);
      expect(plan.rejection, fixture.id).toBeTruthy();
      expect(planOutcomeMatches(fixture, 'rejected', plan.actions, new AbortController().signal), fixture.id).toBe(true);
      expect(planOutcomeMatches(fixture, 'ready', plan.actions, new AbortController().signal), fixture.id).toBe(false);
    }
    generate.mockClear();
  });
  it('rejects observed malformed outputs without repair and preserves both fixture inventories', async () => {
    const corpus = JSON.parse(await readFile(new URL('../eval/fixtures/observed-format.json', import.meta.url), 'utf8'));
    for (const fixture of corpus) {
      generate.mockResolvedValueOnce(fixture.raw);
      await expect(prepareMlp(fixture.text, fixture.accounts.map((a: object, i: number) => ({ ...a, id: `account-${i}` }))))
        .rejects.toMatchObject({ stage: fixture.expectedStage, output: fixture.raw });
    }
    const fixture = HARNESS_CASES.find(x => x.id === 'spend-asset-en-1')!;
    const invalid = [{ action: 'expense' as const, account: 'Cash Wallet', amount: 14, currency: 'EUR' as const }];
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'spend', steps: invalid } }));
    await expect(prepareMlp(fixture.text, [{ id: crypto.randomUUID(), name: 'Cash Wallet', type: AccountType.ASSET, currency: 'USD' }]))
      .rejects.toMatchObject({ stage: 'validation' });
    expect(planOutcomeMatches(fixture, undefined, invalid, new AbortController().signal)).toBe(false);
    expect(generate).toHaveBeenCalledTimes(corpus.length + 1);
    const manifest = JSON.parse(await readFile(new URL('../eval/fixtures/manifest.json', import.meta.url), 'utf8'));
    expect(HARNESS_CASES.map(x => x.id)).toEqual(manifest.regressionIds);
    expect(manifest.coreIds.filter((id: string) => !manifest.regressionIds.includes(id))).toEqual([]);
    const heldout = holdoutCases();
    expect(heldout.map(x => x.id)).toEqual(manifest.holdoutIds);
    expect(heldout.filter(x => x.id.startsWith('holdout-en-'))).toHaveLength(34);
    expect(heldout.filter(x => x.id.startsWith('holdout-zh-'))).toHaveLength(34);
    for (const fixture of [...HARNESS_CASES, ...heldout]) expect(Array.isArray(expectedPlan(fixture))).toBe(true);
  });
});
