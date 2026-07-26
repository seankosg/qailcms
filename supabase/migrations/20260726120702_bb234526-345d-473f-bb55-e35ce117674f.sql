CREATE OR REPLACE FUNCTION public.abd_compute_derived()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Qatar')::date;
  v_active smallint := NULL;
  v_stage text := NULL;
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_needs_plan boolean := false;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;
  v_raw_up text;
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_raw_up := CASE WHEN NEW.latest_status IS NULL THEN NULL ELSE upper(btrim(NEW.latest_status)) END;
  NEW.latest_status_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  NEW.status_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  IF NEW.is_terminated THEN
    NEW.latest_status_norm := 'TERM';
    NEW.bucket_top := NULL; NEW.delay_bucket := '{}'; NEW.needs_planning := false;
    NEW.rs_result_missing := false; NEW.current_stage := 'Terminated'; NEW.active_round := NULL;
    RETURN NEW;
  END IF;

  IF NEW.latest_status_norm = 'A' THEN
    NEW.bucket_top := 'Approved'; NEW.current_stage := 'Approved';
    NEW.delay_bucket := '{}'; NEW.needs_planning := false; NEW.rs_result_missing := false;
    IF NEW.r3_response_result = 'A' THEN NEW.active_round := 3;
    ELSIF NEW.r2_response_result = 'A' THEN NEW.active_round := 2;
    ELSE NEW.active_round := 1;
    END IF;
    RETURN NEW;
  END IF;

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

  IF v_active = 1 THEN
    ds_p := NEW.r1_draft_start_plan; ds_a := NEW.r1_draft_start_actual;
    df_p := NEW.r1_draft_finish_plan; df_a := NEW.r1_draft_finish_actual;
    sb_p := NEW.r1_submission_plan; sb_a := NEW.r1_submission_actual;
    rs_p := NEW.r1_dar_plan; rs_a := NEW.r1_dar_actual; rr := NEW.r1_response_result;
  ELSIF v_active = 2 THEN
    ds_p := NEW.r2_draft_start_plan; ds_a := NEW.r2_draft_start_actual;
    df_p := NEW.r2_draft_finish_plan; df_a := NEW.r2_draft_finish_actual;
    sb_p := NEW.r2_submission_plan; sb_a := NEW.r2_submission_actual;
    rs_p := NEW.r2_dar_plan; rs_a := NEW.r2_dar_actual; rr := NEW.r2_response_result;
  ELSE
    ds_p := NEW.r3_draft_start_plan; ds_a := NEW.r3_draft_start_actual;
    df_p := NEW.r3_draft_finish_plan; df_a := NEW.r3_draft_finish_actual;
    sb_p := NEW.r3_submission_plan; sb_a := NEW.r3_submission_actual;
    rs_p := NEW.r3_dar_plan; rs_a := NEW.r3_dar_actual; rr := NEW.r3_response_result;
  END IF;

  NEW.active_round := v_active;

  IF sb_a IS NOT NULL AND (rs_a IS NULL OR rr IS NULL) THEN
    v_stage := 'UR' || v_active::text; v_bucket := 'UR';
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a;
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  ELSIF ds_a IS NOT NULL AND sb_a IS NULL THEN
    v_stage := 'DS' || v_active::text; v_bucket := 'DS';
  ELSIF NEW.r1_draft_start_actual IS NULL AND NEW.r1_draft_finish_actual IS NULL AND NEW.r1_submission_actual IS NULL THEN
    v_stage := 'NS'; v_bucket := 'NS';
  ELSE
    v_stage := 'RS' || v_active::text; v_bucket := 'DS';
  END IF;

  NEW.current_stage := v_stage; NEW.bucket_top := v_bucket;
  NEW.rs_result_missing := v_rs_missing; NEW.ur_aging_days := v_ur_days;

  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay, 'DS'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL AND ds_a IS NOT NULL THEN v_delay := array_append(v_delay, 'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL AND sb_a IS NOT NULL THEN v_delay := array_append(v_delay, 'RS'); END IF;

  -- 완전 계획 필요: 다음 라운드 DS/DF/SB Plan 3개가 모두 있어야 needs_planning=false
  IF v_active = 1 AND NEW.r1_response_result IN ('B','C')
     AND (NEW.r2_draft_start_plan IS NULL OR NEW.r2_draft_finish_plan IS NULL OR NEW.r2_submission_plan IS NULL) THEN
    v_needs_plan := true;
    v_delay := array_append(v_delay, 'NoPlan');
  ELSIF v_active = 2 AND NEW.r2_response_result IN ('B','C')
     AND (NEW.r3_draft_start_plan IS NULL OR NEW.r3_draft_finish_plan IS NULL OR NEW.r3_submission_plan IS NULL) THEN
    v_needs_plan := true;
    v_delay := array_append(v_delay, 'NoPlan');
  END IF;

  NEW.delay_bucket := v_delay;
  NEW.needs_planning := v_needs_plan;

  IF NEW.extra_rounds IS NOT NULL AND jsonb_typeof(NEW.extra_rounds) = 'array'
     AND jsonb_array_length(NEW.extra_rounds) > 0 THEN
    NEW.has_r4_plus := true;
  ELSE
    NEW.has_r4_plus := false;
  END IF;

  RETURN NEW;
END;
$function$;

-- 전체 재계산 (트리거 재실행)
UPDATE public.abd_items_raw SET updated_at = updated_at WHERE true;