'use server';

import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createTransaction } from '@/lib/actions/createTransaction';
import {
  getDefaultMileageTransferRates,
  getMileageTransferRate,
  normalizeMileageTransferRates,
} from '@/lib/data/mileage-transfer-rates';
import { getSessionContext, type RequestSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import { isRewardCurrencyId, type RewardCurrencyId } from '@/lib/types/rewards';
import {
  AIRLINE_PROGRAM_IDS,
  type AirlineProgram,
  type MileageManualInMetadata,
  type MileageRedeemFlightMetadata,
  type MileageTransferInMetadata,
  type MileageTransferRateMap,
} from '@/lib/types/mileage';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const UpdateMileageRateSchema = z.object({
  accountId: z.string().uuid(),
  usdPer10kMiles: z.number().int().nonnegative(),
});

const UpdateMileageTransferRatesSchema = z.object({
  accountId: z.string().uuid(),
  rates: z.record(z.string(), z.number().int().nonnegative()),
});

const CreateMileageManualInSchema = z.object({
  accountId: z.string().uuid(),
  miles: z.number().int().positive(),
  sourceDescription: z.string().trim().min(1),
  date: z.string().datetime(),
});

const TransferRewardSourceSchema = z.object({
  accountId: z.string().uuid(),
  points: z.number().int().positive(),
});

const TransferRewardsToMileageAccountSchema = z.object({
  mileageAccountId: z.string().uuid(),
  sources: z
    .array(TransferRewardSourceSchema)
    .min(1)
    .max(3)
    .refine(
      (sources) => new Set(sources.map((source) => source.accountId)).size === sources.length,
      { message: 'Source accounts must be unique' },
    ),
  memo: z.string().trim().optional(),
  date: z.string().datetime(),
});

const RedeemMileageFlightSchema = z.object({
  mileageAccountId: z.string().uuid(),
  ticketName: z.string().trim().min(1),
  miles: z.number().int().positive(),
  taxAccountId: z.string().uuid(),
  taxAmount: z.number().finite().gt(0),
  taxCurrency: z.string().trim().min(1),
  date: z.string().datetime(),
});

type UpdateMileageRateInput = z.infer<typeof UpdateMileageRateSchema>;
type UpdateMileageTransferRatesInput = z.infer<typeof UpdateMileageTransferRatesSchema>;
type CreateMileageManualInInput = z.infer<typeof CreateMileageManualInSchema>;
type TransferRewardsToMileageAccountInput = z.infer<
  typeof TransferRewardsToMileageAccountSchema
>;
type RedeemMileageFlightInput = z.infer<typeof RedeemMileageFlightSchema>;

type MileageAccountRow = {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  airline_program: AirlineProgram | null;
  transfer_rates: unknown;
};

type SourceAccountRow = {
  id: string;
  name: string;
  type: AccountType;
  reward_currency: RewardCurrencyId | null;
  reward_balance: number;
};

type TaxAccountRow = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
};

type SupabaseServerClient = RequestSessionContext['supabase'];

async function getAuthenticatedContext() {
  return getSessionContext();
}

function parseInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
): ActionResult<T> {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  return { success: true, data: parsed.data };
}

function revalidateAccounts(...accountIds: string[]) {
  revalidatePath('/accounts');

  for (const accountId of new Set(accountIds)) {
    revalidatePath(`/accounts/${accountId}`);
  }
}

function validateTransferRates(rates: MileageTransferRateMap): string | null {
  for (const [key, value] of Object.entries(rates)) {
    if (!isRewardCurrencyId(key)) {
      return `Unsupported reward currency: ${key}`;
    }

    if (!Number.isInteger(value) || value < 0) {
      return `Transfer rate for ${key} must be a non-negative integer`;
    }
  }

  return null;
}

async function loadMileageAccount(
  supabase: SupabaseServerClient,
  userId: string,
  accountId: string,
  invalidTypeError: string,
): Promise<ActionResult<MileageAccountRow>> {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, type, balance, airline_program, transfer_rates')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Mileage account not found' };
  }

  if (data.type !== AccountType.AIRLINE_MILES) {
    return { success: false, error: invalidTypeError };
  }

  return { success: true, data: data as MileageAccountRow };
}

async function updateMileageBalance(
  supabase: SupabaseServerClient,
  userId: string,
  accountId: string,
  previousBalance: number,
  nextBalance: number,
): Promise<ActionResult<null>> {
  const { error } = await supabase
    .from('accounts')
    .update({ balance: nextBalance })
    .eq('id', accountId)
    .eq('user_id', userId)
    .eq('balance', previousBalance);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: null };
}

