ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS completed_stage text,
  ADD COLUMN IF NOT EXISTS completed_stage_group text;

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
  v_comp text := NULL;
  v_comp_grp text := NULL;
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

  -- completed_stage: 마지막으로 실제 일어난 사실 (라운드 높은 것 우선, 같은 라운드 내 후행 단계 우선)
  IF _row.r3_dar_actual IS NOT NULL THEN v_comp := 'RS3';
  ELSIF _row.r3_submission_actual IS NOT NULL THEN v_comp := 'SB3';
  ELSIF _row.r3_draft_finish_actual IS NOT NULL THEN v_comp := 'DF3';
  ELSIF _row.r3_draft_start_actual IS NOT NULL THEN v_comp := 'DS3';
  ELSIF _row.r2_dar_actual IS NOT NULL THEN v_comp := 'RS2';
  ELSIF _row.r2_submission_actual IS NOT NULL THEN v_comp := 'SB2';
  ELSIF _row.r2_draft_finish_actual IS NOT NULL THEN v_comp := 'DF2';
  ELSIF _row.r2_draft_start_actual IS NOT NULL THEN v_comp := 'DS2';
  ELSIF _row.r1_dar_actual IS NOT NULL THEN v_comp := 'RS1';
  ELSIF _row.r1_submission_actual IS NOT NULL THEN v_comp := 'SB1';
  ELSIF _row.r1_draft_finish_actual IS NOT NULL THEN v_comp := 'DF1';
  ELSIF _row.r1_draft_start_actual IS NOT NULL THEN v_comp := 'DS1';
  END IF;

  IF _row.is_terminated THEN
    v_comp := 'TM' || v_active::text;
    v_comp_grp := 'TM';
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text, 'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', v_comp, 'completed_stage_group', v_comp_grp
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
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', 'Approved', 'completed_stage_group', 'APPROVED'
    );
  END IF;

  v_comp_grp := CASE WHEN v_comp IS NULL THEN NULL ELSE left(v_comp, 2) END;

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
    'rs_result_missing', v_rs_missing, 'ur_aging_days', v_ur_days,
    'completed_stage', v_comp, 'completed_stage_group', v_comp_grp
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
  NEW.completed_stage      := NULLIF(j->>'completed_stage','');
  NEW.completed_stage_group := NULLIF(j->>'completed_stage_group','');
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
    'delay_late','primary_delay','completed_stage','completed_stage_group'
  ]::text[];
$function$;

ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_change_log;
UPDATE public.abd_items_raw r
SET completed_stage = NULLIF(public.abd_judge_v1(r.*, NULL)->>'completed_stage',''),
    completed_stage_group = NULLIF(public.abd_judge_v1(r.*, NULL)->>'completed_stage_group','');
ALTER TABLE public.abd_items_raw ENABLE TRIGGER trg_abd_change_log;