'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const CreateAssetsExpenseSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().finite().gt(0, 'Amount must be greater than 0'),
  memo: z.string().optional(),
  date: z.string().datetime(),
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

export async function createAssetsExpense(
  input: CreateAssetsExpenseInput,
): Promise<CreateAssetsExpenseResult> {
  const { supabase, userId } = await requireSessionContext();

  const parsed = CreateAssetsExpenseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const { accountId, amount: rawAmount, memo, date } = parsed.data;
  const amount = normalizeMoneyAmount(rawAmount);

  const { data: accountRow, error: accountError } = await supabase
    .from('accounts')
    .select('balance, currency, type')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (accountError || !accountRow) {
    throw new Error(accountError?.message ?? 'Account not found');
  }

  const account = accountRow as AssetAccountRow;

  if (account.type !== AccountType.ASSET) {
    throw new Error('Account must be an asset account');
  }

  const normalizedMemo = memo?.trim() ? memo.trim() : null;
  const nextBalance = new Decimal(account.balance).minus(amount).toNumber();

  const { data: expenseRow, error: expenseError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: TransactionType.EXPENSE,
      amount,
      currency: account.currency,
      reward_currency: null,
      metadata: {},
      reference_transaction_id: null,
      from_account: accountId,
      to_account: null,
      category: 'Other',
      memo: normalizedMemo,
      transaction_at: date,
    })
    .select('id')
    .single();

  if (expenseError || !expenseRow) {
    throw new Error(expenseError?.message ?? 'Failed to create asset expense transaction');
  }

  const { error: balanceError } = await supabase
    .from('accounts')
    .update({ balance: nextBalance })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (balanceError) {
    throw new Error(balanceError.message);
  }

  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);

  return {
    expense_id: expenseRow.id,
    reward_id: null,
    reward_points: 0,
  };
}
