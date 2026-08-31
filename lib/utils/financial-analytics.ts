import Decimal from 'decimal.js';
import { normalizeMileageTransferRates } from '@/lib/data/mileage-transfer-rates';
import { AccountType, type Account } from '@/lib/types/accounts';
import type {
  DashboardAllocationSlice,
  DashboardBreakdown,
  DashboardMonthlyExpensePoint,
  DashboardValuationInputs,
} from '@/lib/types/dashboard';
import type { AccountRow, RewardRateRow } from '@/lib/types/database';
import {
  getDefaultRewardRateMap,
  isRewardCurrencyId,
  type RewardRateMap,
} from '@/lib/types/rewards';
import { estimateMileageUsd } from '@/lib/types/mileage';
import { estimateRewardUsd } from '@/lib/types/rewards';

const ALLOCATION_META = {
  cash_banking: {
    label: 'Cash & Banking',
    color: '#B46A4D',
  },
  stock_portfolio: {
    label: 'Stock Portfolio',
    color: '#3B7A57',
  },
  reward_points: {
    label: 'Reward Points',
    color: '#2F6FED',
  },
  airline_miles: {
    label: 'Airline Miles',
    color: '#D6A44D',
  },
} as const;

export function roundMoneyDecimal(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function roundMoneyNumber(value: Decimal.Value) {
  return roundMoneyDecimal(value).toNumber();
}

export function normalizeMoneyAmount(value: Decimal.Value) {
  return roundMoneyNumber(value);
}

export function roundSharesDecimal(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

export function roundSharesNumber(value: Decimal.Value) {
  return roundSharesDecimal(value).toNumber();
}

function roundUsd(value: Decimal.Value) {
  return roundMoneyNumber(value);
}

function getFxRate(currency: string, fxRates: Record<string, number>) {
  return fxRates[currency] ?? 1;
}

export function mapAccountRowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    type: row.type as AccountType,
    balance: row.balance,
    credit_limit: row.credit_limit,
    reward_currency: isRewardCurrencyId(row.reward_currency ?? '')
      ? (row.reward_currency as Account['reward_currency'])
      : null,
    reward_balance: row.reward_balance ?? 0,
    airline_program: row.airline_program,
    usd_per_10k_miles: row.usd_per_10k_miles ?? 0,
    transfer_rates: normalizeMileageTransferRates(row.transfer_rates),
    currency: row.currency as Account['currency'],
    brokerage: row.brokerage ?? null,
    ticker: row.ticker ?? null,
    brokerage_account_id: row.brokerage_account_id ?? null,
    shares: row.shares ?? 0,
    cost_basis: row.cost_basis ?? 0,
    last_price: row.last_price ?? null,
    last_price_date: row.last_price_date ?? null,
    reward_rules: ((row.reward_rules ?? []) as unknown) as Account['reward_rules'],
    spend_stats: ((row.spend_stats ?? {}) as unknown) as Account['spend_stats'],
    auto_pay_config: row.auto_pay_config,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function buildRewardRateMap(rows: RewardRateRow[] | null): RewardRateMap {
  const rates = getDefaultRewardRateMap();

  for (const row of rows ?? []) {
    if (!isRewardCurrencyId(row.reward_currency)) {
      continue;
    }

    rates[row.reward_currency] = row.usd_per_10k_points;
  }

  return rates;
}

export function buildRewardRateMapStrict(rows: RewardRateRow[] | null): RewardRateMap {
  const rates = getDefaultRewardRateMap();

  for (const row of rows ?? []) {
    if (!isRewardCurrencyId(row.reward_currency)) {
      throw new Error(`Unsupported reward currency: ${row.reward_currency}`);
    }

    rates[row.reward_currency] = row.usd_per_10k_points;
  }

  return rates;
}

export function getAccountUsdValue(
  account: Account,
  rewardRates: RewardRateMap,
  fxRates: Record<string, number>,
) {
  switch (account.type) {
    case AccountType.ASSET:
    case AccountType.LIABILITY:
      return roundUsd(
        new Decimal(account.balance).mul(getFxRate(account.currency, fxRates)),
      );
    case AccountType.SHARE:
      return roundUsd(account.balance);
    case AccountType.AIRLINE_MILES:
      return estimateMileageUsd(Math.trunc(account.balance), account.usd_per_10k_miles ?? 0);
    default:
      return 0;
  }
}

function getRewardUsdValue(account: Account, rewardRates: RewardRateMap) {
  if (account.type !== AccountType.LIABILITY || !account.reward_currency) {
    return 0;
  }

  const rate = rewardRates[account.reward_currency] ?? 0;
  return estimateRewardUsd(account.reward_balance, rate);
}

export function buildDashboardBreakdown(
  accounts: Account[],
  rewardRates: RewardRateMap,
  fxRates: Record<string, number>,
): {
  breakdown: DashboardBreakdown;
  assetsUsd: number;
  liabilitiesUsd: number;
  netWorthUsd: number;
  valuationInputs: DashboardValuationInputs;
} {
  const breakdown: DashboardBreakdown = {
    cash_banking: 0,
    credit_card_debt: 0,
    credit_card_overpayment: 0,
    stock_portfolio: 0,
    reward_points: 0,
    airline_miles: 0,
    accounts: [],
  };

  for (const account of accounts) {
    const baseUsd = getAccountUsdValue(account, rewardRates, fxRates);
    const rewardUsd = getRewardUsdValue(account, rewardRates);

    if (account.type === AccountType.ASSET) {
      breakdown.cash_banking = roundUsd(
        new Decimal(breakdown.cash_banking).plus(baseUsd),
      );
      breakdown.accounts.push({
        account_id: account.id,
        name: account.name,
        type: account.type,
        usd: baseUsd,
      });
      continue;
    }

    if (account.type === AccountType.LIABILITY) {
      if (baseUsd < 0) {
        breakdown.credit_card_debt = roundUsd(
          new Decimal(breakdown.credit_card_debt).plus(Math.abs(baseUsd)),
        );
      } else if (baseUsd > 0) {
        breakdown.credit_card_overpayment = roundUsd(
          new Decimal(breakdown.credit_card_overpayment).plus(baseUsd),
        );
      }

      breakdown.reward_points = roundUsd(
        new Decimal(breakdown.reward_points).plus(rewardUsd),
      );

      breakdown.accounts.push({
        account_id: account.id,
        name: account.name,
        type: account.type,
        usd: roundUsd(new Decimal(baseUsd).plus(rewardUsd)),
      });
      continue;
    }

    if (account.type === AccountType.SHARE) {
      breakdown.stock_portfolio = roundUsd(
        new Decimal(breakdown.stock_portfolio).plus(baseUsd),
      );
      breakdown.accounts.push({
        account_id: account.id,
        name: account.name,
        type: account.type,
        usd: baseUsd,
      });
      continue;
    }

    if (account.type === AccountType.AIRLINE_MILES) {
      breakdown.airline_miles = roundUsd(
        new Decimal(breakdown.airline_miles).plus(baseUsd),
      );
      breakdown.accounts.push({
        account_id: account.id,
        name: account.name,
        type: account.type,
        usd: baseUsd,
      });
    }
  }

  const assetsUsd = roundUsd(
    new Decimal(breakdown.cash_banking)
      .plus(breakdown.stock_portfolio)
      .plus(breakdown.reward_points)
      .plus(breakdown.airline_miles),
  );
  const liabilitiesUsd = roundUsd(
    new Decimal(breakdown.credit_card_debt).minus(breakdown.credit_card_overpayment),
  );
  const netWorthUsd = roundUsd(new Decimal(assetsUsd).minus(liabilitiesUsd));

  return {
    breakdown,
    assetsUsd,
    liabilitiesUsd,
    netWorthUsd,
    valuationInputs: {
      fx_rates: fxRates,
      reward_rates: rewardRates,
      mileage_rates: Object.fromEntries(
        accounts
          .filter((account) => account.type === AccountType.AIRLINE_MILES)
          .map((account) => [account.id, account.usd_per_10k_miles ?? 0]),
      ),
    },
  };
}

export function buildAllocationSlices(
  breakdown: DashboardBreakdown,
): DashboardAllocationSlice[] {
  const totalPositiveAssets = roundUsd(
    new Decimal(breakdown.cash_banking)
      .plus(breakdown.stock_portfolio)
      .plus(breakdown.reward_points)
      .plus(breakdown.airline_miles),
  );

  return (Object.entries(ALLOCATION_META) as Array<
    [keyof typeof ALLOCATION_META, (typeof ALLOCATION_META)[keyof typeof ALLOCATION_META]]
  >)
    .map(([key, meta]) => ({
      key,
      label: meta.label,
      usd: breakdown[key],
      percentage:
        totalPositiveAssets > 0
          ? roundUsd(new Decimal(breakdown[key]).div(totalPositiveAssets).mul(100))
          : 0,
      color: meta.color,
    }))
    .filter((slice) => slice.usd > 0);
}

export interface ExpenseRow {
  amount: number;
  currency: string | null;
  category: string | null;
  transaction_date: string;
}

function toMonthKey(value: string) {
  return value.slice(0, 7);
}

export function buildMonthlyExpenseSeries(
  expenses: ExpenseRow[],
  fxRates: Record<string, number>,
): {
  monthlyExpenses: DashboardMonthlyExpensePoint[];
  expenseCategories: string[];
} {
  const monthMap = new Map<string, Record<string, number>>();
  const categorySet = new Set<string>();

  for (const expense of expenses) {
    const month = toMonthKey(expense.transaction_date);
    const category = expense.category?.trim() || 'Other';
    const currency = expense.currency?.trim().toUpperCase() || 'USD';
    const usdAmount = roundUsd(
      new Decimal(expense.amount).mul(getFxRate(currency, fxRates)),
    );

    categorySet.add(category);

    const current = monthMap.get(month) ?? {};
    current[category] = roundUsd(new Decimal(current[category] ?? 0).plus(usdAmount));
    monthMap.set(month, current);
  }

  const expenseCategories = [...categorySet].sort((a, b) => a.localeCompare(b));
  const monthlyExpenses = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, categories]) => {
      const point: DashboardMonthlyExpensePoint = { month };

      for (const category of expenseCategories) {
        point[category] = categories[category] ?? 0;
      }

      return point;
    });

  return {
    monthlyExpenses,
    expenseCategories,
  };
}
