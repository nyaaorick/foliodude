import { z } from 'zod';
import type { Tx } from '@/lib/db/tx';
import { localToday } from '@/lib/utils/local-date';
import { AccountType, type CurrencyId } from '@/lib/types/accounts';
import { AiOutputError, generateAiText } from '@/features/ai/providers/text-client';
import { jsonSchemaFormat, withoutOptionalNulls } from '@/features/ai/protocol/output-format';
import { ACTION_REGISTRY, normalizeName, type MlpAccount, type MlpActionName, type MlpActionResult } from '@/features/ai/protocol/action-registry';
export { ACTION_REGISTRY } from '@/features/ai/protocol/action-registry';

export const MLP_LIMITS = Object.freeze({ steps: 8, candidates: 8, candidateChars: 320, instructionChars: 2000, inputChars: 4000 });
export interface MlpMeasurement { steps: number; actions: MlpActionName[]; candidates: number; excludedAccounts: number; instructionChars: number; inputChars: number }
const observers = new Set<(measurement: MlpMeasurement) => void>();
export function observeMlp(observer: (measurement: MlpMeasurement) => void) { observers.add(observer); return () => { observers.delete(observer); }; }
export interface MlpStep { name: MlpActionName; arguments: Record<string, unknown>; resultAlias?: string }
export interface MlpPlan { steps: MlpStep[]; actions: MlpAction[]; clarification?: string }
export type MlpAction = z.infer<typeof MlpActionSchema>;

// The discriminator comes first so constrained decoding chooses the action before its fields.
const actionSchema = <T extends (typeof ACTION_REGISTRY)[MlpActionName]>(tool: T) =>
  z.object({ action: z.literal(tool.name as T['name']) }).extend(tool.extractionSchema.shape as T['extractionSchema']['shape']).strict();
