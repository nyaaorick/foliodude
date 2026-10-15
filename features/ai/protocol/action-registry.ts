import { z } from 'zod';
import { createAccountWithinTransaction } from '@/lib/actions/create-accounts-actions';
import { createAssetsExpenseWithinTransaction } from '@/lib/actions/createAssetsExpense';
import { createTransactionWithinTransaction } from '@/lib/actions/createTransaction';
import { createTransferWithinTransaction } from '@/lib/actions/createTransfer';
import { one } from '@/lib/db/sql';
import type { Tx } from '@/lib/db/tx';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import { REWARD_CURRENCIES, REWARD_CURRENCY_IDS } from '@/lib/types/rewards';
import { isWritable } from '@/lib/sync/writer';

export interface MlpAccount { id: string; name: string; type: AccountType; currency: CurrencyId }
export interface MappingContext {
  today: string;
  money(value: number): number;
  resolve(name: string, currency?: CurrencyId): MlpAccount;
  create(name: string): void;
}
export interface ExecutionContext { tx: Tx; resolve(id: string): string }
const Name = z.string().trim().min(1);
const Money = z.number().finite().gt(0);
const Currency = z.enum(Object.keys(SUPPORTED_CURRENCIES) as [CurrencyId, ...CurrencyId[]]);
const Reference = z.union([z.string().uuid(), z.string().regex(/^@new\d+$/)]);
const CreationType = z.enum([AccountType.ASSET, AccountType.LIABILITY]);
const ResultSchema = z.object({
  intent: z.enum(['create_account', 'create_assets_expense', 'create_expense', 'create_transfer']),
  entity: z.enum(['account', 'transaction']), entityId: z.string().uuid(), data: z.record(z.string(), z.unknown()),
}).strict();
export type MlpActionResult = z.infer<typeof ResultSchema>;
export type MlpActionName = keyof typeof ACTION_REGISTRY;

