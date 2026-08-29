'use server';

import Decimal from 'decimal.js';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import type { Account } from '@/lib/types/accounts';
import { roundMoneyNumber } from '@/lib/utils/financial-analytics';

const UpdateAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  balance: z.number().finite().optional(),
});

const SetAssetApySchema = z.object({
  id: z.string().uuid(),
  apy: z.number().finite().nonnegative(),
});

type SupabaseClient = Awaited<ReturnType<typeof requireSessionContext>>['supabase'];

async function getAuthenticatedAccountClient() {
  return requireSessionContext();
}

async function loadOwnedAccount(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
) {
  const { data: account, error } = await supabase
    .from('accounts')
    .select('id, type, auto_pay_config')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return account;
}

function revalidateAccountPaths(accountId: string) {
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
}

export async function updateAccount(
  input: z.infer<typeof UpdateAccountSchema>,
): Promise<Account> {
  const { supabase, userId } = await getAuthenticatedAccountClient();
  const parsed = UpdateAccountSchema.parse(input);
  const existingAccount = await loadOwnedAccount(supabase, userId, parsed.id);

  const updates: { name: string; balance?: number } = {
    name: parsed.name.trim(),
  };

  if (parsed.balance !== undefined) {
    if (existingAccount.type === AccountType.SHARE) {
      throw new Error('Share account balances cannot be edited directly');
    }

    if (existingAccount.type === AccountType.AIRLINE_MILES) {
      if (!Number.isInteger(parsed.balance)) {
        throw new Error('Mileage balances must be whole numbers');
      }

      updates.balance = parsed.balance;
    } else {
      const balance = new Decimal(parsed.balance);

      if ((balance.decimalPlaces() ?? 0) > 2) {
        throw new Error('Balance must have at most 2 decimal places');
      }

      updates.balance = balance.toNumber();
    }
  }

  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('id', parsed.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidateAccountPaths(parsed.id);

  return data as Account;
}

export async function setAssetApy(
  input: z.infer<typeof SetAssetApySchema>,
): Promise<Account> {
  const { supabase, userId } = await getAuthenticatedAccountClient();
  const parsed = SetAssetApySchema.parse(input);
  const account = await loadOwnedAccount(supabase, userId, parsed.id);
  const normalizedApy = roundMoneyNumber(parsed.apy);

  if (account.type !== AccountType.ASSET) {
    throw new Error('APY can only be set on asset accounts');
  }

  const currentConfig =
    account.auto_pay_config && typeof account.auto_pay_config === 'object'
      ? (account.auto_pay_config as Record<string, unknown>)
      : {};

  const nextConfig: Record<string, unknown> = {
    ...currentConfig,
    asset_apy: normalizedApy,
  };

  const { data, error } = await supabase
    .from('accounts')
    .update({ auto_pay_config: nextConfig })
    .eq('id', parsed.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidateAccountPaths(parsed.id);

  return data as Account;
}
