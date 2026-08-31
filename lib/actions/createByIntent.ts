'use server';

import { z } from 'zod';
import { createAccount } from '@/lib/actions/create-accounts-actions';
import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';
import { getAccounts } from '@/lib/actions/account-read-actions';
import { createTransaction } from '@/lib/actions/createTransaction';
import { createTransfer } from '@/lib/actions/createTransfer';
import { getSessionContext } from '@/lib/db/session';
import { getApiKey } from '@/lib/db/settings';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
import {
  AccountType,
  SUPPORTED_CURRENCIES,
  type CurrencyId,
} from '@/lib/types/accounts';
import { AIRLINE_PROGRAM_IDS } from '@/lib/types/mileage';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';

// No shipped credential (PLAN.md §1 / §7): the caller supplies a key from
// Settings, sourced via lib/db/settings.ts's `apikey:gemini` row.
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash';
const GEMINI_TEXT_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`;
const GEMINI_IMAGE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

const CREATE_INTENTS = [
  'create_account',
  'create_assets_expense',
  'create_expense',
  'create_transfer',
] as const;

const AI_STEP_INTENTS = [
  'create_account',
  'create_assets_expense',
  'create_expense',
  'create_transfer',
] as const;

const AI_ACCOUNT_TYPES = [
  AccountType.ASSET,
  AccountType.LIABILITY,
] as const;
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const currencyIds = Object.keys(SUPPORTED_CURRENCIES) as [
  CurrencyId,
  ...CurrencyId[],
];
const DateOnlySchema = z.string().regex(
  DATE_ONLY_REGEX,
  'Date must be in YYYY-MM-DD format',
);

const CreateByIntentMetadataSchema = z.object({
  traceId: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
}).optional();

const CreateAccountPayloadSchema = z.object({
  name: z.string().trim().optional(),
  type: z.nativeEnum(AccountType),
  balance: z.number().finite(),
  currency: z.enum(currencyIds),
  credit_limit: z.number().finite().optional(),
  reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable().optional(),
  airline_program: z.enum(AIRLINE_PROGRAM_IDS).optional(),
  usd_per_10k_miles: z.number().int().nonnegative().optional(),
  brokerage: z.string().trim().optional(),
  ticker: z.string().trim().optional(),
  brokerage_account_id: z.string().uuid().optional(),
  initial_shares: z.number().finite().min(0).optional(),
  initial_price: z.number().finite().min(0).optional(),
  initial_fee: z.number().finite().min(0).optional(),
  deduct_from_brokerage: z.boolean().optional(),
});

const CreateExpensePayloadSchema = z.object({
  accountId: z.string().uuid(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().finite().gt(0),
  memo: z.string().optional(),
  date: z.string().date(),
});

const CreateAssetsExpensePayloadSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().finite().gt(0),
  memo: z.string().optional(),
  date: z.string().date(),
});

const CreateTransferPayloadSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: z.number().finite().gt(0),
    targetAmount: z.number().finite().gt(0).optional(),
    memo: z.string().optional(),
  })
  .refine((input) => input.fromAccountId !== input.toAccountId, {
    message: 'Source and destination accounts must be different',
    path: ['toAccountId'],
  });

const CreateByIntentInputSchema = z.object({
  intent: z.enum(CREATE_INTENTS),
  payload: z.unknown(),
  metadata: CreateByIntentMetadataSchema,
});

const CreateByIntentFromTextInputSchema = z.object({
  text: z.string().trim().min(1),
  traceId: z.string().trim().min(1).optional(),
});

const CreateByIntentFromImageInputSchema = z.object({
  imageBase64: z.string().trim().min(1),
  mimeType: z.string().trim().regex(/^image\/[A-Za-z0-9.+-]+$/),
  text: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
});

const AiAccountCandidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  type: z.enum(AI_ACCOUNT_TYPES),
  currency: z.enum(currencyIds),
});

const AiCreateAccountPayloadSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(AI_ACCOUNT_TYPES).default(AccountType.ASSET),
  currency: z.enum(currencyIds).default('USD'),
  balance: z.number().finite().default(0),
  credit_limit: z.number().finite().default(0),
  reward_currency: z.enum(REWARD_CURRENCY_IDS).nullable().default(null),
});

const GeminiGenerateContentResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
      }).passthrough()).min(1),
    }),
  })).min(1),
});

const OptionalTrimmedNonEmptyStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

const AiVisionVisibleFieldsSchema = z.object({
  account_label_seen: OptionalTrimmedNonEmptyStringSchema,
  card_program_label: OptionalTrimmedNonEmptyStringSchema,
  merchant: OptionalTrimmedNonEmptyStringSchema,
  amount: z.number().finite().gt(0).optional(),
  currency: OptionalTrimmedNonEmptyStringSchema,
  transaction_date: DateOnlySchema.optional(),
  status: OptionalTrimmedNonEmptyStringSchema,
  reference_id: OptionalTrimmedNonEmptyStringSchema,
  location: OptionalTrimmedNonEmptyStringSchema,
  installment_details: OptionalTrimmedNonEmptyStringSchema,
  pending: z.boolean().optional(),
  transaction_count: z.number().int().positive().optional(),
}).passthrough();

const AiVisionOcrResultSchema = z.object({
  raw_text: z.string().default(''),
  visible_fields: AiVisionVisibleFieldsSchema,
  normalized_english_text: z.string().trim().min(1),
  user_instruction: OptionalTrimmedNonEmptyStringSchema,
  conflict_notes: OptionalTrimmedNonEmptyStringSchema,
});

const ResultAliasSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const AliasReferenceSchema = z.string().regex(/^@[A-Za-z][A-Za-z0-9_-]*$/);
const UuidOrAliasReferenceSchema = z.union([
  z.string().uuid(),
  AliasReferenceSchema,
]);

const StepPlanCreateExpensePayloadSchema = z.object({
  accountId: UuidOrAliasReferenceSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().finite().gt(0),
  memo: z.string().trim().min(1).optional(),
  date: DateOnlySchema,
});

const StepPlanCreateAssetsExpensePayloadSchema = z.object({
  accountId: UuidOrAliasReferenceSchema,
  amount: z.number().finite().gt(0),
  memo: z.string().trim().min(1).optional(),
  date: DateOnlySchema,
});

const StepPlanCreateTransferPayloadSchema = z
  .object({
    fromAccountId: UuidOrAliasReferenceSchema,
    toAccountId: UuidOrAliasReferenceSchema,
    amount: z.number().finite().gt(0),
    targetAmount: z.number().finite().gt(0).optional(),
    memo: z.string().optional(),
  })
  .refine((input) => input.fromAccountId !== input.toAccountId, {
    message: 'Source and destination accounts must be different',
    path: ['toAccountId'],
  });

export type CreateIntent = (typeof CREATE_INTENTS)[number];
export type CreateByIntentMetadata = z.infer<typeof CreateByIntentMetadataSchema>;
export type CreateByIntentInput = z.infer<typeof CreateByIntentInputSchema>;
export type CreateByIntentFromTextInput = z.infer<typeof CreateByIntentFromTextInputSchema>;
export type CreateByIntentFromImageInput = z.infer<typeof CreateByIntentFromImageInputSchema>;

export type CreateByIntentPayloadMap = {
  create_account: z.infer<typeof CreateAccountPayloadSchema>;
  create_assets_expense: z.infer<typeof CreateAssetsExpensePayloadSchema>;
  create_expense: z.infer<typeof CreateExpensePayloadSchema>;
  create_transfer: z.infer<typeof CreateTransferPayloadSchema>;
};

export type CreateByIntentDataMap = {
  create_account: Awaited<ReturnType<typeof createAccount>>;
  create_assets_expense: Awaited<ReturnType<typeof createAssetsExpense>>;
  create_expense: Awaited<ReturnType<typeof createTransaction>>;
  create_transfer: Awaited<ReturnType<typeof createTransfer>>;
};

export type CreateByIntentEntityMap = {
  create_account: 'account';
  create_assets_expense: 'transaction';
  create_expense: 'transaction';
  create_transfer: 'transaction';
};

export type CreateByIntentResult<TIntent extends CreateIntent = CreateIntent> = {
  intent: TIntent;
  entity: CreateByIntentEntityMap[TIntent];
  entityId: string;
  data: CreateByIntentDataMap[TIntent];
  traceId: string | null;
};

export type CreateByIntentRunResult<TIntent extends CreateIntent = CreateIntent> =
  CreateByIntentResult<TIntent> & {
    steps: CreateByIntentResult[];
  };

export type CreateByIntentFromImageResult = {
  steps: CreateByIntentResult[];
  ocrText: string;
  normalizedText: string;
  userInstruction: string | null;
  conflictNotes: string | null;
  noAction: 'ignore_transaction' | 'no_action' | null;
  noActionReason: string | null;
  traceId: string | null;
};

type AiTextIntent =
  | 'create_account'
  | 'create_assets_expense'
  | 'create_expense'
  | 'create_transfer';
export type CreateByIntentFromTextResult =
  | CreateByIntentRunResult<AiTextIntent>
  | {
      noAction: 'unexecutable';
      reply: string;
      traceId: string | null;
    };
type AiAccountCandidate = z.infer<typeof AiAccountCandidateSchema>;
type StepIntent = (typeof AI_STEP_INTENTS)[number];
type StepResult = CreateByIntentResult<StepIntent>;

function getDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<'year' | 'month' | 'day', string>;

  return `${values.year}-${values.month}-${values.day}`;
}

function getShanghaiTodayDate() {
  return getDateInTimeZone(new Date(), SHANGHAI_TIME_ZONE);
}

function normalizeImageOcrResult(input: {
  ocr: z.infer<typeof AiVisionOcrResultSchema>;
  fallbackDate: string;
}) {
  const transactionDate = input.ocr.visible_fields.transaction_date ?? input.fallbackDate;
  const normalizedCurrency = input.ocr.visible_fields.currency
    ? input.ocr.visible_fields.currency.trim().toUpperCase() === 'CNY'
      ? 'CNH'
      : input.ocr.visible_fields.currency.trim().toUpperCase()
    : undefined;
  const normalizedLines = input.ocr.normalized_english_text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^transaction_date:/i.test(line))
    .filter((line) => !/^currency:/i.test(line));

  if (normalizedCurrency) {
    normalizedLines.push(`currency: ${normalizedCurrency}`);
  }

  normalizedLines.push(`transaction_date: ${transactionDate}`);

  return {
    ...input.ocr,
    visible_fields: {
      ...input.ocr.visible_fields,
      ...(normalizedCurrency ? { currency: normalizedCurrency } : {}),
      transaction_date: transactionDate,
    },
    normalized_english_text: normalizedLines.join('\n'),
    user_instruction: input.ocr.user_instruction?.trim() || undefined,
    conflict_notes: input.ocr.conflict_notes?.trim() || undefined,
  };
}

function buildResult<TIntent extends CreateIntent>(
  intent: TIntent,
  entity: CreateByIntentEntityMap[TIntent],
  entityId: string,
  data: CreateByIntentDataMap[TIntent],
  traceId: string | null,
): CreateByIntentResult<TIntent> {
  return {
    intent,
    entity,
    entityId,
    data,
    traceId,
  };
}

function isAliasReference(value: string) {
  return value.startsWith('@');
}

function createStepPlanSchema(accounts: AiAccountCandidate[]) {
  const assetAccountIds = new Set(
    accounts
      .filter((account) => account.type === AccountType.ASSET)
      .map((account) => account.id),
  );
  const liabilityAccountIds = new Set(
    accounts
      .filter((account) => account.type === AccountType.LIABILITY)
      .map((account) => account.id),
  );

  const StepPlanStepSchema = z.discriminatedUnion('intent', [
    z.object({
      intent: z.literal('create_account'),
      resultAlias: ResultAliasSchema.optional(),
      payload: AiCreateAccountPayloadSchema,
    }).strict(),
    z.object({
      intent: z.literal('create_transfer'),
      payload: StepPlanCreateTransferPayloadSchema
        .refine(
          (payload) =>
            isAliasReference(payload.fromAccountId) ||
            assetAccountIds.has(payload.fromAccountId),
          {
            message: 'fromAccountId must match a provided asset account or alias',
            path: ['fromAccountId'],
          },
        )
        .refine(
          (payload) =>
            isAliasReference(payload.toAccountId) ||
            assetAccountIds.has(payload.toAccountId) ||
            liabilityAccountIds.has(payload.toAccountId),
          {
            message: 'toAccountId must match a provided account or alias',
            path: ['toAccountId'],
          },
        ),
    }).strict(),
    z.object({
      intent: z.literal('create_assets_expense'),
      payload: StepPlanCreateAssetsExpensePayloadSchema
        .refine(
          (payload) =>
            isAliasReference(payload.accountId) ||
            assetAccountIds.has(payload.accountId),
          {
            message: 'accountId must match a provided asset account or alias',
            path: ['accountId'],
          },
        ),
    }).strict(),
    z.object({
      intent: z.literal('create_expense'),
      payload: StepPlanCreateExpensePayloadSchema
        .refine(
          (payload) =>
            isAliasReference(payload.accountId) ||
            liabilityAccountIds.has(payload.accountId),
          {
            message: 'accountId must match a provided liability account or alias',
            path: ['accountId'],
          },
        ),
    }).strict(),
  ]);

  return z.object({
    steps: z.array(StepPlanStepSchema).min(1),
  }).superRefine((plan, ctx) => {
    const aliasTypes = new Map<string, AccountType>();

    for (const [index, step] of plan.steps.entries()) {
      if (step.intent === 'create_account' && step.resultAlias) {
        aliasTypes.set(step.resultAlias, step.payload.type);
        continue;
      }

      if (
        step.intent !== 'create_expense' &&
        step.intent !== 'create_assets_expense'
      ) {
        continue;
      }

      if (!isAliasReference(step.payload.accountId)) {
        continue;
      }

      const alias = step.payload.accountId.slice(1);
      const aliasType = aliasTypes.get(alias);

      if (!aliasType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'payload', 'accountId'],
          message: `Unknown result alias: ${alias}`,
        });
        continue;
      }

      const expectedType =
        step.intent === 'create_assets_expense'
          ? AccountType.ASSET
          : AccountType.LIABILITY;

      if (aliasType !== expectedType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'payload', 'accountId'],
          message: `Alias ${alias} must reference a ${expectedType.toLowerCase()} account`,
        });
      }
    }
  });
}

const TextNoActionSchema = z.object({
  no_action: z.literal('unexecutable'),
  reply: z.string().trim().min(1),
}).strict();

type StepPlan = z.infer<ReturnType<typeof createStepPlanSchema>>;
type PlannedStep = StepPlan['steps'][number];
type TextPlannerOutput = StepPlan | z.infer<typeof TextNoActionSchema>;

function buildTextPlannerPrompt(input: {
  accounts: AiAccountCandidate[];
  userInput: string;
  todayDate: string;
}): string {
  const envelope = JSON.stringify({
    accounts: input.accounts,
    user_input: input.userInput,
    today_date: input.todayDate,
  }, null, 2);

  return [
    'ROLE',
    'You plan one or more finance create steps from raw user text.',
    '',
    'TASK',
    'Read the input JSON and return exactly one JSON object with one or more sequential create steps,',
    'or return a no_action response when the request is not executable.',
    'The user_input may be Chinese, English, or mixed. Translate internally if needed, but do not output the translation.',
    '',
    'ALLOWED_INTENTS',
    '- create_account',
    '- create_assets_expense',
    '- create_transfer',
    '- create_expense',
    '',
    'DEFAULTS',
    '- If account type is missing, use "ASSET".',
    '- If account currency is missing, use "USD".',
    '- If balance is missing, use 0.',
    '- If credit_limit is missing for a liability account, use 0.',
    '- If reward_currency is missing for a liability account, use null.',
    '- If an expense or asset expense date is missing, use today_date.',
    '',
    'CATEGORY_SET',
    '- CATEGORY_SET applies to create_expense only.',
    `- Valid expense categories are: ${EXPENSE_CATEGORIES.join(', ')}.`,
    '- Use Dining for restaurants, cafes, food delivery, bars, and food chains.',
    '- Use Transit only for transportation, rideshare, fuel, tolls, parking, trains, buses, airlines, or metro operators.',
    '- If a purchase cannot be mapped clearly, use "Other".',
    '',
    'OUTPUT_FORMAT',
    '- Return exactly one JSON object and nothing else. No markdown, no explanations, no translated text.',
    '- Output shape for executable requests:',
    '{',
    '  "steps": [',
    '    {',
    '      "intent": "create_account" | "create_assets_expense" | "create_expense" | "create_transfer",',
    '      "resultAlias": "alias_name",',
    '      "payload": { ... }',
    '    }',
    '  ]',
    '}',
    '- Output shape for non-executable requests:',
    '{',
    '  "no_action": "unexecutable",',
    '  "reply": "string"',
    '}',
    '- reply must be a short, plain-text response in the same language as the user_input.',
    '- Use these exact field names only. Do not rename them.',
    '- create_account payload must be exactly:',
    '{',
    '  "name": "string",',
    '  "type": "ASSET" | "LIABILITY",',
    '  "currency": "USD" | "AUD" | "NZD" | "GBP" | "HKD" | "CNH",',
    '  "balance": number,',
    '  "credit_limit": number,',
    '  "reward_currency": "MR" | "UR" | "RC" | null',
    '}',
    '- create_transfer payload must be exactly:',
    '{',
    '  "fromAccountId": "uuid" | "@alias_name",',
    '  "toAccountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "targetAmount": number,',
    '  "memo": "string"',
    '}',
    '- If targetAmount or memo are unknown, omit them.',
    '- create_assets_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- If memo is unknown, omit it.',
    '- Asset expense date must be date only in YYYY-MM-DD format.',
    '- create_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    `  "category": ${EXPENSE_CATEGORIES.map((category) => `"${category}"`).join(' | ')},`,
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- If memo is unknown, omit it.',
    '- Expense date must be date only in YYYY-MM-DD format.',
    '',
    'HARD_RULES',
    '- For create_account in v1, only "ASSET" and "LIABILITY" are allowed account types.',
    '- Infer "LIABILITY" for credit cards or loans. Otherwise default to "ASSET".',
    '- For liability accounts, if the user provides an outstanding debt amount, use a negative balance.',
    '- You may return one step or multiple sequential steps.',
    '- When the user says they do not have the account yet, create the account first and assign resultAlias.',
    '- Later dependent steps may reference a prior created account using @alias_name.',
    '- Only create_account may define resultAlias in v1.',
    '- For transfers, copy exact account IDs from the provided accounts array into fromAccountId and toAccountId unless the target is a newly created @alias.',
    '- For create_assets_expense, accountId must be copied exactly from a provided ASSET account unless the target is a newly created @alias.',
    '- For create_expense, accountId must be copied exactly from a provided LIABILITY account unless the target is a newly created @alias.',
    '- Use LIABILITY for credit cards and charge cards.',
    '- Use ASSET for debit cards, bank accounts, cash wallets, or stored-value balances.',
    '- Direct spend on an ASSET account must use create_assets_expense, not create_expense.',
    '- Direct spend on a LIABILITY account must use create_expense.',
    '- A create_assets_expense alias reference must come from a prior create_account step whose type is ASSET.',
    '- A create_expense alias reference must come from a prior create_account step whose type is LIABILITY.',
    '- Never invent account IDs.',
    '- Never use alternative field names such as opening_balance, sourceAmount, sourceAccountId, or destinationAccountId.',
    '- If the request cannot be mapped to an allowed intent or is not executable, return the no_action shape.',
    '',
    'INPUT',
    envelope,
  ].join('\n');
}

function defaultNoActionReply(userInput: string) {
  const hasCjk = /[\u4E00-\u9FFF]/.test(userInput);
  return hasCjk
    ? '抱歉，我暂时无法执行这个请求。请提供更具体的金额或可执行的操作。'
    : 'Sorry, I cannot execute that request yet. Please provide a specific amount or a supported action.';
}

function buildImageOcrPrompt(input: {
  fallbackDate: string;
  userNote?: string;
}): string {
  const envelope = JSON.stringify({
    fallback_date: input.fallbackDate,
    user_note: input.userNote ?? '',
  }, null, 2);

  return [
    'ROLE',
    'You perform OCR and multimodal finance screenshot extraction.',
    '',
    'TASK',
    'Read the screenshot and optional user note, then return exactly one JSON object.',
    'Preserve visible finance facts and prepare separate planner-friendly outputs for image facts and optional user intent.',
    'The screenshot text and user note may be Chinese or English.',
    '',
    'OUTPUT_FORMAT',
    '- Return JSON only. No markdown or explanations.',
    '- Output shape:',
    '{',
    '  "raw_text": "string",',
    '  "visible_fields": {',
    '    "screen_type": "single_transaction" | "balance_overview" | "account_overview" | "other",',
    '    "account_label_seen": "string",',
    '    "card_program_label": "string",',
    '    "merchant": "string",',
    '    "amount": number,',
    '    "currency": "string",',
    '    "transaction_date": "YYYY-MM-DD",',
    '    "status": "string",',
    '    "reference_id": "string",',
    '    "location": "string",',
    '    "installment_details": "string",',
    '    "pending": boolean,',
    '    "transaction_count": number',
    '  },',
    '  "normalized_english_text": "string",',
    '  "user_instruction": "string",',
    '  "conflict_notes": "string"',
    '}',
    '',
    'HARD_RULES',
    '- If multiple transactions are visible in the screenshot, set transaction_count greater than 1.',
    '- Preserve all visible finance-related facts in raw_text and visible_fields.',
    '- normalized_english_text must be English only.',
    '- normalized_english_text must contain screenshot facts only.',
    '- normalized_english_text must use one fact per line in "key: value" style.',
    '- transaction_date must be date only in YYYY-MM-DD format.',
    '- If the screenshot is mainly a balance page, add money page, card home page, or account overview instead of a single posted transaction, set screen_type to "balance_overview" or "account_overview".',
    '- For balance/add money/account overview screens, preserve the displayed balance or stored value facts, and do not pretend they are transaction amount facts.',
    '- If a clear transaction date is visible, normalize it to YYYY-MM-DD and put it in transaction_date.',
    '- Ignore visible time of day. Do not output time.',
    '- If no clear transaction date is visible, use fallback_date as transaction_date.',
    '- Keep unknown fields out of visible_fields instead of inventing values.',
    '- If user_note contains planning-relevant intent, write one compact English line in user_instruction.',
    '- Omit user_instruction when user_note is empty or does not affect planning.',
    '- Use conflict_notes only for concise conflicts between visible image facts and user_note instructions.',
    '- Omit conflict_notes when there is no meaningful conflict.',
    '',
    'INPUT',
    envelope,
  ].join('\n');
}

function buildImagePlannerPrompt(input: {
  accounts: AiAccountCandidate[];
  normalizedText: string;
  userInstruction?: string;
  conflictNotes?: string;
}): string {
  const envelope = JSON.stringify({
    accounts: input.accounts,
    normalized_text: input.normalizedText,
    ...(input.userInstruction
      ? { user_instruction: input.userInstruction }
      : {}),
    ...(input.conflictNotes
      ? { conflict_notes: input.conflictNotes }
      : {}),
  }, null, 2);

  return [
    'ROLE',
    'You plan one or more finance create steps from normalized multimodal context.',
    '',
    'TASK',
    'Read the input JSON and return exactly one JSON object with one or more sequential create steps.',
    'The normalized_text contains only image-derived facts.',
    'The optional user_instruction contains planner-relevant intent derived from the user note.',
    'The optional conflict_notes highlight mismatches between image facts and user intent.',
    '',
    'ALLOWED_INTENTS',
    ...AI_STEP_INTENTS.map((intent) => `- ${intent}`),
    '',
    'OUTPUT_FORMAT',
    '- Return exactly one JSON object and nothing else. No markdown or explanations.',
    '- Return one of these two shapes only.',
    '- Action shape:',
    '{',
    '  "steps": [',
    '    {',
    '      "intent": "create_account" | "create_assets_expense" | "create_expense" | "create_transfer",',
    '      "resultAlias": "alias_name",',
    '      "payload": { ... }',
    '    }',
    '  ]',
    '}',
    '- No-action shape:',
    '{',
    '  "no_action": "ignore_transaction" | "no_action",',
    '  "reason": "string"',
    '}',
    '',
    'EXACT_PAYLOADS',
    '- create_account payload must be exactly:',
    '{',
    '  "name": "string",',
    '  "type": "ASSET" | "LIABILITY",',
    '  "currency": "USD" | "AUD" | "NZD" | "GBP" | "HKD" | "CNH",',
    '  "balance": number,',
    '  "credit_limit": number,',
    '  "reward_currency": "MR" | "UR" | "RC" | null',
    '}',
    '- create_assets_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- create_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    `  "category": ${EXPENSE_CATEGORIES.map((category) => `"${category}"`).join(' | ')},`,
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- create_transfer payload must be exactly:',
    '{',
    '  "fromAccountId": "uuid" | "@alias_name",',
    '  "toAccountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "targetAmount": number,',
    '  "memo": "string"',
    '}',
    '- Omit optional fields when unknown.',
    '- Expense and asset expense dates must be date only in YYYY-MM-DD format.',
    '',
    'HARD_RULES',
    '- You may return one step or multiple sequential steps.',
    '- If user_instruction says they do not have the account yet, create the account first and assign resultAlias.',
    '- Later dependent steps may reference a prior created account using @alias_name.',
    '- Only create_account may define resultAlias in v1.',
    '- Prefer LIABILITY accounts for credit card or charge card transactions when an existing liability account clearly matches.',
    '- Use ASSET for debit card, bank account, cash wallet, or stored-value balance transactions.',
    '- Direct spend on an ASSET account must use create_assets_expense.',
    '- Direct spend on a LIABILITY account must use create_expense.',
    '- A create_assets_expense alias reference must come from a prior create_account step whose type is ASSET.',
    '- A create_expense alias reference must come from a prior create_account step whose type is LIABILITY.',
    '- If no existing account matches and user_instruction requests account creation, plan create_account before downstream steps.',
    '- If screen_type indicates a balance page, add money page, stored-value card home, or account overview, do not create_expense or create_assets_expense from the displayed balance.',
    '- For those balance/account overview screens: if the screenshot clearly identifies a new card or account product, return exactly one create_account step and stop.',
    '- For those balance/account overview screens: if no clear new account can be identified, return the no-action shape.',
    '- Never return both create_account and a downstream expense step from a balance/account overview screenshot unless the image also clearly contains one explicit posted transaction.',
    '- Never invent existing account IDs.',
    '- If normalized_text includes transaction_date, copy that exact transaction_date string into the final expense or asset expense date.',
    '- Ignore time of day and do not output time.',
    '- Use Dining for restaurants, cafes, food delivery, bars, and food chains.',
    '- Use Transit only for transportation, rideshare, fuel, tolls, parking, trains, buses, airlines, or metro operators.',
    '- If the transaction status is declined, failed, reversed, refunded, cancelled, or otherwise not posted as a real charge, return the no-action shape instead of steps.',
    '- If the screenshot context is a purchase and category is unclear, use "Other".',
    '- If the request cannot be mapped to allowed intents, return invalid output instead of prose.',
    '',
    'INPUT',
    envelope,
  ].join('\n');
}

async function generateGeminiJsonText(input: {
  url: string;
  apiKey: string;
  systemInstruction: string;
  parts: Array<Record<string, unknown>>;
}): Promise<string> {
  const response = await fetch(input.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': input.apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: input.systemInstruction,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: input.parts,
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Gemini request failed with ${response.status}: ${await response.text()}`,
    );
  }

  const responseJson = GeminiGenerateContentResponseSchema.parse(await response.json());
  return responseJson.candidates[0].content.parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

