const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';
const FINNHUB_CACHE_SECONDS = 10;

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

function getFinnhubApiKey() {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Finnhub API key is missing');
  }

  return apiKey;
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

  const response = await fetch(url.toString(), {
    next: { revalidate: FINNHUB_CACHE_SECONDS },
    headers: {
      accept: 'application/json',
    },
  });

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

    if (errorMessage.includes('api key')) {
      throw new Error('Finnhub API key is invalid');
    }

    if (errorMessage.includes('limit')) {
      throw new Error('Finnhub rate limit exceeded');
    }

    throw new Error(`Finnhub request failed: ${payload.error}`);
  }

  return readPrice(payload);
}

export async function fetchStockPrices(
  tickers: string[],
): Promise<StockPriceMap> {
  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  if (normalizedTickers.length === 0) {
    return {};
  }

  const apiKey = getFinnhubApiKey();
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
        firstError =
          error instanceof Error ? error : new Error('Failed to fetch stock prices');
      }
    }
  }

  if (Object.keys(prices).length === 0) {
    throw firstError ?? new Error('Failed to fetch stock prices');
  }

  return prices;
}
