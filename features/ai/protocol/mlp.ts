import { z } from 'zod';
import type { Tx } from '@/lib/db/tx';
import { localToday } from '@/lib/utils/local-date';
import { AccountType, type CurrencyId } from '@/lib/types/accounts';
import { AiOutputError, generateAiText } from '@/features/ai/providers/text-client';
import { jsonSchemaFormat, withoutOptionalNulls } from '@/features/ai/protocol/output-format';
import { ACTION_REGISTRY, STATED_FIELDS, normalizeName, type MlpAccount, type MlpActionName, type MlpActionResult } from '@/features/ai/protocol/action-registry';
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
// The model fills only the registry's planner views; the full action schema validates drafts and edits.
type Tool = (typeof ACTION_REGISTRY)[MlpActionName];
type PlannerStep = { action: string } & Record<string, unknown>;
const TOOLS = Object.values(ACTION_REGISTRY);
const VIEWS = TOOLS.flatMap(tool => tool.plannerViews.map(view => ({ ...view, tool })));
// One schema instance per view: the single-action branch and multi reference the same step, so it is emitted once ($defs).
const STEPS = new Map(VIEWS.map(view => [view, z.object({ action: z.literal(view.name) }).extend(view.schema.shape).strict().meta({ id: `${view.name}_step` })]));
const viewSteps = (views: typeof VIEWS) => views.map(view => STEPS.get(view)!);
const toolSteps = (tool: Tool) => { const [first, ...rest] = viewSteps(VIEWS.filter(view => view.tool === tool)); return rest.length ? z.discriminatedUnion('action', [first, ...rest]) : first; };
const steps = (item: z.ZodType, min: number) => z.array(item).min(min).max(MLP_LIMITS.steps);
// The intent comes first, so the model classifies the whole request before filling any fields. Each branch fixes
// the plan's shape: none has no steps, ask has only a question, a single-action intent admits only that action.
const MlpWireSchema = z.object({ result: z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('none') }).strict(),
  z.object({ intent: z.literal('ask'), clarification: z.string().trim().min(1) }).strict(),
  ...TOOLS.map(tool => z.object({ intent: z.literal(tool.plannerIntent), steps: steps(toolSteps(tool), 1) }).strict()),
  z.object({ intent: z.literal('multi'), steps: steps(z.discriminatedUnion('action', viewSteps(VIEWS) as [z.ZodObject, ...z.ZodObject[]]), 2) }).strict(),
] as [z.ZodObject, ...z.ZodObject[]]) }).strict();
export const MLP_OUTPUT_FORMAT = jsonSchemaFormat('ledger_plan', MlpWireSchema);
type MlpOutput = { steps: PlannerStep[] } | { clarification: string };
/** The only wire-to-internal conversion: drop strict-mode nulls for optional fields, map each view back to its action with
 *  the view's fixed fields, and map the intent back to the internal union. */
