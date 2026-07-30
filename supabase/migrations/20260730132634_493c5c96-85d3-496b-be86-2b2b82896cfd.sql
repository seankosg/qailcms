-- 구 판정 함수를 정본(_g)에 완전 위임 (판정 로직 2벌 공존 제거)
CREATE OR REPLACE FUNCTION public.tm_kpi_judgment(_actual_progress numeric, _actual_finish date, _actual_start date, _plan_start date, _plan_end date, _plan_days integer, _plan_progress numeric, _as_of date, _caution_buffer numeric, _worsen_gap numeric)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- DEPRECATED SHIM: 판정 로직 정본은 public.tm_kpi_judgment_g 하나뿐이다.
  SELECT public.tm_kpi_judgment_g(
    _actual_progress, _actual_finish, _actual_start, _plan_start, _as_of,
    public.tm_kpi_gap(_actual_progress, _plan_progress, _plan_start, _plan_end, _plan_days, _as_of),
    _caution_buffer, _worsen_gap);
$function$;

CREATE OR REPLACE FUNCTION public.tm_kpi_bucket_matches(_bucket text, _actual_progress numeric, _actual_finish date, _actual_start date, _plan_start date, _plan_end date, _plan_days integer, _plan_progress numeric, _as_of date, _caution_buffer numeric, _worsen_gap numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- DEPRECATED SHIM: 버킷 판정 정본은 public.tm_kpi_bucket_matches_g 하나뿐이다.
  SELECT public.tm_kpi_bucket_matches_g(
    _bucket, _actual_progress, _actual_finish, _actual_start, _plan_start, _plan_end, _as_of,
    public.tm_kpi_gap(_actual_progress, _plan_progress, _plan_start, _plan_end, _plan_days, _as_of),
    _caution_buffer, _worsen_gap);
$function$;