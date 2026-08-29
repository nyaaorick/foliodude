'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType } from '@/lib/types/transactions';
import { normalizeMoneyAmount } from '@/lib/utils/financial-analytics';

const CreateAssetBalanceAdjustmentSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().finite().refine((value) => value !== 0, {
    message: 'Amount must not be 0',
  }),
  memo: z.string().optional(),
  date: z.string().datetime(),
});

type CreateAssetBalanceAdjustmentInput =
  z.infer<typeof CreateAssetBalanceAdjustmentSchema>;

interface AssetAccountRow {
  balance: number;
  currency: string;
  type: AccountType;
}

export async function createAssetBalanceAdjustment(
  input: CreateAssetBalanceAdjustmentInput,
): Promise<{ transaction_id: string }> {
  const { supabase, userId } = await requireSessionContext();

  const parsed = CreateAssetBalanceAdjustmentSchema.safeParse(input);
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
  const transactionType = amount > 0 ? TransactionType.INCOME : TransactionType.EXPENSE;

  const { data: transactionRow, error: transactionError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: transactionType,
      amount: Math.abs(amount),
      currency: account.currency,
      reward_currency: null,
      metadata: { kind: 'asset_balance_adjustment' },
      reference_transaction_id: null,
      from_account: amount > 0 ? null : accountId,
      to_account: amount > 0 ? accountId : null,
      category: 'Balance Adjustment',
      memo: normalizedMemo,
      transaction_at: date,
    })
    .select('id')
    .single();

  if (transactionError || !transactionRow) {
    throw new Error(
      transactionError?.message ?? 'Failed to create asset balance adjustment',
    );
  }

  const nextBalance = new Decimal(account.balance).plus(amount).toNumber();
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
    transaction_id: transactionRow.id,
  };
}
