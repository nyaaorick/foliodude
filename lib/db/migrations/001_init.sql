-- ============================================================================
-- 001_init — core schema (PGlite / local-first)
--
-- TABLES  accounts · liability_details · mileage_details · share_details
--         reward_rates · transactions · net_worth_snapshots · device_secrets
-- VIEW    accounts_flat — every account joined to its details, in the flat shape
--         the app reads. Reads go through the view; writes go to the real tables.
--
-- ONE DATABASE, ONE USER. There is no user_id, no auth, no RLS: the database is
-- the user's own and lives on their device. Drive sync replaces the whole file
-- (lib/db/backup.ts), so nothing here needs an account identity.
--
-- ACCOUNTS  `accounts` holds what every account has. Each account type has its
-- own details table, keyed by account_id and tied to its parent through a
-- composite foreign key (account_id, type) -> accounts (id, type). The details
-- row's `type` is a CHECK-pinned constant, so a mileage row can only ever hang
-- off an AIRLINE_MILES account — the database, not the app, enforces the kind.
-- Everything a type requires is a plain NOT NULL / UNIQUE / FK on its table.
--
--   ASSET           accounts only (+ optional apy)
--   LIABILITY       + liability_details  credit limit, reward points, rules
--   AIRLINE_MILES   + mileage_details    program, valuation, transfer rates
--   SHARE           + share_details      brokerage, ticker, position, price
--
-- MONEY   DECIMAL, never float. Reward points and miles are whole numbers.
-- TIME    `*_at` audit columns are TIMESTAMPTZ. Every `*_date` is a DATE: a
--         ledger entry belongs to a day, not an instant. The app supplies that
--         day from the device's calendar (lib/utils/local-date.ts); the schema
--         never calls CURRENT_DATE. `transactions.seq` gives stable insertion
--         order within a day.
-- DELETE  Transactions are tombstoned (`deleted_at`), never edited. The delete
--         action reverses their balance effects in the same transaction.
-- ============================================================================


-- ── 1. ENUM types ───────────────────────────────────────────────────────────
-- Adding a value later: `ALTER TYPE x ADD VALUE 'y'` is transaction-safe on
-- PG12+. Removing or reordering a value is not supported.

CREATE TYPE account_type AS ENUM (
  'ASSET',
  'LIABILITY',
  'AIRLINE_MILES',
  'SHARE'
);

