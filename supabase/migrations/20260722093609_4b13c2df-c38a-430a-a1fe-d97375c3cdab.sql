CREATE TABLE public.defect_actual_backfill_snapshot_20260722 (
  defect_item_id uuid PRIMARY KEY,
  actual_start_date_old date,
  snapshotted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.defect_actual_backfill_snapshot_20260722 TO authenticated;
GRANT ALL   ON public.defect_actual_backfill_snapshot_20260722 TO service_role;
ALTER TABLE public.defect_actual_backfill_snapshot_20260722 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read backfill snapshot"
  ON public.defect_actual_backfill_snapshot_20260722
  FOR SELECT TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

ALTER TABLE public.defect_items_raw
  ADD COLUMN IF NOT EXISTS _backfilled_asd_before_20260722 boolean NOT NULL DEFAULT false;