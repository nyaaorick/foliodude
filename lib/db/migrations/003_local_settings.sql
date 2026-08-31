-- ============================================================================
-- 003_local_settings — key/value store for device-local settings
--
-- Introduced by the local-first migration. Two jobs:
--
--   1. Manual valuation inputs that replaced the paused price APIs (PLAN §7).
--      FX rates and share prices are now user-entered, and each carries the
--      timestamp the UI uses to show a staleness warning.
--   2. Bring-your-own-key API credentials, empty by default. Nothing ships
--      with a key; a value here is something this user typed on this device.
--
-- Values are JSONB so a setting can grow structure without a migration.
-- Keys are namespaced with ':' — e.g. 'fx:HKD', 'price:AAPL', 'apikey:finnhub'.
--
-- SYNC NOTE  api keys are device-local secrets and must be excluded from the
-- Phase 4 snapshot upload. lib/db/backup.ts filters the 'apikey:' namespace.
-- ============================================================================

-- Stable device-local user id. Phase 2 has no auth, but every table is keyed by
-- user_id, so one is minted on first run. Phase 4 rewrites these ids in place
-- once OAuth returns a real account uuid (see lib/db/session.ts).
CREATE TABLE local_identity (
  singleton  BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  user_id    UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at DATE        NOT NULL DEFAULT CURRENT_DATE
);

INSERT INTO local_identity (singleton) VALUES (TRUE);


CREATE TABLE local_settings (
  user_id    UUID        NOT NULL,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  updated_at DATE        NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, key)
);

CREATE TRIGGER local_settings_set_updated_at
  BEFORE UPDATE ON local_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
