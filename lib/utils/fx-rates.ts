import Decimal from 'decimal.js';

const EXCHANGE_RATE_API_URL = 'https://v6.exchangerate-api.com/v6';
const EXCHANGE_RATE_CACHE_SECONDS = 3600;

interface ExchangeRateApiPayload {
  result?: string;
  conversion_rates?: Record<string, number>;
  'error-type'?: string;
}

function getExchangeRateApiKey() {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('ExchangeRate-API key is missing');
  }

  return apiKey;
}

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

async function fetchUsdBaseRates(
  apiKey: string,
): Promise<Record<string, number> | null> {
  const url = `${EXCHANGE_RATE_API_URL}/${apiKey}/latest/USD`;
  const response = await fetch(url, {
    next: { revalidate: EXCHANGE_RATE_CACHE_SECONDS },
    headers: {
      accept: 'application/json',
    },
  });

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

export async function fetchUsdExchangeRates(
  currencies: string[],
): Promise<Record<string, number>> {
  const normalizedCurrencies = [
    ...new Set(currencies.map(normalizeCurrency).filter(Boolean)),
  ];

  if (normalizedCurrencies.length === 0) {
    return {};
  }

  const rates: Record<string, number> = { USD: 1 };

  let apiKey: string;
  try {
    apiKey = getExchangeRateApiKey();
  } catch {
    return Object.fromEntries(normalizedCurrencies.map((currency) => [currency, 1]));
  }

  try {
    const conversionRates = await fetchUsdBaseRates(apiKey);
    if (!conversionRates) {
      return Object.fromEntries(normalizedCurrencies.map((currency) => [currency, 1]));
    }

    for (const currency of normalizedCurrencies) {
      if (currency === 'USD') {
        rates.USD = 1;
        continue;
      }

      const directRate = conversionRates[currency];
      if (
        typeof directRate !== 'number' ||
        !Number.isFinite(directRate) ||
        directRate <= 0
      ) {
        rates[currency] = 1;
        continue;
      }

      rates[currency] = new Decimal(1).div(directRate).toDecimalPlaces(6).toNumber();
    }
  } catch {
    return Object.fromEntries(normalizedCurrencies.map((currency) => [currency, 1]));
  }

  return rates;
}
