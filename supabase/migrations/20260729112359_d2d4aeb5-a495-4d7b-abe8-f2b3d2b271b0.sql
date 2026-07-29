-- Phase A: change_log 백업 + 트리거 비활성화 + 전 행 삭제
SET LOCAL app.change_source = 'rebuild_20260729';

-- ① change_log 백업 (37,531행 전량, admin-only)
CREATE TABLE public.abd_change_log_preserve_20260729 AS
  SELECT * FROM public.abd_change_log;

GRANT SELECT ON public.abd_change_log_preserve_20260729 TO service_role;
ALTER TABLE public.abd_change_log_preserve_20260729 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only_read" ON public.abd_change_log_preserve_20260729
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 백업 행수 검증 (37,531이 아니면 예외)
DO $$
DECLARE
  v_backup_count bigint;
  v_source_count bigint;
BEGIN
  SELECT count(*) INTO v_backup_count FROM public.abd_change_log_preserve_20260729;
  SELECT count(*) INTO v_source_count FROM public.abd_change_log;
  IF v_backup_count <> v_source_count THEN
    RAISE EXCEPTION 'change_log backup mismatch: backup=% source=%', v_backup_count, v_source_count;
  END IF;
  IF v_backup_count < 37000 THEN
    RAISE EXCEPTION 'change_log backup unexpectedly small: %', v_backup_count;
  END IF;
END $$;

-- ② change_log 트리거 비활성화 (재구축 트랜잭션 동안)
ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_change_log;

-- ③ 전 행 삭제 (스냅샷 abd_cleanup_snapshot_20260729 에 보존)
DELETE FROM public.abd_items_raw;