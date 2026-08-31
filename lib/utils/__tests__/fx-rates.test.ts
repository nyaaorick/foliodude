import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchUsdExchangeRates } from '@/lib/utils/fx-rates';

describe('fetchUsdExchangeRates', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns USD as 1 and inverts upstream rates for requested currencies', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        conversion_rates: { USD: 1, HKD: 7.8, CNH: 7.2, EUR: 0.92 },
      }),
    } as Response);

    const result = await fetchUsdExchangeRates(['USD', 'HKD', 'CNH'], 'user-key');

    expect(result).toEqual({ USD: 1, HKD: 0.128205, CNH: 0.138889 });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/user-key/latest/USD'),
      expect.anything(),
    );
  });

  it('falls back to 1:1 for every currency when no key is configured', async () => {
    const result = await fetchUsdExchangeRates(['HKD', 'EUR'], null);
    expect(result).toEqual({ HKD: 1, EUR: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to 1:1 when the upstream request fails', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await fetchUsdExchangeRates(['HKD'], 'user-key');
    expect(result).toEqual({ HKD: 1 });
  });

  it('falls back to 1:1 when fetch throws', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));
    const result = await fetchUsdExchangeRates(['HKD'], 'user-key');
    expect(result).toEqual({ HKD: 1 });
  });

  it('returns an empty map for an empty currency list without calling fetch', async () => {
    expect(await fetchUsdExchangeRates([], 'user-key')).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
