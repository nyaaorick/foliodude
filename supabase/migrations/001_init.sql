-- ============================================================
-- 001_init.sql
-- Initial schema: accounts + transactions tables
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENUM types
-- ------------------------------------------------------------

CREATE TYPE public.account_type AS ENUM (
  'ASSET',
  'LIABILITY',
  'AIRLINE_MILES',
  'SHARE'
);

CREATE TYPE public.airline_program_type AS ENUM (
  'KRISFLYER',
  'AVIOS',
  'ASIA_MILES'
);

CREATE TYPE public.transaction_type AS ENUM (
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'REWARD_EARN',
  'REWARD_TRANSFER_IN',
  'REWARD_REDEEM',
  'MILEAGE_TRANSFER_IN',
  'MILEAGE_MANUAL_IN',
  'MILEAGE_REDEEM_FLIGHT',
  'SHARE_BUY',
  'SHARE_SELL'
);

-- ------------------------------------------------------------
-- 2. accounts table
-- ------------------------------------------------------------

CREATE TABLE public.accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  type            public.account_type NOT NULL,
  currency        TEXT        NOT NULL,
  balance         DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_limit    DECIMAL(12,2),
  reward_currency TEXT,
  reward_balance  INTEGER     NOT NULL DEFAULT 0 CHECK (reward_balance >= 0),
  airline_program public.airline_program_type,
  usd_per_10k_miles INTEGER   NOT NULL DEFAULT 0 CHECK (usd_per_10k_miles >= 0),
  transfer_rates  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  brokerage       TEXT,
  ticker          TEXT,
  brokerage_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  shares          DECIMAL(18,6) NOT NULL DEFAULT 0,
  cost_basis      DECIMAL(18,2) NOT NULL DEFAULT 0,
  last_price      DECIMAL(18,4),
  last_price_at   TIMESTAMPTZ,
  reward_rules    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  spend_stats     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  auto_pay_config JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_share_currency_check
    CHECK (type <> 'SHARE' OR currency = 'USD'),
  CONSTRAINT accounts_airline_miles_check
    CHECK (
      (
        type = 'AIRLINE_MILES'
        AND airline_program IS NOT NULL
        AND credit_limit IS NULL
        AND reward_currency IS NULL
        AND reward_balance = 0
        AND currency = 'USD'
        AND balance = trunc(balance)
        AND jsonb_typeof(transfer_rates) = 'object'
        AND brokerage IS NULL
        AND ticker IS NULL
        AND brokerage_account_id IS NULL
        AND shares = 0
        AND cost_basis = 0
        AND last_price IS NULL
        AND last_price_at IS NULL
        AND reward_rules = '[]'::jsonb
        AND spend_stats = '{}'::jsonb
      )
      OR (
        type <> 'AIRLINE_MILES'
        AND airline_program IS NULL
        AND transfer_rates = '{}'::jsonb
      )
    ),
  CONSTRAINT accounts_liability_reward_check
    CHECK (
      (
        type = 'LIABILITY'
        AND shares = 0
        AND cost_basis = 0
      )
      OR (
        type <> 'LIABILITY'
        AND reward_currency IS NULL
        AND reward_balance = 0
      )
    )
);

CREATE TABLE public.reward_rates (
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_currency    TEXT        NOT NULL,
  usd_per_10k_points INTEGER     NOT NULL CHECK (usd_per_10k_points >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reward_currency)
);

-- Index: fast lookup of all accounts for a given user
CREATE INDEX accounts_user_id_idx ON public.accounts(user_id);
CREATE INDEX reward_rates_user_id_idx ON public.reward_rates(user_id);
CREATE UNIQUE INDEX accounts_user_brokerage_ticker_unique_idx
  ON public.accounts(user_id, brokerage_account_id, ticker)
  WHERE type = 'SHARE';
CREATE UNIQUE INDEX accounts_user_airline_program_unique_idx
  ON public.accounts(user_id, airline_program)
  WHERE type = 'AIRLINE_MILES';

-- Trigger: keep updated_at in sync on every UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER reward_rates_set_updated_at
  BEFORE UPDATE ON public.reward_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3. transactions table
-- ------------------------------------------------------------

