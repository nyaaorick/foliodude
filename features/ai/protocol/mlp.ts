import { z } from 'zod';
import type { Tx } from '@/lib/db/tx';
import { localToday } from '@/lib/utils/local-date';
import { AccountType, type CurrencyId } from '@/lib/types/accounts';
import { generateAiText } from '@/features/ai/providers/text-client';
import { ACTION_REGISTRY, normalizeName, type MlpAccount, type MlpActionName, type MlpActionResult } from '@/features/ai/protocol/action-registry';
export { ACTION_REGISTRY } from '@/features/ai/protocol/action-registry';

export const MLP_LIMITS = Object.freeze({ steps: 8, candidates: 8, candidateChars: 320, instructionChars: 2000, inputChars: 4000 });
export interface MlpMeasurement { steps: number; actions: MlpActionName[]; candidates: number; excludedAccounts: number; instructionChars: number; inputChars: number }
const observers = new Set<(measurement: MlpMeasurement) => void>();
export function observeMlp(observer: (measurement: MlpMeasurement) => void) { observers.add(observer); return () => { observers.delete(observer); }; }
export interface MlpStep { name: MlpActionName; arguments: Record<string, unknown>; resultAlias?: string }
export interface MlpPlan { steps: MlpStep[]; actions: MlpAction[]; clarification?: string }
export type MlpAction = z.infer<typeof MlpActionSchema>;

export const MlpActionSchema = z.discriminatedUnion('action', [
  ACTION_REGISTRY.create_account.extractionSchema.extend({ action: z.literal(ACTION_REGISTRY.create_account.name) }),
  ACTION_REGISTRY.expense.extractionSchema.extend({ action: z.literal(ACTION_REGISTRY.expense.name) }),
  ACTION_REGISTRY.transfer.extractionSchema.extend({ action: z.literal(ACTION_REGISTRY.transfer.name) }),
]);
export class MlpError extends Error {
  constructor(public readonly stage: 'format' | 'validation', message: string, public readonly output?: unknown) { super(message); }
}
function parse(raw: string): unknown {
  const text = raw.replace(/^\s*<think>\s*<\/think>\s*/, '').trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  try { return JSON.parse(fenced ? fenced[1] : text); }
  catch { throw Error(`Invalid AI plan JSON: ${raw}`); }
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
  const specs = request.tools.map(tool => `${tool.name}: ${tool.description}; ${Object.entries(tool.extractionSchema.shape).map(([key, schema]) => `${key}: ${schema.description}`).join('; ')}`);
  const instructions = `Extract Chinese/English ledger actions. Output one JSON object with only a steps array of flat actions. No Markdown or explanations. No action: {"steps":[]}. Missing required information: {"clarification":"short question"}. Never combine steps and clarification.
Execute only explicit requests or reported spending. Negation, questions, hypotheticals, greetings: no action. Include ALL steps in order; resolve pronouns. Never create an existing account to spend/transfer.
Copy exact names, casing, digits and spaces; exclude generic account/账户 suffixes. A category alone can be the account name.
Opening defaults ASSET/USD/0. Credit cards, charge cards, owed money: LIABILITY with negative balance. Initial balance is not a transaction.
Transfer amount="all" means remaining balance after prior steps. Do not guess money. Missing amount/source/destination: clarify. Cross-currency needs explicit targetAmount. Amounts/balances are JSON numbers, never strings. Omit unknown optional fields, no null. Today ${today}.
Examples: {"steps":[{"action":"create_account","name":"Maple"}]}; {"steps":[{"action":"transfer","from":"Pocket","to":"Savings","amount":"all"}]}.
Fields:
${specs.join('\n')}
JSON only. Stop after the closing brace.`;
  if (instructions.length > MLP_LIMITS.instructionChars) throw Error('MLP instructions exceed the context budget. Split the request.');
  return instructions;
}
/** One Responses call performs semantic understanding and extraction together. */
export async function prepareMlp(text: string, accounts: MlpAccount[], signal?: AbortSignal, today = localToday()): Promise<MlpPlan> {
  signal?.throwIfAborted();
  const eligible = accounts.filter(account => account.type === AccountType.ASSET || account.type === AccountType.LIABILITY);
  const request = context(text, eligible);
  const instructions = compile(request, today);
  const input = JSON.stringify({ accounts: request.candidates.map(({ name, type, currency }) => ({ name, type, currency })), request: text }) + '\nReturn only the JSON object. No Markdown or explanation.';
  for (const observer of observers) observer({ steps: 0, actions: request.tools.map(tool => tool.name), candidates: request.candidates.length,
    excludedAccounts: eligible.length - request.candidates.length, instructionChars: instructions.length, inputChars: input.length });
  const raw = await generateAiText(instructions, input, signal);
  let output: { steps: MlpAction[] } | { clarification: string };
  try { output = z.union([z.object({ steps: z.array(MlpActionSchema).max(MLP_LIMITS.steps) }).strict(), z.object({ clarification: z.string().trim().min(1) }).strict()]).parse(parse(raw)); }
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
