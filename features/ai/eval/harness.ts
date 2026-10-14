import { getDb } from '@/lib/db/client';
import { createAccount } from '@/lib/actions/create-accounts-actions';
import { prepareIntentDraft, commitIntentDraft, discardIntentDraft, type PrepareIntentResult } from '@/features/ai/application/intent-draft-actions';
import { saveAiSettings } from '@/features/ai/application/ai-settings-actions';
import { DEFAULT_LOCAL_MODEL, type LocalModelConfig } from '@/features/ai/config';
import { getLocalRuntimeState, loadLocalModel, releaseLocalModel } from '@/features/ai/runtime/local-runtime';
import { MlpError, observeMlp, type MlpAction, type MlpMeasurement } from '@/features/ai/protocol/mlp';
import { HARNESS_CASES } from '@/features/ai/eval/cases';
import { holdoutCases } from '@/features/ai/eval/holdout-cases';
import { expectedPlan, planMatches } from '@/features/ai/eval/expected-plans';
import { NATURAL_SEED } from '@/features/ai/eval/natural-cases';
import { observeAiText, type AiTextMeasurement } from '@/features/ai/providers/text-client';

interface RunOptions { folder: boolean; mode: 'ledger' | 'extraction'; suite: 'regression' | 'holdout'; cases?: string[] }
const state: { evaluationSeed: number; phase: string; done: boolean; fatal?: string; results: Array<Record<string, unknown>>; model?: LocalModelConfig; loadMs?: number } = { evaluationSeed: NATURAL_SEED, phase: 'idle', done: false, results: [] };
const show = () => { document.querySelector('#status')!.textContent = JSON.stringify({ ...state, results: state.results.map(r => ({ id: r.id, passed: r.passed, structured: r.structured, ms: r.ms, error: r.error })) }, null, 2); };
async function snapshot() {
  const db = await getDb();
  return {
    accounts: (await db.query<{ name: string; type: string; currency: string; balance: number; credit_limit: number | null }>('SELECT name,type,currency,balance,credit_limit FROM accounts_flat ORDER BY name,balance,id')).rows,
    transactions: (await db.query<{ amount: number }>('SELECT amount,type,category,memo,transaction_date FROM transactions ORDER BY created_at,id')).rows,
  };
}
async function run(options: RunOptions) {
  try {
    const suite = options.suite === 'holdout' ? holdoutCases() : HARNESS_CASES;
    const fixtures = suite.filter(f => !options.cases || options.cases.includes(f.id));
    if (!fixtures.length || options.cases?.some(id => !suite.some(f => f.id === id))) throw new Error('Unknown or empty fixture selection.');
    state.phase = 'loading'; show();
    let files: FileList | undefined;
    let model: LocalModelConfig = DEFAULT_LOCAL_MODEL;
    if (options.folder) {
      const paths: string[] = await (await fetch('/model-files')).json();
      const transfer = new DataTransfer();
      for (const path of paths) {
        const response = await fetch('/model/' + path.split('/').map(encodeURIComponent).join('/'));
        if (!response.ok) throw new Error(`Model artifact failed: ${path} (${response.status})`);
        const file = new File([await response.blob()], path.split('/').at(-1)!);
        Object.defineProperty(file, 'webkitRelativePath', { value: 'model/' + path });
        transfer.items.add(file);
      }
      files = transfer.files;
      model = { kind: 'folder', modelId: 'foliodude-harness-qwen38', label: 'Harness model folder' };
    }
    state.model = model;
    await saveAiSettings({ backend: 'local', local: model });
    const start = performance.now(); await loadLocalModel(model, files); state.loadMs = performance.now() - start; files = undefined;
    for (const fixture of fixtures) {
      state.phase = fixture.id; show();
      const db = await getDb(); await db.exec('TRUNCATE accounts RESTART IDENTITY CASCADE');
      for (const seed of fixture.seed) await createAccount(seed);
      const before = await snapshot(); const start = performance.now();
      const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => abort.abort(new Error('Case exceeded 90 seconds')), 90_000);
      let result: unknown; let error: string | undefined; let failureKind: string | undefined;
      let prepared: PrepareIntentResult | undefined; let extracted: MlpAction[] = [];
      let modelOutput: unknown; let planningMs = 0, saveMs = 0;
      const calls: AiTextMeasurement[] = [], mlp: MlpMeasurement[] = [];
      const stopMlp = observeMlp(value => mlp.push(value));
      const stopObserving = observeAiText(call => calls.push(call));
      let previewUnchanged = false;
      try {
        if (fixture.expected.outcome === 'cancel') timer = setTimeout(() => abort.abort(), 200);
        const planningStart = performance.now();
        try { prepared = await prepareIntentDraft({ text: fixture.text }, { signal: abort.signal }); }
        finally { planningMs = performance.now() - planningStart; }
        result = prepared;
        previewUnchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
        if (prepared.status === 'ready') {
          extracted = prepared.draft.actions;
          if (options.mode === 'ledger') {
            const saveStart = performance.now();
            try { result = await commitIntentDraft(prepared.draft, extracted, { signal: abort.signal }); }
            catch (cause) { failureKind = 'database'; throw cause; }
            finally { saveMs = performance.now() - saveStart; }
          }
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        if (cause instanceof MlpError) {
          modelOutput = cause.output;
          failureKind = cause.stage;
          if (cause.stage === 'validation' && cause.output && typeof cause.output === 'object' && 'steps' in cause.output) extracted = (cause.output as { steps: MlpAction[] }).steps;
        }
        failureKind ??= 'validation';
        previewUnchanged = planningMs > 0 && saveMs === 0 ? JSON.stringify(before) === JSON.stringify(await snapshot()) : previewUnchanged;
      }
      finally { stopMlp(); stopObserving(); clearTimeout(timeout); if (timer) clearTimeout(timer); if (prepared?.status === 'ready') discardIntentDraft(prepared.draft); }
      const expected = expectedPlan(fixture);
      const planPassed = fixture.expected.outcome === 'clarification' ? prepared?.status === 'clarification'
        : fixture.expected.outcome === 'no_action' ? prepared?.status === 'no_action'
        : fixture.expected.outcome === 'cancel' ? abort.signal.aborted && abort.signal.reason?.name === 'AbortError'
        : planMatches(extracted, expected);
      if (!planPassed && failureKind !== 'format') failureKind = 'semantic';
      const ms = performance.now() - start; const after = await snapshot();
      const unchanged = JSON.stringify(before) === JSON.stringify(after);
      const expectedAccounts = [...fixture.expected.accounts].sort((a, b) => a.name.localeCompare(b.name) || a.balance - b.balance);
      const actualAccounts = [...after.accounts].sort((a, b) => a.name.localeCompare(b.name) || a.balance - b.balance);
      const accountsMatch = actualAccounts.length === expectedAccounts.length && expectedAccounts.every((expected, index) =>
        Object.entries(expected).every(([key, value]) => actualAccounts[index][key as keyof typeof actualAccounts[number]] === value));
      const transactionsMatch = after.transactions.length === fixture.expected.transactions &&
        (!fixture.expected.amounts || JSON.stringify(after.transactions.map(t => t.amount).sort((a,b) => a-b)) === JSON.stringify([...fixture.expected.amounts].sort((a,b) => a-b)));
      const noAction = prepared?.status === 'no_action' || prepared?.status === 'clarification';
      const outcomeMatch = fixture.expected.outcome === 'success' ? !error && !noAction
        : fixture.expected.outcome === 'clarification' ? !error && noAction && prepared?.status === 'clarification' && unchanged
        : fixture.expected.outcome === 'no_action' ? !error && noAction && unchanged
        : !!error && unchanged && (!fixture.expected.error || error.includes(fixture.expected.error)) && (fixture.expected.outcome !== 'cancel' || (abort.signal.aborted && abort.signal.reason?.name === 'AbortError'));
      state.results.push({ id: fixture.id, text: fixture.text, expected: fixture.expected, ms,
        passed: planPassed && previewUnchanged && (options.mode === 'extraction' || (accountsMatch && transactionsMatch && outcomeMatch)),
        planPassed, ledgerPassed: options.mode === 'ledger' ? accountsMatch && transactionsMatch && outcomeMatch : null, previewUnchanged, planningMs, saveMs, failureKind: !planPassed || !(accountsMatch && transactionsMatch && outcomeMatch) ? failureKind : undefined,
        expectedPlan: expected, extracted, modelOutput,
        structured: failureKind !== 'format',
        unchanged, result, error, before, after, mlp, measurements: { calls: calls.length,
          instructionChars: calls.reduce((sum, call) => sum + call.instructionChars, 0),
          inputChars: calls.reduce((sum, call) => sum + call.inputChars, 0),
          inputTokens: calls.every(call => call.inputTokens !== null) ? calls.reduce((sum, call) => sum + call.inputTokens!, 0) : null,
          outputTokens: calls.every(call => call.outputTokens !== null) ? calls.reduce((sum, call) => sum + call.outputTokens!, 0) : null,
          responses: calls } }); show();
    }
    await releaseLocalModel(); state.phase = 'complete';
  } catch (cause) { state.fatal = cause instanceof Error ? cause.stack : String(cause); state.phase = 'failed'; }
  finally { state.done = true; show(); }
}
Object.assign(window, { folioHarness: { state, runtime: getLocalRuntimeState, run } });
