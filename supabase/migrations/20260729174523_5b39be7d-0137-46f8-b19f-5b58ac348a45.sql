ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS primary_delay text,
  ADD COLUMN IF NOT EXISTS delay_late text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_abd_items_raw_primary_delay ON public.abd_items_raw (primary_delay);

CREATE OR REPLACE FUNCTION public.abd_judge_v1(_row abd_items_raw, _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_active smallint := NULL;
  v_stage text := NULL;
  v_stage_kind text := NULL;
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_late text[] := '{}';
  v_primary text := NULL;
  v_needs_plan boolean := false;
  v_needs_revise boolean := false;
  v_revise_src smallint := NULL;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;
  v_raw_up text;
  v_norm text;
  v_mismatch boolean;
  v_ns boolean;
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_raw_up := CASE WHEN _row.latest_status IS NULL THEN NULL ELSE upper(btrim(_row.latest_status)) END;
  v_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  v_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  IF _row.r3_draft_start_actual IS NOT NULL OR _row.r3_draft_finish_actual IS NOT NULL
     OR _row.r3_submission_actual IS NOT NULL OR _row.r3_dar_actual IS NOT NULL
     OR _row.r2_response_result IN ('B','C') THEN
    v_active := 3;
  ELSIF _row.r2_draft_start_actual IS NOT NULL OR _row.r2_draft_finish_actual IS NOT NULL
     OR _row.r2_submission_actual IS NOT NULL OR _row.r2_dar_actual IS NOT NULL
     OR _row.r1_response_result IN ('B','C') THEN
    v_active := 2;
  ELSE
    v_active := 1;
  END IF;

  IF _row.is_terminated THEN
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text, 'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL
    );
  END IF;

  IF v_norm = 'A' THEN
    IF _row.r3_response_result = 'A' THEN v_active := 3;
    ELSIF _row.r2_response_result = 'A' THEN v_active := 2;
    ELSE v_active := 1;
    END IF;
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'Approved', 'bucket_top', 'Approved',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL
    );
  END IF;

  IF v_active = 1 THEN
    ds_p := _row.r1_draft_start_plan; ds_a := _row.r1_draft_start_actual;
    df_p := _row.r1_draft_finish_plan; df_a := _row.r1_draft_finish_actual;
    sb_p := _row.r1_submission_plan; sb_a := _row.r1_submission_actual;
    rs_p := _row.r1_dar_plan; rs_a := _row.r1_dar_actual; rr := _row.r1_response_result;
  ELSIF v_active = 2 THEN
    ds_p := _row.r2_draft_start_plan; ds_a := _row.r2_draft_start_actual;
    df_p := _row.r2_draft_finish_plan; df_a := _row.r2_draft_finish_actual;
    sb_p := _row.r2_submission_plan; sb_a := _row.r2_submission_actual;
    rs_p := _row.r2_dar_plan; rs_a := _row.r2_dar_actual; rr := _row.r2_response_result;
  ELSE
    ds_p := _row.r3_draft_start_plan; ds_a := _row.r3_draft_start_actual;
    df_p := _row.r3_draft_finish_plan; df_a := _row.r3_draft_finish_actual;
    sb_p := _row.r3_submission_plan; sb_a := _row.r3_submission_actual;
    rs_p := _row.r3_dar_plan; rs_a := _row.r3_dar_actual; rr := _row.r3_response_result;
  END IF;

  -- 축1: current_stage = 활성 라운드에서 아직 완료되지 않은 가장 앞선 단계.
  -- DS(Draft Start) -> DF(Draft Finish) -> SB(Submission) -> RS(Response by dar)
  IF ds_a IS NULL THEN
    v_stage_kind := 'DS';
  ELSIF df_a IS NULL THEN
    v_stage_kind := 'DF';
  ELSIF sb_a IS NULL THEN
    v_stage_kind := 'SB';
  ELSE
    v_stage_kind := 'RS';
  END IF;
  v_stage := v_stage_kind || v_active::text;

  -- bucket_top 은 기존 Row1 카드 계약 유지: NS / DS / UR / Approved / RESUBMIT
  v_ns := (_row.r1_draft_start_actual IS NULL AND _row.r1_draft_finish_actual IS NULL
           AND _row.r1_submission_actual IS NULL);
  IF v_ns THEN
    v_bucket := 'NS';
  ELSIF v_stage_kind = 'RS' THEN
    v_bucket := 'UR';
  ELSE
    v_bucket := 'DS';
  END IF;

  IF v_stage_kind = 'RS' THEN
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a;
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  END IF;

  -- 축2-a: delay_bucket = 계획일 경과 + 실적 없음인 "모든" 단계 (선행조건 없음). 인지용.
  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay,'DS'); END IF;
  IF df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN v_delay := array_append(v_delay,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN v_delay := array_append(v_delay,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN v_delay := array_append(v_delay,'RS'); END IF;

  -- 축2-b: delay_late = 지연이행(actual > plan). KPI 지연 카운트와 무관.
  IF ds_p IS NOT NULL AND ds_a IS NOT NULL AND ds_a > ds_p THEN v_late := array_append(v_late,'DS'); END IF;
  IF df_p IS NOT NULL AND df_a IS NOT NULL AND df_a > df_p THEN v_late := array_append(v_late,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_a IS NOT NULL AND sb_a > sb_p THEN v_late := array_append(v_late,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_a IS NOT NULL AND rs_a > rs_p THEN v_late := array_append(v_late,'RS'); END IF;

  -- 축2-c: primary_delay = KPI 정본. current_stage 단계가 미이행 지연일 때만, 도면당 0 또는 1개.
  IF v_stage_kind = 'DS' AND ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN
    v_primary := 'DS'||v_active::text;
  ELSIF v_stage_kind = 'DF' AND df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN
    v_primary := 'DF'||v_active::text;
  ELSIF v_stage_kind = 'SB' AND sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN
    v_primary := 'SB'||v_active::text;
  ELSIF v_stage_kind = 'RS' AND rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN
    v_primary := 'RS'||v_active::text;
  END IF;

  IF v_active = 1 AND _row.r1_response_result IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 2 AND _row.r2_response_result IN ('B','C')
     AND (_row.r3_draft_start_plan IS NULL OR _row.r3_draft_finish_plan IS NULL OR _row.r3_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 2;
  END IF;

  RETURN jsonb_build_object(
    'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
    'current_stage', v_stage, 'bucket_top', v_bucket,
    'delay_bucket', v_delay, 'delay_late', v_late, 'primary_delay', v_primary,
    'needs_planning', v_needs_plan, 'needs_revise', v_needs_revise, 'revise_source_round', v_revise_src,
    'rs_result_missing', v_rs_missing, 'ur_aging_days', v_ur_days
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_compute_derived()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  j jsonb;
BEGIN
  j := public.abd_judge_v1(NEW, NULL);
  NEW.latest_status_norm   := NULLIF(j->>'latest_status_norm','');
  NEW.status_mismatch      := COALESCE((j->>'status_mismatch')::boolean, false);
  NEW.active_round         := NULLIF(j->>'active_round','')::smallint;
  NEW.current_stage        := NULLIF(j->>'current_stage','');
  NEW.bucket_top           := NULLIF(j->>'bucket_top','');
  NEW.delay_bucket         := ARRAY(SELECT jsonb_array_elements_text(COALESCE(j->'delay_bucket','[]'::jsonb)));
  NEW.delay_late           := ARRAY(SELECT jsonb_array_elements_text(COALESCE(j->'delay_late','[]'::jsonb)));
  NEW.primary_delay        := NULLIF(j->>'primary_delay','');
  NEW.needs_planning       := COALESCE((j->>'needs_planning')::boolean, false);
  NEW.needs_revise         := COALESCE((j->>'needs_revise')::boolean, false);
  NEW.revise_source_round  := NULLIF(j->>'revise_source_round','')::smallint;
  NEW.rs_result_missing    := COALESCE((j->>'rs_result_missing')::boolean, false);
  NEW.ur_aging_days        := NULLIF(j->>'ur_aging_days','')::integer;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_derived_cols()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- 파생 컬럼 화이트리스트. 추가 시 이 배열을 갱신할 것.
  SELECT ARRAY[
    'current_stage','ur_aging_days','bucket_top','latest_status_norm','delay_bucket',
    'delay_late','primary_delay'
  ]::text[];
$function$;

-- 지연 카드 정본: primary_delay 기준 (도면당 최대 1건)
CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[])
 RETURNS TABLE(bucket text, team text, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT team, primary_delay, needs_planning
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND latest_status_norm IS DISTINCT FROM 'A'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), tagged AS (
    SELECT team, left(primary_delay,2) || '_DELAY' AS b FROM base WHERE primary_delay IS NOT NULL
    UNION ALL
    SELECT team, 'NO_PLAN'::text FROM base WHERE needs_planning
  )
  SELECT b, NULL::text, count(*) FROM tagged GROUP BY b
  UNION ALL
  SELECT 'TOTAL_DELAY', NULL, count(*) FROM tagged WHERE b <> 'NO_PLAN'
  UNION ALL
  SELECT b, team, count(*) FROM tagged GROUP BY b, team;
$function$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[])
 RETURNS TABLE(bucket text, team text, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.abd_dashboard_row2(_plots, _teams, NULL::text[]);
$function$;

-- 백필: 변경 로그 트리거를 잠시 끄고 전 행 재계산
ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_change_log;
UPDATE public.abd_items_raw SET updated_at = updated_at;
ALTER TABLE public.abd_items_raw ENABLE TRIGGER trg_abd_change_log;