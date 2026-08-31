import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { getApiKey } from '@/lib/db/settings';
import { loadAccount } from '@/lib/db/ledger';
import { one } from '@/lib/db/sql';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import { roundMoneyDecimal, roundSharesDecimal } from '@/lib/utils/financial-analytics';
import { fetchStockPrices } from '@/lib/utils/stock-price';
import type { Queryable } from '@/lib/db/session';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

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
  type: AccountType;
  ticker: string | null;
  brokerage_account_id: string | null;
  shares: number;
  cost_basis: number;
}

interface CashAccountRow {
  id: string;
  type: AccountType;
  currency: string;
  balance: number;
}

async function loadShareAccount(
  db: Queryable,
  userId: string,
  shareAccountId: string,
): Promise<ActionResult<ShareAccountRow>> {
  try {
    const account = await loadAccount<ShareAccountRow>(
      db,
      userId,
      shareAccountId,
      'id, type, ticker, brokerage_account_id, shares, cost_basis',
      'Share account not found',
    );
    if (account.type !== AccountType.SHARE) {
      return { success: false, error: 'Selected account is not a share account' };
    }
    return { success: true, data: account };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadCashAccount(
  db: Queryable,
  userId: string,
  brokerageAccountId: string,
): Promise<ActionResult<CashAccountRow>> {
  try {
    const account = await loadAccount<CashAccountRow>(
      db,
      userId,
      brokerageAccountId,
      'id, type, currency, balance',
      'Brokerage cash account not found',
    );
    if (account.type !== AccountType.ASSET) {
      return { success: false, error: 'Brokerage cash account must be an asset account' };
    }
    if (account.currency !== 'USD') {
      return { success: false, error: 'Brokerage cash account must use USD' };
    }
    return { success: true, data: account };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Recompute a share account's mark-to-market balance and persist a price.
 * Shared by the trade paths, `refreshSharePrices`, and `setSharePrice` — all
 * four end at "this account's price is now X as of today."
 */
async function applySharePrice(
  db: Queryable,
  userId: string,
  accountId: string,
  shares: number,
  price: number,
): Promise<void> {
  const balance = roundMoneyDecimal(new Decimal(shares).mul(price));
  await db.query(
    `UPDATE accounts SET last_price = $1, last_price_date = CURRENT_DATE, balance = $2
      WHERE id = $3 AND user_id = $4`,
    [price, balance.toNumber(), accountId, userId],
  );
}

/**
 * Buy-share logic, callable either standalone (wrapped in its own transaction
 * by `buyShare`) or from inside a caller's existing transaction — PGlite has
 * one embedded connection and no nested-transaction support, so
 * `createShareAccount`'s initial-position purchase calls this directly with
 * its own `tx` rather than have `buyShare` open a second one.
 *
 * No optimistic-concurrency retry is needed here (unlike the old multi-round-
 * trip Supabase client): the transaction already serializes the read-then-write,
 * and PGlite has no concurrent writer to race against in the first place.
 */
export async function buyShareWithinTransaction(
  db: Queryable,
  userId: string,
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  const parsed = ShareTradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid trade input' };
  }
  const { shareAccountId, brokerageAccountId, quantity, price, fee, memo } = parsed.data;

  const shareLoad = await loadShareAccount(db, userId, shareAccountId);
  if (!shareLoad.success) return shareLoad;
  const shareAccount = shareLoad.data;

  if (shareAccount.brokerage_account_id !== brokerageAccountId) {
    return { success: false, error: 'This share account is not linked to the selected cash account' };
  }
  if (!shareAccount.ticker) {
    return { success: false, error: 'Share account ticker is missing' };
  }

  const cashLoad = await loadCashAccount(db, userId, brokerageAccountId);
  if (!cashLoad.success) return cashLoad;
  const brokerageAccount = cashLoad.data;

  const quantityValue = roundSharesDecimal(quantity);
  const priceValue = new Decimal(price);
  const feeValue = roundMoneyDecimal(fee);
  const cashAmount = roundMoneyDecimal(quantityValue.mul(priceValue).plus(feeValue));

  if (new Decimal(brokerageAccount.balance).lt(cashAmount)) {
    return { success: false, error: 'Insufficient cash balance' };
  }

  const nextShares = roundSharesDecimal(new Decimal(shareAccount.shares).plus(quantityValue));
  const nextCostBasis = roundMoneyDecimal(new Decimal(shareAccount.cost_basis).plus(cashAmount));
  const normalizedMemo = memo?.trim() ? memo.trim() : null;

  const transaction = await one<Transaction>(
    db,
    `INSERT INTO transactions
       (user_id, type, amount, currency, metadata, from_account, to_account, memo,
        share_ticker, share_quantity, share_price, fee, transaction_date)
     VALUES ($1, $2, $3, 'USD', '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE)
     RETURNING *`,
    [
      userId,
      TransactionType.SHARE_BUY,
      cashAmount.toNumber(),
      brokerageAccount.id,
      shareAccount.id,
      normalizedMemo,
      shareAccount.ticker,
      quantityValue.toNumber(),
      priceValue.toNumber(),
      feeValue.toNumber(),
    ],
    'Failed to create share buy transaction',
  );

  await db.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND user_id = $3', [
    cashAmount.toNumber(),
    brokerageAccount.id,
    userId,
  ]);

  await db.query(
    'UPDATE accounts SET shares = $1, cost_basis = $2 WHERE id = $3 AND user_id = $4',
    [nextShares.toNumber(), nextCostBasis.toNumber(), shareAccount.id, userId],
  );
  await applySharePrice(db, userId, shareAccount.id, nextShares.toNumber(), priceValue.toNumber());

  return { success: true, data: { transaction } };
}

/** Buy shares, funding the trade from a linked USD cash account. */
export async function buyShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  const { db, userId } = await getSessionContext();
  return db.transaction((tx) => buyShareWithinTransaction(tx, userId, input));
}

