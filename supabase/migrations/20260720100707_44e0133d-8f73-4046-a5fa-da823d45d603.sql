-- 백업 설정 테이블
CREATE TABLE IF NOT EXISTS public.backup_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retention_days integer NOT NULL DEFAULT 30,
  keep_minimum_count integer NOT NULL DEFAULT 3,
  schedule_cron text NOT NULL DEFAULT '50 20 * * *', -- UTC 20:50 = AST 23:50
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.backup_config TO authenticated;
GRANT ALL ON public.backup_config TO service_role;
ALTER TABLE public.backup_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read backup config" ON public.backup_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role manage backup config" ON public.backup_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 스냅샷 메타데이터 테이블
CREATE TABLE IF NOT EXISTS public.database_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  size_bytes bigint,
  sha256_hash text,
  tables_included text[],
  storage_path text,
  triggered_by text NOT NULL DEFAULT 'manual', -- 'manual' | 'scheduled' | 'pre-import'
  trigger_metadata jsonb,
  metadata jsonb,
  is_locked boolean NOT NULL DEFAULT false,
  expires_at timestamptz
);

GRANT SELECT ON public.database_snapshots TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.database_snapshots TO service_role;
GRANT ALL ON public.database_snapshots TO service_role;
ALTER TABLE public.database_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read snapshots" ON public.database_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role manage snapshots" ON public.database_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 백업 실행 로그
CREATE TABLE IF NOT EXISTS public.backup_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  snapshot_id uuid REFERENCES public.database_snapshots(id) ON DELETE SET NULL,
  error_message text,
  duration_ms bigint,
  metadata jsonb
);

GRANT SELECT ON public.backup_run_log TO authenticated;
GRANT ALL ON public.backup_run_log TO service_role;
ALTER TABLE public.backup_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read backup logs" ON public.backup_run_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role manage backup logs" ON public.backup_run_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 복원 실행 로그
CREATE TABLE IF NOT EXISTS public.restore_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  snapshot_id uuid REFERENCES public.database_snapshots(id) ON DELETE SET NULL,
  restored_tables text[],
  error_message text,
  duration_ms bigint,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  destructive boolean NOT NULL DEFAULT false,
  metadata jsonb
);

GRANT SELECT ON public.restore_run_log TO authenticated;
GRANT ALL ON public.restore_run_log TO service_role;
ALTER TABLE public.restore_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read restore logs" ON public.restore_run_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role manage restore logs" ON public.restore_run_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 백업 권한 확인용 헬퍼 함수 (app_role enum 과 text 비교를 위해 캐스팅)
CREATE OR REPLACE FUNCTION public.has_role_backup(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role::public.app_role
  );
$$;

-- 백업 대상 테이블 목록 함수 (JSON 집계용)
CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY[
    'abd_items_raw',
    'defect_items_raw',
    'task_management_raw',
    'spare_parts_raw',
    'dmr_entries',
    'profiles',
    'user_roles',
    'team_master',
    'subcontractor_master',
    'dmr_contractor_master',
    'dmr_system_master',
    'defect_category_team_map',
    'task_management_settings',
    'spare_part_status_mapping',
    'abd_field_config',
    'defect_field_config',
    'task_management_field_config',
    'spare_part_field_config',
    'abd_header_mappings',
    'defect_header_mappings',
    'task_management_header_mappings',
    'spare_part_header_mappings',
    'abd_import_logs',
    'defect_import_logs',
    'task_management_import_logs',
    'spare_parts_import_logs'
  ]::text[];
$$;

-- Storage 버킷이 없으면 생성 (마이그레이션으로는 직접 INSERT 불가, Storage API 사용 권장)
-- 아래 RLS는 db-backups 버킷용입니다.

CREATE POLICY "Allow service role full access on db-backups"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'db-backups')
WITH CHECK (bucket_id = 'db-backups');

CREATE POLICY "Allow authenticated read on db-backups"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'db-backups');

CREATE POLICY "Allow authenticated upload on db-backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'db-backups');

CREATE POLICY "Allow authenticated delete own on db-backups"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'db-backups');