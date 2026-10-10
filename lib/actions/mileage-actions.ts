import { z } from 'zod';
import { createTransactionWithinTransaction } from '@/lib/actions/createTransaction';
import {
  getDefaultMileageTransferRates,
  getMileageTransferRate,
  normalizeMileageTransferRates,
} from '@/lib/data/mileage-transfer-rates';
import { adjustBalance, adjustRewardBalance, insertTransaction, normalizeMemo } from '@/lib/db/ledger';
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
import { parseOrThrow, toActionResult, type ActionResult } from './result';

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
  airline_program: AirlineProgram | null;
  transfer_rates: unknown;
}

interface SourceAccountRow {
  id: string;
  name: string;
  type: AccountType;
  reward_currency: RewardCurrencyId | null;
}

interface TaxAccountRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
}

function validateTransferRates(rates: MileageTransferRateMap): void {
  for (const [key, value] of Object.entries(rates)) {
    if (!isRewardCurrencyId(key)) throw new Error(`Unsupported reward currency: ${key}`);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Transfer rate for ${key} must be a non-negative integer`);
    }
  }
}

async function loadMileageAccount(
  db: Queryable,
  accountId: string,
  invalidTypeError: string,
): Promise<MileageAccountRow> {
  const account = await one<MileageAccountRow>(
    db,
    'SELECT id, name, type, airline_program, transfer_rates FROM accounts_flat WHERE id = $1',
    [accountId],
    'Mileage account not found',
  );
  if (account.type !== AccountType.AIRLINE_MILES) throw new Error(invalidTypeError);
  return account;
}

export function updateMileageRate(
  input: UpdateMileageRateInput,
): Promise<ActionResult<UpdateMileageRateInput>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const parsed = parseOrThrow(UpdateMileageRateSchema, input);

    await loadMileageAccount(
      db,
      parsed.accountId,
      'Mileage rates are only supported on airline mileage accounts',
    );

    await db.query('UPDATE mileage_details SET usd_per_10k_miles = $1 WHERE account_id = $2', [
      parsed.usdPer10kMiles,
      parsed.accountId,
    ]);

    return parsed;
  });
}

export function updateMileageTransferRates(
  input: UpdateMileageTransferRatesInput,
): Promise<ActionResult<UpdateMileageTransferRatesInput>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const parsed = parseOrThrow(UpdateMileageTransferRatesSchema, input);

    const mergedRates: MileageTransferRateMap = { ...getDefaultMileageTransferRates() };
    for (const [key, value] of Object.entries(parsed.rates)) {
      if (!isRewardCurrencyId(key)) throw new Error(`Unsupported reward currency: ${key}`);
      mergedRates[key] = value;
    }

    const transferRates = normalizeMileageTransferRates(mergedRates);
    validateTransferRates(transferRates);

    await loadMileageAccount(
      db,
      parsed.accountId,
      'Transfer rates are only supported on airline mileage accounts',
    );

    await db.query('UPDATE mileage_details SET transfer_rates = $1::jsonb WHERE account_id = $2', [
      JSON.stringify(transferRates),
      parsed.accountId,
    ]);

    return { accountId: parsed.accountId, rates: transferRates };
  });
}

/** Record miles credited outside the app (e.g. a hotel/dining partner bonus). */
export async function createMileageManualIn(
  input: CreateMileageManualInInput,
): Promise<{ transaction: Transaction }> {
  const { db } = await getSessionContext();
  const parsed = parseOrThrow(CreateMileageManualInSchema, input);

  return db.transaction(async (tx) => {
    await loadMileageAccount(
      tx,
      parsed.accountId,
      'Manual mileage transfers are only supported on airline mileage accounts',
    );

    const metadata: MileageManualInMetadata = {
      source_description: parsed.sourceDescription.trim(),
    };

    const transaction = await insertTransaction(tx, {
      type: TransactionType.MILEAGE_MANUAL_IN,
      amount: parsed.miles,
      metadata,
      to_account: parsed.accountId,
      transaction_date: parsed.date,
    });
    await adjustBalance(tx, parsed.accountId, parsed.miles);

    return { transaction };
  });
}

/**
 * Redeem reward points from up to 3 liability accounts into miles on one
 * airline account. All must share a reward currency (the mileage account's
 * transfer rate is per-currency, not per-source-account).
 */
export function transferRewardsToMileageAccount(
  input: TransferRewardsToMileageAccountInput,
): Promise<ActionResult<{ transaction: Transaction; transferredMiles: number }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const parsed = parseOrThrow(TransferRewardsToMileageAccountSchema, input);

    return db.transaction(async (tx) => {
      const memo = normalizeMemo(parsed.memo);
      const mileageAccount = await loadMileageAccount(
        tx,
        parsed.mileageAccountId,
        'Target account must be an airline mileage account',
      );

      if (
        !mileageAccount.airline_program ||
        !AIRLINE_PROGRAM_IDS.includes(mileageAccount.airline_program)
      ) {
        throw new Error('Mileage account airline program is invalid');
      }

      const sourceIds = parsed.sources.map((source) => source.accountId);
      const sourceRows = await rows<SourceAccountRow>(
        tx,
        'SELECT id, name, type, reward_currency FROM accounts_flat WHERE id = ANY($1)',
        [sourceIds],
      );
      if (sourceRows.length !== sourceIds.length) {
        throw new Error('One or more source accounts were not found');
      }

      const sourceLookup = new Map(sourceRows.map((account) => [account.id, account]));
      let transferRewardCurrency: RewardCurrencyId | null = null;

      for (const source of parsed.sources) {
        const account = sourceLookup.get(source.accountId)!;
        if (account.type !== AccountType.LIABILITY) {
          throw new Error('Source accounts must be liability accounts');
        }
        if (!isRewardCurrencyId(account.reward_currency ?? '')) {
          throw new Error('All source accounts must have a fixed reward currency');
        }
        if (transferRewardCurrency === null) {
          transferRewardCurrency = account.reward_currency;
        } else if (transferRewardCurrency !== account.reward_currency) {
          throw new Error('All source accounts must use the same reward currency');
        }
      }
      if (!transferRewardCurrency) {
        throw new Error('Unable to determine reward currency from source accounts');
      }

      const rate = getMileageTransferRate(
        normalizeMileageTransferRates(mileageAccount.transfer_rates),
        transferRewardCurrency,
      );
      const totalSourcePoints = parsed.sources.reduce((sum, source) => sum + source.points, 0);
      const transferredMiles = totalSourcePoints * rate;

      if (transferredMiles <= 0) {
        throw new Error(
          `This airline account does not have a ${transferRewardCurrency} transfer rate configured`,
        );
      }

      const metadata: MileageTransferInMetadata = {
        reward_currency: transferRewardCurrency,
        airline_program: mileageAccount.airline_program,
        total_source_points: totalSourcePoints,
        transferred_miles: transferredMiles,
        ratio_snapshot: { reward_currency: transferRewardCurrency, miles_per_point: rate },
        sources: parsed.sources.map((source) => {
          const account = sourceLookup.get(source.accountId)!;
          return {
            account_id: account.id,
            account_name_snapshot: account.name,
            points_deducted: source.points,
          };
        }),
      };

      const mileageTransaction = await insertTransaction(tx, {
        type: TransactionType.MILEAGE_TRANSFER_IN,
        amount: transferredMiles,
        metadata,
        to_account: parsed.mileageAccountId,
        memo,
        transaction_date: parsed.date,
      });

      for (const source of parsed.sources) {
        await insertTransaction(tx, {
          type: TransactionType.REWARD_REDEEM,
          amount: source.points,
          reward_currency: transferRewardCurrency,
          reference_transaction_id: mileageTransaction.id,
          from_account: source.accountId,
          memo: memo ?? `Transfer to ${mileageAccount.name}`,
          transaction_date: parsed.date,
        });
        await adjustRewardBalance(tx, source.accountId, -source.points);
      }

      await adjustBalance(tx, parsed.mileageAccountId, transferredMiles);

      return { transaction: mileageTransaction, transferredMiles };
    });
  });
}

/**
 * Redeem miles for a flight. The taxes/fees are logged as a normal expense
 * (via `createTransactionWithinTransaction`, sharing this transaction) on a
 * liability account, so both the mileage debit and the tax charge commit
 * together or not at all.
 */
export function redeemMileageFlight(
  input: RedeemMileageFlightInput,
): Promise<ActionResult<{ mileageTransaction: Transaction; expenseId: string }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const parsed = parseOrThrow(RedeemMileageFlightSchema, input);

    return db.transaction(async (tx) => {
      await loadMileageAccount(
        tx,
        parsed.mileageAccountId,
        'Selected account is not an airline mileage account',
      );

      const taxAccount = await one<TaxAccountRow>(
        tx,
        'SELECT id, name, type, currency FROM accounts WHERE id = $1',
        [parsed.taxAccountId],
        'Tax payment account not found',
      );
      if (taxAccount.type !== AccountType.LIABILITY) {
        throw new Error('Tax payment account must be a liability account');
      }
      if (taxAccount.currency !== parsed.taxCurrency) {
        throw new Error('Tax currency must match the selected payment account');
      }

      const taxAmount = normalizeMoneyAmount(parsed.taxAmount);
      const expense = await createTransactionWithinTransaction(tx, {
        accountId: parsed.taxAccountId,
        category: 'Travel',
        amount: taxAmount,
        memo: parsed.ticketName,
        date: parsed.date,
      });

      const metadata: MileageRedeemFlightMetadata = {
        ticket_name: parsed.ticketName,
        tax_amount: taxAmount,
        tax_currency: parsed.taxCurrency,
        tax_account_id: taxAccount.id,
        tax_account_name_snapshot: taxAccount.name,
      };

      const mileageTransaction = await insertTransaction(tx, {
        type: TransactionType.MILEAGE_REDEEM_FLIGHT,
        amount: parsed.miles,
        metadata,
        from_account: parsed.mileageAccountId,
        reference_transaction_id: expense.expense_id,
        transaction_date: parsed.date,
      });
      await adjustBalance(tx, parsed.mileageAccountId, -parsed.miles);

      return { mileageTransaction, expenseId: expense.expense_id };
    });
  });
}
