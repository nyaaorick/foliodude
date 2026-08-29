-- ============================================================
-- 002_net_worth_snapshots.sql  (PGLite local-first edition)
-- Removed: auth.users foreign key, RLS, all CREATE POLICY
-- user_id is a plain UUID set by the frontend after OAuth.
-- ============================================================

CREATE TABLE net_worth_snapshots (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL,  -- plain UUID, no FK to auth.users
  snapshot_date    DATE          NOT NULL,
  snapshot_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  net_worth_usd    DECIMAL(14,2) NOT NULL DEFAULT 0,
  assets_usd       DECIMAL(14,2) NOT NULL DEFAULT 0,
  liabilities_usd  DECIMAL(14,2) NOT NULL DEFAULT 0,
  breakdown        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  valuation_inputs JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One snapshot per user per day
CREATE UNIQUE INDEX net_worth_snapshots_user_date_unique_idx
  ON net_worth_snapshots(user_id, snapshot_date);

CREATE INDEX net_worth_snapshots_user_id_idx
  ON net_worth_snapshots(user_id);

CREATE INDEX net_worth_snapshots_snapshot_date_idx
  ON net_worth_snapshots(snapshot_date DESC);
