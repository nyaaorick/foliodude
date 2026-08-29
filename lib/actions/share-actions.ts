'use server';

import { z } from 'zod';
import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { getSessionContext, type RequestSessionContext } from '@/lib/supabase/server';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import {
  roundMoneyDecimal,
  roundSharesDecimal,
} from '@/lib/utils/financial-analytics';
import { fetchStockPrices } from '@/lib/utils/stock-price';

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const ShareTradeSchema = z.object({
  shareAccountId: z.string().uuid(),
  brokerageAccountId: z.string().uuid(),
  quantity: z.number().positive(),
  price: z.number().positive(),
  fee: z.number().min(0).default(0),
  memo: z.string().optional(),
});

interface ShareAccountRow {
  id: string;
  user_id: string;
  type: AccountType;
  currency: string;
  balance: number;
  ticker: string | null;
  brokerage_account_id: string | null;
  shares: number;
  cost_basis: number;
  last_price: number | null;
  last_price_at: string | null;
}

interface CashAccountRow {
  id: string;
  user_id: string;
  type: AccountType;
  currency: string;
  balance: number;
}

type SupabaseClient = RequestSessionContext['supabase'];

async function getAuthorizedUser() {
  return getSessionContext();
}

async function loadShareAccount(
  supabase: SupabaseClient,
  userId: string,
  shareAccountId: string,
): Promise<ActionResult<ShareAccountRow>> {
  const { data: shareAccount, error } = await supabase
    .from('accounts')
    .select(
      'id, user_id, type, currency, balance, ticker, brokerage_account_id, shares, cost_basis, last_price, last_price_at',
    )
    .eq('id', shareAccountId)
    .eq('user_id', userId)
    .single();

  if (error || !shareAccount) {
    return {
      success: false,
      error: error?.message ?? 'Share account not found',
    };
  }

  if (shareAccount.type !== AccountType.SHARE) {
    return { success: false, error: 'Selected account is not a share account' };
  }

  return {
    success: true,
    data: shareAccount as ShareAccountRow,
  };
}

async function loadCashAccount(
  supabase: SupabaseClient,
  userId: string,
  brokerageAccountId: string,
): Promise<ActionResult<CashAccountRow>> {
  const { data: brokerageAccount, error } = await supabase
    .from('accounts')
    .select('id, user_id, type, currency, balance')
    .eq('id', brokerageAccountId)
    .eq('user_id', userId)
    .single();

  if (error || !brokerageAccount) {
    return {
      success: false,
      error: error?.message ?? 'Brokerage cash account not found',
    };
  }

  if (brokerageAccount.type !== AccountType.ASSET) {
    return { success: false, error: 'Brokerage cash account must be an asset account' };
  }

  if (brokerageAccount.currency !== 'USD') {
    return { success: false, error: 'Brokerage cash account must use USD' };
  }

  return { success: true, data: brokerageAccount as CashAccountRow };
}

