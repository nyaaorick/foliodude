-- ============================================================================
-- 001_init — core schema (PGlite / local-first)
--
-- READ THIS HEADER INSTEAD OF THE CHECK BODIES. The two large CHECK constraints
-- below (accounts, transactions) encode discriminated-union rules that are much
-- faster to read as the matrices in this file than as SQL. If you change a rule,
-- update its matrix in the same edit.
--
-- TABLES  accounts · reward_rates · transactions
-- KEYS    every table carries a plain `user_id UUID` with no FK. There is no
--         auth.users, no RLS, no policies: one local database per user. Phase 4
--         rewrites user_id in place once OAuth lands (see lib/db/session.ts).
-- MONEY   DECIMAL, never float. Reward points/miles are whole numbers.
-- TIME    DATE only — there are no timestamps in this schema. A ledger entry
--         belongs to a day, not an instant, and day-granularity removes every
--         timezone conversion from the app. `transactions.seq` gives stable
--         insertion order within a day. The connection still pins UTC
--         (lib/db/client.ts) because CURRENT_DATE reads the session timezone.
-- ============================================================================


-- ── 1. ENUM types ───────────────────────────────────────────────────────────
-- Adding a value later: `ALTER TYPE x ADD VALUE 'y'` is transaction-safe on
-- PG12+, so it may live in a normal migration file. Removing or reordering a
-- value is not supported — write a new type and migrate the column instead.

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


-- ── 2. accounts ─────────────────────────────────────────────────────────────
-- One table, four discriminated types. `type` selects which columns are live;
-- the rest are forced to NULL / 0 / '{}' so a row can never carry stale data
-- from a different shape.
--
-- FIELD MATRIX  (· = forced empty: NULL, 0, '{}' or '[]')
--
--   column                 ASSET     LIABILITY   AIRLINE_MILES   SHARE
--   ---------------------  --------  ----------  --------------  ----------
--   currency               any       any         'USD'           'USD'
--   balance                money     money       whole miles     money
--   credit_limit           opt       opt         ·               opt
--   reward_currency        ·         opt         ·               ·
--   reward_balance         ·         >= 0        ·               ·
--   reward_rules           ·         [...]       ·               ·
--   spend_stats            ·         {...}       ·               ·
--   airline_program        ·         ·           REQUIRED        ·
--   usd_per_10k_miles      0         0           >= 0            0
--   transfer_rates         {}        {}          {...}           {}
--   brokerage / ticker     ·         ·           ·               used
--   brokerage_account_id   ·         ·           ·               -> accounts.id
--   shares / cost_basis    0         0           0               used
--   last_price(_date)      ·         ·           ·               used
--
-- Enforced by the two CHECKs at the bottom of the table. `AIRLINE_MILES` also
-- requires `balance = trunc(balance)` — miles are whole units stored in the
-- money column.
--
-- CASCADE NOTE  brokerage_account_id is ON DELETE SET NULL, so deleting a
-- brokerage leaves its SHARE rows orphaned rather than deleting holdings.
-- lib/actions/delete-actions.ts handles that case explicitly.

