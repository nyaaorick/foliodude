import Decimal from 'decimal.js';

const EXCHANGE_RATE_API_URL = 'https://v6.exchangerate-api.com/v6';

interface ExchangeRateApiPayload {
  result?: string;
  conversion_rates?: Record<string, number>;
  'error-type'?: string;
}

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

async function fetchUsdBaseRates(apiKey: string): Promise<Record<string, number> | null> {
  const url = `${EXCHANGE_RATE_API_URL}/${apiKey}/latest/USD`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    console.warn(`ExchangeRate-API request failed with ${response.status}`);
    return null;
  }

  const payload = (await response.json()) as ExchangeRateApiPayload;
  if (
    payload.result !== 'success' ||
    !payload.conversion_rates ||
    typeof payload.conversion_rates !== 'object'
  ) {
    console.warn(
      `ExchangeRate-API payload invalid${payload['error-type'] ? `: ${payload['error-type']}` : ''}`,
    );
    return null;
  }

  return payload.conversion_rates;
}

/**
 * USD exchange rates for the given currencies.
 *
 * `apiKey` is a value the user typed into Settings (see lib/db/settings.ts) —
 * this module never reads an environment variable or ships a shared key
 * (docs/PLAN.md §1). With no key configured, every requested currency falls back to
 * 1:1 against USD; the caller is responsible for surfacing that as a staleness
 * warning rather than presenting it as a real rate.
 */
export async function fetchUsdExchangeRates(
  currencies: string[],
  apiKey: string | null,
  onNotice?: (message: string) => void,
): Promise<Record<string, number>> {
  const normalizedCurrencies = [
    ...new Set(currencies.map(normalizeCurrency).filter(Boolean)),
  ];

  if (normalizedCurrencies.length === 0) {
    return {};
  }

  const identityFallback = () =>
    Object.fromEntries(normalizedCurrencies.map((currency) => [currency, 1]));

  if (!apiKey) {
    onNotice?.('No exchange rate API key configured. Using a 1:1 exchange rate.');
    return identityFallback();
  }

  try {
    const conversionRates = await fetchUsdBaseRates(apiKey);
    if (!conversionRates) {
      onNotice?.('Exchange rates are unavailable. Using a 1:1 exchange rate.');
      return identityFallback();
    }

    const rates: Record<string, number> = { USD: 1 };

    for (const currency of normalizedCurrencies) {
      if (currency === 'USD') continue;

      const directRate = conversionRates[currency];
      if (typeof directRate !== 'number' || !Number.isFinite(directRate) || directRate <= 0) {
        onNotice?.(`Exchange rate unavailable for ${currency}. Using 1:1 against USD.`);
        rates[currency] = 1;
        continue;
      }

      rates[currency] = new Decimal(1).div(directRate).toDecimalPlaces(6).toNumber();
    }

    return rates;
  } catch {
    onNotice?.('Exchange rates could not be loaded. Using a 1:1 exchange rate.');
    return identityFallback();
  }
}
