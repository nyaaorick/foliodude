CREATE TABLE public.net_worth_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date    DATE        NOT NULL,
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  net_worth_usd    DECIMAL(14,2) NOT NULL DEFAULT 0,
  assets_usd       DECIMAL(14,2) NOT NULL DEFAULT 0,
  liabilities_usd  DECIMAL(14,2) NOT NULL DEFAULT 0,
  breakdown        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  valuation_inputs JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX net_worth_snapshots_user_date_unique_idx
  ON public.net_worth_snapshots(user_id, snapshot_date);

CREATE INDEX net_worth_snapshots_user_id_idx
  ON public.net_worth_snapshots(user_id);

CREATE INDEX net_worth_snapshots_snapshot_date_idx
  ON public.net_worth_snapshots(snapshot_date);

ALTER TABLE public.net_worth_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "net_worth_snapshots_select_own" ON public.net_worth_snapshots
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "net_worth_snapshots_insert_own" ON public.net_worth_snapshots
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "net_worth_snapshots_update_own" ON public.net_worth_snapshots
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "net_worth_snapshots_delete_own" ON public.net_worth_snapshots
  FOR DELETE USING (user_id = auth.uid());
