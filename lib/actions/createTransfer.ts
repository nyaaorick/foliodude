import { z } from 'zod';
import type { Tx } from '@/lib/db/tx';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { rows } from '@/lib/db/sql';
import { adjustBalance, insertTransaction, normalizeMemo } from '@/lib/db/ledger';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';
import { localToday } from '@/lib/utils/local-date';

const CreateTransferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: z.number().finite().gt(0),
    targetAmount: z.number().finite().gt(0).optional(),
    memo: z.string().optional(),
  })
  // Also enforced by transactions_shape_check in 001_init.sql; checked here too
  // so the caller gets this specific message instead of a generic constraint
  // violation.
  .refine((input) => input.fromAccountId !== input.toAccountId, {
    message: 'Source and destination accounts must be different',
    path: ['toAccountId'],
  });

type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

interface TransferAccount {
  id: string;
  type: AccountType;
  currency: string;
}

/** Move money between two of the user's own accounts, in one currency or two. */
export async function createTransferWithinTransaction(
  tx: Tx,
  input: CreateTransferInput,
): Promise<{ transaction: Transaction }> {

  const parsed = CreateTransferSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid transfer input');
  }
  const { fromAccountId, toAccountId, amount: rawAmount, targetAmount: rawTargetAmount, memo } =
    parsed.data;
  const amountValue = new Decimal(normalizeMoneyAmount(rawAmount));

  const accounts = await rows<TransferAccount>(
    tx,
    'SELECT id, type, currency FROM accounts WHERE id = ANY($1)',
    [[fromAccountId, toAccountId]],
  );
  const fromAccount = accounts.find((account) => account.id === fromAccountId);
  const toAccount = accounts.find((account) => account.id === toAccountId);

  if (!fromAccount || !toAccount) {
    throw new Error('One or more accounts were not found');
  }
  if (fromAccount.type !== AccountType.ASSET) {
    throw new Error('Source account must be an asset account');
  }
  if (toAccount.type !== AccountType.ASSET && toAccount.type !== AccountType.LIABILITY) {
    throw new Error('Destination account must be an asset or liability account');
  }

  const isCrossCurrency = fromAccount.currency !== toAccount.currency;
  if (isCrossCurrency && !rawTargetAmount) {
    throw new Error('Target amount is required for cross-currency transfers');
  }

  const targetAmountValue = isCrossCurrency
    ? new Decimal(normalizeMoneyAmount(rawTargetAmount ?? 0))
    : amountValue;
  const metadata = isCrossCurrency
    ? {
        source_currency: fromAccount.currency,
        target_currency: toAccount.currency,
        target_amount: targetAmountValue.toNumber(),
        implied_exchange_rate: targetAmountValue.div(amountValue).toDecimalPlaces(6).toNumber(),
      }
    : {};

  // No user-supplied date field here (unlike createTransaction et al.) — a
  // transfer is always dated today, on the device's calendar.
  const transaction = await insertTransaction(tx, {
    type: TransactionType.TRANSFER,
    amount: amountValue.toNumber(),
    currency: fromAccount.currency,
    metadata,
    from_account: fromAccountId,
    to_account: toAccountId,
    memo: normalizeMemo(memo),
    transaction_date: localToday(),
  });

  await adjustBalance(tx, fromAccountId, amountValue.neg());
  await adjustBalance(tx, toAccountId, targetAmountValue);

  return { transaction };
}

export async function createTransfer(input: CreateTransferInput): Promise<{ transaction: Transaction }> {
  const { db } = await getSessionContext();
  return db.transaction((tx) => createTransferWithinTransaction(tx, input));
}