export async function updateMileageRate(
  input: UpdateMileageRateInput,
): Promise<ActionResult<UpdateMileageRateInput>> {
  const context = await getAuthenticatedContext();

  if (!context) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = parseInput(UpdateMileageRateSchema, input);
  if (!parsed.success) {
    return parsed;
  }

  const mileageAccount = await loadMileageAccount(
    context.supabase,
    context.userId,
    parsed.data.accountId,
    'Mileage rates are only supported on airline mileage accounts',
  );
  if (!mileageAccount.success) {
    return mileageAccount;
  }

  const { error } = await context.supabase
    .from('accounts')
    .update({ usd_per_10k_miles: parsed.data.usdPer10kMiles })
    .eq('id', parsed.data.accountId)
    .eq('user_id', context.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidateAccounts(parsed.data.accountId);
  return { success: true, data: parsed.data };
}

export async function updateMileageTransferRates(
  input: UpdateMileageTransferRatesInput,
): Promise<ActionResult<UpdateMileageTransferRatesInput>> {
  const context = await getAuthenticatedContext();

  if (!context) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = parseInput(UpdateMileageTransferRatesSchema, input);
  if (!parsed.success) {
    return parsed;
  }

  const mergedRates = { ...getDefaultMileageTransferRates() };
  for (const [key, value] of Object.entries(parsed.data.rates)) {
    if (!isRewardCurrencyId(key)) {
      return { success: false, error: `Unsupported reward currency: ${key}` };
    }

    mergedRates[key] = value;
  }

  const transferRates = normalizeMileageTransferRates(mergedRates);
  const validationError = validateTransferRates(transferRates);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const mileageAccount = await loadMileageAccount(
    context.supabase,
    context.userId,
    parsed.data.accountId,
    'Transfer rates are only supported on airline mileage accounts',
  );
  if (!mileageAccount.success) {
    return mileageAccount;
  }

  const { error } = await context.supabase
    .from('accounts')
    .update({ transfer_rates: transferRates })
    .eq('id', parsed.data.accountId)
    .eq('user_id', context.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidateAccounts(parsed.data.accountId);
  return {
    success: true,
    data: {
      accountId: parsed.data.accountId,
      rates: transferRates,
    },
  };
}

export async function createMileageManualIn(
  input: CreateMileageManualInInput,
): Promise<{ transaction: Transaction }> {
  const context = await getAuthenticatedContext();

  if (!context) {
    throw new Error('Unauthorized');
  }

  const parsed = parseInput(CreateMileageManualInSchema, input);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  const mileageAccount = await loadMileageAccount(
    context.supabase,
    context.userId,
    parsed.data.accountId,
    'Manual mileage transfers are only supported on airline mileage accounts',
  );
  if (!mileageAccount.success) {
    throw new Error(mileageAccount.error);
  }

  const metadata: MileageManualInMetadata = {
    source_description: parsed.data.sourceDescription.trim(),
  };

  const { data: transactionRow, error: insertError } = await context.supabase
    .from('transactions')
    .insert({
      user_id: context.userId,
      type: TransactionType.MILEAGE_MANUAL_IN,
      amount: parsed.data.miles,
      currency: null,
      reward_currency: null,
      metadata,
      reference_transaction_id: null,
      from_account: null,
      to_account: parsed.data.accountId,
      category: null,
      memo: null,
      transaction_at: parsed.data.date,
    })
    .select()
    .single();

  if (insertError || !transactionRow) {
    throw new Error(insertError?.message ?? 'Failed to create mileage transaction');
  }

  const balanceUpdate = await updateMileageBalance(
    context.supabase,
    context.userId,
    parsed.data.accountId,
    mileageAccount.data.balance,
    new Decimal(mileageAccount.data.balance).plus(parsed.data.miles).toNumber(),
  );
  if (!balanceUpdate.success) {
    throw new Error(balanceUpdate.error);
  }

  revalidateAccounts(parsed.data.accountId);
  return { transaction: transactionRow as unknown as Transaction };
}

export async function transferRewardsToMileageAccount(
  input: TransferRewardsToMileageAccountInput,
): Promise<ActionResult<{ transaction: Transaction; transferredMiles: number }>> {
  const context = await getAuthenticatedContext();

  if (!context) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = parseInput(TransferRewardsToMileageAccountSchema, input);
  if (!parsed.success) {
    return parsed;
  }

  const normalizedMemo = parsed.data.memo?.trim() || null;
  const mileageAccount = await loadMileageAccount(
    context.supabase,
    context.userId,
    parsed.data.mileageAccountId,
    'Target account must be an airline mileage account',
  );
  if (!mileageAccount.success) {
    return mileageAccount;
  }

  if (
    !mileageAccount.data.airline_program ||
    !AIRLINE_PROGRAM_IDS.includes(mileageAccount.data.airline_program)
  ) {
    return { success: false, error: 'Mileage account airline program is invalid' };
  }

  const sourceIds = parsed.data.sources.map((source) => source.accountId);
  const { data: sourceRows, error: sourceError } = await context.supabase
    .from('accounts')
    .select('id, name, type, reward_currency, reward_balance')
    .eq('user_id', context.userId)
    .in('id', sourceIds);

  if (sourceError) {
    return { success: false, error: sourceError.message };
  }

  if (!sourceRows || sourceRows.length !== sourceIds.length) {
    return { success: false, error: 'One or more source accounts were not found' };
  }

  const sourceLookup = new Map(
    (sourceRows as SourceAccountRow[]).map((account) => [account.id, account]),
  );
  let transferRewardCurrency: RewardCurrencyId | null = null;

  for (const source of parsed.data.sources) {
    const account = sourceLookup.get(source.accountId);
    if (!account) {
      return { success: false, error: 'One or more source accounts were not found' };
    }

    if (account.type !== AccountType.LIABILITY) {
      return { success: false, error: 'Source accounts must be liability accounts' };
    }

    if (!isRewardCurrencyId(account.reward_currency ?? '')) {
      return { success: false, error: 'All source accounts must have a fixed reward currency' };
    }

    if (transferRewardCurrency === null) {
      transferRewardCurrency = account.reward_currency;
    } else if (transferRewardCurrency !== account.reward_currency) {
      return { success: false, error: 'All source accounts must use the same reward currency' };
    }

    if (Number(account.reward_balance ?? 0) < source.points) {
      return { success: false, error: 'Insufficient reward balance' };
    }
  }

  if (!transferRewardCurrency) {
    return { success: false, error: 'Unable to determine reward currency from source accounts' };
  }

  const rate = getMileageTransferRate(
    normalizeMileageTransferRates(mileageAccount.data.transfer_rates),
    transferRewardCurrency,
  );
  const totalSourcePoints = parsed.data.sources.reduce(
    (sum, source) => sum + source.points,
    0,
  );
  const transferredMiles = totalSourcePoints * rate;

  if (transferredMiles <= 0) {
    return {
      success: false,
      error: `This airline account does not have a ${transferRewardCurrency} transfer rate configured`,
    };
  }

  const metadata: MileageTransferInMetadata = {
    reward_currency: transferRewardCurrency,
    airline_program: mileageAccount.data.airline_program,
    total_source_points: totalSourcePoints,
    transferred_miles: transferredMiles,
    ratio_snapshot: {
      reward_currency: transferRewardCurrency,
      miles_per_point: rate,
    },
    sources: parsed.data.sources.map((source) => {
      const account = sourceLookup.get(source.accountId)!;
      return {
        account_id: account.id,
        account_name_snapshot: account.name,
        points_deducted: source.points,
      };
    }),
  };

  const { data: mileageTransactionRow, error: mileageInsertError } = await context.supabase
    .from('transactions')
    .insert({
      user_id: context.userId,
      type: TransactionType.MILEAGE_TRANSFER_IN,
      amount: transferredMiles,
      currency: null,
      reward_currency: null,
      metadata,
      reference_transaction_id: null,
      from_account: null,
      to_account: parsed.data.mileageAccountId,
      category: null,
      memo: normalizedMemo,
      transaction_at: parsed.data.date,
    })
    .select()
    .single();

  if (mileageInsertError || !mileageTransactionRow) {
    return {
      success: false,
      error: mileageInsertError?.message ?? 'Failed to create mileage transfer',
    };
  }

  for (const source of parsed.data.sources) {
    const account = sourceLookup.get(source.accountId)!;
    const nextRewardBalance = new Decimal(account.reward_balance ?? 0)
      .minus(source.points)
      .toNumber();

    const { error: rewardRedeemError } = await context.supabase.from('transactions').insert({
      user_id: context.userId,
      type: TransactionType.REWARD_REDEEM,
      amount: source.points,
      currency: null,
      reward_currency: transferRewardCurrency,
      metadata: {},
      reference_transaction_id: mileageTransactionRow.id,
      from_account: source.accountId,
      to_account: null,
      category: null,
      memo: normalizedMemo ?? `Transfer to ${mileageAccount.data.name}`,
      transaction_at: parsed.data.date,
    });

    if (rewardRedeemError) {
      return { success: false, error: rewardRedeemError.message };
    }

    const { error: updateError } = await context.supabase
      .from('accounts')
      .update({ reward_balance: nextRewardBalance })
      .eq('id', source.accountId)
      .eq('user_id', context.userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }
  }

  const balanceUpdate = await updateMileageBalance(
    context.supabase,
    context.userId,
    parsed.data.mileageAccountId,
    mileageAccount.data.balance,
    new Decimal(mileageAccount.data.balance).plus(transferredMiles).toNumber(),
  );
  if (!balanceUpdate.success) {
    return balanceUpdate;
  }

  revalidateAccounts(parsed.data.mileageAccountId, ...sourceIds);
  return {
    success: true,
    data: {
      transaction: mileageTransactionRow as unknown as Transaction,
      transferredMiles,
    },
  };
}

export async function redeemMileageFlight(
  input: RedeemMileageFlightInput,
): Promise<ActionResult<{ mileageTransaction: Transaction; expenseId: string }>> {
  const context = await getAuthenticatedContext();

  if (!context) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = parseInput(RedeemMileageFlightSchema, input);
  if (!parsed.success) {
    return parsed;
  }

  const mileageAccount = await loadMileageAccount(
    context.supabase,
    context.userId,
    parsed.data.mileageAccountId,
    'Selected account is not an airline mileage account',
  );
  if (!mileageAccount.success) {
    return mileageAccount;
  }

  if (new Decimal(mileageAccount.data.balance).lt(parsed.data.miles)) {
    return { success: false, error: 'Insufficient mileage balance' };
  }

  const { data: taxAccount, error: taxAccountError } = await context.supabase
    .from('accounts')
    .select('id, name, type, currency')
    .eq('id', parsed.data.taxAccountId)
    .eq('user_id', context.userId)
    .single();

  if (taxAccountError || !taxAccount) {
    return {
      success: false,
      error: taxAccountError?.message ?? 'Tax payment account not found',
    };
  }

  if (taxAccount.type !== AccountType.LIABILITY) {
    return { success: false, error: 'Tax payment account must be a liability account' };
  }

  if ((taxAccount as TaxAccountRow).currency !== parsed.data.taxCurrency) {
    return { success: false, error: 'Tax currency must match the selected payment account' };
  }

  const taxAmount = normalizeMoneyAmount(parsed.data.taxAmount);
  let expenseResult: Awaited<ReturnType<typeof createTransaction>>;
  try {
    expenseResult = await createTransaction({
      accountId: parsed.data.taxAccountId,
      category: 'Travel',
      amount: taxAmount,
      memo: parsed.data.ticketName,
      date: parsed.data.date,
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create expense transaction',
    };
  }

  const typedTaxAccount = taxAccount as TaxAccountRow;
  const metadata: MileageRedeemFlightMetadata = {
    ticket_name: parsed.data.ticketName,
    tax_amount: taxAmount,
    tax_currency: parsed.data.taxCurrency,
    tax_account_id: typedTaxAccount.id,
    tax_account_name_snapshot: typedTaxAccount.name,
    tax_expense_transaction_id: expenseResult.expense_id,
  };

  const { data: mileageTransactionRow, error: insertError } = await context.supabase
    .from('transactions')
    .insert({
      user_id: context.userId,
      type: TransactionType.MILEAGE_REDEEM_FLIGHT,
      amount: parsed.data.miles,
      currency: null,
      reward_currency: null,
      metadata,
      reference_transaction_id: null,
      from_account: parsed.data.mileageAccountId,
      to_account: null,
      category: null,
      memo: null,
      transaction_at: parsed.data.date,
    })
    .select()
    .single();

  if (insertError || !mileageTransactionRow) {
    return {
      success: false,
      error: insertError?.message ?? 'Failed to record mileage redemption',
    };
  }

  const balanceUpdate = await updateMileageBalance(
    context.supabase,
    context.userId,
    parsed.data.mileageAccountId,
    mileageAccount.data.balance,
    new Decimal(mileageAccount.data.balance).minus(parsed.data.miles).toNumber(),
  );
  if (!balanceUpdate.success) {
    return balanceUpdate;
  }

  revalidateAccounts(parsed.data.mileageAccountId, parsed.data.taxAccountId);
  return {
    success: true,
    data: {
      mileageTransaction: mileageTransactionRow as unknown as Transaction,
      expenseId: expenseResult.expense_id,
    },
  };
}
