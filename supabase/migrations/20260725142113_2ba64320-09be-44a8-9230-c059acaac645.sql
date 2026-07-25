
-- 1) abd_items_raw 컬럼 확장
ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS r1_draft_start_plan date,
  ADD COLUMN IF NOT EXISTS r1_draft_start_actual date,
  ADD COLUMN IF NOT EXISTS r1_draft_finish_plan date,
  ADD COLUMN IF NOT EXISTS r1_draft_finish_actual date,
  ADD COLUMN IF NOT EXISTS r2_draft_start_plan date,
  ADD COLUMN IF NOT EXISTS r2_draft_start_actual date,
  ADD COLUMN IF NOT EXISTS r2_draft_finish_plan date,
  ADD COLUMN IF NOT EXISTS r2_draft_finish_actual date,
  ADD COLUMN IF NOT EXISTS r3_draft_start_plan date,
  ADD COLUMN IF NOT EXISTS r3_draft_start_actual date,
  ADD COLUMN IF NOT EXISTS r3_draft_finish_plan date,
  ADD COLUMN IF NOT EXISTS r3_draft_finish_actual date,
  ADD COLUMN IF NOT EXISTS r1_response_result char(1),
  ADD COLUMN IF NOT EXISTS r2_response_result char(1),
  ADD COLUMN IF NOT EXISTS r3_response_result char(1),
  ADD COLUMN IF NOT EXISTS latest_status_norm text,
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS active_round smallint,
  ADD COLUMN IF NOT EXISTS bucket_top text,
  ADD COLUMN IF NOT EXISTS delay_bucket text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_planning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_r4_plus boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_mismatch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ur_aging_days integer,
  ADD COLUMN IF NOT EXISTS rs_result_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_terminated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_rounds jsonb,
  ADD COLUMN IF NOT EXISTS aconex_status_raw text,
  ADD COLUMN IF NOT EXISTS aconex_review_status_raw text,
  ADD COLUMN IF NOT EXISTS aconex_date_modified date,
  ADD COLUMN IF NOT EXISTS aconex_last_synced_at timestamptz;

-- 도메인 체크 (문자열)
ALTER TABLE public.abd_items_raw DROP CONSTRAINT IF EXISTS abd_items_raw_latest_status_norm_chk;
ALTER TABLE public.abd_items_raw
  ADD CONSTRAINT abd_items_raw_latest_status_norm_chk
  CHECK (latest_status_norm IS NULL OR latest_status_norm IN ('A','B','C','NS','TERM'));
ALTER TABLE public.abd_items_raw DROP CONSTRAINT IF EXISTS abd_items_raw_bucket_top_chk;
ALTER TABLE public.abd_items_raw
  ADD CONSTRAINT abd_items_raw_bucket_top_chk
  CHECK (bucket_top IS NULL OR bucket_top IN ('Approved','UR','DS','NS'));

CREATE INDEX IF NOT EXISTS abd_items_raw_bucket_top_idx ON public.abd_items_raw(bucket_top) WHERE is_active AND NOT is_terminated;
CREATE INDEX IF NOT EXISTS abd_items_raw_latest_status_norm_idx ON public.abd_items_raw(latest_status_norm);
CREATE INDEX IF NOT EXISTS abd_items_raw_is_terminated_idx ON public.abd_items_raw(is_terminated);

-- 2) 기존 drafting 데이터 이관 → draft_finish (한 번만 실행되도록 조건부)
UPDATE public.abd_items_raw
   SET r1_draft_finish_plan = COALESCE(r1_draft_finish_plan, r1_drafting_plan),
       r1_draft_finish_actual = COALESCE(r1_draft_finish_actual, r1_drafting_actual),
       r2_draft_finish_plan = COALESCE(r2_draft_finish_plan, r2_drafting_plan),
       r2_draft_finish_actual = COALESCE(r2_draft_finish_actual, r2_drafting_actual),
       r3_draft_finish_plan = COALESCE(r3_draft_finish_plan, r3_drafting_plan),
       r3_draft_finish_actual = COALESCE(r3_draft_finish_actual, r3_drafting_actual)
 WHERE r1_drafting_plan IS NOT NULL
    OR r1_drafting_actual IS NOT NULL
    OR r2_drafting_plan IS NOT NULL
    OR r2_drafting_actual IS NOT NULL
    OR r3_drafting_plan IS NOT NULL
    OR r3_drafting_actual IS NOT NULL;

-- 3) latest_status_norm 초기값 (기존 latest_status에서 정규화)
UPDATE public.abd_items_raw
   SET latest_status_norm = CASE
     WHEN upper(coalesce(latest_status,'')) IN ('A','APPROVED') THEN 'A'
     WHEN upper(coalesce(latest_status,'')) LIKE 'B%' THEN 'B'
     WHEN upper(coalesce(latest_status,'')) LIKE 'C%' OR upper(coalesce(latest_status,'')) LIKE '%RESUBMIT%' THEN 'C'
     ELSE 'NS'
   END
 WHERE latest_status_norm IS NULL;

