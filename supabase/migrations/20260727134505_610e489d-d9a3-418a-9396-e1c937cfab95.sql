-- 1) 출처 추적 컬럼 신설
ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS r1_response_source text,
  ADD COLUMN IF NOT EXISTS r2_response_source text,
  ADD COLUMN IF NOT EXISTS r3_response_source text;

-- 2) 기존 non-null response_result 는 imported 로 표기
UPDATE public.abd_items_raw
SET r1_response_source = 'imported'
WHERE r1_response_result IS NOT NULL AND r1_response_source IS NULL;
UPDATE public.abd_items_raw
SET r2_response_source = 'imported'
WHERE r2_response_result IS NOT NULL AND r2_response_source IS NULL;
UPDATE public.abd_items_raw
SET r3_response_source = 'imported'
WHERE r3_response_result IS NOT NULL AND r3_response_source IS NULL;

-- 3) back-fill 함수
CREATE OR REPLACE FUNCTION public.abd_backfill_response_results()
 RETURNS TABLE(item_id uuid, r1_set text, r2_set text, r3_set text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_last_code text;
  v_last_round smallint;
  v_r1 text; v_r2 text; v_r3 text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superuser'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: admin/superuser only';
  END IF;

  PERFORM set_config('app.change_source', 'backfill', true);

  FOR r IN
    SELECT id, latest_status_norm, latest_status,
           r1_response_result, r2_response_result, r3_response_result,
           r1_dar_actual, r2_dar_actual, r3_dar_actual,
           r1_submission_actual, r2_submission_actual, r3_submission_actual,
           active_round, is_terminated, is_active
    FROM public.abd_items_raw
    WHERE COALESCE(is_active, true) = true
      AND COALESCE(is_terminated, false) = false
      AND UPPER(COALESCE(latest_status,'')) IN ('A','B','C')
      AND r1_response_result IS NULL
      AND r2_response_result IS NULL
      AND r3_response_result IS NULL
  LOOP
    v_last_code := UPPER(r.latest_status);
    -- 마지막 완료 라운드 = active_round (Approved 는 A 회신 시점)
    v_last_round := COALESCE(r.active_round, 1);
    v_r1 := NULL; v_r2 := NULL; v_r3 := NULL;

    IF v_last_round = 1 THEN
      v_r1 := v_last_code;
    ELSIF v_last_round = 2 THEN
      v_r1 := 'C';  -- B 는 1회 연장 후 종결, 이전 라운드는 규칙상 C
      v_r2 := v_last_code;
    ELSIF v_last_round = 3 THEN
      v_r1 := 'C';
      v_r2 := 'C';
      v_r3 := v_last_code;
    END IF;

    UPDATE public.abd_items_raw
    SET r1_response_result = COALESCE(r1_response_result, v_r1),
        r2_response_result = COALESCE(r2_response_result, v_r2),
        r3_response_result = COALESCE(r3_response_result, v_r3),
        r1_response_source = CASE WHEN r1_response_source IS NULL AND v_r1 IS NOT NULL THEN 'backfill' ELSE r1_response_source END,
        r2_response_source = CASE WHEN r2_response_source IS NULL AND v_r2 IS NOT NULL THEN 'backfill' ELSE r2_response_source END,
        r3_response_source = CASE WHEN r3_response_source IS NULL AND v_r3 IS NOT NULL THEN 'backfill' ELSE r3_response_source END
    WHERE id = r.id;

    item_id := r.id;
    r1_set := v_r1; r2_set := v_r2; r3_set := v_r3;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_backfill_response_results() TO authenticated;