/** Sell shares, crediting proceeds to the linked USD cash account. */
export async function sellShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  const { db, userId } = await getSessionContext();
  const parsed = ShareTradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid trade input' };
  }
  const { shareAccountId, brokerageAccountId, quantity, price, fee, memo } = parsed.data;

  return db.transaction(async (tx) => {
    const shareLoad = await loadShareAccount(tx, userId, shareAccountId);
    if (!shareLoad.success) return shareLoad;
    const shareAccount = shareLoad.data;

    if (shareAccount.brokerage_account_id !== brokerageAccountId) {
      return { success: false, error: 'This share account is not linked to the selected cash account' };
    }
    if (!shareAccount.ticker) {
      return { success: false, error: 'Share account ticker is missing' };
    }

    const cashLoad = await loadCashAccount(tx, userId, brokerageAccountId);
    if (!cashLoad.success) return cashLoad;
    const brokerageAccount = cashLoad.data;

    const quantityValue = roundSharesDecimal(quantity);
    const priceValue = new Decimal(price);
    const feeValue = roundMoneyDecimal(fee);
    const currentShares = new Decimal(shareAccount.shares);

    if (currentShares.lt(quantityValue)) {
      return { success: false, error: 'Insufficient shares' };
    }

    const cashAmount = roundMoneyDecimal(quantityValue.mul(priceValue).minus(feeValue));
    if (cashAmount.lte(0)) {
      return { success: false, error: 'Sell proceeds must be greater than 0' };
    }

    const nextSharesRaw = roundSharesDecimal(currentShares.minus(quantityValue));
    const isCleared = nextSharesRaw.lte(0);
    const averageCost = currentShares.gt(0)
      ? new Decimal(shareAccount.cost_basis).div(currentShares)
      : new Decimal(0);
    const reducedCost = roundMoneyDecimal(averageCost.mul(quantityValue));
    const nextCostBasis = isCleared
      ? new Decimal(0)
      : Decimal.max(roundMoneyDecimal(new Decimal(shareAccount.cost_basis).minus(reducedCost)), new Decimal(0));
    const nextShares = isCleared ? new Decimal(0) : nextSharesRaw;
    const normalizedMemo = memo?.trim() ? memo.trim() : null;

    const transaction = await one<Transaction>(
      tx,
      `INSERT INTO transactions
         (user_id, type, amount, currency, metadata, from_account, to_account, memo,
          share_ticker, share_quantity, share_price, fee, transaction_date)
       VALUES ($1, $2, $3, 'USD', '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE)
       RETURNING *`,
      [
        userId,
        TransactionType.SHARE_SELL,
        cashAmount.toNumber(),
        shareAccount.id,
        brokerageAccount.id,
        normalizedMemo,
        shareAccount.ticker,
        quantityValue.toNumber(),
        priceValue.toNumber(),
        feeValue.toNumber(),
      ],
      'Failed to create share sell transaction',
    );

    await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2 AND user_id = $3', [
      cashAmount.toNumber(),
      brokerageAccount.id,
      userId,
    ]);

    await tx.query(
      'UPDATE accounts SET shares = $1, cost_basis = $2 WHERE id = $3 AND user_id = $4',
      [nextShares.toNumber(), nextCostBasis.toNumber(), shareAccount.id, userId],
    );
    await applySharePrice(
      tx,
      userId,
      shareAccount.id,
      nextShares.toNumber(),
      isCleared ? 0 : priceValue.toNumber(),
    );

    return { success: true, data: { transaction } };
  });
}