CREATE TABLE accounts (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL,
  name                 TEXT          NOT NULL,
  type                 account_type  NOT NULL,
  currency             TEXT          NOT NULL,
  balance              DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_limit         DECIMAL(12,2),
  reward_currency      TEXT,
  reward_balance       INTEGER       NOT NULL DEFAULT 0 CHECK (reward_balance >= 0),
  airline_program      airline_program_type,
  usd_per_10k_miles    INTEGER       NOT NULL DEFAULT 0 CHECK (usd_per_10k_miles >= 0),
  transfer_rates       JSONB         NOT NULL DEFAULT '{}'::jsonb
                                     CHECK (jsonb_typeof(transfer_rates) = 'object'),
  brokerage            TEXT,
  ticker               TEXT,
  brokerage_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  shares               DECIMAL(18,6) NOT NULL DEFAULT 0,
  cost_basis           DECIMAL(18,2) NOT NULL DEFAULT 0,
  last_price           DECIMAL(18,4),
  last_price_date      DATE,
  reward_rules         JSONB         NOT NULL DEFAULT '[]'::jsonb
                                     CHECK (jsonb_typeof(reward_rules) = 'array'),
  spend_stats          JSONB         NOT NULL DEFAULT '{}'::jsonb
                                     CHECK (jsonb_typeof(spend_stats) = 'object'),
  auto_pay_config      JSONB         CHECK (auto_pay_config IS NULL
                                            OR jsonb_typeof(auto_pay_config) = 'object'),
  created_at           DATE          NOT NULL DEFAULT CURRENT_DATE,
  updated_at           DATE          NOT NULL DEFAULT CURRENT_DATE,

  -- One branch per account type, in the same order as the matrix above. A
  -- searched CASE means each type is described exactly once, instead of the
  -- three overlapping OR-chains this replaced. `ELSE false` makes the rule fail
  -- closed: adding a value to account_type without adding a branch here is
  -- rejected at write time rather than silently unconstrained.
  CONSTRAINT accounts_shape_check CHECK (
    CASE
      WHEN type = 'ASSET' THEN
             airline_program IS NULL
         AND transfer_rates = '{}'::jsonb
         AND reward_currency IS NULL
         AND reward_balance = 0
         AND shares = 0
         AND cost_basis = 0

      WHEN type = 'LIABILITY' THEN
             airline_program IS NULL
         AND transfer_rates = '{}'::jsonb
         AND shares = 0
         AND cost_basis = 0

      WHEN type = 'AIRLINE_MILES' THEN
             airline_program IS NOT NULL
         AND currency = 'USD'
         AND balance = trunc(balance)          -- miles are whole units
         AND credit_limit IS NULL
         AND reward_currency IS NULL
         AND reward_balance = 0
         AND reward_rules = '[]'::jsonb
         AND spend_stats = '{}'::jsonb
         AND brokerage IS NULL
         AND ticker IS NULL
         AND brokerage_account_id IS NULL
         AND shares = 0
         AND cost_basis = 0
         AND last_price IS NULL
         AND last_price_date IS NULL

      WHEN type = 'SHARE' THEN
             currency = 'USD'                  -- FX happens at the brokerage
         AND airline_program IS NULL
         AND transfer_rates = '{}'::jsonb
         AND reward_currency IS NULL
         AND reward_balance = 0

      ELSE false
    END
  )
);


-- ── 3. reward_rates ─────────────────────────────────────────────────────────
-- Per-user valuation of a reward currency ('MR', 'UR', …) in USD per 10k points.
-- Note reward currency codes are NOT ISO 4217 and may be 2 characters.

CREATE TABLE reward_rates (
  user_id            UUID        NOT NULL,
  reward_currency    TEXT        NOT NULL,
  usd_per_10k_points INTEGER     NOT NULL CHECK (usd_per_10k_points >= 0),
  updated_at         DATE        NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, reward_currency)
);


-- ── 4. updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- WHEN guards keep updated_at meaningful: an UPDATE that changes nothing (a
-- common no-op when saving an unedited form) leaves the date alone.
CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reward_rates_set_updated_at
  BEFORE UPDATE ON reward_rates
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();


-- ── 5. transactions ─────────────────────────────────────────────────────────
-- Append-mostly ledger. 11 discriminated types across three families.
--
-- FIELD MATRIX  (REQ = NOT NULL required, · = must be NULL, — = unconstrained)
--
--   type                    currency  reward_ccy  from_acct  to_acct  ref_txn  share_*
--   ----------------------  --------  ----------  ---------  -------  -------  -------
--   EXPENSE                 REQ       ·           —          —        ·        ·
--   INCOME                  REQ       ·           —          —        ·        ·
--   TRANSFER                REQ       ·           —          —        ·        ·
--   SHARE_BUY               REQ       ·           —          —        ·        REQ
--   SHARE_SELL              REQ       ·           —          —        ·        REQ
--   REWARD_EARN             ·         REQ         ·          REQ      REQ      ·
--   REWARD_TRANSFER_IN      ·         REQ         ·          REQ      ·        ·
--   REWARD_REDEEM           ·         REQ         REQ        ·        —        ·
--   MILEAGE_TRANSFER_IN     ·         ·           ·          REQ      ·        ·
--   MILEAGE_MANUAL_IN       ·         ·           ·          REQ      ·        ·
--   MILEAGE_REDEEM_FLIGHT   ·         ·           REQ        ·        ·        ·
--
--   share_* = share_ticker, share_quantity, share_price, fee (all four together)
--
-- Reading the matrix: cash-family rows carry `currency`; reward and mileage rows
-- do not (their unit is the reward currency or miles). REWARD_EARN is the only
-- type requiring `reference_transaction_id` — it points at the EXPENSE that
-- generated the points, so deleting that expense must clawback the earn.
--
-- CASCADE NOTE  from_account / to_account are ON DELETE SET NULL: deleting an
-- account preserves its history as orphaned rows rather than erasing the ledger.
-- reference_transaction_id is likewise SET NULL.
--
-- `amount` is always > 0; direction comes from the type plus from/to, never from
-- a negative amount.

