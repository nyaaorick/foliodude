import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { insertTransaction, loadAccount, normalizeMemo, setBalance } from '@/lib/db/ledger';

import { AccountType } from '@/lib/types/accounts';
import { TransactionType } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const CreateAssetBalanceAdjustmentSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().finite().refine((value) => value !== 0, {
    message: 'Amount must not be 0',
  }),
  memo: z.string().optional(),
  date: z.string().date(),
});

type CreateAssetBalanceAdjustmentInput =
  z.infer<typeof CreateAssetBalanceAdjustmentSchema>;

interface AssetAccountRow {
  balance: number;
  currency: string;
  type: AccountType;
}

/**
 * Reconcile an asset account against reality.
 *
 * The signed input becomes a positive INCOME or EXPENSE row — the ledger stores
 * direction in `type` plus from/to, never as a negative amount.
 */
export async function createAssetBalanceAdjustment(
  input: CreateAssetBalanceAdjustmentInput,
): Promise<{ transaction_id: string }> {
  const { db } = await getSessionContext();

  const parsed = CreateAssetBalanceAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid adjustment input');
  }

  const { accountId, amount: rawAmount, memo, date } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);
  const isCredit = amount > 0;

  return db.transaction(async (tx) => {
    const account = await loadAccount<AssetAccountRow>(
      tx,
      accountId,
      'balance, currency, type',
    );

    if (account.type !== AccountType.ASSET) {
      throw new Error('Account must be an asset account');
    }

    const transactionId = await insertTransaction(tx, {
      type: isCredit ? TransactionType.INCOME : TransactionType.EXPENSE,
      amount: Math.abs(amount),
      currency: account.currency,
      metadata: { kind: 'asset_balance_adjustment' },
      from_account: isCredit ? null : accountId,
      to_account: isCredit ? accountId : null,
      category: 'Balance Adjustment',
      memo: normalizeMemo(memo),
      transaction_date: date,
    });

    await setBalance(tx, accountId, new Decimal(account.balance).plus(amount).toNumber());

    return { transaction_id: transactionId };
  });
}
