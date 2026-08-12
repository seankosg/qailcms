ALTER TABLE public.dmr_entries
  ADD COLUMN IF NOT EXISTS tc_plan_pct numeric,
  ADD COLUMN IF NOT EXISTS tc_actual_pct numeric;

COMMENT ON COLUMN public.dmr_entries.tc_plan_pct IS 'report_date 하루치 계획 증분 스냅샷 (tm_rows_as_of.tc_plan_pct)';
COMMENT ON COLUMN public.dmr_entries.tc_actual_pct IS 'report_date 하루치 실적 증분 스냅샷 (tm_rows_as_of.tc_actual_pct)';