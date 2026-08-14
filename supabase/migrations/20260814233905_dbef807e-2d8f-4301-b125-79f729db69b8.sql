CREATE OR REPLACE FUNCTION public.dmr_period_canon(_start date, _end date, _from_zero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  _prev date;
  _rows jsonb;
BEGIN
  IF _start IS NULL OR _end IS NULL THEN
    RAISE EXCEPTION 'dmr_period_canon: _start/_end are required';
  END IF;
  IF _start > _end THEN
    RAISE EXCEPTION 'dmr_period_canon: _start(%) must be <= _end(%)', _start, _end;
  END IF;
  _prev := _start - 1;

  WITH te AS (
    SELECT t.*, row_number() OVER () AS rn
    FROM public.tm_rows_as_of(_end) t
  ),
  te_code AS (
    SELECT *, btrim(coalesce(task_no, '')) AS code FROM te
  ),
  meta AS (
    SELECT DISTINCT ON (code)
      code, task_name, row_type, discipline, team, plot, data_date, cum_plan_pct
    FROM te_code
    WHERE code <> ''
    ORDER BY code, rn
  ),
  id_code AS (
    SELECT id, code FROM te_code WHERE code <> ''
  ),
  ae AS (
    SELECT a.*, row_number() OVER () AS rn
    FROM public.tm_actual_at_set(_end, NULL) a
  ),
  actual_end AS (
    SELECT DISTINCT ON (ic.code)
      ic.code, ae.b_asof, ae.a_asof
    FROM ae JOIN id_code ic ON ic.id = ae.task_raw_id
    ORDER BY ic.code, ae.rn DESC
  ),
  tp AS (
    SELECT t.*, row_number() OVER () AS rn
    FROM public.tm_rows_as_of(_prev) t
    WHERE NOT _from_zero
  ),
  plan_prev AS (
    SELECT DISTINCT ON (btrim(coalesce(task_no, '')))
      btrim(coalesce(task_no, '')) AS code, cum_plan_pct AS v
    FROM tp
    WHERE btrim(coalesce(task_no, '')) <> '' AND cum_plan_pct IS NOT NULL
    ORDER BY 1, rn
  ),
  ap AS (
    SELECT a.*, row_number() OVER () AS rn
    FROM public.tm_actual_at_set(_start, NULL) a
    WHERE NOT _from_zero
  ),
  actual_prev AS (
    SELECT DISTINCT ON (ic.code)
      ic.code, ap.b_prev, ap.a_prev
    FROM ap JOIN id_code ic ON ic.id = ap.task_raw_id
    ORDER BY ic.code, ap.rn DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'task_no', m.code,
           'task_name', m.task_name,
           'row_type', m.row_type,
           'discipline', m.discipline,
           'team', m.team,
           'plot', m.plot,
           'data_date', m.data_date,
           'cum_plan_pct', m.cum_plan_pct,
           'plan_prev', pp.v,
           'actual_end_b_asof', aend.b_asof,
           'actual_end_a_asof', aend.a_asof,
           'actual_prev_b_prev', aprev.b_prev,
           'actual_prev_a_prev', aprev.a_prev
         ) ORDER BY m.code), '[]'::jsonb)
    INTO _rows
  FROM meta m
  LEFT JOIN plan_prev pp ON pp.code = m.code
  LEFT JOIN actual_end aend ON aend.code = m.code
  LEFT JOIN actual_prev aprev ON aprev.code = m.code;

  RETURN jsonb_build_object(
    'start', _start,
    'end', _end,
    'from_zero', coalesce(_from_zero, false),
    'rows', _rows
  );
END;
$function$;