async function generateTextPlan(input: {
  text: string;
  apiKey: string;
  accounts: AiAccountCandidate[];
  todayDate: string;
}): Promise<TextPlannerOutput> {
  const responseText = await generateGeminiJsonText({
    url: GEMINI_TEXT_URL,
    apiKey: input.apiKey,
    systemInstruction: 'You are a deterministic finance text step planner.',
    parts: [
      {
        text: buildTextPlannerPrompt({
          accounts: input.accounts,
          userInput: input.text,
          todayDate: input.todayDate,
        }),
      },
    ],
  });

  const actionSchema = createStepPlanSchema(input.accounts);
  const responseJson = JSON.parse(responseText);

  if (Array.isArray(responseJson?.steps) && responseJson.steps.length === 0) {
    return {
      no_action: 'unexecutable',
      reply: defaultNoActionReply(input.text),
    };
  }

  return z.union([actionSchema, TextNoActionSchema]).parse(responseJson);
}

async function generateImageOcr(input: {
  imageBase64: string;
  mimeType: string;
  apiKey: string;
  fallbackDate: string;
  userNote?: string;
}) {
  const responseText = await generateGeminiJsonText({
    url: GEMINI_IMAGE_URL,
    apiKey: input.apiKey,
    systemInstruction: 'You are a deterministic OCR and multimodal screenshot normalizer.',
    parts: [
      {
        inlineData: {
          mimeType: input.mimeType,
          data: input.imageBase64,
        },
      },
      {
        text: buildImageOcrPrompt({
          fallbackDate: input.fallbackDate,
          userNote: input.userNote,
        }),
      },
    ],
  });

  return normalizeImageOcrResult({
    ocr: AiVisionOcrResultSchema.parse(JSON.parse(responseText)),
    fallbackDate: input.fallbackDate,
  });
}

