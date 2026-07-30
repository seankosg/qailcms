DROP FUNCTION IF EXISTS public.abd_judge_v1(abd_items_raw, date);

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

  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay,'DS'); END IF;
  IF df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN v_delay := array_append(v_delay,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN v_delay := array_append(v_delay,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN v_delay := array_append(v_delay,'RS'); END IF;

  IF ds_p IS NOT NULL AND ds_a IS NOT NULL AND ds_a > ds_p THEN v_late := array_append(v_late,'DS'); END IF;
  IF df_p IS NOT NULL AND df_a IS NOT NULL AND df_a > df_p THEN v_late := array_append(v_late,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_a IS NOT NULL AND sb_a > sb_p THEN v_late := array_append(v_late,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_a IS NOT NULL AND rs_a > rs_p THEN v_late := array_append(v_late,'RS'); END IF;

  IF v_stage_kind = 'DS' AND ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN
    v_primary := 'DS'||v_active::text;
  ELSIF v_stage_kind = 'DF' AND df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN
    v_primary := 'DF'||v_active::text;
  ELSIF v_stage_kind = 'SB' AND sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN
    v_primary := 'SB'||v_active::text;
  ELSIF v_stage_kind = 'RS' AND rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN
    v_primary := 'RS'||v_active::text;
  END IF;

  -- NoPlan: R1=B/C 로 R2 진입했으나 R2 계획 누락 (v_active=2 이고 r1_response_result IN B/C)
  IF v_active = 2 AND _row.r1_response_result IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 3 AND _row.r2_response_result IN ('B','C')
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

-- 기존 전체 행 재계산 (트리거는 INSERT/UPDATE 시만 동작하므로 일괄 갱신)
UPDATE abd_items_raw SET 
  latest_status_norm = NULLIF((j.j->>'latest_status_norm'),''),
  status_mismatch = COALESCE(((j.j->>'status_mismatch')::boolean), false),
  active_round = NULLIF(j.j->>'active_round','')::smallint,
  current_stage = NULLIF(j.j->>'current_stage',''),
  bucket_top = NULLIF(j.j->>'bucket_top',''),
  delay_bucket = ARRAY(SELECT jsonb_array_elements_text(COALESCE(j.j->'delay_bucket','[]'::jsonb))),
  delay_late = ARRAY(SELECT jsonb_array_elements_text(COALESCE(j.j->'delay_late','[]'::jsonb))),
  primary_delay = NULLIF(j.j->>'primary_delay',''),
  needs_planning = COALESCE(((j.j->>'needs_planning')::boolean), false),
  needs_revise = COALESCE(((j.j->>'needs_revise')::boolean), false),
  revise_source_round = NULLIF(j.j->>'revise_source_round','')::smallint,
  rs_result_missing = COALESCE(((j.j->>'rs_result_missing')::boolean), false),
  ur_aging_days = NULLIF(j.j->>'ur_aging_days','')::integer
FROM (
  SELECT id, public.abd_judge_v1(t, NULL) as j
  FROM abd_items_raw t
  WHERE is_active = true
) j
WHERE abd_items_raw.id = j.id;