function revalidateSharePaths(shareAccountId: string, brokerageAccountId: string) {
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${shareAccountId}`);
  revalidatePath(`/accounts/${brokerageAccountId}`);
}

export async function buyShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  const auth = await getAuthorizedUser();
  if (!auth) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = ShareTradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { shareAccountId, brokerageAccountId, quantity, price, fee, memo } =
    parsed.data;

  const shareLoad = await loadShareAccount(auth.supabase, auth.userId, shareAccountId);
  if (!shareLoad.success) {
    return shareLoad;
  }

  const supabase = auth.supabase;
  const shareAccount = shareLoad.data;

  if (shareAccount.brokerage_account_id !== brokerageAccountId) {
    return {
      success: false,
      error: 'This share account is not linked to the selected cash account',
    };
  }

  if (!shareAccount.ticker) {
    return { success: false, error: 'Share account ticker is missing' };
  }

  const cashLoad = await loadCashAccount(supabase, auth.userId, brokerageAccountId);
  if (!cashLoad.success) {
    return cashLoad;
  }

  const brokerageAccount = cashLoad.data;
  const quantityValue = roundSharesDecimal(quantity);
  const priceValue = new Decimal(price);
  const feeValue = roundMoneyDecimal(fee);
  const cashAmount = roundMoneyDecimal(quantityValue.mul(priceValue).plus(feeValue));

  if (new Decimal(brokerageAccount.balance).lt(cashAmount)) {
    return { success: false, error: 'Insufficient cash balance' };
  }

  const nextCashBalance = roundMoneyDecimal(
    new Decimal(brokerageAccount.balance).minus(cashAmount),
  );
  const nextShares = roundSharesDecimal(new Decimal(shareAccount.shares).plus(quantityValue));
  const nextCostBasis = roundMoneyDecimal(
    new Decimal(shareAccount.cost_basis).plus(cashAmount),
  );
  const nextBalance = roundMoneyDecimal(nextShares.mul(priceValue));
  const transactionAt = new Date().toISOString();
  const normalizedMemo = memo?.trim() ? memo.trim() : null;

  const { data: transactionRow, error: insertError } = await supabase
    .from('transactions')
    .insert({
      user_id: auth.userId,
      type: TransactionType.SHARE_BUY,
      amount: cashAmount.toNumber(),
      currency: 'USD',
      metadata: {},
      from_account: brokerageAccount.id,
      to_account: shareAccount.id,
      category: null,
      memo: normalizedMemo,
      share_ticker: shareAccount.ticker,
      share_quantity: quantityValue.toNumber(),
      share_price: priceValue.toNumber(),
      fee: feeValue.toNumber(),
      transaction_at: transactionAt,
    })
    .select()
    .single();

  if (insertError || !transactionRow) {
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create share buy transaction',
    };
  }

  const { data: updatedCashAccount, error: cashUpdateError } = await supabase
    .from('accounts')
    .update({ balance: nextCashBalance.toNumber() })
    .eq('id', brokerageAccount.id)
    .eq('user_id', auth.userId)
    .eq('balance', brokerageAccount.balance)
    .select('id')
    .single();

  if (cashUpdateError) {
    return { success: false, error: cashUpdateError.message };
  }

  if (!updatedCashAccount) {
    return { success: false, error: 'Cash balance changed, please retry' };
  }

  const { data: updatedShareAccount, error: shareUpdateError } = await supabase
    .from('accounts')
    .update({
      shares: nextShares.toNumber(),
      cost_basis: nextCostBasis.toNumber(),
      last_price: priceValue.toNumber(),
      last_price_at: transactionAt,
      balance: nextBalance.toNumber(),
    })
    .eq('id', shareAccount.id)
    .eq('user_id', auth.userId)
    .eq('shares', shareAccount.shares)
    .eq('cost_basis', shareAccount.cost_basis)
    .select('id')
    .single();

  if (shareUpdateError) {
    return { success: false, error: shareUpdateError.message };
  }

  if (!updatedShareAccount) {
    return { success: false, error: 'Share position changed, please retry' };
  }

  revalidateSharePaths(shareAccount.id, brokerageAccount.id);

  return {
    success: true,
    data: {
      transaction: transactionRow as unknown as Transaction,
    },
  };
}

export async function sellShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  const auth = await getAuthorizedUser();
  if (!auth) {
    return { success: false, error: 'Unauthorized' };
  }

  const parsed = ShareTradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { shareAccountId, brokerageAccountId, quantity, price, fee, memo } =
    parsed.data;

  const shareLoad = await loadShareAccount(auth.supabase, auth.userId, shareAccountId);
  if (!shareLoad.success) {
    return shareLoad;
  }

  const supabase = auth.supabase;
  const shareAccount = shareLoad.data;

  if (shareAccount.brokerage_account_id !== brokerageAccountId) {
    return {
      success: false,
      error: 'This share account is not linked to the selected cash account',
    };
  }

  if (!shareAccount.ticker) {
    return { success: false, error: 'Share account ticker is missing' };
  }

  const cashLoad = await loadCashAccount(supabase, auth.userId, brokerageAccountId);
  if (!cashLoad.success) {
    return cashLoad;
  }

  const brokerageAccount = cashLoad.data;
  const quantityValue = roundSharesDecimal(quantity);
  const priceValue = new Decimal(price);
  const feeValue = roundMoneyDecimal(fee);
  const currentShares = new Decimal(shareAccount.shares);

  if (currentShares.lt(quantityValue)) {
    return { success: false, error: 'Insufficient shares' };
  }

  const grossProceeds = quantityValue.mul(priceValue);
  const cashAmount = roundMoneyDecimal(grossProceeds.minus(feeValue));
  if (cashAmount.lte(0)) {
    return { success: false, error: 'Sell proceeds must be greater than 0' };
  }

  const nextCashBalance = roundMoneyDecimal(
    new Decimal(brokerageAccount.balance).plus(cashAmount),
  );
  const nextSharesRaw = roundSharesDecimal(currentShares.minus(quantityValue));
  const isCleared = nextSharesRaw.lte(0);
  const averageCost = currentShares.gt(0)
    ? new Decimal(shareAccount.cost_basis).div(currentShares)
    : new Decimal(0);
  const reducedCost = roundMoneyDecimal(averageCost.mul(quantityValue));
  const nextCostBasis = isCleared
    ? new Decimal(0)
    : Decimal.max(
        roundMoneyDecimal(new Decimal(shareAccount.cost_basis).minus(reducedCost)),
        new Decimal(0),
      );
  const nextShares = isCleared ? new Decimal(0) : nextSharesRaw;
  const nextBalance = isCleared
    ? new Decimal(0)
    : roundMoneyDecimal(nextShares.mul(priceValue));
  const transactionAt = new Date().toISOString();
  const normalizedMemo = memo?.trim() ? memo.trim() : null;

  const { data: transactionRow, error: insertError } = await supabase
    .from('transactions')
    .insert({
      user_id: auth.userId,
      type: TransactionType.SHARE_SELL,
      amount: cashAmount.toNumber(),
      currency: 'USD',
      metadata: {},
      from_account: shareAccount.id,
      to_account: brokerageAccount.id,
      category: null,
      memo: normalizedMemo,
      share_ticker: shareAccount.ticker,
      share_quantity: quantityValue.toNumber(),
      share_price: priceValue.toNumber(),
      fee: feeValue.toNumber(),
      transaction_at: transactionAt,
    })
    .select()
    .single();

  if (insertError || !transactionRow) {
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create share sell transaction',
    };
  }

  const { data: updatedCashAccount, error: cashUpdateError } = await supabase
    .from('accounts')
    .update({ balance: nextCashBalance.toNumber() })
    .eq('id', brokerageAccount.id)
    .eq('user_id', auth.userId)
    .eq('balance', brokerageAccount.balance)
    .select('id')
    .single();

  if (cashUpdateError) {
    return { success: false, error: cashUpdateError.message };
  }

  if (!updatedCashAccount) {
    return { success: false, error: 'Cash balance changed, please retry' };
  }

  const { data: updatedShareAccount, error: shareUpdateError } = await supabase
    .from('accounts')
    .update({
      shares: nextShares.toNumber(),
      cost_basis: nextCostBasis.toNumber(),
      last_price: priceValue.toNumber(),
      last_price_at: transactionAt,
      balance: nextBalance.toNumber(),
    })
    .eq('id', shareAccount.id)
    .eq('user_id', auth.userId)
    .eq('shares', shareAccount.shares)
    .eq('cost_basis', shareAccount.cost_basis)
    .select('id')
    .single();

  if (shareUpdateError) {
    return { success: false, error: shareUpdateError.message };
  }

  if (!updatedShareAccount) {
    return { success: false, error: 'Share position changed, please retry' };
  }

  revalidateSharePaths(shareAccount.id, brokerageAccount.id);

  return {
    success: true,
    data: {
      transaction: transactionRow as unknown as Transaction,
    },
  };
}

export async function refreshSharePrices(
  input?: { force?: boolean },
): Promise<ActionResult<{ updated: number; failed: string[]; freshSkipped: number }>> {
  const auth = await getAuthorizedUser();
  if (!auth) {
    return { success: false, error: 'Unauthorized' };
  }

  const force = Boolean(input?.force);
  const stalenessMs = 10_000;

  const supabase = auth.supabase;
  const { data: shareAccounts, error } = await supabase
    .from('accounts')
    .select('id, ticker, shares, last_price_at')
    .eq('user_id', auth.userId)
    .eq('type', AccountType.SHARE);

  if (error) {
    return { success: false, error: error.message };
  }

  const now = Date.now();
  const validAccounts = (shareAccounts ?? []).filter((account) => Boolean(account.ticker));
  const staleAccounts = force
    ? validAccounts
    : validAccounts.filter((account) => {
        const last = account.last_price_at ? Date.parse(String(account.last_price_at)) : NaN;
        return !Number.isFinite(last) || now - last > stalenessMs;
      });
  const freshSkipped = validAccounts.length - staleAccounts.length;

  if (validAccounts.length === 0) {
    return { success: true, data: { updated: 0, failed: [], freshSkipped: 0 } };
  }

  if (staleAccounts.length === 0) {
    return { success: true, data: { updated: 0, failed: [], freshSkipped } };
  }

  let prices: Record<string, number>;

  try {
    prices = await fetchStockPrices(
      staleAccounts
        .map((account) => String(account.ticker).trim().toUpperCase())
        .filter(Boolean),
    );
  } catch (refreshError) {
    return {
      success: false,
      error:
        refreshError instanceof Error
          ? refreshError.message
          : 'Failed to refresh share prices',
    };
  }

  const refreshedAt = new Date().toISOString();
  const failed: string[] = [];
  const updateResults = await Promise.allSettled(
    staleAccounts.map(async (account) => {
      const ticker = String(account.ticker).trim().toUpperCase();
      const price = prices[ticker];

      if (typeof price !== 'number') {
        return { ticker, accountId: account.id, updated: false as const };
      }

      try {
        const nextBalance = roundMoneyDecimal(new Decimal(account.shares).mul(price));
        const { error: updateError } = await supabase
          .from('accounts')
          .update({
            last_price: price,
            last_price_at: refreshedAt,
            balance: nextBalance.toNumber(),
          })
          .eq('id', account.id)
          .eq('user_id', auth.userId);

        if (updateError) {
          return { ticker, accountId: account.id, updated: false as const };
        }

        return { ticker, accountId: account.id, updated: true as const };
      } catch (error) {
        throw { ticker, error };
      }
    }),
  );

  let updated = 0;

  for (const result of updateResults) {
    if (result.status === 'fulfilled') {
      if (!result.value.updated) {
        failed.push(result.value.ticker);
        continue;
      }

      updated += 1;
      revalidatePath(`/accounts/${result.value.accountId}`);
      continue;
    }

    const reason =
      result.reason && typeof result.reason === 'object'
        ? (result.reason as { ticker?: unknown })
        : null;
    failed.push(
      typeof reason?.ticker === 'string' ? reason.ticker : 'UNKNOWN',
    );
  }

  if (updated === 0 && failed.length === staleAccounts.length) {
    return {
      success: false,
      error: 'Failed to refresh prices for all symbols',
    };
  }

  revalidatePath('/accounts');

  return {
    success: true,
    data: {
      updated,
      failed,
      freshSkipped,
    },
  };
}