async function generateImagePlan(input: {
  normalizedText: string;
  apiKey: string;
  accounts: AiAccountCandidate[];
  userInstruction?: string;
  conflictNotes?: string;
}) {
  const responseText = await generateGeminiJsonText({
    url: GEMINI_TEXT_URL,
    apiKey: input.apiKey,
    systemInstruction: 'You are a deterministic multimodal finance step planner.',
    parts: [
      {
        text: buildImagePlannerPrompt({
          accounts: input.accounts,
          normalizedText: input.normalizedText,
          userInstruction: input.userInstruction,
          conflictNotes: input.conflictNotes,
        }),
      },
    ],
  });

  const actionSchema = createStepPlanSchema(input.accounts);
  const noActionSchema = z.object({
    no_action: z.enum(['ignore_transaction', 'no_action']),
    reason: z.string().trim().min(1).optional(),
  }).strict();

  return z.union([actionSchema, noActionSchema]).parse(JSON.parse(responseText));
}

function buildAiAccountCandidates(
  accounts: Awaited<ReturnType<typeof getAccounts>>,
  allowedTypes: readonly (typeof AI_ACCOUNT_TYPES)[number][],
) {
  const allowedTypeSet = new Set<AccountType>(allowedTypes);

  return accounts
    .filter((account) => allowedTypeSet.has(account.type))
    .map((account) => AiAccountCandidateSchema.parse({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
    }));
}