CREATE TABLE public.transactions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                     public.transaction_type NOT NULL,
  amount                   DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency                 TEXT,
  reward_currency          TEXT,
  metadata                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  reference_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  from_account             UUID        REFERENCES public.accounts(id) ON DELETE SET NULL,
  to_account               UUID        REFERENCES public.accounts(id) ON DELETE SET NULL,
  category                 TEXT,
  memo                     TEXT,
  share_ticker             TEXT,
  share_quantity           DECIMAL(18,6),
  share_price              DECIMAL(18,4),
  fee                      DECIMAL(18,2),
  transaction_at           TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_share_fields_check
    CHECK (
      (
        type::text IN ('SHARE_BUY', 'SHARE_SELL')
        AND share_ticker IS NOT NULL
        AND share_quantity IS NOT NULL
        AND share_quantity > 0
        AND share_price IS NOT NULL
        AND share_price > 0
        AND fee IS NOT NULL
        AND fee >= 0
      )
      OR (
        type::text NOT IN ('SHARE_BUY', 'SHARE_SELL')
        AND share_ticker IS NULL
        AND share_quantity IS NULL
        AND share_price IS NULL
        AND fee IS NULL
      )
    ),
  CONSTRAINT transactions_reward_fields_check
    CHECK (
      (
        type::text IN ('REWARD_EARN', 'REWARD_TRANSFER_IN', 'REWARD_REDEEM')
        AND currency IS NULL
        AND reward_currency IS NOT NULL
      )
      OR (
        type::text IN (
          'MILEAGE_TRANSFER_IN',
          'MILEAGE_MANUAL_IN',
          'MILEAGE_REDEEM_FLIGHT'
        )
        AND currency IS NULL
        AND reward_currency IS NULL
      )
      OR (
        type::text NOT IN (
          'REWARD_EARN',
          'REWARD_TRANSFER_IN',
          'REWARD_REDEEM',
          'MILEAGE_TRANSFER_IN',
          'MILEAGE_MANUAL_IN',
          'MILEAGE_REDEEM_FLIGHT'
        )
        AND currency IS NOT NULL
        AND reward_currency IS NULL
      )
    ),
  CONSTRAINT transactions_reward_account_direction_check
    CHECK (
      (
        type::text = 'REWARD_EARN'
        AND from_account IS NULL
        AND to_account IS NOT NULL
        AND reference_transaction_id IS NOT NULL
      )
      OR (
        type::text = 'REWARD_TRANSFER_IN'
        AND from_account IS NULL
        AND to_account IS NOT NULL
        AND reference_transaction_id IS NULL
      )
      OR (
        type::text = 'REWARD_REDEEM'
        AND from_account IS NOT NULL
        AND to_account IS NULL
      )
      OR (
        type::text IN ('MILEAGE_TRANSFER_IN', 'MILEAGE_MANUAL_IN')
        AND from_account IS NULL
        AND to_account IS NOT NULL
        AND reference_transaction_id IS NULL
      )
      OR (
        type::text = 'MILEAGE_REDEEM_FLIGHT'
        AND from_account IS NOT NULL
        AND to_account IS NULL
        AND reference_transaction_id IS NULL
      )
      OR (
        type::text NOT IN (
          'REWARD_EARN',
          'REWARD_TRANSFER_IN',
          'REWARD_REDEEM',
          'MILEAGE_TRANSFER_IN',
          'MILEAGE_MANUAL_IN',
          'MILEAGE_REDEEM_FLIGHT'
        )
        AND reference_transaction_id IS NULL
      )
    )
);

-- Indexes
CREATE INDEX transactions_user_id_idx      ON public.transactions(user_id);
CREATE INDEX transactions_from_account_idx ON public.transactions(from_account);
CREATE INDEX transactions_to_account_idx   ON public.transactions(to_account);
CREATE INDEX transactions_reference_transaction_id_idx
  ON public.transactions(reference_transaction_id);

-- ------------------------------------------------------------
-- 4. Row Level Security
-- ------------------------------------------------------------

ALTER TABLE public.accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- accounts policies
CREATE POLICY "accounts_select_own" ON public.accounts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "accounts_insert_own" ON public.accounts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "accounts_update_own" ON public.accounts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "accounts_delete_own" ON public.accounts
  FOR DELETE USING (user_id = auth.uid());

-- reward_rates policies
CREATE POLICY "reward_rates_select_own" ON public.reward_rates
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "reward_rates_insert_own" ON public.reward_rates
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "reward_rates_update_own" ON public.reward_rates
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "reward_rates_delete_own" ON public.reward_rates
  FOR DELETE USING (user_id = auth.uid());

-- transactions policies
CREATE POLICY "transactions_select_own" ON public.transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "transactions_insert_own" ON public.transactions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "transactions_update_own" ON public.transactions
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "transactions_delete_own" ON public.transactions
  FOR DELETE USING (user_id = auth.uid());
