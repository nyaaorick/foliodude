import { z } from 'zod';
import Decimal from 'decimal.js';
import { getSessionContext } from '@/lib/db/session';
import { getApiKey } from '@/lib/db/settings';
import {
  adjustBalance,
  insertTransaction,
  loadAccount,
  normalizeMemo,
  setSharePosition,
} from '@/lib/db/ledger';
import { one } from '@/lib/db/sql';
import type { Tx } from '@/lib/db/tx';
import { AccountType } from '@/lib/types/accounts';
import { TransactionType, type Transaction } from '@/lib/types/transactions';
import { roundMoneyDecimal, roundSharesDecimal } from '@/lib/utils/financial-analytics';
import { fetchStockPrices } from '@/lib/utils/stock-price';
import type { Queryable } from '@/lib/db/session';
import { localToday } from '@/lib/utils/local-date';
import { parseOrThrow, toActionResult, type ActionResult } from './result';

const ShareTradeSchema = z.object({
  shareAccountId: z.string().uuid(),
  brokerageAccountId: z.string().uuid(),
  quantity: z.number().positive(),
  price: z.number().positive(),
  memo: z.string().optional(),
});

interface ShareAccountRow {
  id: string;
  type: AccountType;
  ticker: string;
  brokerage_account_id: string;
  shares: number;
  cost_basis: number;
}

interface CashAccountRow {
  id: string;
  type: AccountType;
  currency: string;
}

/** The position as it stood before a trade, kept on the trade so deleting it restores it exactly. */
function positionBefore(account: ShareAccountRow) {
  return { shares_before: account.shares, cost_basis_before: account.cost_basis };
}

/** `transactions.share_price` is DECIMAL(18,4); the cash amount must be computed from what is stored. */
function roundSharePriceDecimal(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

async function loadShareAccount(db: Queryable, shareAccountId: string): Promise<ShareAccountRow> {
  const account = await loadAccount<ShareAccountRow>(
    db,
    shareAccountId,
    'id, type, ticker, brokerage_account_id, shares, cost_basis',
    'Share account not found',
  );
  if (account.type !== AccountType.SHARE) throw new Error('Selected account is not a share account');
  return account;
}

async function loadCashAccount(db: Queryable, brokerageAccountId: string): Promise<CashAccountRow> {
  const account = await loadAccount<CashAccountRow>(
    db,
    brokerageAccountId,
    'id, type, currency',
    'Brokerage cash account not found',
  );
  if (account.type !== AccountType.ASSET) {
    throw new Error('Brokerage cash account must be an asset account');
  }
  if (account.currency !== 'USD') throw new Error('Brokerage cash account must use USD');
  return account;
}

/**
 * Set a share account's balance to shares x last_price, from the rows as they
 * are now. Computing it in SQL (rather than from shares read earlier) means a
 * price refresh that awaited the network cannot overwrite a trade that landed
 * in the meantime.
 */
export async function syncShareBalance(tx: Tx, accountId: string): Promise<void> {
  await tx.query(
    `UPDATE accounts a
        SET balance = round(s.shares * COALESCE(s.last_price, 0), 2)
       FROM share_details s
      WHERE s.account_id = a.id AND a.id = $1`,
    [accountId],
  );
}

/**
 * Persist a price as of today and re-mark the position. Shared by the trade
 * paths, `refreshSharePrices`, and `setSharePrice` — all end at "this account's
 * price is now X as of today."
 */
async function applySharePrice(tx: Tx, accountId: string, price: number): Promise<void> {
  await tx.query(
    'UPDATE share_details SET last_price = $1, last_price_date = $2 WHERE account_id = $3',
    [price, localToday(), accountId],
  );
  await syncShareBalance(tx, accountId);
}

/**
 * Buy-share logic, callable either standalone (wrapped in its own transaction
 * by `buyShare`) or from inside a caller's existing transaction —
 * `createShareAccount`'s initial-position purchase calls this directly with its
 * own `tx`, because PGlite has one embedded connection and no nested
 * transactions.
 */
export async function buyShareWithinTransaction(
  tx: Tx,
  input: z.infer<typeof ShareTradeSchema>,
): Promise<{ transaction: Transaction }> {
  const { shareAccountId, brokerageAccountId, quantity, price, memo } = parseOrThrow(
    ShareTradeSchema,
    input,
  );

  const shareAccount = await loadShareAccount(tx, shareAccountId);
  if (shareAccount.brokerage_account_id !== brokerageAccountId) {
    throw new Error('This share account is not linked to the selected cash account');
  }
  const brokerageAccount = await loadCashAccount(tx, brokerageAccountId);

  const quantityValue = roundSharesDecimal(quantity);
  const priceValue = roundSharePriceDecimal(price);
  const cashAmount = roundMoneyDecimal(quantityValue.mul(priceValue));

  const nextShares = roundSharesDecimal(new Decimal(shareAccount.shares).plus(quantityValue));
  const nextCostBasis = roundMoneyDecimal(new Decimal(shareAccount.cost_basis).plus(cashAmount));

  const transaction = await insertTransaction(tx, {
    type: TransactionType.SHARE_BUY,
    amount: cashAmount.toNumber(),
    currency: 'USD',
    metadata: positionBefore(shareAccount),
    from_account: brokerageAccount.id,
    to_account: shareAccount.id,
    memo: normalizeMemo(memo),
    share_ticker: shareAccount.ticker,
    share_quantity: quantityValue.toNumber(),
    share_price: priceValue.toNumber(),
    transaction_date: localToday(),
  });

  await adjustBalance(tx, brokerageAccount.id, cashAmount.neg());
  await setSharePosition(tx, shareAccount.id, nextShares, nextCostBasis);
  await applySharePrice(tx, shareAccount.id, priceValue.toNumber());

  return { transaction };
}

/** Buy shares, funding the trade from a linked USD cash account. */
export function buyShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    return db.transaction((tx) => buyShareWithinTransaction(tx, input));
  });
}