function resolveAliasReference(
  value: string,
  aliases: Map<string, string>,
) {
  if (!isAliasReference(value)) {
    return value;
  }

  const alias = value.slice(1);
  const resolved = aliases.get(alias);

  if (!resolved) {
    throw new Error(`Unknown result alias: ${alias}`);
  }

  return resolved;
}

function resolvePlannedStepPayload(
  step: PlannedStep,
  aliases: Map<string, string>,
): CreateByIntentPayloadMap[typeof step.intent] {
  switch (step.intent) {
    case 'create_account':
      return step.payload;
    case 'create_assets_expense':
    case 'create_expense':
      // step.payload.date is already a plain YYYY-MM-DD (DateOnlySchema); the
      // ledger's transaction_date column is DATE, so no timezone conversion
      // belongs here.
      return {
        ...step.payload,
        accountId: resolveAliasReference(step.payload.accountId, aliases),
      };
    case 'create_transfer':
      return {
        ...step.payload,
        fromAccountId: resolveAliasReference(step.payload.fromAccountId, aliases),
        toAccountId: resolveAliasReference(step.payload.toAccountId, aliases),
      };
  }
}

async function executePlannedSteps(input: {
  steps: PlannedStep[];
  traceId?: string;
  source: string;
}): Promise<StepResult[]> {
  const aliases = new Map<string, string>();
  const results: StepResult[] = [];

  for (const step of input.steps) {
    const resultAlias = 'resultAlias' in step ? step.resultAlias : undefined;

    if (step.intent !== 'create_account' && resultAlias) {
      throw new Error('Only create_account may define resultAlias');
    }

    const payload = resolvePlannedStepPayload(step, aliases);
    const result = await createByIntent({
      intent: step.intent,
      payload,
      metadata: {
        traceId: input.traceId,
        source: input.source,
      },
    });

    results.push(result as StepResult);

    if (resultAlias) {
      aliases.set(resultAlias, result.entityId);
    }
  }

  return results;
}

