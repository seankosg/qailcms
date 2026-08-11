CREATE OR REPLACE FUNCTION public.abd_judge_v1(_row abd_items_raw, _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Qatar')::date;
  v_today date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_past boolean;
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
  v_norm_out text;
  v_mismatch boolean;
  v_comp text := NULL;
  v_comp_grp text := NULL;
  v_approved boolean := false;
  a1ds date; a1df date; a1sb date; a1rs date;
  a2ds date; a2df date; a2sb date; a2rs date;
  a3ds date; a3df date; a3sb date; a3rs date;
  rr1 char(1); rr2 char(1); rr3 char(1);
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_past := v_today < v_now;

  -- As-of 마스킹: 실적일 > as-of 이면 그 시점에는 미발생으로 취급 (혼합 계산 금지).
  a1ds := CASE WHEN _row.r1_draft_start_actual  <= v_today THEN _row.r1_draft_start_actual  END;
  a1df := CASE WHEN _row.r1_draft_finish_actual <= v_today THEN _row.r1_draft_finish_actual END;
  a1sb := CASE WHEN _row.r1_submission_actual   <= v_today THEN _row.r1_submission_actual   END;
  a1rs := CASE WHEN _row.r1_dar_actual          <= v_today THEN _row.r1_dar_actual          END;
  a2ds := CASE WHEN _row.r2_draft_start_actual  <= v_today THEN _row.r2_draft_start_actual  END;
  a2df := CASE WHEN _row.r2_draft_finish_actual <= v_today THEN _row.r2_draft_finish_actual END;
  a2sb := CASE WHEN _row.r2_submission_actual   <= v_today THEN _row.r2_submission_actual   END;
  a2rs := CASE WHEN _row.r2_dar_actual          <= v_today THEN _row.r2_dar_actual          END;
  a3ds := CASE WHEN _row.r3_draft_start_actual  <= v_today THEN _row.r3_draft_start_actual  END;
  a3df := CASE WHEN _row.r3_draft_finish_actual <= v_today THEN _row.r3_draft_finish_actual END;
  a3sb := CASE WHEN _row.r3_submission_actual   <= v_today THEN _row.r3_submission_actual   END;
  a3rs := CASE WHEN _row.r3_dar_actual          <= v_today THEN _row.r3_dar_actual          END;
  -- 회신 결과는 회신일(dar_actual) <= as-of 일 때만 유효.
  rr1 := CASE WHEN a1rs IS NOT NULL THEN _row.r1_response_result END;
  rr2 := CASE WHEN a2rs IS NOT NULL THEN _row.r2_response_result END;
  rr3 := CASE WHEN a3rs IS NOT NULL THEN _row.r3_response_result END;

  v_raw_up := CASE WHEN _row.latest_status IS NULL THEN NULL ELSE upper(btrim(_row.latest_status)) END;
  v_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  v_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  -- 승인은 approval_date <= as-of 일 때만 유효. 과거 as-of 인데 승인일이 없으면 복원 불가.
  IF v_norm = 'A' THEN
    IF _row.approval_date IS NOT NULL THEN
      v_approved := (_row.approval_date <= v_today);
    ELSE
      v_approved := NOT v_past;
    END IF;
  END IF;

  -- 날짜 근거 없는 상태 스칼라(종결 플래그 / 승인일 없는 승인)는 과거 시점 복원 불가 → 판정 불가.
  IF v_past AND NOT v_approved AND (COALESCE(_row.is_terminated,false) OR (v_norm = 'A' AND _row.approval_date IS NULL)) THEN
    RETURN jsonb_build_object(
      'latest_status_norm', NULL, 'status_mismatch', v_mismatch, 'active_round', NULL,
      'current_stage', 'NO_HISTORY', 'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', NULL, 'completed_stage_group', NULL,
      'judgment_unavailable', true
    );
  END IF;

  IF a3ds IS NOT NULL OR a3df IS NOT NULL OR a3sb IS NOT NULL OR a3rs IS NOT NULL
     OR rr2 IN ('B','C') THEN
    v_active := 3;
  ELSIF a2ds IS NOT NULL OR a2df IS NOT NULL OR a2sb IS NOT NULL OR a2rs IS NOT NULL
     OR rr1 IN ('B','C') THEN
    v_active := 2;
  ELSE
    v_active := 1;
  END IF;

  IF a3rs IS NOT NULL THEN v_comp := 'RS3';
  ELSIF a3sb IS NOT NULL THEN v_comp := 'SB3';
  ELSIF a3df IS NOT NULL THEN v_comp := 'DF3';
  ELSIF a3ds IS NOT NULL THEN v_comp := 'DS3';
  ELSIF a2rs IS NOT NULL THEN v_comp := 'RS2';
  ELSIF a2sb IS NOT NULL THEN v_comp := 'SB2';
  ELSIF a2df IS NOT NULL THEN v_comp := 'DF2';
  ELSIF a2ds IS NOT NULL THEN v_comp := 'DS2';
  ELSIF a1rs IS NOT NULL THEN v_comp := 'RS1';
  ELSIF a1sb IS NOT NULL THEN v_comp := 'SB1';
  ELSIF a1df IS NOT NULL THEN v_comp := 'DF1';
  ELSIF a1ds IS NOT NULL THEN v_comp := 'DS1';
  END IF;

  IF v_approved THEN
    IF rr3 = 'A' THEN v_active := 3;
    ELSIF rr2 = 'A' THEN v_active := 2;
    ELSE v_active := 1;
    END IF;
    RETURN jsonb_build_object(
      'latest_status_norm', 'A', 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'Approved', 'bucket_top', 'Approved',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', 'Approved', 'completed_stage_group', 'APPROVED',
      'judgment_unavailable', false
    );
  END IF;

  IF COALESCE(_row.is_terminated,false) THEN
    v_comp := 'TM' || v_active::text;
    v_comp_grp := 'TM';
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text, 'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', v_comp, 'completed_stage_group', v_comp_grp,
      'judgment_unavailable', false
    );
  END IF;

  -- 승인 미도래(또는 미승인) 상태: 과거 as-of 에서는 날짜 근거 없는 B/C 스칼라를 노출하지 않는다.
  v_norm_out := CASE WHEN v_past THEN NULL ELSE v_norm END;

  v_comp_grp := CASE WHEN v_comp IS NULL THEN NULL ELSE left(v_comp, 2) END;

  IF v_active = 1 THEN
    ds_p := _row.r1_draft_start_plan;  ds_a := a1ds;
    df_p := _row.r1_draft_finish_plan; df_a := a1df;
    sb_p := _row.r1_submission_plan;   sb_a := a1sb;
    rs_p := _row.r1_dar_plan;          rs_a := a1rs; rr := rr1;
  ELSIF v_active = 2 THEN
    ds_p := _row.r2_draft_start_plan;  ds_a := a2ds;
    df_p := _row.r2_draft_finish_plan; df_a := a2df;
    sb_p := _row.r2_submission_plan;   sb_a := a2sb;
    rs_p := _row.r2_dar_plan;          rs_a := a2rs; rr := rr2;
  ELSE
    ds_p := _row.r3_draft_start_plan;  ds_a := a3ds;
    df_p := _row.r3_draft_finish_plan; df_a := a3df;
    sb_p := _row.r3_submission_plan;   sb_a := a3sb;
    rs_p := _row.r3_dar_plan;          rs_a := a3rs; rr := rr3;
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

  IF v_stage_kind = 'RS' THEN
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

  -- needs_planning: 활성 라운드 plan 3종 결손만으로 판정.
  IF ds_p IS NULL OR df_p IS NULL OR sb_p IS NULL THEN
    v_needs_plan := true;
    v_delay := array_append(v_delay,'NoPlan');
  END IF;

  -- needs_revise: 직전 라운드 회신 B/C 기인 재계획 필요 (회신일 <= as-of 인 경우만).
  IF v_active = 2 AND rr1 IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 3 AND rr2 IN ('B','C')
     AND (_row.r3_draft_start_plan IS NULL OR _row.r3_draft_finish_plan IS NULL OR _row.r3_submission_plan IS NULL) THEN
    v_needs_revise := true; v_revise_src := 2;
  END IF;

  RETURN jsonb_build_object(
    'latest_status_norm', v_norm_out, 'status_mismatch', v_mismatch, 'active_round', v_active,
    'current_stage', v_stage, 'bucket_top', v_bucket,
    'delay_bucket', v_delay, 'delay_late', v_late, 'primary_delay', v_primary,
    'needs_planning', v_needs_plan, 'needs_revise', v_needs_revise, 'revise_source_round', v_revise_src,
    'rs_result_missing', v_rs_missing, 'ur_aging_days', v_ur_days,
    'completed_stage', v_comp, 'completed_stage_group', v_comp_grp,
    'judgment_unavailable', false
  );
END;
$function$;

UPDATE public.abd_items_raw
SET is_terminated = is_terminated
WHERE is_active
  AND COALESCE(is_terminated,false)
  AND upper(btrim(latest_status)) = 'A';