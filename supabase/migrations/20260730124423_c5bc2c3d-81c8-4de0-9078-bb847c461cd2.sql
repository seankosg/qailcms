-- S-커브 누적 정본: abd_progress_events 기반 "기간 내 문서 distinct" 누적.
-- 누적(b) = 최초 이벤트일(min edate)이 버킷 종료일 이하인 문서 수 → 종점 = abd_progress_totals.
CREATE OR REPLACE FUNCTION public.abd_progress_cum_json(
  _plots text[],
  _teams text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text,
  _round text
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT r.id
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.abd_progress_events(_as_of_date, _plan_mode, _round) e
    JOIN base b ON b.id = e.item_id
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  firsts AS (
    SELECT item_id, stage, field, min(edate) AS first_date
    FROM ev
    GROUP BY 1,2,3
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
           CASE WHEN _bucket = 'week' THEN (g::date + 6) ELSE g::date END AS bucket_end
    FROM generate_series(
      _range_start::timestamp,
      _range_end::timestamp,
      CASE WHEN _bucket = 'week' THEN interval '7 day' ELSE interval '1 day' END
    ) g
  ),
  stages(stage) AS (
    VALUES ('draft_start'),('draft_finish'),('submission'),('dar'),('approval')
  ),
  grid AS (
    SELECT b.bucket_iso, b.bucket_end, s.stage FROM buckets b CROSS JOIN stages s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_iso', gr.bucket_iso,
           'stage', gr.stage,
           'cum_plan', gr.cum_plan,
           'cum_actual', gr.cum_actual
         ) ORDER BY gr.stage, gr.bucket_iso), '[]'::jsonb)
  FROM (
    SELECT g.bucket_iso, g.stage,
      (SELECT count(*) FROM firsts f
        WHERE f.stage = g.stage AND f.field = 'planned' AND f.first_date <= g.bucket_end)::int AS cum_plan,
      (SELECT count(*) FROM firsts f
        WHERE f.stage = g.stage AND f.field = 'actual' AND f.first_date <= g.bucket_end)::int AS cum_actual
    FROM grid g
  ) gr;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_progress_cum_json(text[],text[],text,date,date,date,text,text) TO authenticated, service_role;