function fromWire(raw: string): MlpOutput {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw Error(`Invalid AI plan JSON: ${raw}`); }
  const wire = (value as { result?: { steps?: unknown } } | null)?.result;
  // The local decoder cannot exclude 0, so the local model writes 0 for amounts it does not know. A transfer of 0 is
  // read as transfer_all, and a received amount of 0 as unstated. Review shows "Entire remaining balance" and Save
  // still needs explicit confirmation.
  const zeroAsAll = (step: unknown) => {
    const { amount, targetAmount, ...rest } = step as { action?: unknown; amount?: unknown; targetAmount?: unknown };
    if (rest.action !== 'transfer' && rest.action !== 'transfer_all') return step;
    return { ...rest, ...(amount === 0 ? { action: 'transfer_all' } : amount === undefined ? {} : { amount }), targetAmount: targetAmount === 0 ? null : targetAmount };
  };
  if (Array.isArray(wire?.steps)) wire.steps = wire.steps.map(zeroAsAll).map(step => withoutOptionalNulls(step,
    VIEWS.find(view => view.name === (step as { action?: unknown })?.action)?.schema.shape ?? {}));
  const result = MlpWireSchema.parse(value).result as { intent: string; clarification?: string; steps?: PlannerStep[] };
  if (result.intent === 'ask') return { clarification: result.clarification! };
  result.steps = result.steps?.map(({ action, ...fields }) => { const view = VIEWS.find(item => item.name === action)!; return { action: view.tool.name, ...fields, ...view.fixed }; });
  // The grammar cannot express "different kinds"; same-kind steps belong to that action's own intent.
  if (result.intent === 'multi' && new Set(result.steps!.map(step => step.action)).size < 2) throw Error(`Intent multi needs steps of different kinds; got only ${result.steps![0].action}.`);
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
  const fields = (shape: Record<string, z.ZodType>, keys: string[]) => keys.map(key => `${key}: ${shape[key].description}`).join('; ');
  // Later views of an action are described against its first view, so shared fields are listed once.
  const specs = request.tools.flatMap(tool => tool.plannerViews.map((view, index) => {
    const first = tool.plannerViews[0].schema.shape, shape = view.schema.shape as Record<string, z.ZodType>;
    if (!index) return `${view.name}: ${view.description}; ${fields(shape, Object.keys(shape))}`;
    const added = Object.keys(shape).filter(key => !(key in first)), removed = Object.keys(first).filter(key => !(key in shape));
    return `${view.name}: ${view.description}; as ${tool.plannerViews[0].name}${removed.length ? `, without ${removed.join(', ')}` : ''}${added.length ? `; ${fields(shape, added)}` : ''}`;
  }));
  // Output syntax is enforced by MLP_OUTPUT_FORMAT; instructions carry only ledger semantics.
  const intents = request.tools.map(tool => `${tool.plannerIntent} (only ${tool.plannerViews.map(view => view.name).join('/')} steps)`).join(', ');
  const instructions = `Extract Chinese/English ledger actions. First classify the whole request: ${intents}, multi (steps of different kinds), none (no change), ask (required info missing; ask one short question).
Execute only explicit requests or reported spending. Negation, questions, hypotheticals, greetings: none. Include ALL steps in order; resolve pronouns. Never create an existing account to spend/transfer.
Copy exact names, casing, digits and spaces; exclude generic account/账户 suffixes. A category alone can be the account name.
Opening defaults ASSET/USD/0. Credit cards, charge cards, card brands (Amex, Visa), owed money: LIABILITY with negative balance. Initial balance is not a transaction.
Do not guess money or unstated details. Missing amount/source/destination: ask. Cross-currency needs explicit targetAmount. Today ${today}.
Examples:
"Empty Acorn Jar into Maple Pouch" → transfer_all: Acorn Jar's remaining balance into Maple Pouch
"枫叶钱包午饭花了12" → spend: 12 paid with 枫叶钱包
"Should I move 30 out of Acorn Jar? Not yet" → none: a question, nothing changes
"从枫叶钱包转钱给橡果罐" → ask: 转多少？
Actions:
${specs.join('\n')}`;
  if (instructions.length > MLP_LIMITS.instructionChars) throw Error(`MLP instructions exceed the context budget (${instructions.length}/${MLP_LIMITS.instructionChars} characters).`);
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
  const eligible = accounts.filter(account => account.type === AccountType.ASSET || account.type === AccountType.LIABILITY);
  const source = text === undefined ? '' : normalizeName(text);
  // Latin letters and digits need a word boundary, so a short id such as MR is not found inside another word;
  // CJK text has no word spaces and matches as a substring.
  const states = (spelling: string) => {
    const wanted = normalizeName(spelling);
    for (let at = source.indexOf(wanted); wanted && at >= 0; at = source.indexOf(wanted, at + 1))
      if (!/[a-z0-9]/.test(source[at - 1] ?? '') && !/[a-z0-9]/.test(source[at + wanted.length] ?? '')) return true;
    return false;
  };
  // Drop unstated optional prose before mapping, so review and save never see an invented value. User edits keep theirs.
  const selected = z.array(MlpActionSchema).max(MLP_LIMITS.steps).parse(actions).map(action => text === undefined ? action : Object.fromEntries(Object.entries(action).flatMap(([key, value]) => {
    const spellings = typeof value === 'string' ? STATED_FIELDS[key]?.(value) : undefined;
    if (!spellings || spellings.some(states)) return [[key, value]];
    return (ACTION_REGISTRY[action.action].extractionSchema.shape as Record<string, z.ZodType>)[key].safeParse(null).success ? [[key, null]] : [];
  })) as MlpAction);
  const numbers = new Set(((text ?? '').match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map(number => Math.abs(Number(number.replaceAll(',', '')))));
  const available = [...eligible]; const steps: MlpStep[] = [];
  for (const [index, action] of selected.entries()) {
    const tool = ACTION_REGISTRY[action.action];
    const reason = tool.availability(available, steps.some(step => step.name === 'create_account'));
    if (reason) throw Error(reason);
    const grounded = (name: string) => { if (text !== undefined && !source.includes(normalizeName(name))) throw Error(`Account name must remain verbatim: ${name}`); };
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
