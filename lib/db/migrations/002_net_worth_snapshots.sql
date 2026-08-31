-- ============================================================================
-- 002_net_worth_snapshots — daily net worth history
--
-- One row per user per day, upserted by the dashboard. `breakdown` and
-- `valuation_inputs` are JSONB blobs (per-account values, and the FX/price
-- inputs used) kept for auditability: a snapshot must stay explainable even
-- after the rates that produced it change.
--
-- TIMEZONE  snapshot_date comes from CURRENT_DATE, which reads the session
-- timezone. The connection pins UTC (lib/db/client.ts); without that pin the
-- same day lands differently for different users and the unique index below
-- silently admits duplicates.
-- ============================================================================

CREATE TABLE net_worth_snapshots (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL,
  snapshot_date    DATE          NOT NULL,
  net_worth_usd    DECIMAL(14,2) NOT NULL DEFAULT 0,
  assets_usd       DECIMAL(14,2) NOT NULL DEFAULT 0,
  liabilities_usd  DECIMAL(14,2) NOT NULL DEFAULT 0,
  breakdown        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  valuation_inputs JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at       DATE          NOT NULL DEFAULT CURRENT_DATE
);

-- Doubles as the read index: chart queries scan (user_id, snapshot_date) ranges,
-- which this unique index already serves. No further index is warranted.
CREATE UNIQUE INDEX net_worth_snapshots_user_date_unique_idx
  ON net_worth_snapshots(user_id, snapshot_date);