CREATE TYPE airline_program_type AS ENUM (
  'KRISFLYER',
  'AVIOS',
  'ASIA_MILES',
  'ALASKA_AS',
  'UNITED_MILEAGEPLUS'
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


-- ── 2. updated_at trigger ───────────────────────────────────────────────────

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── 3. accounts ─────────────────────────────────────────────────────────────
-- Each CHECK has one job and a name that says which, so a violation reads as
-- the rule that was broken.

CREATE TABLE accounts (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT          NOT NULL,
  type       account_type  NOT NULL,
  currency   TEXT          NOT NULL,
  balance    DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- Asset accounts only; percent per year.
  apy        DECIMAL(7,4),
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Target of the composite FKs from the details tables.
  CONSTRAINT accounts_id_type_unique UNIQUE (id, type),

  CONSTRAINT accounts_name_check     CHECK (btrim(name) <> ''),
  CONSTRAINT accounts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT accounts_apy_check      CHECK (apy IS NULL OR (type = 'ASSET' AND apy >= 0)),
  -- Cash cannot be overdrawn. Every debit path (expense, transfer, trade,
  -- adjustment, delete-reversal) relies on this one rule; lib/db/ledger.ts
  -- turns its violation into "Insufficient balance".
  CONSTRAINT accounts_asset_balance_check CHECK (type <> 'ASSET' OR balance >= 0),
  -- Miles are whole units stored in the money column; they cannot go negative.
  CONSTRAINT accounts_miles_check    CHECK (
    type <> 'AIRLINE_MILES'
    OR (currency = 'USD' AND balance >= 0 AND balance = trunc(balance))
  ),
  -- A position's balance is shares x price; FX happens at the brokerage.
  CONSTRAINT accounts_share_check    CHECK (type <> 'SHARE' OR (currency = 'USD' AND balance >= 0))
);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();


-- ── 4. liability_details ────────────────────────────────────────────────────
-- Reward points live here, next to the rules that earn them. `spend_stats` is
-- keyed "YYYY[-MM]_Category" and tracks cap usage.

CREATE TABLE liability_details (
  account_id      UUID         PRIMARY KEY,
  type            account_type NOT NULL DEFAULT 'LIABILITY' CHECK (type = 'LIABILITY'),
  credit_limit    DECIMAL(12,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  -- Not ISO 4217: reward currency codes ('MR', 'UR', …) may be 2 characters.
  reward_currency TEXT         CHECK (reward_currency ~ '^[A-Z]{2,4}$'),
  reward_balance  INTEGER      NOT NULL DEFAULT 0,
  reward_rules    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  spend_stats     JSONB        NOT NULL DEFAULT '{}'::jsonb,

  FOREIGN KEY (account_id, type) REFERENCES accounts (id, type) ON DELETE CASCADE,

  CONSTRAINT liability_reward_balance_check CHECK (reward_balance >= 0),

  -- Points mean nothing without a currency to denominate them in. Rules may be
  -- set ahead of one, so they are not tied to it.
  CONSTRAINT liability_reward_check CHECK (reward_currency IS NOT NULL OR reward_balance = 0),
  -- Array of { category: string, multiplier: number >= 0, … }.
  CONSTRAINT liability_reward_rules_check CHECK (
    jsonb_typeof(reward_rules) = 'array'
    AND NOT jsonb_path_exists(reward_rules, '$[*] ? (!(
          @.type() == "object"
          && exists(@.category)   && @.category.type()   == "string"
          && exists(@.multiplier) && @.multiplier.type() == "number" && @.multiplier >= 0))')
  ),
  -- Object of { "<period>_<category>": spend >= 0 }.
  CONSTRAINT liability_spend_stats_check CHECK (
    jsonb_typeof(spend_stats) = 'object'
    AND NOT jsonb_path_exists(spend_stats, '$.* ? (@.type() != "number" || @ < 0)')
  )
);


-- ── 5. mileage_details ──────────────────────────────────────────────────────
-- One mileage account per program. The balance (miles) lives on `accounts`.

CREATE TABLE mileage_details (
  account_id        UUID                 PRIMARY KEY,
  type              account_type         NOT NULL DEFAULT 'AIRLINE_MILES' CHECK (type = 'AIRLINE_MILES'),
  airline_program   airline_program_type NOT NULL UNIQUE,
  usd_per_10k_miles INTEGER              NOT NULL DEFAULT 0 CHECK (usd_per_10k_miles >= 0),
  -- Object of { "<reward currency>": miles per point (whole number >= 0) }.
  transfer_rates    JSONB                NOT NULL DEFAULT '{}'::jsonb,

  FOREIGN KEY (account_id, type) REFERENCES accounts (id, type) ON DELETE CASCADE,

  CONSTRAINT mileage_transfer_rates_check CHECK (
    jsonb_typeof(transfer_rates) = 'object'
    AND NOT jsonb_path_exists(transfer_rates, '$.* ? (@.type() != "number" || @ < 0)')
  )
);


-- ── 6. share_details ────────────────────────────────────────────────────────
-- A position in one ticker, held through one brokerage cash account. The
-- account's balance (on `accounts`) is shares x last_price.
--
-- brokerage_account_id has no ON DELETE action. Deleting a brokerage while a
-- position still points at it is a referential error, never an orphan; the
-- delete action removes the positions first.

CREATE TABLE share_details (
  account_id           UUID          PRIMARY KEY,
  type                 account_type  NOT NULL DEFAULT 'SHARE' CHECK (type = 'SHARE'),
  brokerage_account_id UUID          NOT NULL,
  -- The brokerage must be an ASSET account.
  brokerage_type       account_type  NOT NULL DEFAULT 'ASSET' CHECK (brokerage_type = 'ASSET'),
  ticker               TEXT          NOT NULL CHECK (ticker <> '' AND ticker = upper(btrim(ticker))),
  shares               DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (shares >= 0),
  cost_basis           DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (cost_basis >= 0),
  last_price           DECIMAL(18,4) CHECK (last_price IS NULL OR last_price >= 0),
  last_price_date      DATE,

  FOREIGN KEY (account_id, type) REFERENCES accounts (id, type) ON DELETE CASCADE,
  FOREIGN KEY (brokerage_account_id, brokerage_type) REFERENCES accounts (id, type),

  -- One position per (brokerage, ticker).
  UNIQUE (brokerage_account_id, ticker),
  CONSTRAINT share_price_pair_check CHECK ((last_price IS NULL) = (last_price_date IS NULL)),
  CONSTRAINT share_not_own_brokerage_check CHECK (brokerage_account_id <> account_id)
);


-- ── 7. accounts_flat ────────────────────────────────────────────────────────
-- Every account with its details, absent details defaulted. Read-only.

CREATE VIEW accounts_flat AS
SELECT
  a.id,
  a.name,
  a.type,
  a.currency,
  a.balance,
  a.apy,
  l.credit_limit,
  l.reward_currency,
  COALESCE(l.reward_balance, 0)            AS reward_balance,
  COALESCE(l.reward_rules, '[]'::jsonb)    AS reward_rules,
  COALESCE(l.spend_stats, '{}'::jsonb)     AS spend_stats,
  m.airline_program,
  COALESCE(m.usd_per_10k_miles, 0)         AS usd_per_10k_miles,
  COALESCE(m.transfer_rates, '{}'::jsonb)  AS transfer_rates,
  s.brokerage_account_id,
  s.ticker,
  COALESCE(s.shares, 0)                    AS shares,
  COALESCE(s.cost_basis, 0)                AS cost_basis,
  s.last_price,
  s.last_price_date,
  a.created_at,
  a.updated_at
FROM accounts a
LEFT JOIN liability_details l ON l.account_id = a.id
LEFT JOIN mileage_details   m ON m.account_id = a.id
LEFT JOIN share_details     s ON s.account_id = a.id;


-- ── 8. reward_rates ─────────────────────────────────────────────────────────
-- Valuation of a reward currency in USD per 10k points.

CREATE TABLE reward_rates (
  reward_currency    TEXT        PRIMARY KEY CHECK (reward_currency ~ '^[A-Z]{2,4}$'),
  usd_per_10k_points INTEGER     NOT NULL CHECK (usd_per_10k_points >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER reward_rates_set_updated_at
  BEFORE UPDATE ON reward_rates
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();


-- ── 9. transactions ─────────────────────────────────────────────────────────
-- Append-mostly ledger. 11 discriminated types across three families.
--
-- FIELD MATRIX  (REQ = NOT NULL required, · = must be NULL, — = unconstrained)
--
--   type                    currency  reward_ccy  from_acct  to_acct  ref_txn  amount
--   ----------------------  --------  ----------  ---------  -------  -------  -------
--   EXPENSE                 REQ       ·           REQ        ·        ·        money
--   INCOME                  REQ       ·           ·          REQ      ·        money
--   TRANSFER                REQ       ·           REQ        REQ      ·        money
--   SHARE_BUY               REQ       ·           REQ        REQ      ·        money
--   SHARE_SELL              REQ       ·           REQ        REQ      ·        money
--   REWARD_EARN             ·         REQ         ·          REQ      REQ      whole
--   REWARD_TRANSFER_IN      ·         REQ         ·          REQ      ·        whole
--   REWARD_REDEEM           ·         REQ         REQ        ·        —        whole
--   MILEAGE_TRANSFER_IN     ·         ·           ·          REQ      ·        whole
--   MILEAGE_MANUAL_IN       ·         ·           ·          REQ      ·        whole
--   MILEAGE_REDEEM_FLIGHT   ·         ·           REQ        ·        REQ      whole
--
--   share_* = share_ticker, share_quantity, share_price (all three together)
--
-- Cash-family rows carry `currency`; reward and mileage rows do not (their unit
-- is the reward currency or miles). Reference links:
--   REWARD_EARN            -> the EXPENSE that earned the points
--   MILEAGE_REDEEM_FLIGHT  -> the EXPENSE that paid its taxes
--   REWARD_REDEEM          -> the MILEAGE_TRANSFER_IN it funded (when it did)
-- SHARE_BUY / SHARE_SELL record the position as it was before the trade in
-- `metadata` (shares_before, cost_basis_before) so deleting the trade restores
-- it exactly.
--
-- `amount` is always > 0; direction comes from the type plus from/to, never from
-- a negative amount. SHARE_BUY and SHARE_SELL move exactly qty x price.
--
-- from_account / to_account / reference_transaction_id use NO ACTION: deleting a
-- parent while dependants remain is a referential error, not an orphaning. It is
-- checked at end of statement, so deleting a whole closure in one statement
-- works.

CREATE TABLE transactions (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  type                     transaction_type NOT NULL,
  amount                   DECIMAL(12,2)    NOT NULL CHECK (amount > 0),
  currency                 TEXT             CHECK (currency ~ '^[A-Z]{3}$'),
  reward_currency          TEXT             CHECK (reward_currency ~ '^[A-Z]{2,4}$'),
  metadata                 JSONB            NOT NULL DEFAULT '{}'::jsonb
                                            CHECK (jsonb_typeof(metadata) = 'object'),
  reference_transaction_id UUID REFERENCES transactions(id),
  from_account             UUID REFERENCES accounts(id),
  to_account               UUID REFERENCES accounts(id),
  category                 TEXT,
  memo                     TEXT,
  share_ticker             TEXT,
  share_quantity           DECIMAL(18,6),
  share_price              DECIMAL(18,4),
  transaction_date         DATE             NOT NULL,
  -- Monotonic insertion order; the tiebreak for rows sharing a date.
  seq                      BIGINT           GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT now(),
  -- Tombstone. A deleted row stays for referential integrity and audit; every
  -- ledger read filters on `deleted_at IS NULL`.
  deleted_at               TIMESTAMPTZ,

  -- share_* travel as a set: all three present on SHARE_BUY/SELL, all three NULL
  -- otherwise.
  CONSTRAINT transactions_share_fields_check CHECK (
    CASE
      WHEN type IN ('SHARE_BUY', 'SHARE_SELL') THEN
             share_ticker   IS NOT NULL
         AND share_quantity IS NOT NULL AND share_quantity > 0
         AND share_price    IS NOT NULL AND share_price    > 0
      ELSE
             share_ticker   IS NULL
         AND share_quantity IS NULL
         AND share_price    IS NULL
    END
  ),

  -- One branch per row shape, in the order of the matrix above. `ELSE false`
  -- makes a forgotten transaction_type fail closed instead of unconstrained.
  CONSTRAINT transactions_shape_check CHECK (
    CASE
      WHEN type = 'EXPENSE' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NULL

      WHEN type = 'INCOME' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL

      -- A transfer moves money between two different accounts.
      WHEN type = 'TRANSFER' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NOT NULL
         AND from_account <> to_account

      WHEN type = 'SHARE_BUY' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NOT NULL
         AND from_account <> to_account
         AND amount = round(share_quantity * share_price, 2)
         AND jsonb_typeof(metadata -> 'shares_before') = 'number'
         AND jsonb_typeof(metadata -> 'cost_basis_before') = 'number'

      WHEN type = 'SHARE_SELL' THEN
             currency IS NOT NULL
         AND reward_currency IS NULL
         AND reference_transaction_id IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NOT NULL
         AND from_account <> to_account
         AND amount = round(share_quantity * share_price, 2)
         AND jsonb_typeof(metadata -> 'shares_before') = 'number'
         AND jsonb_typeof(metadata -> 'cost_basis_before') = 'number'

      -- Points earned by a specific expense, which it must point back at so a
      -- deleted expense can claw its reward back.
      WHEN type = 'REWARD_EARN' THEN
             amount = trunc(amount)
         AND currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NOT NULL

      WHEN type = 'REWARD_TRANSFER_IN' THEN
             amount = trunc(amount)
         AND currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NULL

      WHEN type = 'REWARD_REDEEM' THEN
             amount = trunc(amount)
         AND currency IS NULL
         AND reward_currency IS NOT NULL
         AND from_account IS NOT NULL
         AND to_account IS NULL

      -- Mileage rows are denominated in miles: neither currency column applies.
      WHEN type IN ('MILEAGE_TRANSFER_IN', 'MILEAGE_MANUAL_IN') THEN
             amount = trunc(amount)
         AND currency IS NULL
         AND reward_currency IS NULL
         AND from_account IS NULL
         AND to_account IS NOT NULL
         AND reference_transaction_id IS NULL

      WHEN type = 'MILEAGE_REDEEM_FLIGHT' THEN
             amount = trunc(amount)
         AND currency IS NULL
         AND reward_currency IS NULL
         AND from_account IS NOT NULL
         AND to_account IS NULL
         AND reference_transaction_id IS NOT NULL

      ELSE false
    END
  )
);


-- ── 10. Indexes ─────────────────────────────────────────────────────────────
-- Account detail pulls both sides of the ledger for one account; the same
-- indexes serve the foreign-key checks.
CREATE INDEX transactions_from_account_idx ON transactions(from_account) WHERE from_account IS NOT NULL;
CREATE INDEX transactions_to_account_idx   ON transactions(to_account)   WHERE to_account   IS NOT NULL;

-- Delete walk: find what points at a given transaction.
CREATE INDEX transactions_reference_idx
  ON transactions(reference_transaction_id) WHERE reference_transaction_id IS NOT NULL;

-- Dashboard: every live expense, oldest first.
CREATE INDEX transactions_expense_date_idx
  ON transactions(transaction_date, seq) WHERE type = 'EXPENSE' AND deleted_at IS NULL;


-- ── 11. net_worth_snapshots ─────────────────────────────────────────────────
-- One row per day, written by the dashboard. `breakdown` and `valuation_inputs`
-- are audit blobs (per-account values, and the FX inputs used): a snapshot must
-- stay explainable after the rates that produced it change.
--
-- snapshot_date is the device's calendar day, supplied by the app.

CREATE TABLE net_worth_snapshots (
  snapshot_date    DATE          PRIMARY KEY,
  net_worth_usd    DECIMAL(14,2) NOT NULL,
  assets_usd       DECIMAL(14,2) NOT NULL,
  liabilities_usd  DECIMAL(14,2) NOT NULL,
  breakdown        JSONB         NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(breakdown) = 'object'),
  valuation_inputs JSONB         NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valuation_inputs) = 'object'),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT net_worth_snapshots_sum_check CHECK (net_worth_usd = assets_usd - liabilities_usd)
);