function buildRunResult<TIntent extends StepIntent>(
  steps: StepResult[],
): CreateByIntentRunResult<TIntent> {
  const lastStep = steps.at(-1);

  if (!lastStep) {
    throw new Error('Expected at least one executed step');
  }

  return {
    ...(lastStep as CreateByIntentResult<TIntent>),
    steps,
  };
}

export async function createByIntent(
  input: CreateByIntentInput,
): Promise<CreateByIntentResult> {
  const { intent, payload, metadata } = CreateByIntentInputSchema.parse(input);
  const traceId = metadata?.traceId ?? null;

  switch (intent) {
    case 'create_account': {
      const data = await createAccount(CreateAccountPayloadSchema.parse(payload));
      return buildResult(intent, 'account', data.id, data, traceId);
    }
    case 'create_assets_expense': {
      const data = await createAssetsExpense(
        CreateAssetsExpensePayloadSchema.parse(payload),
      );
      return buildResult(intent, 'transaction', data.expense_id, data, traceId);
    }
    case 'create_expense': {
      const data = await createTransaction(CreateExpensePayloadSchema.parse(payload));
      return buildResult(intent, 'transaction', data.expense_id, data, traceId);
    }
    case 'create_transfer': {
      const data = await createTransfer(CreateTransferPayloadSchema.parse(payload));
      return buildResult(intent, 'transaction', data.transaction.id, data, traceId);
    }
  }
}

