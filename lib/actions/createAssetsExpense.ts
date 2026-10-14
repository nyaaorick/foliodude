import { z } from 'zod';
import type { Tx } from '@/lib/db/tx';
import { getSessionContext } from '@/lib/db/session';
import { adjustBalance, insertTransaction, loadAccount, normalizeMemo } from '@/lib/db/ledger';

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
  currency: string;
  type: AccountType;
}

/** Spend from a plain asset account. No rewards are earned; see createTransaction. */
export async function createAssetsExpenseWithinTransaction(
  tx: Tx,
  input: CreateAssetsExpenseInput,
): Promise<CreateAssetsExpenseResult> {
  const parsed = CreateAssetsExpenseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid expense input');
  }

  const { accountId, amount: rawAmount, memo, date } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);

  const account = await loadAccount<AssetAccountRow>(
    tx,
    accountId,
    'currency, type',
  );

  if (account.type !== AccountType.ASSET) {
    throw new Error('Account must be an asset account');
  }

  const expense = await insertTransaction(tx, {
    type: TransactionType.EXPENSE,
    amount,
    currency: account.currency,
    from_account: accountId,
    category: 'Other',
    memo: normalizeMemo(memo),
    transaction_date: date,
  });

  await adjustBalance(tx, accountId, -amount);

  return { expense_id: expense.id, reward_id: null, reward_points: 0 };
}

export async function createAssetsExpense(input: CreateAssetsExpenseInput): Promise<CreateAssetsExpenseResult> {
  const { db } = await getSessionContext();
  return db.transaction((tx) => createAssetsExpenseWithinTransaction(tx, input));
}
