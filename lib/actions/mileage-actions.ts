import Decimal from 'decimal.js';
import { z } from 'zod';
import { createTransactionWithinTransaction } from '@/lib/actions/createTransaction';
import {
  getDefaultMileageTransferRates,
  getMileageTransferRate,
  normalizeMileageTransferRates,
} from '@/lib/data/mileage-transfer-rates';
import { getSessionContext } from '@/lib/db/session';
import type { Queryable } from '@/lib/db/session';
import { one, rows } from '@/lib/db/sql';
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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

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
  date: z.string().date(),
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
  date: z.string().date(),
});

const RedeemMileageFlightSchema = z.object({
  mileageAccountId: z.string().uuid(),
  ticketName: z.string().trim().min(1),
  miles: z.number().int().positive(),
  taxAccountId: z.string().uuid(),
  taxAmount: z.number().finite().gt(0),
  taxCurrency: z.string().trim().min(1),
  date: z.string().date(),
});

type UpdateMileageRateInput = z.infer<typeof UpdateMileageRateSchema>;
type UpdateMileageTransferRatesInput = z.infer<typeof UpdateMileageTransferRatesSchema>;
type CreateMileageManualInInput = z.infer<typeof CreateMileageManualInSchema>;
type TransferRewardsToMileageAccountInput = z.infer<typeof TransferRewardsToMileageAccountSchema>;
type RedeemMileageFlightInput = z.infer<typeof RedeemMileageFlightSchema>;

interface MileageAccountRow {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  airline_program: AirlineProgram | null;
  transfer_rates: unknown;
}

interface SourceAccountRow {
  id: string;
  name: string;
  type: AccountType;
  reward_currency: RewardCurrencyId | null;
  reward_balance: number;
}

interface TaxAccountRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
}

function parseInput<T>(schema: z.ZodSchema<T>, input: unknown): ActionResult<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  return { success: true, data: parsed.data };
}

function validateTransferRates(rates: MileageTransferRateMap): string | null {
  for (const [key, value] of Object.entries(rates)) {
    if (!isRewardCurrencyId(key)) return `Unsupported reward currency: ${key}`;
    if (!Number.isInteger(value) || value < 0) {
      return `Transfer rate for ${key} must be a non-negative integer`;
    }
  }
  return null;
}

