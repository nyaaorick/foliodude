import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { insertTransaction, loadAccount, normalizeMemo, updateAccount } from '@/lib/db/ledger';

import { AccountType } from '@/lib/types/accounts';
import { TransactionType } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const CreateAssetsExpenseSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().finite().gt(0, 'Amount must be greater than 0'),
  memo: z.string().optional(),
  date: z.string().date(),
});

type CreateAssetsExpenseInput = z.infer<typeof CreateAssetsExpenseSchema>;

interface CreateAssetsExpenseResult {
  expense_id: string;
  reward_id: null;
  reward_points: 0;
}

interface AssetAccountRow {
  balance: number;
  currency: string;
  type: AccountType;
}

/** Spend from a plain asset account. No rewards are earned; see createTransaction. */
export async function createAssetsExpense(
  input: CreateAssetsExpenseInput,
): Promise<CreateAssetsExpenseResult> {
  const { db, userId } = await getSessionContext();

  const parsed = CreateAssetsExpenseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid expense input');
  }

  const { accountId, amount: rawAmount, memo, date } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);

  return db.transaction(async (tx) => {
    const account = await loadAccount<AssetAccountRow>(
      tx,
      userId,
      accountId,
      'balance, currency, type',
    );

    if (account.type !== AccountType.ASSET) {
      throw new Error('Account must be an asset account');
    }

    const expenseId = await insertTransaction(tx, userId, {
      type: TransactionType.EXPENSE,
      amount,
      currency: account.currency,
      from_account: accountId,
      category: 'Other',
      memo: normalizeMemo(memo),
      transaction_date: date,
    });

    await updateAccount(tx, userId, accountId, {
      balance: new Decimal(account.balance).minus(amount).toNumber(),
    });

    return { expense_id: expenseId, reward_id: null, reward_points: 0 };
  });
}
