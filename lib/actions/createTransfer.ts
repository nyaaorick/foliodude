import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { one, rows } from '@/lib/db/sql';
import { normalizeMemo, updateAccount } from '@/lib/db/ledger';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

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
  balance: number;
}

/** Move money between two of the user's own accounts, in one currency or two. */
export async function createTransfer(
  input: CreateTransferInput,
): Promise<{ transaction: Transaction }> {
  const { db, userId } = await getSessionContext();

  const parsed = CreateTransferSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid transfer input');
  }
  const { fromAccountId, toAccountId, amount: rawAmount, targetAmount: rawTargetAmount, memo } =
    parsed.data;
  const amountValue = new Decimal(normalizeMoneyAmount(rawAmount));

  return db.transaction(async (tx) => {
    const accounts = await rows<TransferAccount>(
      tx,
      'SELECT id, type, currency, balance FROM accounts WHERE user_id = $1 AND id = ANY($2)',
      [userId, [fromAccountId, toAccountId]],
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
    if (new Decimal(fromAccount.balance).lt(amountValue)) {
      throw new Error('Insufficient balance');
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
    // transfer is always dated today. CURRENT_DATE is a SQL literal, not a bound
    // parameter, so this stays on the connection's pinned UTC date rather than
    // going through `new Date()` and reintroducing host-timezone drift.
    const transaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions
         (user_id, type, amount, currency, metadata, from_account, to_account, memo, transaction_date)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, CURRENT_DATE)
       RETURNING *`,
      [
        userId,
        TransactionType.TRANSFER,
        amountValue.toNumber(),
        fromAccount.currency,
        JSON.stringify(metadata),
        fromAccountId,
        toAccountId,
        normalizeMemo(memo),
      ],
      'Failed to create transfer transaction',
    );

    await updateAccount(tx, userId, fromAccountId, {
      balance: new Decimal(fromAccount.balance).minus(amountValue).toNumber(),
    });
    await updateAccount(tx, userId, toAccountId, {
      balance: new Decimal(toAccount.balance).plus(targetAmountValue).toNumber(),
    });

    return { transaction };
  });
}
