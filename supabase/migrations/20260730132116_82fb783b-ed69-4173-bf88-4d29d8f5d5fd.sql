CREATE OR REPLACE FUNCTION public.tm_kpi_judgment_g(_actual_progress numeric, _actual_finish date, _actual_start date, _plan_start date, _as_of date, _gap numeric, _caution_buffer numeric DEFAULT NULL::numeric, _worsen_gap numeric DEFAULT NULL::numeric)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL) THEN '완료'
    WHEN (_plan_start IS NOT NULL AND _as_of IS NOT NULL AND _plan_start > _as_of)
         AND COALESCE(_actual_progress,0) <= 0 THEN '정상'
    WHEN _gap IS NULL THEN '정상'
    WHEN _gap < public.tm_resolve_worsen(_worsen_gap) THEN '악화'
    WHEN _gap < 0 THEN '지연'
    WHEN _gap < public.tm_resolve_caution(_caution_buffer) THEN '주의'
    ELSE '정상' END;
$function$;