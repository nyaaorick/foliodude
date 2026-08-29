'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import type { CreateAccountInput, Account } from '@/lib/types/accounts';
import {
  AIRLINE_PROGRAM_IDS,
  getAirlineProgramDefinition,
} from '@/lib/types/mileage';
import { getCloudRewardRuleSet } from '@/lib/data/cloud-rules';
import { getDefaultMileageTransferRates } from '@/lib/data/mileage-transfer-rates';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';
import {
  roundMoneyDecimal,
  roundSharesDecimal,
} from '@/lib/utils/financial-analytics';
import { buildShareAccountName } from '@/lib/utils/share-account-name';
import { buyShare } from '@/lib/actions/share-actions';

const CreateAccountSchema = z.object({
  name: z.string().trim().optional(),
  type: z.nativeEnum(AccountType),
  balance: z.number().finite(),
  currency: z.enum(Object.keys(SUPPORTED_CURRENCIES) as [CurrencyId, ...CurrencyId[]]),
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

type CreateAccountData = z.infer<typeof CreateAccountSchema>;
type SupabaseClient = Awaited<ReturnType<typeof requireSessionContext>>['supabase'];

type CreateAccountContext = {
  supabase: SupabaseClient;
  userId: string;
};

type CommonCreateAccountValues = {
  initialShares: Decimal;
  initialPrice: Decimal;
  initialFee: Decimal;
  shouldDeductFromBrokerage: boolean;
  shouldInitializePosition: boolean;
};

type BrokerageAccountRecord = {
  id: string;
  type: AccountType;
  currency: string;
  name: string;
  balance: number | null;
};

type ShareAccountInput = CreateAccountData & {
  type: AccountType.SHARE;
  ticker: string;
  brokerage_account_id: string;
};

function getNormalizedCreateAccountValues(
  input: CreateAccountData,
): CommonCreateAccountValues {
  const initialShares = roundSharesDecimal(input.initial_shares ?? 0);
  const initialPrice = new Decimal(input.initial_price ?? 0);
  const initialFee = roundMoneyDecimal(input.initial_fee ?? 0);

  return {
    initialShares,
    initialPrice,
    initialFee,
    shouldDeductFromBrokerage: Boolean(input.deduct_from_brokerage),
    shouldInitializePosition: initialShares.gt(0),
  };
}

async function getAuthorizedCreateAccountContext(): Promise<CreateAccountContext> {
  const { supabase, userId } = await requireSessionContext();
  return { supabase, userId };
}

function parseCreateAccountInput(input: CreateAccountInput): CreateAccountData {
  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  return parsed.data;
}

function requireAccountName(input: CreateAccountData): string {
  const accountName = input.name?.trim() ?? '';
  if (!accountName) {
    throw new Error('Name is required');
  }

  return accountName;
}

function requireShareAccountInput(input: CreateAccountData): ShareAccountInput {
  const ticker = input.ticker?.trim().toUpperCase() ?? '';
  if (!ticker) {
    throw new Error('Ticker is required for share accounts');
  }

  const brokerageAccountId = input.brokerage_account_id?.trim() ?? '';
  if (!brokerageAccountId) {
    throw new Error('Brokerage cash account is required for share accounts');
  }

  return {
    ...input,
    type: AccountType.SHARE,
    ticker,
    brokerage_account_id: brokerageAccountId,
  };
}

async function loadBrokerageCashAccount(
  context: CreateAccountContext,
  brokerageAccountId: string,
): Promise<BrokerageAccountRecord> {
  const { data: brokerageAccount, error: brokerageError } = await context.supabase
    .from('accounts')
    .select('id, type, currency, name, balance')
    .eq('id', brokerageAccountId)
    .eq('user_id', context.userId)
    .single();

  if (brokerageError || !brokerageAccount) {
    throw new Error(brokerageError?.message ?? 'Brokerage cash account not found');
  }

  if (brokerageAccount.type !== AccountType.ASSET) {
    throw new Error('Brokerage cash account must be an asset account');
  }

  if (brokerageAccount.currency !== 'USD') {
    throw new Error('Brokerage cash account must use USD');
  }

  return brokerageAccount as BrokerageAccountRecord;
}

async function insertAccountOrThrow(
  context: CreateAccountContext,
  accountType: AccountType,
  payload: Record<string, unknown>,
): Promise<Account> {
  const { data, error } = await context.supabase
    .from('accounts')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (accountType === AccountType.SHARE && error.code === '23505') {
      throw new Error('This cash account already has a position for that ticker');
    }

    if (accountType === AccountType.AIRLINE_MILES && error.code === '23505') {
      throw new Error('This airline program already has a mileage account');
    }

    throw new Error(error.message);
  }

  return data as unknown as Account;
}

async function deleteCreatedAccountOrThrow(
  context: CreateAccountContext,
  accountId: string,
  message: string,
): Promise<never> {
  const { error: cleanupError } = await context.supabase
    .from('accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', context.userId);

  if (cleanupError) {
    throw new Error(
      `Initialization failed: ${message}. Cleanup also failed: ${cleanupError.message}`,
    );
  }

  throw new Error(message);
}

function revalidateCreatedAccount(accountId: string) {
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
}

async function createAssetAccount(
  context: CreateAccountContext,
  input: CreateAccountData,
): Promise<Account> {
  const accountName = requireAccountName(input);
  const account = await insertAccountOrThrow(context, AccountType.ASSET, {
    user_id: context.userId,
    name: accountName,
    type: AccountType.ASSET,
    currency: input.currency,
    balance: input.balance,
    credit_limit: null,
    reward_currency: null,
    reward_rules: [],
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    brokerage: input.brokerage?.trim() || null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
  });

  revalidatePath('/accounts');
  return account;
}

async function createLiabilityAccount(
  context: CreateAccountContext,
  input: CreateAccountData,
): Promise<Account> {
  const accountName = requireAccountName(input);
  const hasRewardCurrency = (input.reward_currency ?? null) !== null;
  let rewardRules: Record<string, unknown>[] = [];

  if (hasRewardCurrency) {
    const defaultLiabilityRuleSet = getCloudRewardRuleSet('amex-gold-core');
    if (!defaultLiabilityRuleSet) {
      throw new Error('Default liability cloud reward rule set not found: amex-gold-core');
    }

    rewardRules = defaultLiabilityRuleSet.rules as unknown as Record<string, unknown>[];
  }
  const account = await insertAccountOrThrow(context, AccountType.LIABILITY, {
    user_id: context.userId,
    name: accountName,
    type: AccountType.LIABILITY,
    currency: input.currency,
    balance: input.balance,
    credit_limit: input.credit_limit ?? null,
    reward_currency: input.reward_currency ?? null,
    reward_rules: rewardRules,
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    brokerage: input.brokerage?.trim() || null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
  });

  revalidatePath('/accounts');
  return account;
}

async function createAirlineMilesAccount(
  context: CreateAccountContext,
  input: CreateAccountData,
): Promise<Account> {
  if (!input.airline_program) {
    throw new Error('Airline program is required for mileage accounts');
  }

  if (!Number.isInteger(input.balance) || input.balance < 0) {
    throw new Error('Mileage balance must be a non-negative integer');
  }

  const accountName =
    getAirlineProgramDefinition(input.airline_program)?.displayName ??
    input.airline_program;
  const account = await insertAccountOrThrow(context, AccountType.AIRLINE_MILES, {
    user_id: context.userId,
    name: accountName,
    type: AccountType.AIRLINE_MILES,
    currency: 'USD',
    balance: input.balance,
    credit_limit: null,
    reward_currency: null,
    reward_rules: [],
    reward_balance: 0,
    airline_program: input.airline_program,
    usd_per_10k_miles: input.usd_per_10k_miles ?? 0,
    transfer_rates: getDefaultMileageTransferRates(),
    brokerage: input.brokerage?.trim() || null,
    ticker: null,
    brokerage_account_id: null,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
  });

  revalidatePath('/accounts');
  return account;
}

async function createShareAccount(
  context: CreateAccountContext,
  input: ShareAccountInput,
  common: CommonCreateAccountValues,
): Promise<Account> {
  const brokerageAccount = await loadBrokerageCashAccount(
    context,
    input.brokerage_account_id,
  );

  if (common.shouldInitializePosition && !common.initialPrice.gt(0)) {
    throw new Error('Cost per share is required when initial shares are greater than 0');
  }

  if (common.shouldInitializePosition && common.shouldDeductFromBrokerage) {
    const totalCost = roundMoneyDecimal(
      common.initialShares.mul(common.initialPrice).plus(common.initialFee),
    );
    const brokerageCashBalance = new Decimal(brokerageAccount.balance ?? 0);

    if (brokerageCashBalance.lt(totalCost)) {
      throw new Error('Insufficient cash balance');
    }
  }

  const accountName = buildShareAccountName(input.ticker, brokerageAccount.name);
  const createdAccount = await insertAccountOrThrow(context, AccountType.SHARE, {
    user_id: context.userId,
    name: accountName,
    type: AccountType.SHARE,
    currency: 'USD',
    balance: 0,
    credit_limit: null,
    reward_currency: null,
    reward_rules: [],
    reward_balance: 0,
    airline_program: null,
    usd_per_10k_miles: 0,
    transfer_rates: {},
    brokerage: input.brokerage?.trim() || null,
    ticker: input.ticker,
    brokerage_account_id: input.brokerage_account_id,
    shares: 0,
    cost_basis: 0,
    last_price: null,
    last_price_at: null,
  });

  if (!common.shouldInitializePosition) {
    revalidateCreatedAccount(createdAccount.id);
    return createdAccount;
  }

  if (common.shouldDeductFromBrokerage) {
    const buyResult = await buyShare({
      shareAccountId: createdAccount.id,
      brokerageAccountId: input.brokerage_account_id,
      quantity: common.initialShares.toNumber(),
      price: common.initialPrice.toNumber(),
      fee: common.initialFee.toNumber(),
      memo: 'Initial position',
    });

    if (!buyResult.success) {
      await deleteCreatedAccountOrThrow(context, createdAccount.id, buyResult.error);
    }

    const { data: refreshedAccount, error: refreshError } = await context.supabase
      .from('accounts')
      .select('*')
      .eq('id', createdAccount.id)
      .eq('user_id', context.userId)
      .single();

    if (refreshError || !refreshedAccount) {
      throw new Error(refreshError?.message ?? 'Failed to load created share account');
    }

    revalidateCreatedAccount(createdAccount.id);
    return refreshedAccount as unknown as Account;
  }

  const initializedAt = new Date().toISOString();
  const costBasis = roundMoneyDecimal(
    common.initialShares.mul(common.initialPrice).plus(common.initialFee),
  );
  const balance = roundMoneyDecimal(common.initialShares.mul(common.initialPrice));
  const { data: initializedAccount, error: initError } = await context.supabase
    .from('accounts')
    .update({
      shares: common.initialShares.toNumber(),
      cost_basis: costBasis.toNumber(),
      last_price: common.initialPrice.toNumber(),
      last_price_at: initializedAt,
      balance: balance.toNumber(),
    })
    .eq('id', createdAccount.id)
    .eq('user_id', context.userId)
    .select()
    .single();

  if (initError || !initializedAccount) {
    await deleteCreatedAccountOrThrow(
      context,
      createdAccount.id,
      initError?.message ?? 'Failed to initialize share position',
    );
  }

  revalidateCreatedAccount(createdAccount.id);
  return initializedAccount as unknown as Account;
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<Account> {
  const context = await getAuthorizedCreateAccountContext();
  const parsed = parseCreateAccountInput(input);
  const common = getNormalizedCreateAccountValues(parsed);

  switch (parsed.type) {
    case AccountType.SHARE:
      return createShareAccount(context, requireShareAccountInput(parsed), common);
    case AccountType.AIRLINE_MILES:
      return createAirlineMilesAccount(context, parsed);
    case AccountType.LIABILITY:
      return createLiabilityAccount(context, parsed);
    case AccountType.ASSET:
    default:
      return createAssetAccount(context, parsed);
  }
}
