import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchStockPrices } from '@/lib/utils/stock-price';

describe('fetchStockPrices', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws a Settings-pointing error when no key is configured', async () => {
    await expect(fetchStockPrices(['AAPL'], null)).rejects.toThrow(
      'Add one in Settings',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches and normalizes ticker casing', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ c: 189.5 }),
    } as Response);

    const result = await fetchStockPrices([' aapl '], 'user-key');

    expect(result).toEqual({ AAPL: 189.5 });
    const calledUrl = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('symbol=AAPL');
    expect(calledUrl).toContain('token=user-key');
  });

  it('throws on an invalid key (401)', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchStockPrices(['AAPL'], 'bad-key')).rejects.toThrow(
      'Finnhub API key is invalid',
    );
  });

  it('throws on rate limit (429)', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(fetchStockPrices(['AAPL'], 'user-key')).rejects.toThrow(
      'Finnhub rate limit exceeded',
    );
  });

  it('skips tickers with no usable quote but keeps the rest', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ c: 0 }) } as Response)
      .mockResolvedValueOnce(
        { ok: true, status: 200, json: async () => ({ c: 42 }) } as Response,
      );

    const result = await fetchStockPrices(['ZERO', 'GOOD'], 'user-key');
    expect(result).toEqual({ GOOD: 42 });
  });

  it('returns an empty map for an empty ticker list without calling fetch', async () => {
    expect(await fetchStockPrices([], 'user-key')).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