export async function createByIntentFromText(
  input: CreateByIntentFromTextInput,
): Promise<CreateByIntentFromTextResult> {
  const { text, traceId } = CreateByIntentFromTextInputSchema.parse(input);
  const { db, userId } = await getSessionContext();
  const apiKey = await getApiKey(db, userId, 'gemini');
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Add one in Settings to enable AI-assisted entry.');
  }

  const accounts = await getAccounts();
  const aiAccounts = buildAiAccountCandidates(accounts, AI_ACCOUNT_TYPES);
  const plan = await generateTextPlan({
    text,
    apiKey,
    accounts: aiAccounts,
    todayDate: getShanghaiTodayDate(),
  });

  if ('no_action' in plan) {
    return {
      noAction: plan.no_action,
      reply: plan.reply,
      traceId: traceId ?? null,
    };
  }

  const steps = await executePlannedSteps({
    steps: plan.steps,
    traceId,
    source: 'gemini-text',
  });

  return buildRunResult<AiTextIntent>(steps);
}

export async function createByIntentFromImage(
  input: CreateByIntentFromImageInput,
): Promise<CreateByIntentFromImageResult> {
  const { imageBase64, mimeType, text, traceId } =
    CreateByIntentFromImageInputSchema.parse(input);
  const { db, userId } = await getSessionContext();
  const apiKey = await getApiKey(db, userId, 'gemini');
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Add one in Settings to enable AI-assisted entry.');
  }

  const accounts = await getAccounts();
  const aiAccounts = buildAiAccountCandidates(accounts, AI_ACCOUNT_TYPES);
  const fallbackDate = getShanghaiTodayDate();
  const ocrResult = await generateImageOcr({
    imageBase64,
    mimeType,
    apiKey,
    fallbackDate,
    userNote: text,
  });

  if ((ocrResult.visible_fields.transaction_count ?? 1) > 1) {
    throw new Error('Image must contain exactly one transaction');
  }

  const normalizedText = ocrResult.normalized_english_text.trim();
  const userInstruction = ocrResult.user_instruction ?? null;
  const conflictNotes = ocrResult.conflict_notes ?? null;
  const plan = await generateImagePlan({
    normalizedText,
    apiKey,
    accounts: aiAccounts,
    userInstruction: userInstruction ?? undefined,
    conflictNotes: conflictNotes ?? undefined,
  });

  if ('no_action' in plan) {
    return {
      steps: [],
      ocrText: ocrResult.raw_text,
      normalizedText,
      userInstruction,
      conflictNotes,
      noAction: plan.no_action,
      noActionReason: plan.reason ?? null,
      traceId: traceId ?? null,
    };
  }

  const steps = await executePlannedSteps({
    steps: plan.steps,
    traceId,
    source: 'gemini-image',
  });

  return {
    steps,
    ocrText: ocrResult.raw_text,
    normalizedText,
    userInstruction,
    conflictNotes,
    noAction: null,
    noActionReason: null,
    traceId: traceId ?? null,
  };
}