/** Sell shares, crediting proceeds to the linked USD cash account. */
export function sellShare(
  input: z.infer<typeof ShareTradeSchema>,
): Promise<ActionResult<{ transaction: Transaction }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const { shareAccountId, brokerageAccountId, quantity, price, memo } = parseOrThrow(
      ShareTradeSchema,
      input,
    );

    return db.transaction(async (tx) => {
      const shareAccount = await loadShareAccount(tx, shareAccountId);
      if (shareAccount.brokerage_account_id !== brokerageAccountId) {
        throw new Error('This share account is not linked to the selected cash account');
      }
      const brokerageAccount = await loadCashAccount(tx, brokerageAccountId);

      const quantityValue = roundSharesDecimal(quantity);
      const priceValue = roundSharePriceDecimal(price);
      const currentShares = new Decimal(shareAccount.shares);

      if (currentShares.lt(quantityValue)) throw new Error('Insufficient shares');

      const cashAmount = roundMoneyDecimal(quantityValue.mul(priceValue));
      if (cashAmount.lte(0)) throw new Error('Sell proceeds must be greater than 0');

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

      const transaction = await insertTransaction(tx, {
        type: TransactionType.SHARE_SELL,
        amount: cashAmount.toNumber(),
        currency: 'USD',
        metadata: positionBefore(shareAccount),
        from_account: shareAccount.id,
        to_account: brokerageAccount.id,
        memo: normalizeMemo(memo),
        share_ticker: shareAccount.ticker,
        share_quantity: quantityValue.toNumber(),
        share_price: priceValue.toNumber(),
        transaction_date: localToday(),
      });

      await adjustBalance(tx, brokerageAccount.id, cashAmount);
      await setSharePosition(tx, shareAccount.id, nextShares, nextCostBasis);
      await applySharePrice(tx, shareAccount.id, priceValue.toNumber());

      return { transaction };
    });
  });
}

interface RefreshCandidate {
  id: string;
  ticker: string;
}

/**
 * Pull live prices for every SHARE account and mark-to-market its balance.
 *
 * "Fresh" means "already priced today" — `last_price_date` is a DATE, so there
 * is no sub-day staleness to measure. `force` re-fetches regardless.
 */
export function refreshSharePrices(
  input?: { force?: boolean },
): Promise<ActionResult<{ updated: number; failed: string[]; freshSkipped: number }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const force = Boolean(input?.force);

    const staleAccounts = await db.query<RefreshCandidate>(
      `SELECT account_id AS id, ticker FROM share_details
        WHERE ($1 OR last_price_date IS DISTINCT FROM $2::date)`,
      [force, localToday()],
    );
    const totalShareAccounts = await one<{ count: number }>(
      db,
      'SELECT count(*)::int AS count FROM share_details',
      [],
      'Failed to count share accounts',
    );
    const freshSkipped = totalShareAccounts.count - staleAccounts.rows.length;

    if (totalShareAccounts.count === 0) return { updated: 0, failed: [], freshSkipped: 0 };
    if (staleAccounts.rows.length === 0) return { updated: 0, failed: [], freshSkipped };

    const apiKey = await getApiKey(db, 'finnhub');
    // The network call stays outside the transaction so it never holds the
    // database open.
    const prices = await fetchStockPrices(
      staleAccounts.rows.map((a) => a.ticker),
      apiKey,
    );

    const failed: string[] = [];
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const account of staleAccounts.rows) {
        const price = prices[account.ticker];
        if (typeof price !== 'number') {
          failed.push(account.ticker);
          continue;
        }
        await applySharePrice(tx, account.id, price);
        updated += 1;
      }
    });

    if (updated === 0 && failed.length === staleAccounts.rows.length) {
      throw new Error('Failed to refresh prices for all symbols');
    }

    return { updated, failed, freshSkipped };
  });
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
export function setSharePrice(
  input: z.infer<typeof SetSharePriceSchema>,
): Promise<ActionResult<{ balance: number }>> {
  return toActionResult(async () => {
    const { db } = await getSessionContext();
    const parsed = parseOrThrow(SetSharePriceSchema, input);

    return db.transaction(async (tx) => {
      const share = await loadShareAccount(tx, parsed.accountId);

      await applySharePrice(tx, parsed.accountId, parsed.price);
      const balance = roundMoneyDecimal(new Decimal(share.shares).mul(parsed.price));
      return { balance: balance.toNumber() };
    });
  });
}
