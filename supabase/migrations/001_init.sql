-- ============================================================
-- 001_init.sql  (PGLite local-first edition)
-- Removed: auth.users foreign keys, RLS, all CREATE POLICY
-- Kept:    ENUMs, CHECK constraints, indexes, triggers
-- user_id is stored as a plain UUID (set by the frontend
-- after Supabase OAuth login; cloud sync is handled at the
-- Storage layer, not the DB layer).
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENUM types
-- ------------------------------------------------------------

CREATE TYPE account_type AS ENUM (
  'ASSET',
  'LIABILITY',
  'AIRLINE_MILES',
  'SHARE'
);

CREATE TYPE airline_program_type AS ENUM (
  'KRISFLYER',
  'AVIOS',
  'ASIA_MILES'
);

CREATE TYPE transaction_type AS ENUM (
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

CREATE TABLE accounts (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL,   -- set by frontend after OAuth; no FK to auth.users
  name                 TEXT          NOT NULL,
  type                 account_type  NOT NULL,
  currency             TEXT          NOT NULL,
  balance              DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_limit         DECIMAL(12,2),
  reward_currency      TEXT,
  reward_balance       INTEGER       NOT NULL DEFAULT 0 CHECK (reward_balance >= 0),
  airline_program      airline_program_type,
  usd_per_10k_miles    INTEGER       NOT NULL DEFAULT 0 CHECK (usd_per_10k_miles >= 0),
  transfer_rates       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  brokerage            TEXT,
  ticker               TEXT,
  brokerage_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  shares               DECIMAL(18,6) NOT NULL DEFAULT 0,
  cost_basis           DECIMAL(18,2) NOT NULL DEFAULT 0,
  last_price           DECIMAL(18,4),
  last_price_at        TIMESTAMPTZ,
  reward_rules         JSONB         NOT NULL DEFAULT '[]'::jsonb,
  spend_stats          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  auto_pay_config      JSONB,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
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

-- ------------------------------------------------------------
-- 3. reward_rates table
-- ------------------------------------------------------------

CREATE TABLE reward_rates (
  user_id            UUID    NOT NULL,           -- plain UUID, no FK
  reward_currency    TEXT    NOT NULL,
  usd_per_10k_points INTEGER NOT NULL CHECK (usd_per_10k_points >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reward_currency)
);

-- ------------------------------------------------------------
-- 4. Indexes
-- ------------------------------------------------------------

CREATE INDEX accounts_user_id_idx ON accounts(user_id);
CREATE INDEX reward_rates_user_id_idx ON reward_rates(user_id);

CREATE UNIQUE INDEX accounts_user_brokerage_ticker_unique_idx
  ON accounts(user_id, brokerage_account_id, ticker)
  WHERE type = 'SHARE';

CREATE UNIQUE INDEX accounts_user_airline_program_unique_idx
  ON accounts(user_id, airline_program)
  WHERE type = 'AIRLINE_MILES';

-- ------------------------------------------------------------
-- 5. updated_at trigger (PGLite supports plpgsql)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reward_rates_set_updated_at
  BEFORE UPDATE ON reward_rates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 6. transactions table
-- ------------------------------------------------------------

CREATE TABLE transactions (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID             NOT NULL,  -- plain UUID, no FK
  type                     transaction_type NOT NULL,
  amount                   DECIMAL(12,2)    NOT NULL CHECK (amount > 0),
  currency                 TEXT,
  reward_currency          TEXT,
  metadata                 JSONB            NOT NULL DEFAULT '{}'::jsonb,
  reference_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  from_account             UUID REFERENCES accounts(id) ON DELETE SET NULL,
  to_account               UUID REFERENCES accounts(id) ON DELETE SET NULL,
  category                 TEXT,
  memo                     TEXT,
  share_ticker             TEXT,
  share_quantity           DECIMAL(18,6),
  share_price              DECIMAL(18,4),
  fee                      DECIMAL(18,2),
  transaction_at           TIMESTAMPTZ      NOT NULL,
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT now(),
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
CREATE INDEX transactions_user_id_idx      ON transactions(user_id);
CREATE INDEX transactions_from_account_idx ON transactions(from_account);
CREATE INDEX transactions_to_account_idx   ON transactions(to_account);
CREATE INDEX transactions_reference_idx    ON transactions(reference_transaction_id);
CREATE INDEX transactions_at_idx           ON transactions(transaction_at DESC);
