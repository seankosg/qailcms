CREATE OR REPLACE FUNCTION public.abd_stage_group(_row abd_items_raw)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 2026-07-30: NS 폐지. 판정 정본(current_stage/bucket_top)만 사용한다.
  -- latest_status 원값(날짜 근거 없는 현재 스칼라)은 과거 as-of 를 오염시키므로 참조 금지.
  SELECT CASE
    WHEN coalesce(_row.current_stage,'') = 'NO_HISTORY' THEN 'NO_HISTORY'
    WHEN coalesce(_row.bucket_top,'') = 'RESUBMIT' THEN 'RESUBMIT'
    WHEN coalesce(_row.bucket_top,'') = 'Approved' THEN 'APPROVED'
    ELSE left(coalesce(_row.current_stage,'DS'), 2)
  END
$function$;