export const MlpActionSchema = z.discriminatedUnion('action', [
  actionSchema(ACTION_REGISTRY.create_account), actionSchema(ACTION_REGISTRY.expense), actionSchema(ACTION_REGISTRY.transfer),
]);
// The model fills only the registry's planner fields; the full action schema validates drafts and edits.
const plannerStep = (tool: (typeof ACTION_REGISTRY)[MlpActionName]) => z.object({ action: z.literal(tool.name) }).extend(tool.plannerSchema.shape).strict();
type PlannerStep = z.infer<ReturnType<typeof plannerStep>>;
const TOOLS = Object.values(ACTION_REGISTRY);
const steps = (item: z.ZodType, min: number) => z.array(item).min(min).max(MLP_LIMITS.steps);
// The intent comes first, so the model classifies the whole request before filling any fields. Each branch fixes
// the plan's shape: none has no steps, ask has only a question, a single-action intent admits only that action.
const MlpWireSchema = z.object({ result: z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('none') }).strict(),
  z.object({ intent: z.literal('ask'), clarification: z.string().trim().min(1) }).strict(),
  ...TOOLS.map(tool => z.object({ intent: z.literal(tool.plannerIntent), steps: steps(plannerStep(tool), 1) }).strict()),
  z.object({ intent: z.literal('multi'), steps: steps(z.discriminatedUnion('action', TOOLS.map(plannerStep) as [ReturnType<typeof plannerStep>]), 2) }).strict(),
] as [z.ZodObject, ...z.ZodObject[]]) }).strict();
export const MLP_OUTPUT_FORMAT = jsonSchemaFormat('ledger_plan', MlpWireSchema);
type MlpOutput = { steps: PlannerStep[] } | { clarification: string };
/** The only wire-to-internal conversion: drop strict-mode nulls for optional fields, then map the intent back to the internal union. */
function fromWire(raw: string): MlpOutput {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw Error(`Invalid AI plan JSON: ${raw}`); }
  const wire = (value as { result?: { steps?: unknown } } | null)?.result;
  if (Array.isArray(wire?.steps)) wire.steps = wire.steps.map(step => withoutOptionalNulls(step,
    TOOLS.find(tool => tool.name === (step as { action?: unknown })?.action)?.plannerSchema.shape ?? {}));
  const result = MlpWireSchema.parse(value).result as { intent: string; clarification?: string; steps?: PlannerStep[] };
  if (result.intent === 'ask') return { clarification: result.clarification! };
  return { steps: result.steps ?? [] };
}
export class MlpError extends Error {
  constructor(public readonly stage: 'format' | 'validation', message: string, public readonly output?: unknown) { super(message); }
}
function context(text: string, accounts: MlpAccount[]) {
  if (text.length > MLP_LIMITS.inputChars) throw Error('Request exceeds the MLP input budget. Split it into smaller requests.');
  const tools = Object.values(ACTION_REGISTRY).filter(tool => !tool.availability(accounts, true));
  if (!tools.length) throw Error(ACTION_REGISTRY.create_account.availability(accounts, false)!);
  // Include all accounts when they fit; otherwise select literal mentions, never truncate duplicates.
  const candidates = accounts.length <= MLP_LIMITS.candidates ? accounts : accounts.filter(account => normalizeName(text).includes(normalizeName(account.name)));
  if (candidates.length > MLP_LIMITS.candidates || JSON.stringify(candidates.map(a => a.name)).length > MLP_LIMITS.candidateChars) throw Error('Account candidates exceed the MLP context budget. Use explicit account names.');
  return { candidates, tools };
}
function compile(request: ReturnType<typeof context>, today: string) {
  const specs = request.tools.map(tool => `${tool.name}: ${tool.description}; ${Object.entries(tool.plannerSchema.shape).map(([key, schema]) => `${key}: ${schema.description}`).join('; ')}`);
  // Output syntax is enforced by MLP_OUTPUT_FORMAT; instructions carry only ledger semantics.
  const intents = request.tools.map(tool => `${tool.plannerIntent} (only ${tool.name} steps)`).join(', ');
  const instructions = `Extract Chinese/English ledger actions. First classify the whole request: ${intents}, multi (several different kinds of steps), none (nothing should change), ask (required information is missing; ask one short question).
Execute only explicit requests or reported spending. Negation, questions, hypotheticals, greetings: none. Include ALL steps in order; resolve pronouns. Never create an existing account to spend/transfer.
Copy exact names, casing, digits and spaces; exclude generic account/账户 suffixes. A category alone can be the account name.
Opening defaults ASSET/USD/0. Credit cards, charge cards, owed money: LIABILITY with negative balance. Initial balance is not a transaction.
Transfer amount "all" means remaining balance after prior steps. Do not guess money or unstated details. Missing amount/source/destination: ask. Cross-currency needs explicit targetAmount. Today ${today}.
Actions:
${specs.join('\n')}`;
  if (instructions.length > MLP_LIMITS.instructionChars) throw Error('MLP instructions exceed the context budget. Split the request.');
  return instructions;
}
/** One Responses call performs semantic understanding and extraction together. */
export async function prepareMlp(text: string, accounts: MlpAccount[], signal?: AbortSignal, today = localToday()): Promise<MlpPlan> {
  signal?.throwIfAborted();
  const eligible = accounts.filter(account => account.type === AccountType.ASSET || account.type === AccountType.LIABILITY);
  const request = context(text, eligible);
  const instructions = compile(request, today);
  const input = JSON.stringify({ accounts: request.candidates.map(({ name, type, currency }) => ({ name, type, currency })), request: text });
  for (const observer of observers) observer({ steps: 0, actions: request.tools.map(tool => tool.name), candidates: request.candidates.length,
    excludedAccounts: eligible.length - request.candidates.length, instructionChars: instructions.length, inputChars: input.length });
  let raw: string;
  try { raw = await generateAiText(instructions, input, MLP_OUTPUT_FORMAT, signal); }
  catch (cause) { throw cause instanceof AiOutputError ? new MlpError('format', cause.message, cause.output) : cause; }
  let output: MlpOutput;
  try { output = fromWire(raw); }
  catch (cause) { throw new MlpError('format', cause instanceof Error ? cause.message : String(cause), raw); }
  signal?.throwIfAborted();
  if ('clarification' in output) return { steps: [], actions: [], clarification: output.clarification };
  try { return normalizeMlp(output.steps, eligible, today, text); }
  catch (cause) { throw new MlpError('validation', cause instanceof Error ? cause.message : String(cause), output); }
}
/** Explicit user edits use the same schemas; only model extraction is grounded in source text. */
export function normalizeMlp(actions: unknown, accounts: MlpAccount[], today = localToday(), text?: string): MlpPlan {
  const selected = z.array(MlpActionSchema).max(MLP_LIMITS.steps).parse(actions);
  const eligible = accounts.filter(account => account.type === AccountType.ASSET || account.type === AccountType.LIABILITY);
  const source = text === undefined ? undefined : normalizeName(text);
  const numbers = new Set(((text ?? '').match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map(number => Math.abs(Number(number.replaceAll(',', '')))));
  const available = [...eligible]; const steps: MlpStep[] = [];
  for (const [index, action] of selected.entries()) {
    const tool = ACTION_REGISTRY[action.action];
    const reason = tool.availability(available, steps.some(step => step.name === 'create_account'));
    if (reason) throw Error(reason);
    const grounded = (name: string) => { if (source !== undefined && !source.includes(normalizeName(name))) throw Error(`Account name must remain verbatim: ${name}`); };
    const { action: name, ...value } = action;
    const arguments_ = tool.map(value, {
      today,
      money(value) { if (text !== undefined && value !== 0 && !numbers.has(Math.abs(value))) throw Error('The extracted amount was not provided in the request. Use numeric amounts.'); return value; },
      resolve(name, currency?: CurrencyId) {
        const matches = available.filter(account => normalizeName(account.name) === normalizeName(name) && (!currency || account.currency === currency));
        grounded(name);
        if (matches.length !== 1) throw Error(matches.length ? `Several accounts match ${name}; use a unique account name.` : `Account not found: ${name}. Create it explicitly first.`);
        return matches[0];
      },
      create(name) {
        grounded(name);
        if (available.some(account => normalizeName(account.name) === normalizeName(name))) throw Error(`Account already exists: ${name}`);
      },
    });
    const resultAlias = name === 'create_account' ? `new${index + 1}` : undefined;
    steps.push({ name, arguments: arguments_, ...(resultAlias ? { resultAlias } : {}) });
    if (name === 'create_account') {
      const account = ACTION_REGISTRY.create_account.inputSchema.parse(arguments_);
      available.push({ id: `@${resultAlias}`, name: account.name, type: account.type, currency: account.currency });
    }
  }
  return { steps, actions: selected };
}
/** All writes run in the caller's Tx. Aborting inside the transaction throws to roll back. */
export async function executeMlp(tx: Tx, plan: MlpPlan, signal?: AbortSignal): Promise<MlpActionResult[]> {
  const aliases = new Map<string, string>(); const results: MlpActionResult[] = [];
  for (const step of plan.steps) {
    signal?.throwIfAborted();
    const result = await ACTION_REGISTRY[step.name].call(step.arguments, { tx, resolve(id) {
      if (!id.startsWith('@')) return id;
      const resolved = aliases.get(id.slice(1)); if (!resolved) throw Error(`Unknown result alias: ${id}`); return resolved;
    } });
    results.push(result);
    if (step.resultAlias) aliases.set(step.resultAlias, result.entityId);
  }
  signal?.throwIfAborted();
  return results;
}
