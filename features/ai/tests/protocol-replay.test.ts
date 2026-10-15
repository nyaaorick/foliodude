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
    generate.mockClear();
  });
  it('rejects observed malformed outputs without repair and preserves both fixture inventories', async () => {
    const corpus = JSON.parse(await readFile(new URL('../eval/fixtures/observed-format.json', import.meta.url), 'utf8'));
    for (const fixture of corpus) {
      generate.mockResolvedValueOnce(fixture.raw);
      await expect(prepareMlp(fixture.text, fixture.accounts.map((a: object, i: number) => ({ ...a, id: `account-${i}` }))))
        .rejects.toMatchObject({ stage: fixture.expectedStage, output: fixture.raw });
    }
    const fixture = HARNESS_CASES.find(x => x.id === 'natural-spend-en')!;
    const invalid = [{ action: 'expense' as const, account: 'Test Wallet', amount: 17, currency: 'EUR' as const }];
    generate.mockResolvedValueOnce(JSON.stringify({ result: { intent: 'spend', steps: invalid } }));
    await expect(prepareMlp(fixture.text, [{ id: crypto.randomUUID(), name: 'Test Wallet', type: AccountType.ASSET, currency: 'USD' }]))
      .rejects.toMatchObject({ stage: 'validation' });
    expect(planOutcomeMatches(fixture, undefined, invalid, new AbortController().signal)).toBe(false);
    expect(generate).toHaveBeenCalledTimes(corpus.length + 1);
    const manifest = JSON.parse(await readFile(new URL('../eval/fixtures/manifest.json', import.meta.url), 'utf8'));
    expect(HARNESS_CASES.map(x => x.id)).toEqual(manifest.regressionIds);
    const heldout = holdoutCases();
    expect(heldout.map(x => x.id)).toEqual(manifest.holdoutIds);
    expect(heldout.filter(x => x.id.startsWith('holdout-en-'))).toHaveLength(50);
    expect(heldout.filter(x => x.id.startsWith('holdout-zh-'))).toHaveLength(50);
    for (const fixture of [...HARNESS_CASES, ...heldout]) expect(Array.isArray(expectedPlan(fixture))).toBe(true);
  });
});