CREATE TABLE transactions (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID             NOT NULL,
  type                     transaction_type NOT NULL,
  amount                   DECIMAL(12,2)    NOT NULL CHECK (amount > 0),
  currency                 TEXT,
  reward_currency          TEXT,
  metadata                 JSONB            NOT NULL DEFAULT '{}'::jsonb
                                            CHECK (jsonb_typeof(metadata) = 'object'),
  reference_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  from_account             UUID REFERENCES accounts(id) ON DELETE SET NULL,
  to_account               UUID REFERENCES accounts(id) ON DELETE SET NULL,
  category                 TEXT,
  memo                     TEXT,
  share_ticker             TEXT,
  share_quantity           DECIMAL(18,6),
  share_price              DECIMAL(18,4),
  fee                      DECIMAL(18,2),
  transaction_date         DATE             NOT NULL,
  -- Monotonic insertion order. transaction_date is day-granular, so two rows on
  -- the same day need an explicit tiebreak for stable ledger ordering.
  seq                      BIGSERIAL        NOT NULL,
  created_at               DATE             NOT NULL DEFAULT CURRENT_DATE,

  -- share_* travel as a set: all four present on SHARE_BUY/SELL, all four NULL
  -- otherwise. Orthogonal to the shape rule below — it constrains only these
  -- four columns, so it stays its own constraint.
  CONSTRAINT transactions_share_fields_check CHECK (
    CASE
      WHEN type IN ('SHARE_BUY', 'SHARE_SELL') THEN
             share_ticker   IS NOT NULL
         AND share_quantity IS NOT NULL AND share_quantity > 0
         AND share_price    IS NOT NULL AND share_price    > 0
         AND fee            IS NOT NULL AND fee           >= 0
      ELSE
             share_ticker   IS NULL
         AND share_quantity IS NULL
         AND share_price    IS NULL
         AND fee            IS NULL
    END
  ),

  -- One branch per row shape, in the same order as the matrix above. Replaces
  -- two constraints that each re-enumerated the same type lists, so adding a
  -- transaction_type value now means editing exactly one place. `ELSE false`
  -- makes that omission fail closed instead of silently unconstrained.
  CONSTRAINT transactions_shape_check CHECK (
    CASE
      -- Cash family: denominated in a real currency, no reward provenance.
      WHEN type IN ('EXPENSE', 'INCOME', 'SHARE_BUY', 'SHARE_SELL') THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL

      -- A transfer must move between two different accounts.
      WHEN type = 'TRANSFER' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS DISTINCT FROM to_account

      -- Points earned by a specific expense, which it must point back at so a
      -- deleted expense can claw its reward back.
      WHEN type = 'REWARD_EARN' THEN
             currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NOT NULL

      WHEN type = 'REWARD_TRANSFER_IN' THEN
             currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NULL

      WHEN type = 'REWARD_REDEEM' THEN
             currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NOT NULL
         AND to_account IS NULL

      -- Mileage rows are denominated in miles: neither currency column applies.
      WHEN type IN ('MILEAGE_TRANSFER_IN', 'MILEAGE_MANUAL_IN') THEN
             currency IS NULL
         AND reward_currency IS NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NULL

      WHEN type = 'MILEAGE_REDEEM_FLIGHT' THEN
             currency IS NULL
         AND reward_currency IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NULL
         AND reference_transaction_id IS NULL

      ELSE false
    END
  )
);


-- ── 6. Indexes ──────────────────────────────────────────────────────────────
-- Tuned for ONE local database per user. A standalone user_id index is dead
-- weight here: every row shares the same value, so it can never narrow a scan,
-- yet it still costs on every write. Each index below therefore leads with
-- user_id only as a composite prefix that a real query actually uses.

-- "accounts of type X" (dashboard) and "all accounts" (prefix scan).
CREATE INDEX accounts_user_type_idx ON accounts(user_id, type);

-- Ledger paging: always user-scoped, always newest-first, seq breaking ties
-- between rows sharing a date.
CREATE INDEX transactions_user_date_idx
  ON transactions(user_id, transaction_date DESC, seq DESC);

-- Account detail pulls both sides of the ledger for one account.
CREATE INDEX transactions_from_account_idx ON transactions(from_account);
CREATE INDEX transactions_to_account_idx   ON transactions(to_account);

-- Clawback lookup: find the REWARD_EARN generated by a given expense.
CREATE INDEX transactions_reference_idx ON transactions(reference_transaction_id);

-- reward_rates needs no extra index: PRIMARY KEY (user_id, reward_currency)
-- already covers both the point lookup and the user-prefix scan.

-- One SHARE row per (brokerage account, ticker); one mileage account per program.
CREATE UNIQUE INDEX accounts_user_brokerage_ticker_unique_idx
  ON accounts(user_id, brokerage_account_id, ticker)
  WHERE type = 'SHARE';

CREATE UNIQUE INDEX accounts_user_airline_program_unique_idx
  ON accounts(user_id, airline_program)
  WHERE type = 'AIRLINE_MILES';