interface ToolSpec<N extends string, E extends z.ZodObject, B extends z.ZodObject> {
  name: N; description: string;
  extractionSchema: E; inputSchema: B; outputSchema: z.ZodType<MlpActionResult>;
  /** The request-level intent label for plans made only of this action. */
  plannerIntent: string;
  /** The fields the model extracts. The rest take their defaults and stay editable in review. */
  plannerFields: readonly (keyof E['shape'] & string)[];
  availability(accounts: MlpAccount[], earlierCreation: boolean): string | null;
  normalize(value: z.infer<E>, context: MappingContext): z.infer<B>;
  execute(value: z.infer<B>, context: ExecutionContext): Promise<MlpActionResult>;
}
function tool<const N extends string, E extends z.ZodObject, B extends z.ZodObject>(spec: ToolSpec<N, E, B>) {
  return Object.freeze({ ...spec,
    plannerSchema: z.object(Object.fromEntries(spec.plannerFields.map(key => [key, spec.extractionSchema.shape[key] as z.ZodType]))).strict(),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }),
    risk: 'ledger-write' as const, undoSupported: false,
    availability(accounts: MlpAccount[], earlierCreation: boolean) {
      return isWritable() ? spec.availability(accounts, earlierCreation) : 'This device is read-only. Promote it in Sync before creating entries.';
    },
    map(value: unknown, context: MappingContext) { return spec.inputSchema.parse(spec.normalize(spec.extractionSchema.parse(value), context)); },
    async call(value: unknown, context: ExecutionContext) {
      return spec.outputSchema.parse(await spec.execute(spec.inputSchema.parse(value), context));
    },
  });
}
const creation = tool({
  name: 'create_account', description: 'open an account; initial state only',
  extractionSchema: z.object({ name: Name.describe('literal name'),
    type: CreationType.default(AccountType.ASSET).describe('LIABILITY for cards or owed money, else ASSET'),
    currency: Currency.default('USD').describe('currency if stated (USD default)'),
    balance: z.number().finite().default(0).describe('starting balance (0 default)'),
    credit_limit: z.number().finite().nonnegative().default(0).describe('credit limit if stated (0 default)'),
    reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable().default(null).describe('reward program if stated') }).strict(),
  plannerIntent: 'create', plannerFields: ['name', 'type', 'currency', 'balance', 'credit_limit', 'reward_currency'],
  inputSchema: z.object({ name: Name, type: CreationType, currency: Currency, balance: z.number().finite(),
    credit_limit: z.number().finite().nonnegative(), reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable() }).strict(),
  outputSchema: ResultSchema.extend({ intent: z.literal('create_account'), entity: z.literal('account'), data: z.looseObject({ id: z.string().uuid(), name: Name, type: CreationType, currency: Currency, balance: z.number().finite() }) }),
  availability: () => null,
  normalize(value, context) {
    context.create(value.name);
    return { ...value, balance: value.type === AccountType.LIABILITY ? -Math.abs(context.money(value.balance)) : context.money(value.balance),
      credit_limit: context.money(value.credit_limit) };
  },
  async execute(value, { tx }) {
    // Recheck uniqueness after inference, inside the writing transaction.
    const accounts = (await tx.query<{ name: string }>('SELECT name FROM accounts')).rows;
    if (accounts.some(account => normalizeName(account.name) === normalizeName(value.name))) throw Error(`Account already exists: ${value.name}`);
    const data = await createAccountWithinTransaction(tx, value);
    return { intent: 'create_account', entity: 'account', entityId: data.id, data: { ...data } };
  },
});
const expense = tool({
  name: 'expense', description: 'record spending',
  extractionSchema: z.object({ account: Name.describe('literal account name'), amount: Money.describe('amount spent'),
    currency: Currency.optional().describe('account currency if stated'), date: z.string().date().optional().describe('YYYY-MM-DD if stated'),
    memo: z.string().optional().describe('note if stated'), category: z.enum(EXPENSE_CATEGORIES).optional().describe('spending category if clear') }).strict(),
  plannerIntent: 'spend', plannerFields: ['account', 'amount', 'currency', 'memo'],
  inputSchema: z.object({ accountId: Reference, expectedType: CreationType, expectedCurrency: Currency, amount: Money,
    category: z.enum(EXPENSE_CATEGORIES), memo: z.string().optional(), date: z.string().date() }).strict(),
  outputSchema: ResultSchema.extend({ intent: z.enum(['create_assets_expense', 'create_expense']), entity: z.literal('transaction'), data: z.looseObject({ expense_id: z.string().uuid(), reward_id: z.string().uuid().nullable(), reward_points: z.number().finite() }) }),
  availability: (accounts, earlierCreation) => accounts.length || earlierCreation ? null : 'Account not found: no cash or liability accounts. Create one explicitly first.',
  normalize(value, context) {
    const account = context.resolve(value.account, value.currency);
    return { accountId: account.id, expectedType: CreationType.parse(account.type), expectedCurrency: account.currency,
      amount: context.money(value.amount), date: value.date ?? context.today, memo: value.memo,
      category: value.category ?? 'Other' };
  },
  async execute(value, { tx, resolve }) {
    const accountId = z.string().uuid().parse(resolve(value.accountId));
    const account = await one<{ type: AccountType; currency: CurrencyId }>(tx, 'SELECT type,currency FROM accounts WHERE id=$1', [accountId], 'Account not found');
    if (account.type !== value.expectedType || account.currency !== value.expectedCurrency) throw Error('Account changed during extraction. Try again.');
    const { expectedType: _, expectedCurrency: __, ...payload } = value;
    const asset = account.type === AccountType.ASSET;
    const data = asset ? await createAssetsExpenseWithinTransaction(tx, { ...payload, accountId }) : await createTransactionWithinTransaction(tx, { ...payload, accountId });
    return { intent: asset ? 'create_assets_expense' : 'create_expense', entity: 'transaction', entityId: data.expense_id, data: { ...data } };
  },
});
const transfer = tool({
  name: 'transfer', description: 'move money or repay a card',
  extractionSchema: z.object({ from: Name.describe('literal source name'), to: Name.describe('literal destination name'), amount: z.union([Money, z.literal('all')]).describe('amount sent, or "all"'),
    fromCurrency: Currency.optional().describe('source currency if stated'), toCurrency: Currency.optional().describe('destination currency if stated'),
    targetAmount: Money.optional().describe('amount received; required across currencies'), memo: z.string().optional().describe('note if stated') }).strict(),
  plannerIntent: 'transfer', plannerFields: ['from', 'to', 'amount', 'fromCurrency', 'toCurrency', 'targetAmount', 'memo'],
  inputSchema: z.object({ fromAccountId: Reference, toAccountId: Reference, amount: z.union([Money, z.literal('all')]), targetAmount: Money.optional(),
    fromCurrency: Currency, toCurrency: Currency, memo: z.string().optional() }).strict(),
  outputSchema: ResultSchema.extend({ intent: z.literal('create_transfer'), entity: z.literal('transaction'), data: z.object({ transaction: z.looseObject({ id: z.string().uuid(), amount: Money }) }) }),
  availability: (accounts, earlierCreation) => earlierCreation || accounts.some(account => account.type === AccountType.ASSET) ? null : 'Transfers must originate from an asset account.',
  normalize(value, context) {
    const from = context.resolve(value.from, value.fromCurrency), to = context.resolve(value.to, value.toCurrency);
    if (from.type !== AccountType.ASSET) throw Error('Transfers must originate from an asset account.');
    if (from.id === to.id) throw Error('Source and destination accounts must be different');
    if (from.currency !== to.currency && value.targetAmount === undefined) throw Error('Cross-currency transfers require an explicit target amount.');
    return { fromAccountId: from.id, toAccountId: to.id, amount: value.amount === 'all' ? 'all' as const : context.money(value.amount),
      fromCurrency: from.currency, toCurrency: to.currency,
      targetAmount: value.targetAmount === undefined ? undefined : context.money(value.targetAmount), memo: value.memo };
  },
  async execute(value, { tx, resolve }) {
    const fromAccountId = z.string().uuid().parse(resolve(value.fromAccountId)), toAccountId = z.string().uuid().parse(resolve(value.toAccountId));
    const accounts = (await tx.query<{ id: string; currency: CurrencyId; balance: number }>('SELECT id,currency,balance FROM accounts WHERE id=ANY($1) FOR UPDATE', [[fromAccountId, toAccountId]])).rows;
    if (accounts.find(a => a.id === fromAccountId)?.currency !== value.fromCurrency || accounts.find(a => a.id === toAccountId)?.currency !== value.toCurrency) throw Error('Account changed during extraction. Try again.');
    const amount = value.amount === 'all' ? accounts.find(a => a.id === fromAccountId)!.balance : value.amount;
    if (value.amount === 'all' && amount <= 0) throw Error('No transferable balance in the source account.');
    const { fromCurrency: _, toCurrency: __, ...payload } = value;
    const data = await createTransferWithinTransaction(tx, { ...payload, amount, fromAccountId, toAccountId });
    return { intent: 'create_transfer', entity: 'transaction', entityId: data.transaction.id, data: { ...data } };
  },
});
/** Optional extracted fields the request must state verbatim (any listed spelling); the model invents them otherwise. */
export const STATED_FIELDS: Partial<Record<string, (value: string) => string[]>> = {
  memo: value => [value],
  reward_currency: value => [value, ...REWARD_CURRENCIES.filter(item => item.id === value).map(item => item.displayName)],
};
export const normalizeName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** The sole action directory. MLP calls it directly; a future MCP view can reuse it. */
export const ACTION_REGISTRY = Object.freeze({ create_account: creation, expense, transfer });