-- 4) abd_import_logs · abd_field_config 확장
ALTER TABLE public.abd_import_logs
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'hdec';
ALTER TABLE public.abd_import_logs DROP CONSTRAINT IF EXISTS abd_import_logs_source_kind_chk;
ALTER TABLE public.abd_import_logs
  ADD CONSTRAINT abd_import_logs_source_kind_chk CHECK (source_kind IN ('hdec','aconex'));

ALTER TABLE public.abd_field_config
  ADD COLUMN IF NOT EXISTS source_group text NOT NULL DEFAULT 'hdec';
ALTER TABLE public.abd_field_config DROP CONSTRAINT IF EXISTS abd_field_config_source_group_chk;
ALTER TABLE public.abd_field_config
  ADD CONSTRAINT abd_field_config_source_group_chk CHECK (source_group IN ('hdec','aconex','system'));

-- 5) abd_settings 신규 테이블
CREATE TABLE IF NOT EXISTS public.abd_settings (
  id text NOT NULL PRIMARY KEY DEFAULT 'default',
  ur_aging_warn_days integer NOT NULL DEFAULT 7,
  ur_aging_late_days integer NOT NULL DEFAULT 14,
  rs_plan_gap_days integer NOT NULL DEFAULT 3,
  stuck_ns_days integer NOT NULL DEFAULT 30,
  ds_gap_after_rs_days integer NOT NULL DEFAULT 3,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.abd_settings TO authenticated;
GRANT ALL ON public.abd_settings TO service_role;

ALTER TABLE public.abd_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abd_settings_select ON public.abd_settings;
CREATE POLICY abd_settings_select ON public.abd_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS abd_settings_admin_write ON public.abd_settings;
CREATE POLICY abd_settings_admin_write ON public.abd_settings
  FOR ALL TO authenticated
  USING (is_admin_or_super(auth.uid()))
  WITH CHECK (is_admin_or_super(auth.uid()));

INSERT INTO public.abd_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;

-- 6) 파생 트리거 함수
CREATE OR REPLACE FUNCTION public.abd_compute_derived()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Qatar')::date;
  v_active smallint := NULL;
  v_stage text := NULL;
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_needs_plan boolean := false;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;

  -- helpers 라운드별 값
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
  n smallint;
