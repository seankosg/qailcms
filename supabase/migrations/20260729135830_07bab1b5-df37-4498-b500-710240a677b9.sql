-- 오버로드 방지: 기존 무인자 시그니처를 명시적으로 DROP (PGRST203 재발 방지)
DROP FUNCTION IF EXISTS public.abd_backfill_response_results();

CREATE OR REPLACE FUNCTION public.abd_backfill_response_results(_dry_run boolean DEFAULT true)
RETURNS TABLE(
  item_id uuid,
  abd_number text,
  last_round smallint,
  r1_set text,
  r2_set text,
  r3_set text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_last_code text;
  v_last_round smallint;
  v_r1 text;
  v_r2 text;
  v_r3 text;
BEGIN
  -- 권한: 관리자/슈퍼유저만
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION '권한 없음: admin/superuser 만 실행 가능';
  END IF;

  IF NOT _dry_run THEN
    PERFORM set_config('app.change_source', 'backfill', true);
  END IF;

  FOR r IN
    SELECT id, abd_number,
           r1_submission_actual, r2_submission_actual, r3_submission_actual,
           r1_response_result, r2_response_result, r3_response_result,
           latest_status, approval_date
    FROM public.abd_items_raw
    WHERE latest_status IN ('A','B','C')
      AND (is_active IS NOT FALSE)
      AND (is_terminated IS NOT TRUE)
      -- 이전 라운드 추론 대상: 제출 이력이 하나라도 있고, 회신 결과가 하나라도 비어있는 도면
      AND (r1_submission_actual IS NOT NULL
           OR r2_submission_actual IS NOT NULL
           OR r3_submission_actual IS NOT NULL)
      AND (r1_response_result IS NULL
           OR r2_response_result IS NULL
           OR r3_response_result IS NULL)
  LOOP
    -- 실제 제출된 최고 라운드 (계획/active_round 무시)
    v_last_round := NULL;
    IF r.r3_submission_actual IS NOT NULL THEN v_last_round := 3;
    ELSIF r.r2_submission_actual IS NOT NULL THEN v_last_round := 2;
    ELSIF r.r1_submission_actual IS NOT NULL THEN v_last_round := 1;
    END IF;

    -- 이중 안전장치: 제출 이력 전무 → 스킵
    IF v_last_round IS NULL THEN CONTINUE; END IF;

    v_last_code := r.latest_status;
    v_r1 := NULL; v_r2 := NULL; v_r3 := NULL;

    -- 이전 라운드는 반려('C')로 추정. 이미 값이 있으면 유지(COALESCE).
    IF v_last_round >= 2 AND r.r1_response_result IS NULL AND r.r1_submission_actual IS NOT NULL THEN
      v_r1 := 'C';
    END IF;
    IF v_last_round >= 3 AND r.r2_response_result IS NULL AND r.r2_submission_actual IS NOT NULL THEN
      v_r2 := 'C';
    END IF;

    -- n 라운드는 절대 덮지 않는다 (Aconex source='imported' 불가침).
    -- v_r{last_round} 는 NULL 유지.

    -- 변경할 것이 없으면 스킵
    IF v_r1 IS NULL AND v_r2 IS NULL AND v_r3 IS NULL THEN CONTINUE; END IF;

    IF NOT _dry_run THEN
      UPDATE public.abd_items_raw SET
        r1_response_result = COALESCE(r1_response_result, v_r1),
        r2_response_result = COALESCE(r2_response_result, v_r2),
        r3_response_result = COALESCE(r3_response_result, v_r3),
        r1_response_source = CASE WHEN r1_response_result IS NULL AND v_r1 IS NOT NULL THEN 'backfill' ELSE r1_response_source END,
        r2_response_source = CASE WHEN r2_response_result IS NULL AND v_r2 IS NOT NULL THEN 'backfill' ELSE r2_response_source END,
        r3_response_source = CASE WHEN r3_response_result IS NULL AND v_r3 IS NOT NULL THEN 'backfill' ELSE r3_response_source END
      WHERE id = r.id;
    END IF;

    item_id := r.id;
    abd_number := r.abd_number;
    last_round := v_last_round;
    r1_set := v_r1;
    r2_set := v_r2;
    r3_set := v_r3;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;

-- 검증: 오버로드가 1건인지 확인
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM pg_proc WHERE proname='abd_backfill_response_results';
  IF cnt <> 1 THEN RAISE EXCEPTION 'abd_backfill_response_results overload mismatch: %', cnt; END IF;
END $$;