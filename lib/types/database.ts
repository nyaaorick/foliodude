// Row shapes returned by the queries in lib/actions — hand-kept in sync with
// lib/db/migrations/001_init.sql. Do NOT mix ViewModels into this file; see
// lib/types/accounts.ts for those.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type AccountTypeValue = 'ASSET' | 'LIABILITY' | 'AIRLINE_MILES' | 'SHARE'

export type AirlineProgramValue =
  | 'ALASKA_AS'
  | 'KRISFLYER'
  | 'UNITED_MILEAGEPLUS'
  | 'AVIOS'
  | 'ASIA_MILES'

export type TransactionTypeValue =
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER'
  | 'REWARD_EARN'
  | 'REWARD_TRANSFER_IN'
  | 'REWARD_REDEEM'
  | 'MILEAGE_TRANSFER_IN'
  | 'MILEAGE_MANUAL_IN'
  | 'MILEAGE_REDEEM_FLIGHT'
  | 'SHARE_BUY'
  | 'SHARE_SELL'

/** One row of the `accounts_flat` view: an account joined to its details. */
export interface AccountRow {
  id:              string
  name:            string
  type:            AccountTypeValue
  currency:        string
  balance:         number
  apy:             number | null
  credit_limit:    number | null
  reward_currency: string | null
  reward_balance:  number
  reward_rules:    Json
  spend_stats:     Json
  airline_program: AirlineProgramValue | null
  usd_per_10k_miles: number
  transfer_rates:  Json
  brokerage_account_id: string | null
  ticker:          string | null
  shares:          number
  cost_basis:      number
  last_price:      number | null
  last_price_date: string | null
  created_at:      string
  updated_at:      string
}

export interface RewardRateRow {
  reward_currency:    string
  usd_per_10k_points: number
  updated_at:         string
}

export interface TransactionRow {
  id:             string
  type:           TransactionTypeValue
  amount:         number
  currency:       string | null
  reward_currency: string | null
  metadata:       Json
  reference_transaction_id: string | null
  from_account:   string | null
  to_account:     string | null
  category:       string | null
  memo:           string | null
  share_ticker:   string | null
  share_quantity: number | null
  share_price:    number | null
  transaction_date: string
  seq:            number
  created_at:     string
  deleted_at:     string | null
}