async function loadMileageAccount(
  db: Queryable,
  userId: string,
  accountId: string,
  invalidTypeError: string,
): Promise<ActionResult<MileageAccountRow>> {
  try {
    const account = await one<MileageAccountRow>(
      db,
      'SELECT id, name, type, balance, airline_program, transfer_rates FROM accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId],
      'Mileage account not found',
    );
    if (account.type !== AccountType.AIRLINE_MILES) {
      return { success: false, error: invalidTypeError };
    }
    return { success: true, data: account };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateMileageRate(
  input: UpdateMileageRateInput,
): Promise<ActionResult<UpdateMileageRateInput>> {
  const { db, userId } = await getSessionContext();
  const parsed = parseInput(UpdateMileageRateSchema, input);
  if (!parsed.success) return parsed;

  const mileageAccount = await loadMileageAccount(
    db,
    userId,
    parsed.data.accountId,
    'Mileage rates are only supported on airline mileage accounts',
  );
  if (!mileageAccount.success) return mileageAccount;

  await db.query('UPDATE accounts SET usd_per_10k_miles = $1 WHERE id = $2 AND user_id = $3', [
    parsed.data.usdPer10kMiles,
    parsed.data.accountId,
    userId,
  ]);

  return { success: true, data: parsed.data };
}

export async function updateMileageTransferRates(
  input: UpdateMileageTransferRatesInput,
): Promise<ActionResult<UpdateMileageTransferRatesInput>> {
  const { db, userId } = await getSessionContext();
  const parsed = parseInput(UpdateMileageTransferRatesSchema, input);
  if (!parsed.success) return parsed;

  const mergedRates: MileageTransferRateMap = { ...getDefaultMileageTransferRates() };
  for (const [key, value] of Object.entries(parsed.data.rates)) {
    if (!isRewardCurrencyId(key)) {
      return { success: false, error: `Unsupported reward currency: ${key}` };
    }
    mergedRates[key] = value;
  }

  const transferRates = normalizeMileageTransferRates(mergedRates);
  const validationError = validateTransferRates(transferRates);
  if (validationError) return { success: false, error: validationError };

  const mileageAccount = await loadMileageAccount(
    db,
    userId,
    parsed.data.accountId,
    'Transfer rates are only supported on airline mileage accounts',
  );
  if (!mileageAccount.success) return mileageAccount;

  await db.query('UPDATE accounts SET transfer_rates = $1::jsonb WHERE id = $2 AND user_id = $3', [
    JSON.stringify(transferRates),
    parsed.data.accountId,
    userId,
  ]);

  return { success: true, data: { accountId: parsed.data.accountId, rates: transferRates } };
}

/** Record miles credited outside the app (e.g. a hotel/dining partner bonus). */
export async function createMileageManualIn(
  input: CreateMileageManualInInput,
): Promise<{ transaction: Transaction }> {
  const { db, userId } = await getSessionContext();
  const parsed = parseInput(CreateMileageManualInSchema, input);
  if (!parsed.success) throw new Error(parsed.error);

  return db.transaction(async (tx) => {
    const mileageAccount = await loadMileageAccount(
      tx,
      userId,
      parsed.data.accountId,
      'Manual mileage transfers are only supported on airline mileage accounts',
    );
    if (!mileageAccount.success) throw new Error(mileageAccount.error);

    const metadata: MileageManualInMetadata = {
      source_description: parsed.data.sourceDescription.trim(),
    };

    const transaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions (user_id, type, amount, metadata, to_account, transaction_date)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        userId,
        TransactionType.MILEAGE_MANUAL_IN,
        parsed.data.miles,
        JSON.stringify(metadata),
        parsed.data.accountId,
        parsed.data.date,
      ],
      'Failed to create mileage transaction',
    );

    await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
      parsed.data.miles,
      parsed.data.accountId,
      userId,
    ]);

    return { transaction };
  });
}

/**
 * Redeem reward points from up to 3 liability accounts into miles on one
 * airline account. All must share a reward currency (the mileage account's
 * transfer rate is per-currency, not per-source-account).
 */