-- ── 12. device_secrets ──────────────────────────────────────────────────────
-- Bring-your-own-key API credentials (and the one endpoint config that goes
-- with them), empty by default. Nothing ships with a
-- key; a row is something this user typed on this device.
--
-- SYNC  This table is device-local by construction: lib/db/backup.ts lists the
-- tables it exports and this is not one of them, so a key can never reach Drive.

CREATE TABLE device_secrets (
  provider   TEXT        PRIMARY KEY CHECK (provider IN ('exchangerate', 'finnhub', 'llm')),
  api_key    TEXT        NOT NULL CHECK (btrim(api_key) <> ''),
  -- The 'llm' provider is any OpenAI-compatible Responses endpoint, so it
  -- needs an address and a model as well as a key. NULL for every other provider.
  base_url   TEXT,
  model      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT device_secrets_endpoint_check CHECK (
    CASE
      WHEN provider = 'llm' THEN
             COALESCE(base_url ~ '^https?://', false)
         AND COALESCE(btrim(model) <> '', false)
      ELSE base_url IS NULL AND model IS NULL
    END
  )
);

-- Device-local AI selection and model source. No credentials or model bytes;
-- excluded from lib/db/backup.ts's explicit ledger table list.
CREATE TABLE device_ai_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  config JSONB NOT NULL CHECK (config->>'backend' IN ('remote', 'local'))
);
