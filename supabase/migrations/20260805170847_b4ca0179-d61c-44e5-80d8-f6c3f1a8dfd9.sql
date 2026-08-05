ALTER TABLE public.task_management_import_logs
  ADD COLUMN IF NOT EXISTS parsed_rows integer,
  ADD COLUMN IF NOT EXISTS applied_rows integer,
  ADD COLUMN IF NOT EXISTS exclusions jsonb;

COMMENT ON COLUMN public.task_management_import_logs.parsed_rows IS '파일에서 파싱된 전체 행수(분모). total_rows 와 동일하게 기록한다.';
COMMENT ON COLUMN public.task_management_import_logs.applied_rows IS '실제 반영 대상 행수. parsed_rows 와 같을 때만 status=success.';
COMMENT ON COLUMN public.task_management_import_logs.exclusions IS '사유별 제외 건수: excluded_by_permission / excluded_by_scope / excluded_unmapped / duplicates / rolled_up / renumbered / resolved_by_decision / unclassified';

ALTER TABLE public.task_management_import_row_logs
  DROP CONSTRAINT IF EXISTS task_management_import_row_logs_action_taken_check;
ALTER TABLE public.task_management_import_row_logs
  ADD CONSTRAINT task_management_import_row_logs_action_taken_check
  CHECK (action_taken = ANY (ARRAY['inserted'::text,'updated'::text,'skipped'::text,'rejected'::text,'excluded'::text]));