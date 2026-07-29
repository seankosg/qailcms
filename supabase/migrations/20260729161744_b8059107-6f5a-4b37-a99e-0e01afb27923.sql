CREATE OR REPLACE FUNCTION public.abd_backfill_response_results(_dry_run boolean DEFAULT true)
 RETURNS TABLE(item_id uuid, abd_number text, last_round smallint, r1_set text, r2_set text, r3_set text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_last_round smallint;
  v_r1 text;
  v_r2 text;
  v_r3 text;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION '권한 없음: admin/superuser 만 실행 가능';
  END IF;

  IF NOT _dry_run THEN
    PERFORM set_config('app.change_source', 'backfill', true);
  END IF;

  FOR r IN
    SELECT t.id, t.abd_number AS num,
           t.r1_submission_actual, t.r2_submission_actual, t.r3_submission_actual,
           t.r1_response_result, t.r2_response_result, t.r3_response_result,
           t.latest_status
    FROM public.abd_items_raw t
    WHERE t.latest_status IN ('A','B','C')
      AND (t.is_active IS NOT FALSE)
      AND (t.is_terminated IS NOT TRUE)
      AND (t.r1_submission_actual IS NOT NULL
           OR t.r2_submission_actual IS NOT NULL
           OR t.r3_submission_actual IS NOT NULL)
      AND (t.r1_response_result IS NULL
           OR t.r2_response_result IS NULL
           OR t.r3_response_result IS NULL)
  LOOP
    v_last_round := NULL;
    IF r.r3_submission_actual IS NOT NULL THEN v_last_round := 3;
    ELSIF r.r2_submission_actual IS NOT NULL THEN v_last_round := 2;
    ELSIF r.r1_submission_actual IS NOT NULL THEN v_last_round := 1;
    END IF;
    IF v_last_round IS NULL THEN CONTINUE; END IF;

    v_r1 := NULL; v_r2 := NULL; v_r3 := NULL;
    IF v_last_round >= 2 AND r.r1_response_result IS NULL AND r.r1_submission_actual IS NOT NULL THEN
      v_r1 := 'C';
    END IF;
    IF v_last_round >= 3 AND r.r2_response_result IS NULL AND r.r2_submission_actual IS NOT NULL THEN
      v_r2 := 'C';
    END IF;
    IF v_r1 IS NULL AND v_r2 IS NULL AND v_r3 IS NULL THEN CONTINUE; END IF;

    IF NOT _dry_run THEN
      UPDATE public.abd_items_raw u SET
        r1_response_result = COALESCE(u.r1_response_result, v_r1),
        r2_response_result = COALESCE(u.r2_response_result, v_r2),
        r3_response_result = COALESCE(u.r3_response_result, v_r3),
        r1_response_source = CASE WHEN u.r1_response_result IS NULL AND v_r1 IS NOT NULL THEN 'backfill' ELSE u.r1_response_source END,
        r2_response_source = CASE WHEN u.r2_response_result IS NULL AND v_r2 IS NOT NULL THEN 'backfill' ELSE u.r2_response_source END,
        r3_response_source = CASE WHEN u.r3_response_result IS NULL AND v_r3 IS NOT NULL THEN 'backfill' ELSE u.r3_response_source END
      WHERE u.id = r.id;
    END IF;

    item_id := r.id;
    abd_number := r.num;
    last_round := v_last_round;
    r1_set := v_r1;
    r2_set := v_r2;
    r3_set := v_r3;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;