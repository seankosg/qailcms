-- Phase 0: 정정 작업 전 전체 스냅샷
CREATE TABLE public.abd_cleanup_snapshot_20260729 AS
SELECT * FROM public.abd_items_raw;

-- 스냅샷 시각 기록용 메타 컬럼
ALTER TABLE public.abd_cleanup_snapshot_20260729
  ADD COLUMN snapshot_taken_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX abd_cleanup_snapshot_20260729_id_idx
  ON public.abd_cleanup_snapshot_20260729(id);
CREATE INDEX abd_cleanup_snapshot_20260729_abd_number_idx
  ON public.abd_cleanup_snapshot_20260729(abd_number);

GRANT SELECT ON public.abd_cleanup_snapshot_20260729 TO authenticated;
GRANT ALL ON public.abd_cleanup_snapshot_20260729 TO service_role;

ALTER TABLE public.abd_cleanup_snapshot_20260729 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_cleanup_snapshot_20260729_admin_select"
  ON public.abd_cleanup_snapshot_20260729
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));
