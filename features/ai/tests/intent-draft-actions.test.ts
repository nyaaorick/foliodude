import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockGetSessionContext, mockWithLocalClient } = vi.hoisted(() => ({ mockGetSessionContext: vi.fn(), mockWithLocalClient: vi.fn() }));
vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));
vi.mock('@/features/ai/runtime/local-runtime', () => ({ withLocalClient: mockWithLocalClient }));
import { executeMlp, prepareMlp, MLP_LIMITS, MLP_OUTPUT_FORMAT, ACTION_REGISTRY } from '@/features/ai/protocol/mlp';
import { prepareIntentDraft, commitIntentDraft, reviewIntentDraft, refreshIntentDraft } from '@/features/ai/application/intent-draft-actions';
import type { IntentDraft } from '@/features/ai/application/intent-draft';
import { saveAiSettings } from '@/features/ai/application/ai-settings-actions';
import { setApiKey } from '@/lib/db/settings';
import { createTestContext, allTransactions, seedAccount } from '@/lib/db/testing';
import { AccountType } from '@/lib/types/accounts';
import { adjustBalance } from '@/lib/db/ledger';
import type { SessionContext } from '@/lib/db/session';
const newAccount = { action: 'create_account', name: 'Cash', balance: 50 };
const expense = (amount: number) => ({ action: 'expense', account: 'Cash', amount });
// Endpoints echo the applied text.format; the plan travels inside the intent-tagged wire envelope.
const INTENTS: Record<string, string> = Object.fromEntries(Object.values(ACTION_REGISTRY).map(tool => [tool.name, tool.plannerIntent]));
function wire(value: unknown) {
  const plan = value as { steps?: Array<{ action: string }>; clarification?: string };
  if (plan.clarification !== undefined) return { intent: 'ask', ...plan };
  if (!Array.isArray(plan.steps)) return value;
  if (!plan.steps.length) return { intent: 'none' };
  return { intent: new Set(plan.steps.map(step => step.action)).size > 1 ? 'multi' : INTENTS[plan.steps[0].action], ...plan };
}
const response = (value: unknown, extra: object = { text: { format: MLP_OUTPUT_FORMAT } }) => ({ id: 'resp_test', object: 'response', status: 'completed', output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ result: wire(value) }), annotations: [] }] }], ...extra });
function mockPlan(value: unknown, extra?: object) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(response(value, extra)), { headers: { 'Content-Type': 'application/json' } }));
}
async function draft(text: string, steps: unknown[]): Promise<IntentDraft> {
  mockPlan({ steps });
  const result = await prepareIntentDraft({ text });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error('Expected draft');
  return result.draft;
}
describe('reviewable intent entry', () => {
  let ctx: SessionContext;
  beforeEach(async () => {
    vi.clearAllMocks(); ctx = await createTestContext(); mockGetSessionContext.mockResolvedValue(ctx);
    vi.stubGlobal('fetch', vi.fn());
    await setApiKey(ctx.db, 'llm', 'test-key', { baseUrl: 'https://llm.example.test/v1', model: 'test-model' });
  });
  it('prepares without writes using one Responses call, then atomically saves or rolls back', async () => {
    const failed = await draft('set up Cash with 50; lunch cost 60 from it', [newAccount, expense(60)]);
    expect((await ctx.db.query('SELECT * FROM accounts')).rows).toHaveLength(0);
    expect(await allTransactions(ctx.db)).toHaveLength(0);
    await expect(commitIntentDraft(failed)).rejects.toThrow('Insufficient balance');
    expect((await ctx.db.query('SELECT * FROM accounts')).rows).toHaveLength(0);
    const valid = await draft('set up Cash with 50; lunch cost 10 from it', [newAccount, expense(10)]);
    const receipt = await commitIntentDraft(valid);
    expect(receipt.steps).toHaveLength(2);
    expect((await ctx.db.query<{ balance: number }>('SELECT balance FROM accounts')).rows[0].balance).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe('https://llm.example.test/v1/responses');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
      const body = JSON.parse(init?.body as string);
      expect(body.store).toBe(false); expect(body.input).toContain('set up Cash');
      expect(body.instructions).toContain('LIABILITY'); expect(body.input).not.toContain('accountId');
      expect(body.text).toEqual({ format: MLP_OUTPUT_FORMAT }); expect(body.instructions + body.input).not.toMatch(/JSON|Markdown|brace/i);
    }
  });
  it('fails explicitly when an endpoint ignores native JSON output or truncates it', async () => {
    mockPlan({ steps: [newAccount] }, {});
    await expect(prepareIntentDraft({ text: 'set up Cash with 50' })).rejects.toThrow('did not confirm json_schema');
    mockPlan({ steps: [newAccount] }, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, text: { format: MLP_OUTPUT_FORMAT } });
    await expect(prepareIntentDraft({ text: 'set up Cash with 50' })).rejects.toMatchObject({ stage: 'format' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await ctx.db.query('SELECT * FROM accounts')).rows).toHaveLength(0);
  });
  it('uses the same local contract and rejects malformed, ungrounded or ambiguous extraction without writes', async () => {
    await saveAiSettings({ backend: 'local', local: { kind: 'folder', modelId: 'imported', label: 'My model' } });
    const create = vi.fn(); mockWithLocalClient.mockImplementation(async (_id, work) => work({ responses: { create } }));
    await seedAccount(ctx, { name: 'Cash', balance: 50 });
    const answer = (value: unknown) => create.mockResolvedValueOnce({ status: 'completed', output: [], output_text: JSON.stringify({ result: wire(value) }), text: { format: MLP_OUTPUT_FORMAT } });
    answer({ steps: [expense(10)] });
    const result = await prepareIntentDraft({ text: 'spend 10 from Cash' });
    expect(result.status).toBe('ready'); expect(fetch).not.toHaveBeenCalled(); expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].text).toEqual({ format: MLP_OUTPUT_FORMAT });
    for (const [text, value] of [
      ['create 中文钱包 with 100', { steps: [{ action: 'create_account', name: 'Chinese Wallet', balance: 100 }] }],
      ['spend 10 from Cash', { steps: [expense(999)] }],
      ['spend 10 from Missing', { steps: [{ action: 'expense', account: 'Missing', amount: 10 }] }],
      ['spend 10 from Cash', expense(10)],
      ['spend 10 from Cash on 2026-02-30', { steps: [{ ...expense(10), date: '2026-02-30' }] }],
    ] as const) { answer(value); await expect(prepareIntentDraft({ text })).rejects.toThrow(); }
    // everything-webgpu reports a post-decode schema rejection as a failed response; it must stay a format failure.
    create.mockResolvedValueOnce({ status: 'failed', error: { code: 'server_error', message: 'Generated JSON does not match schema at #/result.' }, output_text: '{"result":{}}' });
    await expect(prepareIntentDraft({ text: 'spend 10 from Cash' })).rejects.toMatchObject({ stage: 'format', output: '{"result":{}}' });
    await seedAccount(ctx, { name: 'Cash', balance: 50 }); answer({ steps: [expense(10)] });
    await expect(prepareIntentDraft({ text: 'spend 10 from Cash' })).rejects.toThrow('Several accounts');
    expect(await allTransactions(ctx.db)).toHaveLength(0);
  });
  it('defaults openings and initial debt without transactions, and returns clarification/no-action without writes', async () => {
    await commitIntentDraft(await draft('创建一个账户, 叫chase', [{ action: 'create_account', name: 'chase' }]));
    await commitIntentDraft(await draft('我要创立一个amex账户', [{ action: 'create_account', name: 'amex' }]));
    await commitIntentDraft(await draft('我要建立一个信用卡，里面负债20刀', [{ action: 'create_account', name: '信用卡', type: 'LIABILITY', balance: 20 }]));
    expect((await ctx.db.query('SELECT name,type,currency,balance FROM accounts ORDER BY name')).rows).toEqual([
      { name: 'amex', type: 'ASSET', currency: 'USD', balance: 0 }, { name: 'chase', type: 'ASSET', currency: 'USD', balance: 0 },
      { name: '信用卡', type: 'LIABILITY', currency: 'USD', balance: -20 },
    ]);
    mockPlan({ steps: [] }); expect(await prepareIntentDraft({ text: '不要建立新账户' })).toHaveProperty('status', 'no_action');
    mockPlan({ clarification: 'Please provide the amount.' });
    expect(await prepareIntentDraft({ text: '从amex支付午饭' })).toEqual({ status: 'clarification', reply: 'Please provide the amount.' });
    expect(await allTransactions(ctx.db)).toHaveLength(0);
  });
  it('accepts explicit edited fields, validates them, and blocks sequential and concurrent duplicate saves', async () => {
    const original = await draft('create Cash with 50', [newAccount]);
    const edited = [{ ...newAccount, name: 'Edited account', balance: 123 }];
    expect(() => reviewIntentDraft(original, [{ ...newAccount, balance: NaN }])).toThrow();
    const first = commitIntentDraft(original, edited);
    await expect(commitIntentDraft(original, edited)).rejects.toThrow('already saving'); await first;
    await expect(commitIntentDraft(original, edited)).rejects.toThrow('already been saved');
    expect((await ctx.db.query('SELECT name,balance FROM accounts')).rows).toEqual([{ name: 'Edited account', balance: 123 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires refreshed review for changed/deleted accounts and previews all after earlier steps', async () => {
    const fromId = await seedAccount(ctx, { name: 'Wallet', balance: 100 }); await seedAccount(ctx, { name: 'Bank', balance: 20 });
    const actions = [{ action: 'expense', account: 'Wallet', amount: 12 }, { action: 'transfer', from: 'Wallet', to: 'Bank', amount: 'all' }];
    const original = await draft('spend 12 from Wallet; move all remaining Wallet money to Bank', actions);
    expect(reviewIntentDraft(original).steps[1].amount).toBe(88);
    await ctx.db.transaction(tx => adjustBalance(tx, fromId, 5));
    await expect(commitIntentDraft(original)).rejects.toThrow('Accounts changed'); expect(await allTransactions(ctx.db)).toHaveLength(0);
    const refreshed = await refreshIntentDraft(original, actions);
    expect(reviewIntentDraft(refreshed).steps[1].amount).toBe(93); await commitIntentDraft(refreshed);
    expect((await ctx.db.query('SELECT name,balance FROM accounts ORDER BY name')).rows).toEqual([{ name: 'Bank', balance: 113 }, { name: 'Wallet', balance: 0 }]);
    expect((await allTransactions(ctx.db)).map(t => t.amount)).toEqual([12, 93]);
    const deleted = await draft('spend 1 from Bank', [{ action: 'expense', account: 'Bank', amount: 1 }]);
    await ctx.db.query('DELETE FROM transactions'); await ctx.db.query('DELETE FROM accounts');
    await expect(commitIntentDraft(deleted)).rejects.toThrow('Accounts changed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not trust public snapshots and rolls back cancellation after the final write', async () => {
    const id = await seedAccount(ctx, { name: 'Cash', balance: 50 });
    const original = await draft('spend 10 from Cash', [expense(10)]);
    await ctx.db.transaction(tx => adjustBalance(tx, id, 5));
    original.accounts[0].balance = 55;
    await expect(commitIntentDraft(original)).rejects.toThrow('Accounts changed');
    const controller = new AbortController(); const accounts = original.accounts;
    mockPlan({ steps: [{ action: 'create_account', name: 'Cancelled', balance: 50 }] });
    const plan = await prepareMlp('create Cancelled with 50', accounts);
    await expect(ctx.db.transaction(tx => executeMlp(new Proxy(tx, { get(target, key) {
      if (key !== 'query') return Reflect.get(target, key);
      return async (sql: string, params: unknown[]) => { const result = await target.query(sql, params); if (/INSERT INTO accounts/.test(sql)) controller.abort(); return result; };
    } }), plan, controller.signal))).rejects.toThrow();
    expect((await ctx.db.query('SELECT name FROM accounts')).rows).toEqual([{ name: 'Cash' }]);
  });
  it('enforces budgets before inference', async () => {
    await expect(prepareMlp('x'.repeat(MLP_LIMITS.inputChars + 1), [])).rejects.toThrow('input budget');
    const accounts = Array.from({ length: 9 }, (_, index) => ({ id: crypto.randomUUID(), name: `Wallet${index}`, type: AccountType.ASSET, currency: 'USD' as const }));
    await expect(prepareMlp('move 1 from ' + accounts.map(a => a.name).join(' '), accounts)).rejects.toThrow('context budget');
    expect(fetch).not.toHaveBeenCalled();
  });
});
