CREATE TABLE public.dmr_entries_datefix_snapshot_20260813 AS
SELECT * FROM public.dmr_entries WHERE report_date = DATE '2026-11-08';

GRANT SELECT ON public.dmr_entries_datefix_snapshot_20260813 TO authenticated;
GRANT ALL ON public.dmr_entries_datefix_snapshot_20260813 TO service_role;
ALTER TABLE public.dmr_entries_datefix_snapshot_20260813 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot readable by authenticated"
  ON public.dmr_entries_datefix_snapshot_20260813
  FOR SELECT TO authenticated USING (true);

-- 1) delete rows that would collide with existing 2026-08-11 rows
DELETE FROM public.dmr_entries n
WHERE n.report_date = DATE '2026-11-08'
  AND EXISTS (
    SELECT 1 FROM public.dmr_entries o
    WHERE o.report_date = DATE '2026-08-11'
      AND o.discipline IS NOT DISTINCT FROM n.discipline
      AND o.system_name IS NOT DISTINCT FROM n.system_name
      AND o.contractor_name IS NOT DISTINCT FROM n.contractor_name
      AND o.plot IS NOT DISTINCT FROM n.plot
      AND o.task_no IS NOT DISTINCT FROM n.task_no
      AND o.headcount_kind IS NOT DISTINCT FROM n.headcount_kind
  );

-- 2) correct the remaining rows
UPDATE public.dmr_entries SET report_date = DATE '2026-08-11'
WHERE report_date = DATE '2026-11-08';