interface RefreshCandidate {
  id: string;
  ticker: string;
  shares: number;
}

/**
 * Pull live prices for every SHARE account and mark-to-market its balance.
 *
 * "Fresh" now means "already priced today" — `last_price_date` is a DATE (see
 * PLAN.md's day-granularity decision), so there is no sub-day staleness to
 * measure. `force` re-fetches regardless.
 */
export async function refreshSharePrices(
  input?: { force?: boolean },
): Promise<ActionResult<{ updated: number; failed: string[]; freshSkipped: number }>> {
  const { db, userId } = await getSessionContext();
  const force = Boolean(input?.force);

  const staleAccounts = await db.query<RefreshCandidate>(
    `SELECT id, ticker, shares FROM accounts
      WHERE user_id = $1 AND type = 'SHARE' AND ticker IS NOT NULL
        AND ($2 OR last_price_date IS DISTINCT FROM CURRENT_DATE)`,
    [userId, force],
  );
  const totalShareAccounts = await one<{ count: number }>(
    db,
    `SELECT count(*)::int AS count FROM accounts WHERE user_id = $1 AND type = 'SHARE' AND ticker IS NOT NULL`,
    [userId],
    'Failed to count share accounts',
  );
  const freshSkipped = totalShareAccounts.count - staleAccounts.rows.length;

  if (totalShareAccounts.count === 0) {
    return { success: true, data: { updated: 0, failed: [], freshSkipped: 0 } };
  }
  if (staleAccounts.rows.length === 0) {
    return { success: true, data: { updated: 0, failed: [], freshSkipped } };
  }

  const apiKey = await getApiKey(db, userId, 'finnhub');
  let prices: Record<string, number>;
  try {
    prices = await fetchStockPrices(
      staleAccounts.rows.map((a) => a.ticker.trim().toUpperCase()),
      apiKey,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to refresh share prices' };
  }

  const failed: string[] = [];
  let updated = 0;

  for (const account of staleAccounts.rows) {
    const ticker = account.ticker.trim().toUpperCase();
    const price = prices[ticker];
    if (typeof price !== 'number') {
      failed.push(ticker);
      continue;
    }
    await applySharePrice(db, userId, account.id, account.shares, price);
    updated += 1;
  }

  if (updated === 0 && failed.length === staleAccounts.rows.length) {
    return { success: false, error: 'Failed to refresh prices for all symbols' };
  }

  return { success: true, data: { updated, failed, freshSkipped } };
}

const SetSharePriceSchema = z.object({
  accountId: z.string().uuid(),
  price: z.number().positive(),
});

/**
 * User correction to a SHARE account's price — e.g. the API returned a stale
 * or wrong quote, or the market is closed and today's actual fill differs.
 * Writes through the same `applySharePrice` path `refreshSharePrices` uses, so
 * a manual value is indistinguishable in shape from a fetched one; only
 * `last_price_date` (today) says when it was last touched.
 */
export async function setSharePrice(
  input: z.infer<typeof SetSharePriceSchema>,
): Promise<ActionResult<{ balance: number }>> {
  const { db, userId } = await getSessionContext();
  const parsed = SetSharePriceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid price' };
  }

  return db.transaction(async (tx) => {
    const shareLoad = await loadShareAccount(tx, userId, parsed.data.accountId);
    if (!shareLoad.success) return shareLoad;

    await applySharePrice(tx, userId, parsed.data.accountId, shareLoad.data.shares, parsed.data.price);
    const balance = roundMoneyDecimal(new Decimal(shareLoad.data.shares).mul(parsed.data.price));
    return { success: true, data: { balance: balance.toNumber() } };
  });
}
