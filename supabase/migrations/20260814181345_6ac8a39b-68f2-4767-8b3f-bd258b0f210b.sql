-- DMR 대시보드 성능: 기존 TM 정본(tm_rows_as_of / tm_actual_at_set)을 서버에서 호출해
-- 필요한 필드만 축소 반환하는 읽기 전용 래퍼. 산식 복제 없음.

CREATE OR REPLACE FUNCTION public.dmr_period_canon(
  _start date,
  _end date,
  _from_zero boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
      ic.code,
      least(1, greatest(0,
        CASE WHEN coalesce(ae.b_asof, ae.a_asof, 0) > 1
             THEN coalesce(ae.b_asof, ae.a_asof, 0) / 100
             ELSE coalesce(ae.b_asof, ae.a_asof, 0) END)) AS v
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
      ic.code,
      least(1, greatest(0,
        CASE WHEN coalesce(ap.b_prev, ap.a_prev, 0) > 1
             THEN coalesce(ap.b_prev, ap.a_prev, 0) / 100
             ELSE coalesce(ap.b_prev, ap.a_prev, 0) END)) AS v
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
           'actual_end', coalesce(aend.v, 0),
           'actual_prev', coalesce(aprev.v, 0)
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
$$;

REVOKE ALL ON FUNCTION public.dmr_period_canon(date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dmr_period_canon(date, date, boolean) TO authenticated, service_role;

-- 추이 차트: 날짜별 tm_rows_as_of 결과에서 tc_plan_pct / tc_actual_pct 만 뽑아 한 번에 반환.
CREATE OR REPLACE FUNCTION public.dmr_daily_canon(
  _start date,
  _end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _d date;
  _out jsonb := '[]'::jsonb;
  _day jsonb;
BEGIN
  IF _start IS NULL OR _end IS NULL THEN
    RAISE EXCEPTION 'dmr_daily_canon: _start/_end are required';
  END IF;
  IF _start > _end THEN
    RAISE EXCEPTION 'dmr_daily_canon: _start(%) must be <= _end(%)', _start, _end;
  END IF;
  IF (_end - _start) + 1 > 31 THEN
    RAISE EXCEPTION 'dmr_daily_canon: range limited to 31 days (got %)', (_end - _start) + 1;
  END IF;

  _d := _start;
  WHILE _d <= _end LOOP
    WITH t AS (
      SELECT r.*, row_number() OVER () AS rn
      FROM public.tm_rows_as_of(_d) r
    ),
    d AS (
      SELECT DISTINCT ON (btrim(coalesce(task_no, '')))
        btrim(coalesce(task_no, '')) AS code, tc_plan_pct, tc_actual_pct
      FROM t
      WHERE btrim(coalesce(task_no, '')) <> ''
      ORDER BY 1, rn
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'as_of', _d,
             'task_no', d.code,
             'tc_plan_pct', d.tc_plan_pct,
             'tc_actual_pct', d.tc_actual_pct
           ) ORDER BY d.code), '[]'::jsonb)
      INTO _day
    FROM d;

    _out := _out || _day;
    _d := _d + 1;
  END LOOP;

  RETURN jsonb_build_object('start', _start, 'end', _end, 'rows', _out);
END;
$$;

REVOKE ALL ON FUNCTION public.dmr_daily_canon(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dmr_daily_canon(date, date) TO authenticated, service_role;