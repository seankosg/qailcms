-- 완료 정본 단일화: actual_finish IS NOT NULL 단독 (진행률 100% OR 조건 제거)

CREATE OR REPLACE FUNCTION public.tm_kpi_judgment_g(_actual_progress numeric, _actual_finish date, _actual_start date, _plan_start date, _as_of date, _gap numeric, _caution_buffer numeric DEFAULT NULL::numeric, _worsen_gap numeric DEFAULT NULL::numeric)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (_actual_finish IS NOT NULL) THEN '완료'
    WHEN (_plan_start IS NOT NULL AND _as_of IS NOT NULL AND _plan_start > _as_of)
         AND COALESCE(_actual_progress,0) <= 0 THEN '정상'
    WHEN _gap IS NULL THEN '정상'
    WHEN _gap < public.tm_resolve_worsen(_worsen_gap) THEN '악화'
    WHEN _gap < 0 THEN '지연'
    WHEN _gap < public.tm_resolve_caution(_caution_buffer) THEN '주의'
    ELSE '정상' END;
$function$;

DO $mig$
DECLARE
  d text;
  nd text;
  v text;
BEGIN
  -- tm_kpi_bucket_matches_g
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='tm_kpi_bucket_matches_g';
  nd := replace(d, '(COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL)', '(_actual_finish IS NOT NULL)');
  IF nd = d THEN RAISE EXCEPTION 'tm_kpi_bucket_matches_g: pattern not found'; END IF;
  EXECUTE nd;

  -- tm_items_counts
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='tm_items_counts';
  nd := replace(d, '(COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL)', '(s.actual_finish IS NOT NULL)');
  IF nd = d THEN RAISE EXCEPTION 'tm_items_counts: pattern not found'; END IF;
  EXECUTE nd;

  -- tm_items_counts_by_team
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='tm_items_counts_by_team';
  nd := replace(d, '(COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL)', '(s.actual_finish IS NOT NULL)');
  IF nd = d THEN RAISE EXCEPTION 'tm_items_counts_by_team: pattern not found'; END IF;
  EXECUTE nd;

  -- update_task_summary (bool_and 하위 완료 롤업)
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='update_task_summary';
  nd := replace(d,
    'bool_and(actual_finish is not null or least(1, greatest(0, coalesce(actual_progress,0))) >= 1) as all_finished',
    'bool_and(actual_finish is not null) as all_finished');
  IF nd = d THEN RAISE EXCEPTION 'update_task_summary: pattern not found'; END IF;
  EXECUTE nd;

  -- v_task_management_raw_derived (plan_overdue / actual_overdue)
  SELECT pg_get_viewdef(c.oid) INTO v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='v_task_management_raw_derived';
  nd := replace(v,
    '(COALESCE(t.actual_progress, (0)::numeric) >= (1)::numeric) OR (t.actual_finish IS NOT NULL)',
    't.actual_finish IS NOT NULL');
  IF nd = v THEN RAISE EXCEPTION 'v_task_management_raw_derived: pattern not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_task_management_raw_derived AS ' || nd;
END
$mig$;