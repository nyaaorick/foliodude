// Raw Supabase DB types — auto-synced with supabase/migrations/001_init.sql
// Do NOT mix ViewModels into this file; see lib/types/accounts.ts for those.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id:              string
          user_id:         string
          name:            string
          type:            Database['public']['Enums']['account_type']
          currency:        string
          balance:         number
          credit_limit:    number | null
          reward_currency: string | null
          reward_balance:  number
          airline_program: Database['public']['Enums']['airline_program_type'] | null
          usd_per_10k_miles: number
          transfer_rates: Json
          brokerage:       string | null
          ticker:          string | null
          brokerage_account_id: string | null
          shares:          number
          cost_basis:      number
          last_price:      number | null
          last_price_at:   string | null
          reward_rules:    Json
          spend_stats:     Json
          auto_pay_config: Json | null
          created_at:      string
          updated_at:      string
        }
        Insert: {
          id?:             string
          user_id:         string
          name:            string
          type:            Database['public']['Enums']['account_type']
          currency:        string
          balance?:        number
          credit_limit?:   number | null
          reward_currency?: string | null
          reward_balance?:  number
          airline_program?: Database['public']['Enums']['airline_program_type'] | null
          usd_per_10k_miles?: number
          transfer_rates?: Json
          brokerage?:      string | null
          ticker?:         string | null
          brokerage_account_id?: string | null
          shares?:         number
          cost_basis?:     number
          last_price?:     number | null
          last_price_at?:  string | null
          reward_rules?:   Json
          spend_stats?:    Json
          auto_pay_config?: Json | null
          created_at?:     string
          updated_at?:     string
        }
        Update: {
          id?:             string
          user_id?:        string
          name?:           string
          type?:           Database['public']['Enums']['account_type']
          currency?:       string
          balance?:        number
          credit_limit?:   number | null
          reward_currency?: string | null
          reward_balance?:  number
          airline_program?: Database['public']['Enums']['airline_program_type'] | null
          usd_per_10k_miles?: number
          transfer_rates?: Json
          brokerage?:      string | null
          ticker?:         string | null
          brokerage_account_id?: string | null
          shares?:         number
          cost_basis?:     number
          last_price?:     number | null
          last_price_at?:  string | null
          reward_rules?:   Json
          spend_stats?:    Json
          auto_pay_config?: Json | null
          created_at?:     string
          updated_at?:     string
        }
      }
      reward_rates: {
        Row: {
          user_id:            string
          reward_currency:    string
          usd_per_10k_points: number
          updated_at:         string
        }
        Insert: {
          user_id:            string
          reward_currency:    string
          usd_per_10k_points: number
          updated_at?:        string
        }
        Update: {
          user_id?:            string
          reward_currency?:    string
          usd_per_10k_points?: number
          updated_at?:         string
        }
      }
      net_worth_snapshots: {
        Row: {
          id: string
          user_id: string
          snapshot_date: string
          snapshot_at: string
          net_worth_usd: number
          assets_usd: number
          liabilities_usd: number
          breakdown: Json
          valuation_inputs: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          snapshot_date: string
          snapshot_at?: string
          net_worth_usd?: number
          assets_usd?: number
          liabilities_usd?: number
          breakdown?: Json
          valuation_inputs?: Json
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          snapshot_date?: string
          snapshot_at?: string
          net_worth_usd?: number
          assets_usd?: number
          liabilities_usd?: number
          breakdown?: Json
          valuation_inputs?: Json
          created_at?: string
        }
      }
      transactions: {
        Row: {
          id:             string
          user_id:        string
          type:           Database['public']['Enums']['transaction_type']
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
          fee:            number | null
          transaction_at: string
          created_at:     string
        }
        Insert: {
          id?:            string
          user_id:        string
          type:           Database['public']['Enums']['transaction_type']
          amount:         number
          currency?:      string | null
          reward_currency?: string | null
          metadata?:      Json
          reference_transaction_id?: string | null
          from_account?:  string | null
          to_account?:    string | null
          category?:      string | null
          memo?:          string | null
          share_ticker?:  string | null
          share_quantity?: number | null
          share_price?:   number | null
          fee?:           number | null
          transaction_at: string
          created_at?:    string
        }
        Update: {
          id?:            string
          user_id?:       string
          type?:          Database['public']['Enums']['transaction_type']
          amount?:        number
          currency?:      string | null
          reward_currency?: string | null
          metadata?:      Json
          reference_transaction_id?: string | null
          from_account?:  string | null
          to_account?:    string | null
          category?:      string | null
          memo?:          string | null
          share_ticker?:  string | null
          share_quantity?: number | null
          share_price?:   number | null
          fee?:           number | null
          transaction_at?: string
          created_at?:    string
        }
      }
    }
    Enums: {
      account_type:     'ASSET' | 'LIABILITY' | 'AIRLINE_MILES' | 'SHARE'
      airline_program_type:
        | 'ALASKA_AS'
        | 'KRISFLYER'
        | 'UNITED_MILEAGEPLUS'
        | 'AVIOS'
        | 'ASIA_MILES'
      transaction_type:
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
    }
  }
}

// Convenience aliases — use these in Server Actions and ViewModels
export type AccountRow       = Database['public']['Tables']['accounts']['Row']
export type AccountInsert    = Database['public']['Tables']['accounts']['Insert']
export type AccountUpdate    = Database['public']['Tables']['accounts']['Update']
export type RewardRateRow    = Database['public']['Tables']['reward_rates']['Row']
export type RewardRateInsert = Database['public']['Tables']['reward_rates']['Insert']
export type RewardRateUpdate = Database['public']['Tables']['reward_rates']['Update']
export type NetWorthSnapshotRow = Database['public']['Tables']['net_worth_snapshots']['Row']
export type NetWorthSnapshotInsert = Database['public']['Tables']['net_worth_snapshots']['Insert']
export type NetWorthSnapshotUpdate = Database['public']['Tables']['net_worth_snapshots']['Update']
export type TransactionRow   = Database['public']['Tables']['transactions']['Row']
export type TransactionInsert = Database['public']['Tables']['transactions']['Insert']
export type TransactionUpdate = Database['public']['Tables']['transactions']['Update']
