-- Snapshot before state
DROP TABLE IF EXISTS public.abd_judge_v_active_snapshot_20260729;
CREATE TABLE public.abd_judge_v_active_snapshot_20260729 AS
SELECT id, active_round AS ar_before, current_stage AS cs_before, bucket_top AS bt_before, latest_status
FROM public.abd_items_raw WHERE is_active=true;
ALTER TABLE public.abd_judge_v_active_snapshot_20260729 ENABLE ROW LEVEL SECURITY;
CREATE POLICY snap_admin ON public.abd_judge_v_active_snapshot_20260729 FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

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
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_needs_plan boolean := false;
  v_needs_revise boolean := false;
  v_revise_src smallint := NULL;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;
  v_raw_up text;
  v_norm text;
  v_mismatch boolean;
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_raw_up := CASE WHEN _row.latest_status IS NULL THEN NULL ELSE upper(btrim(_row.latest_status)) END;
  v_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  v_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  -- v_active 판정: actual/response 기반만 사용 (plan 필드 완전 제거).
  -- 정책 근거: policy #6 "B는 1회 연장" -> r{n-1}_response_result IN ('B','C') 시 다음 라운드 활성.
  -- 임포트측 resolveActiveRound (src/lib/abd/aconex-import.functions.ts) 는
  -- SB actual 최고 라운드만으로 회신 귀속 라운드를 정한다 (Aconex 회신을 계획 없는 라운드에
  -- 잘못 귀속시키는 것을 방지). 판정측(여기)은 회신 결과(B/C) + 다음 라운드 actual 을
  -- 모두 승격 근거로 삼는다. 두 규칙의 의도적 차이임 - 무결성 검사 시 상호 참조 확인.
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
      'latest_status_norm', v_norm,
      'status_mismatch', v_mismatch,
      'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text,
      'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[],
      'needs_planning', false,
      'needs_revise', false,
      'revise_source_round', NULL,
      'rs_result_missing', false,
      'ur_aging_days', NULL
    );
  END IF;

  IF v_norm = 'A' THEN
    IF _row.r3_response_result = 'A' THEN v_active := 3;
    ELSIF _row.r2_response_result = 'A' THEN v_active := 2;
    ELSE v_active := 1;
    END IF;
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm,
      'status_mismatch', v_mismatch,
      'active_round', v_active,
      'current_stage', 'Approved',
      'bucket_top', 'Approved',
      'delay_bucket', '{}'::text[],
      'needs_planning', false,
      'needs_revise', false,
      'revise_source_round', NULL,
      'rs_result_missing', false,
      'ur_aging_days', NULL
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

  IF sb_a IS NOT NULL AND (rs_a IS NULL OR rr IS NULL) THEN
    v_stage := 'UR'||v_active::text; v_bucket := 'UR';
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a;
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  ELSIF ds_a IS NOT NULL AND sb_a IS NULL THEN
    v_stage := 'DS'||v_active::text; v_bucket := 'DS';
  ELSIF _row.r1_draft_start_actual IS NULL AND _row.r1_draft_finish_actual IS NULL AND _row.r1_submission_actual IS NULL THEN
    v_stage := 'NS'; v_bucket := 'NS';
  ELSE
    v_stage := 'RS'||v_active::text; v_bucket := 'DS';
  END IF;

  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay,'DS'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL AND ds_a IS NOT NULL THEN v_delay := array_append(v_delay,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL AND sb_a IS NOT NULL THEN v_delay := array_append(v_delay,'RS'); END IF;

  IF v_active = 1 AND _row.r1_response_result IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 2 AND _row.r2_response_result IN ('B','C')
     AND (_row.r3_draft_start_plan IS NULL OR _row.r3_draft_finish_plan IS NULL OR _row.r3_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 2;
  END IF;

  RETURN jsonb_build_object(
    'latest_status_norm', v_norm,
    'status_mismatch', v_mismatch,
    'active_round', v_active,
    'current_stage', v_stage,
    'bucket_top', v_bucket,
    'delay_bucket', v_delay,
    'needs_planning', v_needs_plan,
    'needs_revise', v_needs_revise,
    'revise_source_round', v_revise_src,
    'rs_result_missing', v_rs_missing,
    'ur_aging_days', v_ur_days
  );
END;
$function$;

-- Refire abd_compute_derived on every active row
UPDATE public.abd_items_raw SET updated_at = updated_at WHERE is_active = true;