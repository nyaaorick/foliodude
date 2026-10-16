const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';

export interface StockPriceMap {
  [ticker: string]: number;
}

interface FinnhubQuotePayload {
  c?: number;
  error?: string;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function readPrice(payload: FinnhubQuotePayload) {
  const price = payload.c;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return price;
}

async function fetchFinnhubQuote(ticker: string, apiKey: string): Promise<number | null> {
  const url = new URL(FINNHUB_QUOTE_URL);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('token', apiKey);

  const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });

  if (response.status === 401) {
    throw new Error('Finnhub API key is invalid');
  }
  if (response.status === 429) {
    throw new Error('Finnhub rate limit exceeded');
  }
  if (!response.ok) {
    throw new Error(`Finnhub request failed with ${response.status}`);
  }

  const payload = (await response.json()) as FinnhubQuotePayload;

  if (payload.error) {
    const errorMessage = payload.error.toLowerCase();
    if (errorMessage.includes('api key')) throw new Error('Finnhub API key is invalid');
    if (errorMessage.includes('limit')) throw new Error('Finnhub rate limit exceeded');
    throw new Error(`Finnhub request failed: ${payload.error}`);
  }

  return readPrice(payload);
}

/**
 * Share prices for the given tickers.
 *
 * `apiKey` is a value the user typed into Settings (see lib/db/settings.ts) —
 * this module never reads an environment variable or ships a shared key
 * (docs/PLAN.md §1). With no key configured this throws rather than silently
 * returning nothing, since a share account with a stale price is a valuation
 * error the caller must surface, not swallow.
 */
export async function fetchStockPrices(
  tickers: string[],
  apiKey: string | null,
): Promise<StockPriceMap> {
  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  if (normalizedTickers.length === 0) {
    return {};
  }

  if (!apiKey) {
    throw new Error('No Finnhub API key configured. Add one on the Lab page to enable price refresh.');
  }

  const prices: StockPriceMap = {};
  let firstError: Error | null = null;

  for (const ticker of normalizedTickers) {
    try {
      const price = await fetchFinnhubQuote(ticker, apiKey);
      if (typeof price === 'number') {
        prices[ticker] = price;
      }
    } catch (error) {
      if (!firstError) {
        firstError = error instanceof Error ? error : new Error('Failed to fetch stock prices');
      }
    }
  }

  if (Object.keys(prices).length === 0) {
    throw firstError ?? new Error('Failed to fetch stock prices');
  }

  return prices;
}
