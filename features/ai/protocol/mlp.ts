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
/** clarification is the model's ask; rejection is the host refusing a model answer (zero amount), shown as a notice. */
export interface MlpPlan { steps: MlpStep[]; actions: MlpAction[]; clarification?: string; rejection?: string }
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
// the plan's shape: ask has only a reply, a single-action intent admits only that action.
const MlpWireSchema = z.object({ result: z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('ask'), clarification: z.string().trim().min(1) }).strict(),
  ...TOOLS.map(tool => z.object({ intent: z.literal(tool.plannerIntent), steps: steps(toolSteps(tool), 1) }).strict()),
  z.object({ intent: z.literal('multi'), steps: steps(z.discriminatedUnion('action', viewSteps(VIEWS) as [z.ZodObject, ...z.ZodObject[]]), 2) }).strict(),
] as [z.ZodObject, ...z.ZodObject[]]) }).strict();
export const MLP_OUTPUT_FORMAT = jsonSchemaFormat('ledger_plan', MlpWireSchema);
type MlpOutput = { steps: PlannerStep[] } | { clarification: string } | { rejection: string };
// The grammar cannot express different logical action kinds (transfer and transfer_all are the same kind).
function assertMixedKinds(steps: PlannerStep[]): void {
  const kinds = new Set(steps.map(step => VIEWS.find(view => view.name === step.action)!.tool.name));
  if (kinds.size < 2) throw Error(`Intent multi needs steps of different kinds; got only ${[...kinds][0]}.`);
}
/** The only wire-to-internal conversion: drop strict-mode nulls for optional fields, map each view back to its action with
 *  the view's fixed fields, and map the intent back to the internal union. */
