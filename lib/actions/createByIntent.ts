import { z } from 'zod';
import { createAccount } from '@/lib/actions/create-accounts-actions';
import { createAssetsExpense } from '@/lib/actions/createAssetsExpense';
import { getAccounts } from '@/lib/actions/account-read-actions';
import { createTransaction } from '@/lib/actions/createTransaction';
import { createTransfer } from '@/lib/actions/createTransfer';
import { getSessionContext } from '@/lib/db/session';
import { getLlmConfig, type LlmConfig } from '@/lib/db/settings';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
import {
  AccountType,
  SUPPORTED_CURRENCIES,
  type CurrencyId,
} from '@/lib/types/accounts';
import { AIRLINE_PROGRAM_IDS } from '@/lib/types/mileage';
import { localToday } from '@/lib/utils/local-date';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';

// No shipped credential (PLAN.md §1 / §7): the endpoint, model and key all come
// from the user's own `llm` entry (Lab page -> lib/db/settings.ts). Any
// OpenAI-compatible /chat/completions API works.

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
  ticker: z.string().trim().optional(),
  brokerage_account_id: z.string().uuid().optional(),
  initial_shares: z.number().finite().min(0).optional(),
  initial_price: z.number().finite().min(0).optional(),
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

const ChatCompletionResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
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

type CreateIntent = (typeof CREATE_INTENTS)[number];
type CreateByIntentMetadata = z.infer<typeof CreateByIntentMetadataSchema>;
type CreateByIntentInput = z.infer<typeof CreateByIntentInputSchema>;
export type CreateByIntentFromTextInput = z.infer<typeof CreateByIntentFromTextInputSchema>;

type CreateByIntentPayloadMap = {
  create_account: z.infer<typeof CreateAccountPayloadSchema>;
  create_assets_expense: z.infer<typeof CreateAssetsExpensePayloadSchema>;
  create_expense: z.infer<typeof CreateExpensePayloadSchema>;
  create_transfer: z.infer<typeof CreateTransferPayloadSchema>;
};

type CreateByIntentDataMap = {
  create_account: Awaited<ReturnType<typeof createAccount>>;
  create_assets_expense: Awaited<ReturnType<typeof createAssetsExpense>>;
  create_expense: Awaited<ReturnType<typeof createTransaction>>;
  create_transfer: Awaited<ReturnType<typeof createTransfer>>;
};

type CreateByIntentEntityMap = {
  create_account: 'account';
  create_assets_expense: 'transaction';
  create_expense: 'transaction';
  create_transfer: 'transaction';
};

type CreateByIntentResult<TIntent extends CreateIntent = CreateIntent> = {
  intent: TIntent;
  entity: CreateByIntentEntityMap[TIntent];
  entityId: string;
  data: CreateByIntentDataMap[TIntent];
  traceId: string | null;
};

type CreateByIntentRunResult<TIntent extends CreateIntent = CreateIntent> =
  CreateByIntentResult<TIntent> & {
    steps: CreateByIntentResult[];
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

/** One JSON-mode call to an OpenAI-compatible `/chat/completions` endpoint. */
async function generateJsonText(input: {
  config: LlmConfig;
  systemInstruction: string;
  userPrompt: string;
}): Promise<string> {
  const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify({
      model: input.config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemInstruction },
        { role: 'user', content: input.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with ${response.status}: ${await response.text()}`);
  }

  return ChatCompletionResponseSchema.parse(await response.json()).choices[0].message.content.trim();
}

async function generateTextPlan(input: {
  text: string;
  config: LlmConfig;
  accounts: AiAccountCandidate[];
  todayDate: string;
}): Promise<TextPlannerOutput> {
  const responseText = await generateJsonText({
    config: input.config,
    systemInstruction: 'You are a deterministic finance text step planner. Respond with a single JSON object.',
    userPrompt: buildTextPlannerPrompt({
      accounts: input.accounts,
      userInput: input.text,
      todayDate: input.todayDate,
    }),
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

async function createByIntent(
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
  const { db } = await getSessionContext();
  const config = await getLlmConfig(db);
  if (!config) {
    throw new Error(
      'No LLM configured. Add an OpenAI-compatible base URL, model and API key on the Lab page.',
    );
  }

  const accounts = await getAccounts();
  const aiAccounts = buildAiAccountCandidates(accounts, AI_ACCOUNT_TYPES);
  const plan = await generateTextPlan({
    text,
    config,
    accounts: aiAccounts,
    todayDate: localToday(),
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
    source: 'llm-text',
  });

  return buildRunResult<AiTextIntent>(steps);
}
