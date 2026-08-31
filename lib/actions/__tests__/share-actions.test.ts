import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionContext, mockFetchStockPrices, mockGetApiKey } = vi.hoisted(() => ({
  mockGetSessionContext: vi.fn(),
  mockFetchStockPrices: vi.fn(),
  mockGetApiKey: vi.fn(),
}));

vi.mock('@/lib/db/session', () => ({ getSessionContext: mockGetSessionContext }));
vi.mock('@/lib/utils/stock-price', () => ({ fetchStockPrices: mockFetchStockPrices }));
vi.mock('@/lib/db/settings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getApiKey: mockGetApiKey,
}));

import { buyShare, refreshSharePrices, sellShare, setSharePrice } from '@/lib/actions/share-actions';
import { createTestContext, getAccount, seedAccount } from '@/lib/db/testing';
import type { SessionContext } from '@/lib/db/session';

describe('share actions', () => {
  let ctx: SessionContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    mockGetSessionContext.mockResolvedValue(ctx);
    mockGetApiKey.mockResolvedValue('test-finnhub-key');
  });

  async function seedShareSetup() {
    const brokerageId = await seedAccount(ctx, { type: 'ASSET', currency: 'USD', balance: 10_000 });
    const shareId = await seedAccount(ctx, {
      type: 'SHARE',
      currency: 'USD',
      brokerage: 'IBKR',
      ticker: 'AAPL',
      brokerage_account_id: brokerageId,
    });
    return { brokerageId, shareId };
  }

  it('records a buy and updates cash plus position balances', async () => {
    const { brokerageId, shareId } = await seedShareSetup();

    const result = await buyShare({
      shareAccountId: shareId,
      brokerageAccountId: brokerageId,
      quantity: 10,
      price: 150,
      fee: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.transaction).toMatchObject({ type: 'SHARE_BUY', amount: 1501 });

    const brokerage = await getAccount(ctx.db, brokerageId);
    expect(brokerage.balance).toBe(8499); // 10000 - (10*150 + 1)

    const share = await getAccount(ctx.db, shareId);
    expect(share).toMatchObject({ shares: 10, cost_basis: 1501, last_price: 150, balance: 1500 });
    expect(share.last_price_date).toBeTruthy();
  });

  it('rejects a buy when cash is insufficient', async () => {
    const { brokerageId, shareId } = await seedShareSetup();

    const result = await buyShare({
      shareAccountId: shareId,
      brokerageAccountId: brokerageId,
      quantity: 1000,
      price: 150,
      fee: 0,
    });

    expect(result).toEqual({ success: false, error: 'Insufficient cash balance' });
    // No partial writes on a rejected trade.
    expect((await getAccount(ctx.db, brokerageId)).balance).toBe(10_000);
    expect((await getAccount(ctx.db, shareId)).shares).toBe(0);
  });

  it('records a sell and clears the position when all shares are sold', async () => {
    const { brokerageId, shareId } = await seedShareSetup();
    await buyShare({ shareAccountId: shareId, brokerageAccountId: brokerageId, quantity: 10, price: 150, fee: 1 });

    const result = await sellShare({
      shareAccountId: shareId,
      brokerageAccountId: brokerageId,
      quantity: 10,
      price: 160,
      fee: 2,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.transaction).toMatchObject({ type: 'SHARE_SELL', amount: 1598 });

    const share = await getAccount(ctx.db, shareId);
    // Position fully closed: cost basis and mark-to-market balance both zero.
    expect(share).toMatchObject({ shares: 0, cost_basis: 0, balance: 0 });

    const brokerage = await getAccount(ctx.db, brokerageId);
    expect(brokerage.balance).toBe(8499 + 1598);
  });

  it('rejects selling more shares than are held', async () => {
    const { brokerageId, shareId } = await seedShareSetup();
    await buyShare({ shareAccountId: shareId, brokerageAccountId: brokerageId, quantity: 5, price: 100, fee: 0 });

    const result = await sellShare({
      shareAccountId: shareId,
      brokerageAccountId: brokerageId,
      quantity: 10,
      price: 100,
      fee: 0,
    });

    expect(result).toEqual({ success: false, error: 'Insufficient shares' });
  });

  it('refreshSharePrices fetches only accounts not already priced today', async () => {
    const { shareId } = await seedShareSetup();
    mockFetchStockPrices.mockResolvedValue({ AAPL: 175 });

    const first = await refreshSharePrices();
    expect(first).toEqual({ success: true, data: { updated: 1, failed: [], freshSkipped: 0 } });
    expect(mockFetchStockPrices).toHaveBeenCalledWith(['AAPL'], 'test-finnhub-key');
    expect((await getAccount(ctx.db, shareId)).last_price).toBe(175);

    // Second call the same day: already priced today, nothing to fetch.
    mockFetchStockPrices.mockClear();
    const second = await refreshSharePrices();
    expect(second).toEqual({ success: true, data: { updated: 0, failed: [], freshSkipped: 1 } });
    expect(mockFetchStockPrices).not.toHaveBeenCalled();

    // force bypasses the "already priced today" skip.
    mockFetchStockPrices.mockResolvedValue({ AAPL: 180 });
    const forced = await refreshSharePrices({ force: true });
    expect(forced).toEqual({ success: true, data: { updated: 1, failed: [], freshSkipped: 0 } });
  });

  it('refreshSharePrices reports a per-ticker failure without failing the whole batch', async () => {
    const { brokerageId } = await seedShareSetup();
    await seedAccount(ctx, {
      type: 'SHARE',
      currency: 'USD',
      brokerage: 'IBKR',
      ticker: 'MSFT',
      brokerage_account_id: brokerageId,
    });
    mockFetchStockPrices.mockResolvedValue({ AAPL: 175 }); // MSFT missing from the response

    const result = await refreshSharePrices();
    expect(result).toEqual({ success: true, data: { updated: 1, failed: ['MSFT'], freshSkipped: 0 } });
  });

  it('surfaces a Settings-pointing error when no Finnhub key is configured', async () => {
    await seedShareSetup();
    mockGetApiKey.mockResolvedValue(null);
    mockFetchStockPrices.mockRejectedValue(
      new Error('No Finnhub API key configured. Add one in Settings to enable price refresh.'),
    );

    const result = await refreshSharePrices();
    expect(result).toEqual({
      success: false,
      error: 'No Finnhub API key configured. Add one in Settings to enable price refresh.',
    });
  });

  it('setSharePrice lets the user override the last fetched price', async () => {
    const { shareId, brokerageId } = await seedShareSetup();
    await buyShare({ shareAccountId: shareId, brokerageAccountId: brokerageId, quantity: 10, price: 150, fee: 0 });

    const result = await setSharePrice({ accountId: shareId, price: 142.5 });

    expect(result).toEqual({ success: true, data: { balance: 1425 } });
    expect(await getAccount(ctx.db, shareId)).toMatchObject({ last_price: 142.5, balance: 1425 });
  });

  it('setSharePrice rejects a non-share account', async () => {
    const { brokerageId } = await seedShareSetup();
    const result = await setSharePrice({ accountId: brokerageId, price: 10 });
    expect(result).toEqual({ success: false, error: 'Selected account is not a share account' });
  });
});
