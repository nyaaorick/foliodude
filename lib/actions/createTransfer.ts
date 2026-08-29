'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
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
  .refine((input) => input.fromAccountId !== input.toAccountId, {
    message: 'Source and destination accounts must be different',
    path: ['toAccountId'],
  });

type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

interface TransferAccount {
  id: string;
  user_id: string;
  type: AccountType;
  currency: string;
  balance: number;
}

export async function createTransfer(
  input: CreateTransferInput,
): Promise<{ transaction: Transaction }> {
  const { supabase, userId } = await requireSessionContext();

  const parsed = CreateTransferSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const {
    fromAccountId,
    toAccountId,
    amount: rawAmount,
    targetAmount: rawTargetAmount,
    memo,
  } = parsed.data;
  const amountValue = new Decimal(normalizeMoneyAmount(rawAmount));

  const normalizedMemo = memo?.trim() ? memo.trim() : null;

  const { data: accountRows, error: accountError } = await supabase
    .from('accounts')
    .select('id, user_id, type, currency, balance')
    .eq('user_id', userId)
    .in('id', [fromAccountId, toAccountId]);

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!accountRows || accountRows.length !== 2) {
    throw new Error('One or more accounts were not found');
  }

  const accounts = accountRows as TransferAccount[];
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
  if (new Decimal(fromAccount.balance).lt(amountValue)) {
    throw new Error('Insufficient balance');
  }

  const transactionAt = new Date().toISOString();
  const nextFromBalance = new Decimal(fromAccount.balance).minus(amountValue).toNumber();
  const nextToBalance = new Decimal(toAccount.balance).plus(targetAmountValue).toNumber();
  const metadata = isCrossCurrency
    ? {
        source_currency: fromAccount.currency,
        target_currency: toAccount.currency,
        target_amount: targetAmountValue.toNumber(),
        implied_exchange_rate: targetAmountValue.div(amountValue).toDecimalPlaces(6).toNumber(),
      }
    : {};

  const { data: transactionRow, error: insertError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: TransactionType.TRANSFER,
      amount: amountValue.toNumber(),
      currency: fromAccount.currency,
      metadata,
      from_account: fromAccountId,
      to_account: toAccountId,
      category: null,
      memo: normalizedMemo,
      transaction_at: transactionAt,
    })
    .select()
    .single();

  if (insertError || !transactionRow) {
    throw new Error(insertError?.message ?? 'Failed to create transfer transaction');
  }

  const { data: updatedFromAccount, error: fromUpdateError } = await supabase
    .from('accounts')
    .update({ balance: nextFromBalance })
    .eq('id', fromAccountId)
    .eq('user_id', userId)
    .eq('balance', fromAccount.balance)
    .select('id')
    .single();

  if (fromUpdateError) {
    throw new Error(fromUpdateError.message);
  }

  if (!updatedFromAccount) {
    throw new Error('Source balance changed, please retry');
  }

  const { data: updatedToAccount, error: toUpdateError } = await supabase
    .from('accounts')
    .update({ balance: nextToBalance })
    .eq('id', toAccountId)
    .eq('user_id', userId)
    .eq('balance', toAccount.balance)
    .select('id')
    .single();

  if (toUpdateError) {
    throw new Error(toUpdateError.message);
  }

  if (!updatedToAccount) {
    throw new Error('Destination balance changed, please retry');
  }

  revalidatePath('/accounts');
  revalidatePath(`/accounts/${fromAccountId}`);
  revalidatePath(`/accounts/${toAccountId}`);

  return {
    transaction: transactionRow as unknown as Transaction,
  };
}
