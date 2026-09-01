-- ============================================================
-- 논리 DR(Lovable Cloud Logical DR) 내보내기 감사 정본
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dr_export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  issued_by uuid NOT NULL,
  -- 토큰 원문은 저장하지 않는다. SHA-256 hex 만 저장한다.
  token_sha256 text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','downloading','completed','expired','revoked','failed')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  first_used_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  -- 발급 시점에 고정한 Snapshot manifest 원본 bytes 의 SHA-256
  snapshot_manifest_sha256 text,
  snapshot_overall_sha256 text,
  -- 대상 업무 버킷 정본(7개)
  buckets text[] NOT NULL,
  files_downloaded integer NOT NULL DEFAULT 0,
  bytes_downloaded bigint NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dr_export_runs_snapshot_idx ON public.dr_export_runs (snapshot_id);
CREATE INDEX IF NOT EXISTS dr_export_runs_status_idx ON public.dr_export_runs (status, issued_at DESC);

GRANT SELECT ON public.dr_export_runs TO authenticated;
GRANT ALL ON public.dr_export_runs TO service_role;

ALTER TABLE public.dr_export_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dr_export_runs_sysadmin_select" ON public.dr_export_runs;
CREATE POLICY "dr_export_runs_sysadmin_select"
  ON public.dr_export_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'system_administrator'));

DROP TRIGGER IF EXISTS dr_export_runs_set_updated_at ON public.dr_export_runs;
CREATE TRIGGER dr_export_runs_set_updated_at
  BEFORE UPDATE ON public.dr_export_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 정기 Snapshot cron 계약 (멱등)
--  - 기존 job 이름을 유지한다: qail-auto-backup-doha-2350
--  - 기존 command(내부 secret 포함)는 절대 재작성하지 않는다.
--  - 존재할 때만 schedule/active 를 정본값으로 맞춘다.
-- ============================================================
DO $$
DECLARE
  _jobid bigint;
  _schedule text;
BEGIN
  SELECT jobid, schedule INTO _jobid, _schedule
  FROM cron.job WHERE jobname = 'qail-auto-backup-doha-2350';
  IF _jobid IS NULL THEN
    RAISE NOTICE 'qail-auto-backup-doha-2350 job 이 없습니다. 관리자 화면에서 경고로 표면화됩니다.';
  ELSIF _schedule IS DISTINCT FROM '50 20 * * *' THEN
    BEGIN
      PERFORM cron.alter_job(_jobid, schedule => '50 20 * * *');
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cron 일정 갱신 권한이 없습니다. 화면 경고로 표면화됩니다.';
    END;
  END IF;
END $$;

-- 읽기 전용 cron 상태 조회 (command·secret 은 반환하지 않는다)
CREATE OR REPLACE FUNCTION public.dr_snapshot_cron_status()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT j.jobname::text, j.schedule::text, j.active
  FROM cron.job j
  WHERE j.jobname = 'qail-auto-backup-doha-2350'
$$;

REVOKE ALL ON FUNCTION public.dr_snapshot_cron_status() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr_snapshot_cron_status() TO service_role;