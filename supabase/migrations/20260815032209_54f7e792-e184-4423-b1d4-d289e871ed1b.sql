CREATE TABLE IF NOT EXISTS public.spl_plan_from_actual_snapshot_20260815 (
  id uuid,
  item_id uuid,
  stage_code text,
  plan_start date,
  plan_finish date,
  actual_start date,
  actual_finish date,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.spl_plan_from_actual_snapshot_20260815 TO authenticated;
GRANT ALL ON public.spl_plan_from_actual_snapshot_20260815 TO service_role;
ALTER TABLE public.spl_plan_from_actual_snapshot_20260815 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot readable by authenticated" ON public.spl_plan_from_actual_snapshot_20260815 FOR SELECT TO authenticated USING (true);