function fromWire(raw: string, text: string): MlpOutput {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw Error(`Invalid AI plan JSON: ${raw}`); }
  const wire = (value as { result?: { intent?: unknown; steps?: unknown } } | null)?.result;
  if (Array.isArray(wire?.steps)) wire.steps = wire.steps.map(step => withoutOptionalNulls(step,
    VIEWS.find(view => view.name === (step as { action?: unknown })?.action)?.schema.shape ?? {}));
  const parsed = MlpWireSchema.safeParse(value);
  if (!parsed.success) {
    // A fully shaped response whose sole defects are zero transaction amounts is rejected with a notice. This is the
    // host refusing the model's answer, not a model ask. Never reinterpret zero as all, and never keep the other steps.
    const zeroAmounts = parsed.error.issues.every(issue => issue.code === 'too_small' && issue.minimum === 0 && !issue.inclusive
      && issue.path.at(-1) === 'amount'
      && issue.path.reduce<unknown>((node, key) => (node as Record<PropertyKey, unknown>)?.[key], value) === 0);
    if (zeroAmounts) {
      if (wire?.intent === 'multi') assertMixedKinds(wire.steps as PlannerStep[]);
      const chinese = /[\u3400-\u9fff]/.test(text);
      const kinds = new Set(parsed.error.issues.map(issue => VIEWS.find(view => view.name === (wire!.steps as PlannerStep[])[issue.path[2] as number].action)!.tool.name));
      const subject = chinese ? [...kinds].map(kind => kind === 'transfer' ? '转账' : '消费').join('和')
        : kinds.size > 1 ? 'Transfers and expenses need' : kinds.has('transfer') ? 'A transfer needs' : 'An expense needs';
      return { rejection: chinese ? `${subject}需要提供数字金额。请在请求里写明金额后重新生成预览。`
        : `${subject} a numeric amount. Add the amount to your request and generate a new preview.` };
    }
    throw parsed.error;
  }
  const result = parsed.data.result as { intent: string; clarification?: string; steps?: PlannerStep[] };
  if (result.intent === 'ask') return { clarification: result.clarification! };
  if (result.intent === 'multi') assertMixedKinds(result.steps!);
  result.steps = result.steps?.map(({ action, ...fields }) => { const view = VIEWS.find(item => item.name === action)!; return { action: view.tool.name, ...fields, ...view.fixed }; });
  return { steps: result.steps! };
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
  // The grammar enforces syntax; instructions and examples teach ledger semantics and view selection.
  const intents = request.tools.map(tool => `${tool.plannerIntent}=${tool.plannerViews.map(view => view.name).join('/')}`).join(', ');
  const instructions = `ledger：提取中英文记账动作。读完整请求再选intent：${intents}；不同种类混合用multi，同类多笔仍用该intent。
先看accounts：已有账户只使用，简称唯一匹配后返回全名，绝不开重复账户。未列出的账户附初始资金/欠款表示开户；卡/品牌/欠款为LIABILITY，欠款负数。开户默认ASSET/USD/0，不是消费。
已发生的消费选spend；还款从资产转入卡。全部/剩余选transfer_all，不填amount、不算余额。
必须逐项输出所有操作并保持顺序，新账户先创建再使用。缺必填信息才ask，已有金额不要再问，不能用0代表未知。否定/假设/只咨询/闲聊用ask，礼貌请求仍执行。保留名称大小写数字空格；回复与用户同语言。Today ${today}.
Examples:
accounts有Nori: "Nori paid 17 for tea" → spend: expense(Nori,17)
"Add my UnionPay, debt 260" → create: create_account(UnionPay,LIABILITY,-260)
"New Vela: 80; Vela buys food 7; empty Vela into Nori" → multi: create_account(Vela,80),expense(Vela,7),transfer_all(Vela,Nori)
"Drain Fir into Elm" → {"result":{"intent":"transfer","steps":[{"action":"transfer_all","from":"Fir","to":"Elm","fromCurrency":null,"toCurrency":null,"memo":null}]}}
"Move money from Fir to Elm" → {"result":{"intent":"ask","clarification":"How much?"}}
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
  try { output = fromWire(raw, text); }
  catch (cause) { throw new MlpError('format', cause instanceof Error ? cause.message : String(cause), raw); }
  signal?.throwIfAborted();
  if ('clarification' in output) return { steps: [], actions: [], clarification: output.clarification };
  if ('rejection' in output) return { steps: [], actions: [], rejection: output.rejection };
  try { return normalizeMlp(output.steps, eligible, today, text); }
  catch (cause) { throw new MlpError('validation', cause instanceof Error ? cause.message : String(cause), output); }
}
/** Explicit user edits use the same schemas; only model extraction is grounded in source text. */
export function normalizeMlp(actions: unknown, accounts: MlpAccount[], today = localToday(), text?: string): MlpPlan {
  const eligible = accounts.filter(account => account.type === AccountType.ASSET || account.type === AccountType.LIABILITY);
  const source = text === undefined ? '' : normalizeName(text);
  // Latin letters and digits need a word boundary, so a short id such as MR is not found inside another word;
  // CJK text has no word spaces and matches as a substring.
  const within = (haystack: string, wanted: string) => {
    for (let at = haystack.indexOf(wanted); wanted && at >= 0; at = haystack.indexOf(wanted, at + 1))
      if (!/[a-z0-9]/.test(haystack[at - 1] ?? '') && !/[a-z0-9]/.test(haystack[at + wanted.length] ?? '')) return true;
    return false;
  };
  const states = (spelling: string) => within(source, normalizeName(spelling));
  // Drop unstated optional prose before mapping, so review and save never see an invented value. User edits keep theirs.
  const selected = z.array(MlpActionSchema).max(MLP_LIMITS.steps).parse(actions).map(action => text === undefined ? action : Object.fromEntries(Object.entries(action).flatMap(([key, value]) => {
    const spellings = typeof value === 'string' ? STATED_FIELDS[key]?.(value) : undefined;
    if (!spellings || spellings.some(states)) return [[key, value]];
    return (ACTION_REGISTRY[action.action].extractionSchema.shape as Record<string, z.ZodType>)[key].safeParse(null).success ? [[key, null]] : [];
  })) as MlpAction);
  const numbers = new Set(((text ?? '').match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map(number => Math.abs(Number(number.replaceAll(',', '')))));
  const available = [...eligible]; const steps: MlpStep[] = [];
  // An existing account may be named by part of its name ("chase" for "chase checking"), if only that account has the part.
  const parts = (name: string) => { const whole = normalizeName(name), found = new Set<string>();
    for (let start = 0; start < whole.length; start++) for (let end = start + 2; end <= whole.length; end++) {
      const part = whole.slice(start, end).trim(); if (part.length >= 2 && within(whole, part)) found.add(part); }
    return [...found]; };
  const owners = (part: string) => available.filter(account => within(normalizeName(account.name), part));
  const canonical = (name: unknown, currency?: unknown) => {
    if (typeof name !== 'string' || available.some(account => normalizeName(account.name) === normalizeName(name))) return name;
    const matches = owners(normalizeName(name)).filter(account => !currency || account.currency === currency);
    return matches.length === 1 ? matches[0].name : name;
  };
  for (const [index, given] of selected.entries()) {
    const action = { ...given } as MlpAction & Record<string, unknown>;
    for (const [key, currency] of [['account', 'currency'], ['from', 'fromCurrency'], ['to', 'toCurrency']] as const)
      if (key in action) action[key] = canonical(action[key], action[currency]);
    selected[index] = action;
    const tool = ACTION_REGISTRY[action.action];
    const reason = tool.availability(available, steps.some(step => step.name === 'create_account'));
    if (reason) throw Error(reason);
    const grounded = (name: string) => { if (text !== undefined && !source.includes(normalizeName(name))) throw Error(`Account name must remain verbatim: ${name}`); };
    // An existing account is grounded by its name or by a part of it that no other account has.
    const mentioned = (name: string) => { if (text !== undefined && !source.includes(normalizeName(name)) && !parts(name).some(part => within(source, part) && owners(part).length === 1)) throw Error(`Account name must remain verbatim: ${name}`); };
    const { action: name, ...value } = action;
    const arguments_ = tool.map(value, {
      today,
      money(value) { if (text !== undefined && value !== 0 && !numbers.has(Math.abs(value))) throw Error('The extracted amount was not provided in the request. Use numeric amounts.'); return value; },
      resolve(name, currency?: CurrencyId) {
        const matches = available.filter(account => normalizeName(account.name) === normalizeName(name) && (!currency || account.currency === currency));
        mentioned(name);
        if (matches.length !== 1) throw Error(matches.length || owners(normalizeName(name)).length > 1 ? `Several accounts match ${name}; use a unique account name.` : `Account not found: ${name}. Create it explicitly first.`);
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
