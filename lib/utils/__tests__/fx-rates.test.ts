import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchUsdExchangeRates } from '@/lib/utils/fx-rates';

describe('fetchUsdExchangeRates', () => {
  const originalKey = process.env.EXCHANGE_RATE_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-key';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env.EXCHANGE_RATE_API_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns USD as 1 and inverts upstream rates for requested currencies', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        conversion_rates: {
          USD: 1,
          HKD: 7.8,
          CNH: 7.2,
          EUR: 0.92,
        },
      }),
    } as Response);

    const result = await fetchUsdExchangeRates(['USD', 'HKD', 'CNH']);

    expect(result).toEqual({
      USD: 1,
      HKD: 0.128205,
      CNH: 0.138889,
    });
  });

  it('returns only requested currencies plus USD', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        conversion_rates: {
          USD: 1,
          HKD: 7.8,
          EUR: 0.92,
        },
      }),
    } as Response);

    const result = await fetchUsdExchangeRates(['HKD']);

    expect(result).toEqual({
      USD: 1,
      HKD: 0.128205,
    });
  });

  it('falls back to 1:1 when the API key is missing', async () => {
    delete process.env.EXCHANGE_RATE_API_KEY;

    const result = await fetchUsdExchangeRates(['USD', 'HKD']);

    expect(result).toEqual({
      USD: 1,
      HKD: 1,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to 1:1 when the upstream request fails', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network error'));

    const result = await fetchUsdExchangeRates(['USD', 'HKD']);

    expect(result).toEqual({
      USD: 1,
      HKD: 1,
    });
  });

  it('falls back to 1:1 when a requested currency is missing upstream', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        conversion_rates: {
          USD: 1,
          EUR: 0.92,
        },
      }),
    } as Response);

    const result = await fetchUsdExchangeRates(['USD', 'HKD']);

    expect(result).toEqual({
      USD: 1,
      HKD: 1,
    });
  });
});
