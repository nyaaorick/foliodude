import type { RewardCurrencyId, RewardRule } from './rewards';
import type { AirlineProgram, MileageTransferRateMap } from './mileage';

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  AIRLINE_MILES = 'AIRLINE_MILES',
  SHARE = 'SHARE',
}

export const SUPPORTED_CURRENCIES = {
  USD: { id: 'USD', name: 'US Dollar', symbol: '$' },
  EUR: { id: 'EUR', name: 'Euro', symbol: '€' },
  AUD: { id: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  NZD: { id: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  GBP: { id: 'GBP', name: 'British Pound Sterling', symbol: '£' },
  HKD: { id: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  CNH: { id: 'CNH', name: 'Chinese Yuan (Offshore)', symbol: '¥' },
} as const;

export type CurrencyId = keyof typeof SUPPORTED_CURRENCIES;

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  apy: number | null;
  credit_limit: number | null;
  reward_currency: RewardCurrencyId | null;
  reward_balance: number;
  airline_program: AirlineProgram | null;
  usd_per_10k_miles: number;
  transfer_rates: MileageTransferRateMap;
  currency: CurrencyId;
  ticker: string | null;
  brokerage_account_id: string | null;
  shares: number;
  cost_basis: number;
  last_price: number | null;
  last_price_date: string | null;
  reward_rules: RewardRule[];
  spend_stats: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface AccountWithStats extends Account {
  available_credit: number | null;
}

export type AccountOption = Pick<
  AccountWithStats,
  | 'id'
  | 'name'
  | 'type'
  | 'balance'
  | 'currency'
  | 'reward_currency'
  | 'reward_balance'
  | 'airline_program'
  | 'brokerage_account_id'
>;

export type CreateAccountInput = Pick<Account, 'type' | 'balance' | 'currency'> & {
  name?: string;
  credit_limit?: number;
  reward_currency?: RewardCurrencyId | null;
  airline_program?: AirlineProgram;
  usd_per_10k_miles?: number;
  ticker?: string;
  brokerage_account_id?: string;
  initial_shares?: number;
  initial_price?: number;
  deduct_from_brokerage?: boolean;
};

export type UpdateAccountInput = Partial<
  Pick<Account, 'name' | 'balance' | 'credit_limit' | 'usd_per_10k_miles'>
>;