BEGIN
  -- Terminated 처리
  IF NEW.is_terminated THEN
    NEW.bucket_top := NULL;
    NEW.delay_bucket := '{}';
    NEW.needs_planning := false;
    NEW.rs_result_missing := false;
    NEW.current_stage := 'Terminated';
    NEW.active_round := NULL;
    RETURN NEW;
  END IF;

  -- 승인 우선
  IF NEW.latest_status_norm = 'A' THEN
    NEW.bucket_top := 'Approved';
    NEW.current_stage := 'Approved';
    NEW.delay_bucket := '{}';
    NEW.needs_planning := false;
    NEW.rs_result_missing := false;
    -- active_round: 마지막 승인된 라운드
    IF NEW.r3_response_result = 'A' THEN NEW.active_round := 3;
    ELSIF NEW.r2_response_result = 'A' THEN NEW.active_round := 2;
    ELSE NEW.active_round := 1;
    END IF;
    RETURN NEW;
  END IF;

  -- 활성 라운드 판정 (승인 아닐 때):
  -- 규칙: 최신 라운드 n = max round where any of DS/SB/RS actual/plan 존재
  --   이전 라운드 result가 B/C인 경우 다음 라운드 활성
  IF NEW.r2_response_result IS NOT NULL OR NEW.r3_draft_start_plan IS NOT NULL
     OR NEW.r3_draft_finish_plan IS NOT NULL OR NEW.r3_submission_plan IS NOT NULL
     OR NEW.r3_draft_start_actual IS NOT NULL OR NEW.r3_draft_finish_actual IS NOT NULL
     OR NEW.r3_submission_actual IS NOT NULL OR NEW.r3_dar_actual IS NOT NULL THEN
    v_active := 3;
  ELSIF NEW.r1_response_result IS NOT NULL OR NEW.r2_draft_start_plan IS NOT NULL
     OR NEW.r2_draft_finish_plan IS NOT NULL OR NEW.r2_submission_plan IS NOT NULL
     OR NEW.r2_draft_start_actual IS NOT NULL OR NEW.r2_draft_finish_actual IS NOT NULL
     OR NEW.r2_submission_actual IS NOT NULL OR NEW.r2_dar_actual IS NOT NULL THEN
    v_active := 2;
  ELSE
    v_active := 1;
  END IF;

  -- 활성 라운드 값 로드
  IF v_active = 1 THEN
    ds_p := NEW.r1_draft_start_plan; ds_a := NEW.r1_draft_start_actual;
    df_p := NEW.r1_draft_finish_plan; df_a := NEW.r1_draft_finish_actual;
    sb_p := NEW.r1_submission_plan; sb_a := NEW.r1_submission_actual;
    rs_p := NEW.r1_dar_plan; rs_a := NEW.r1_dar_actual;
    rr := NEW.r1_response_result;
  ELSIF v_active = 2 THEN
    ds_p := NEW.r2_draft_start_plan; ds_a := NEW.r2_draft_start_actual;
    df_p := NEW.r2_draft_finish_plan; df_a := NEW.r2_draft_finish_actual;
    sb_p := NEW.r2_submission_plan; sb_a := NEW.r2_submission_actual;
    rs_p := NEW.r2_dar_plan; rs_a := NEW.r2_dar_actual;
    rr := NEW.r2_response_result;
  ELSE
    ds_p := NEW.r3_draft_start_plan; ds_a := NEW.r3_draft_start_actual;
    df_p := NEW.r3_draft_finish_plan; df_a := NEW.r3_draft_finish_actual;
    sb_p := NEW.r3_submission_plan; sb_a := NEW.r3_submission_actual;
    rs_p := NEW.r3_dar_plan; rs_a := NEW.r3_dar_actual;
    rr := NEW.r3_response_result;
  END IF;

  NEW.active_round := v_active;

  -- current_stage & bucket_top (배타)
  IF sb_a IS NOT NULL AND (rs_a IS NULL OR rr IS NULL) THEN
    v_stage := 'UR' || v_active::text;
    v_bucket := 'UR';
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a; -- rs 도착일 기준
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  ELSIF ds_a IS NOT NULL AND sb_a IS NULL THEN
    v_stage := 'DS' || v_active::text;
    v_bucket := 'DS';
  ELSIF NEW.r1_draft_start_actual IS NULL
        AND NEW.r1_draft_finish_actual IS NULL
        AND NEW.r1_submission_actual IS NULL THEN
    v_stage := 'NS';
    v_bucket := 'NS';
  ELSE
    -- Response 완료 후 아직 다음 라운드 미시작
    v_stage := 'RS' || v_active::text;
    v_bucket := 'DS'; -- 회신 완료·다음 라운드 미시작 → 작업 필요 상태
  END IF;

  NEW.current_stage := v_stage;
  NEW.bucket_top := v_bucket;
  NEW.rs_result_missing := v_rs_missing;
  NEW.ur_aging_days := v_ur_days;

  -- 지연 판정
  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN
    v_delay := array_append(v_delay, 'DS');
  END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL AND ds_a IS NOT NULL THEN
    v_delay := array_append(v_delay, 'SB');
  END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL AND sb_a IS NOT NULL THEN
    v_delay := array_append(v_delay, 'RS');
  END IF;

  -- Needs Planning: 이전 라운드 result가 B/C인데 다음 라운드 DS 계획 없음
  IF v_active = 1 AND NEW.r1_response_result IN ('B','C')
     AND (NEW.r2_draft_start_plan IS NULL AND NEW.r2_draft_finish_plan IS NULL AND NEW.r2_submission_plan IS NULL) THEN
    v_needs_plan := true;
    v_delay := array_append(v_delay, 'NoPlan');
  ELSIF v_active = 2 AND NEW.r2_response_result IN ('B','C')
     AND (NEW.r3_draft_start_plan IS NULL AND NEW.r3_draft_finish_plan IS NULL AND NEW.r3_submission_plan IS NULL) THEN
    v_needs_plan := true;
    v_delay := array_append(v_delay, 'NoPlan');
  END IF;

  NEW.delay_bucket := v_delay;
  NEW.needs_planning := v_needs_plan;

  -- R4+ 감지 (extra_rounds JSONB 존재 & 비어있지 않음)
  IF NEW.extra_rounds IS NOT NULL AND jsonb_typeof(NEW.extra_rounds) = 'array'
     AND jsonb_array_length(NEW.extra_rounds) > 0 THEN
    NEW.has_r4_plus := true;
  ELSE
    NEW.has_r4_plus := false;
  END IF;

  -- status_mismatch: 원본 latest_status ≠ 파생 norm (경고용)
  IF NEW.latest_status IS NOT NULL AND upper(NEW.latest_status) <> COALESCE(NEW.latest_status_norm,'') THEN
    IF NOT (upper(NEW.latest_status) IN ('A','B','C') AND NEW.latest_status_norm IN ('A','B','C')) THEN
      NEW.status_mismatch := true;
    ELSE
      NEW.status_mismatch := (upper(NEW.latest_status) <> NEW.latest_status_norm);
    END IF;
  ELSE
    NEW.status_mismatch := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_abd_compute_derived ON public.abd_items_raw;
CREATE TRIGGER trg_abd_compute_derived
  BEFORE INSERT OR UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.abd_compute_derived();

-- 7) 기존 행 파생 강제 재계산
UPDATE public.abd_items_raw SET updated_at = updated_at;

-- 8) abd_settings updated_at 트리거
DROP TRIGGER IF EXISTS trg_abd_settings_updated_at ON public.abd_settings;
CREATE TRIGGER trg_abd_settings_updated_at
  BEFORE UPDATE ON public.abd_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