export async function transferRewardsToMileageAccount(
  input: TransferRewardsToMileageAccountInput,
): Promise<ActionResult<{ transaction: Transaction; transferredMiles: number }>> {
  const { db, userId } = await getSessionContext();
  const parsed = parseInput(TransferRewardsToMileageAccountSchema, input);
  if (!parsed.success) return parsed;

  return db.transaction(async (tx) => {
    const normalizedMemo = parsed.data.memo?.trim() || null;
    const mileageAccount = await loadMileageAccount(
      tx,
      userId,
      parsed.data.mileageAccountId,
      'Target account must be an airline mileage account',
    );
    if (!mileageAccount.success) return mileageAccount;

    if (
      !mileageAccount.data.airline_program ||
      !AIRLINE_PROGRAM_IDS.includes(mileageAccount.data.airline_program)
    ) {
      return { success: false, error: 'Mileage account airline program is invalid' };
    }

    const sourceIds = parsed.data.sources.map((source) => source.accountId);
    const sourceRows = await rows<SourceAccountRow>(
      tx,
      'SELECT id, name, type, reward_currency, reward_balance FROM accounts WHERE user_id = $1 AND id = ANY($2)',
      [userId, sourceIds],
    );
    if (sourceRows.length !== sourceIds.length) {
      return { success: false, error: 'One or more source accounts were not found' };
    }

    const sourceLookup = new Map(sourceRows.map((account) => [account.id, account]));
    let transferRewardCurrency: RewardCurrencyId | null = null;

    for (const source of parsed.data.sources) {
      const account = sourceLookup.get(source.accountId)!;
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
    const totalSourcePoints = parsed.data.sources.reduce((sum, source) => sum + source.points, 0);
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
      ratio_snapshot: { reward_currency: transferRewardCurrency, miles_per_point: rate },
      sources: parsed.data.sources.map((source) => {
        const account = sourceLookup.get(source.accountId)!;
        return {
          account_id: account.id,
          account_name_snapshot: account.name,
          points_deducted: source.points,
        };
      }),
    };

    const mileageTransaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions (user_id, type, amount, metadata, to_account, memo, transaction_date)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        TransactionType.MILEAGE_TRANSFER_IN,
        transferredMiles,
        JSON.stringify(metadata),
        parsed.data.mileageAccountId,
        normalizedMemo,
        parsed.data.date,
      ],
      'Failed to create mileage transfer',
    );

    for (const source of parsed.data.sources) {
      const account = sourceLookup.get(source.accountId)!;
      const nextRewardBalance = new Decimal(account.reward_balance ?? 0).minus(source.points).toNumber();

      await one(
        tx,
        `INSERT INTO transactions
           (user_id, type, amount, reward_currency, reference_transaction_id, from_account, memo, transaction_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          userId,
          TransactionType.REWARD_REDEEM,
          source.points,
          transferRewardCurrency,
          mileageTransaction.id,
          source.accountId,
          normalizedMemo ?? `Transfer to ${mileageAccount.data.name}`,
          parsed.data.date,
        ],
        'Failed to record reward redemption',
      );

      await tx.query('UPDATE accounts SET reward_balance = $1 WHERE id = $2 AND user_id = $3', [
        nextRewardBalance,
        source.accountId,
        userId,
      ]);
    }

    await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
      transferredMiles,
      parsed.data.mileageAccountId,
      userId,
    ]);

    return { success: true, data: { transaction: mileageTransaction, transferredMiles } };
  });
}

/**
 * Redeem miles for a flight. The taxes/fees are logged as a normal expense
 * (via `createTransactionWithinTransaction`, sharing this transaction) on a
 * liability account, so both the mileage debit and the tax charge commit
 * together or not at all.
 */
export async function redeemMileageFlight(
  input: RedeemMileageFlightInput,
): Promise<ActionResult<{ mileageTransaction: Transaction; expenseId: string }>> {
  const { db, userId } = await getSessionContext();
  const parsed = parseInput(RedeemMileageFlightSchema, input);
  if (!parsed.success) return parsed;

  return db.transaction(async (tx) => {
    const mileageAccount = await loadMileageAccount(
      tx,
      userId,
      parsed.data.mileageAccountId,
      'Selected account is not an airline mileage account',
    );
    if (!mileageAccount.success) return mileageAccount;

    if (new Decimal(mileageAccount.data.balance).lt(parsed.data.miles)) {
      return { success: false, error: 'Insufficient mileage balance' };
    }

    let taxAccount: TaxAccountRow;
    try {
      taxAccount = await one<TaxAccountRow>(
        tx,
        'SELECT id, name, type, currency FROM accounts WHERE id = $1 AND user_id = $2',
        [parsed.data.taxAccountId, userId],
        'Tax payment account not found',
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (taxAccount.type !== AccountType.LIABILITY) {
      return { success: false, error: 'Tax payment account must be a liability account' };
    }
    if (taxAccount.currency !== parsed.data.taxCurrency) {
      return { success: false, error: 'Tax currency must match the selected payment account' };
    }

    const taxAmount = normalizeMoneyAmount(parsed.data.taxAmount);
    let expenseResult: Awaited<ReturnType<typeof createTransactionWithinTransaction>>;
    try {
      expenseResult = await createTransactionWithinTransaction(tx, userId, {
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

    const metadata: MileageRedeemFlightMetadata = {
      ticket_name: parsed.data.ticketName,
      tax_amount: taxAmount,
      tax_currency: parsed.data.taxCurrency,
      tax_account_id: taxAccount.id,
      tax_account_name_snapshot: taxAccount.name,
      tax_expense_transaction_id: expenseResult.expense_id,
    };

    const mileageTransaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions (user_id, type, amount, metadata, from_account, transaction_date)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        userId,
        TransactionType.MILEAGE_REDEEM_FLIGHT,
        parsed.data.miles,
        JSON.stringify(metadata),
        parsed.data.mileageAccountId,
        parsed.data.date,
      ],
      'Failed to record mileage redemption',
    );

    await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3', [
      parsed.data.miles,
      parsed.data.mileageAccountId,
      userId,
    ]);

    return {
      success: true,
      data: { mileageTransaction, expenseId: expenseResult.expense_id },
    };
  });
}
