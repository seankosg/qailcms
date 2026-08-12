-- TC 두 열: 행별 tm_cum_actual_at 호출을 집합 연산으로 대체 (결과 불변, 성능만 개선)
CREATE OR REPLACE FUNCTION public.tm_actual_at_set(_as_of date, _ids uuid[] DEFAULT NULL)
RETURNS TABLE(task_raw_id uuid, b_asof numeric, a_asof numeric, b_prev numeric, a_prev numeric)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH h AS (
    SELECT s.task_raw_id, s.old_value, s.new_value, s.changed_at,
           (s.changed_at AT TIME ZONE 'Asia/Qatar')::date AS d
      FROM public.task_management_status_history s
     WHERE s.field = 'actual_progress'
       AND (_ids IS NULL OR s.task_raw_id = ANY(_ids))
  ),
  hh AS (SELECT DISTINCT h.task_raw_id FROM h),
  b1 AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id, btrim(h.new_value)::numeric AS v
      FROM h WHERE btrim(h.new_value) ~ '^-?[0-9]+(\.[0-9]+)?$' AND h.d <= _as_of
     ORDER BY h.task_raw_id, h.changed_at DESC
  ),
  b2 AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id, btrim(h.new_value)::numeric AS v
      FROM h WHERE btrim(h.new_value) ~ '^-?[0-9]+(\.[0-9]+)?$' AND h.d <= _as_of - 1
     ORDER BY h.task_raw_id, h.changed_at DESC
  ),
  a1 AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id,
           CASE WHEN btrim(h.old_value) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(h.old_value)::numeric ELSE 0 END AS v
      FROM h WHERE h.d > _as_of
     ORDER BY h.task_raw_id, h.changed_at ASC
  ),
  a2 AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id,
           CASE WHEN btrim(h.old_value) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(h.old_value)::numeric ELSE 0 END AS v
      FROM h WHERE h.d > _as_of - 1
     ORDER BY h.task_raw_id, h.changed_at ASC
  )
  SELECT hh.task_raw_id, b1.v, a1.v, b2.v, a2.v
    FROM hh
    LEFT JOIN b1 ON b1.task_raw_id = hh.task_raw_id
    LEFT JOIN a1 ON a1.task_raw_id = hh.task_raw_id
    LEFT JOIN b2 ON b2.task_raw_id = hh.task_raw_id
    LEFT JOIN a2 ON a2.task_raw_id = hh.task_raw_id;
$fn$;

GRANT EXECUTE ON FUNCTION public.tm_actual_at_set(date, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tm_rows_as_of_notc(_as_of date)
RETURNS TABLE(id uuid, task_no text, main_task_no text, level text, discipline text, category text, plot text, task_name text, risk text, sub_task_desc text, row_type text, status_manual text, plan_start date, plan_end date, plan_days integer, actual_start date, actual_progress numeric, plan_progress numeric, progress_variance numeric, forecast_end date, slip_days integer, auto_judgment text, data_date date, sort_order integer, source_file text, imported_at timestamp with time zone, imported_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, auto_judgment_import text, is_rollup boolean, source_import_log_id uuid, is_active boolean, team text, location text, floor_level text, actual_finish date, actual_duration integer, owner_user_id uuid, hdec_pic_name text, hdec_eng_name text, cum_plan_pct numeric, cum_actual_pct numeric, gap_pct numeric, delay_days integer, alarm_reason text, milestone text, milestone_date date, plan_overdue text, expected_finish date, actual_overdue text, stage_start text, stage_finish text, expected_progress_today numeric, effective_pic text, original_pic text, delegated_from text, is_delegated boolean)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH p AS (
    SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  th AS (
    SELECT public.tm_resolve_caution(NULL) AS caution, public.tm_resolve_worsen(NULL) AS worsen
  ),
  calc AS MATERIALIZED (
    SELECT v.*, p.asof, th.caution, th.worsen,
      dg.to_pic AS deleg_to, dg.from_pic AS deleg_from,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof) AS tplan,
      public.tm_kpi_norm_actual(v.actual_progress) AS act_n
    FROM public.v_task_management_raw_derived v
    CROSS JOIN p CROSS JOIN th
    LEFT JOIN LATERAL (
      SELECT d.to_pic, d.from_pic
        FROM public.tm_pic_delegations d
       WHERE d.task_raw_id = v.id
         AND d.status = 'active'
         AND p.asof BETWEEN d.start_date AND d.end_date
       ORDER BY d.created_at DESC
       LIMIT 1
    ) dg ON true
  )
  SELECT
    c.id, c.task_no, c.main_task_no, c.level, c.discipline, c.category, c.plot, c.task_name,
    c.risk, c.sub_task_desc, c.row_type, c.status_manual, c.plan_start, c.plan_end, c.plan_days,
    c.actual_start, c.actual_progress,
    c.plan_progress, c.progress_variance, c.forecast_end, c.slip_days,
    public.tm_kpi_judgment_g(
      c.act_n, c.actual_finish, c.actual_start, c.plan_start, c.asof,
      CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END,
      c.caution, c.worsen) AS auto_judgment,
    c.data_date, c.sort_order, c.source_file, c.imported_at, c.imported_by, c.created_at, c.updated_at,
    c.auto_judgment_import, c.is_rollup, c.source_import_log_id, c.is_active, c.team, c.location, c.floor_level,
    c.actual_finish,
    c.actual_duration, c.owner_user_id, c.hdec_pic_name, c.hdec_eng_name,
    c.tplan AS cum_plan_pct,
    c.act_n AS cum_actual_pct,
    CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END AS gap_pct,
    c.delay_days,
    c.alarm_reason,
    c.milestone, c.milestone_date, c.plan_overdue, c.expected_finish, c.actual_overdue,
    CASE
      WHEN c.actual_start IS NOT NULL AND c.plan_start IS NOT NULL AND c.actual_start > c.plan_start THEN 'completed_late'
      WHEN c.actual_start IS NOT NULL THEN 'completed'
      WHEN c.plan_start IS NULL THEN 'empty'
      WHEN c.plan_start <= c.asof THEN 'delay'
      ELSE 'plan' END AS stage_start,
    CASE
      WHEN c.actual_finish IS NOT NULL AND c.plan_end IS NOT NULL AND c.actual_finish > c.plan_end THEN 'completed_late'
      WHEN c.actual_finish IS NOT NULL THEN 'completed'
      WHEN c.plan_end IS NOT NULL AND c.plan_end <= c.asof THEN 'delay'
      WHEN c.actual_start IS NOT NULL AND (c.plan_end IS NULL OR c.plan_end > c.asof) THEN 'wip'
      WHEN c.plan_end IS NULL THEN 'empty'
      ELSE 'plan' END AS stage_finish,
    c.expected_progress_today,
    COALESCE(c.deleg_to, c.hdec_pic_name) AS effective_pic,
    c.hdec_pic_name AS original_pic,
    c.deleg_from AS delegated_from,
    (c.deleg_to IS NOT NULL) AS is_delegated
  FROM calc c;
$fn$;

GRANT EXECUTE ON FUNCTION public.tm_rows_as_of_notc(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
RETURNS TABLE(id uuid, task_no text, main_task_no text, level text, discipline text, category text, plot text, task_name text, risk text, sub_task_desc text, row_type text, status_manual text, plan_start date, plan_end date, plan_days integer, actual_start date, actual_progress numeric, plan_progress numeric, progress_variance numeric, forecast_end date, slip_days integer, auto_judgment text, data_date date, sort_order integer, source_file text, imported_at timestamp with time zone, imported_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, auto_judgment_import text, is_rollup boolean, source_import_log_id uuid, is_active boolean, team text, location text, floor_level text, actual_finish date, actual_duration integer, owner_user_id uuid, hdec_pic_name text, hdec_eng_name text, cum_plan_pct numeric, cum_actual_pct numeric, gap_pct numeric, delay_days integer, alarm_reason text, milestone text, milestone_date date, plan_overdue text, expected_finish date, actual_overdue text, stage_start text, stage_finish text, expected_progress_today numeric, effective_pic text, original_pic text, delegated_from text, is_delegated boolean, tc_actual_pct numeric, tc_plan_pct numeric)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH p AS (
    SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  hs AS (
    SELECT * FROM public.tm_actual_at_set((SELECT asof FROM p), NULL)
  ),
  n AS (
    SELECT * FROM public.tm_rows_as_of_notc((SELECT asof FROM p))
  )
  SELECT n.*,
    CASE
      WHEN hs.task_raw_id IS NULL THEN 0::numeric
      ELSE public.tm_kpi_norm_actual(COALESCE(hs.b_asof, hs.a_asof, 0))
           - public.tm_kpi_norm_actual(COALESCE(hs.b_prev, hs.a_prev, 0))
    END AS tc_actual_pct,
    CASE WHEN n.cum_plan_pct IS NULL OR tp.prev IS NULL THEN NULL
         ELSE n.cum_plan_pct - tp.prev END AS tc_plan_pct
  FROM n
  CROSS JOIN p
  LEFT JOIN hs ON hs.task_raw_id = n.id
  LEFT JOIN LATERAL (
    SELECT public.tm_row_tplan(n.level, n.discipline, n.task_no, n.plan_start, n.plan_end, n.plan_days, p.asof - 1) AS prev
  ) tp ON true;
$fn$;

CREATE OR REPLACE FUNCTION public.tm_items_search(_q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100, _include_inactive boolean DEFAULT false, _kpi_mode text DEFAULT NULL::text, _as_of date DEFAULT NULL::date, _thresholds jsonb DEFAULT NULL::jsonb, _ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  _allowed_cols constant text[] := array[
    'id','task_no','main_task_no','level','discipline','category','plot','task_name','risk',
    'sub_task_desc','row_type','status_manual','plan_start','plan_end','plan_days',
    'actual_start','actual_finish','actual_duration','actual_progress','plan_progress',
    'progress_variance','forecast_end','slip_days','auto_judgment','auto_judgment_import',
    'data_date','sort_order','is_rollup','is_active',
    'team','location','floor_level','owner_user_id','hdec_pic_name','hdec_eng_name','effective_pic','original_pic','is_delegated',
    'cum_plan_pct','cum_actual_pct','gap_pct','delay_days',
    'milestone','milestone_date','plan_overdue','expected_finish','actual_overdue',
    'stage_start','stage_finish','expected_progress_today'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','effective_pic','original_pic','is_delegated','milestone','status_manual','risk'
  ];
  _where_sql text := 'true';
  _sort_sql text := '';
  _filter jsonb;
  _sort_item jsonb;
  _col text; _op text; _val jsonb;
  _first_sort boolean := true;
  _token text;
  _field_sql text;
  _search_field text;
  _safe_limit integer;
  _safe_offset integer := greatest(0, coalesce(_offset, 0));
  _worsen_gap numeric := public.tm_resolve_worsen((_thresholds->>'worsen_gap')::numeric);
  _caution_gap_buffer numeric := public.tm_resolve_caution((_thresholds->>'caution_gap_buffer')::numeric);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
  _has_derived_ctx boolean := (_as_of IS NOT NULL AND _thresholds IS NOT NULL);
  _derived_expr text;
  _sql text;
  _result jsonb;
begin
  if _limit is null or _limit <= 0 then _safe_limit := 5000;
  else _safe_limit := least(_limit, 5000); end if;

  if not _include_inactive then _where_sql := _where_sql || ' and is_active = true'; end if;

  if _ids is not null and array_length(_ids, 1) > 0 then
    _where_sql := _where_sql || format(' and id = any(%L::uuid[])', _ids);
  end if;

  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(both '"' from trim(x))
      from regexp_split_to_table(_q, ',') as x
      where length(trim(both '"' from trim(x))) > 0
    loop
      _field_sql := '';
      foreach _search_field in array _search_cols loop
        if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
        _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
      end loop;
      if _field_sql <> '' then _where_sql := _where_sql || format(' and (%s)', _field_sql); end if;
    end loop;
  end if;

  for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;

    if _op = 'in' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
      end if;
    elsif _op = 'in_or_empty' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
          _col, _val, _col, _col);
      else
        _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
      end if;
    elsif _op = 'text' then
      if jsonb_typeof(_val) = 'string' then
        for _token in select trim(x) from regexp_split_to_table(_val #>> '{}', ',') as x where length(trim(x))>0 loop
          _where_sql := _where_sql || format(' and %I::text ilike %L', _col, '%' || _token || '%');
        end loop;
      end if;
    elsif _op = 'empty' then
      _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'not_empty' then
      _where_sql := _where_sql || format(' and (%I is not null and %I::text <> '''')', _col, _col);
    elsif _op = 'date_range' then
      if _val ? 'from' and length(coalesce(_val->>'from',''))>0 then
        _where_sql := _where_sql || format(' and (%I)::date >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to',''))>0 then
        _where_sql := _where_sql || format(' and (%I)::date <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then _where_sql := _where_sql || format(' and %I >= %s', _col, _val->>'min'); end if;
      if _val ? 'max' then _where_sql := _where_sql || format(' and %I <= %s', _col, _val->>'max'); end if;
    elsif _op = 'bool' and jsonb_typeof(_val)='boolean' then
      _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
    end if;
  end loop;

  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _where_sql := _where_sql || format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, %L::date, %s::numeric, %s::numeric)',
      _kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    ) || ' and alarm_reason is distinct from ''이력 없음''';
  end if;

  for _sort_item in select * from jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) loop
    _col := _sort_item->>'column';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;
    if not _first_sort then _sort_sql := _sort_sql || ', '; end if;
    _sort_sql := _sort_sql || format('%I %s nulls last', _col,
      case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    _first_sort := false;
  end loop;
  if _sort_sql = '' then
    _sort_sql := 'discipline asc nulls last, group_key asc, sort_order asc nulls last';
  else
    _sort_sql := _sort_sql || ', group_key asc, sort_order asc nulls last';
  end if;

  if _has_derived_ctx then
    _derived_expr := format(
      'public.tm_kpi_judgment(actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, %L::date, %s::numeric, %s::numeric)',
      _effective_asof, _caution_gap_buffer, _worsen_gap);
  else
    _derived_expr := 'auto_judgment';
  end if;

  _sql := format($fmt$
    with filtered as (
      select *, coalesce(main_task_no, task_no) as group_key
      from %s
      where %s
    ),
    mains_ordered as (
      select group_key,
             row_number() over (order by min(discipline) nulls last, group_key) as rn
      from filtered
      group by group_key
    ),
    tot as (
      select count(*)::bigint as total_count,
             count(distinct group_key)::bigint as main_count
      from filtered
    ),
    page_mains as (
      select group_key from mains_ordered
      where rn > %s and rn <= %s
    ),
    page_rows as (
      select f.*, (%s) as derived_auto_judgment
      from filtered f
      join page_mains pm using (group_key)
      order by %s
    ),
    tcset as (
      select * from public.tm_actual_at_set(%L::date, (select array_agg(id) from page_rows))
    ),
    page_rows_tc as (
      select pr.*,
        case when t.task_raw_id is null then 0::numeric
             else public.tm_kpi_norm_actual(coalesce(t.b_asof, t.a_asof, 0))
                  - public.tm_kpi_norm_actual(coalesce(t.b_prev, t.a_prev, 0)) end as tc_actual_pct,
        case when pr.cum_plan_pct is null or tp.prev is null then null
             else pr.cum_plan_pct - tp.prev end as tc_plan_pct
      from page_rows pr
      left join tcset t on t.task_raw_id = pr.id
      left join lateral (
        select public.tm_row_tplan(pr.level, pr.discipline, pr.task_no, pr.plan_start, pr.plan_end, pr.plan_days, %L::date - 1) as prev
      ) tp on true
      order by %s
    ),
    agg as (
      select coalesce(jsonb_agg(to_jsonb(page_rows_tc.*) - 'group_key'), '[]'::jsonb) as rows
      from page_rows_tc
    )
    select jsonb_build_object(
      'rows', agg.rows,
      'total_count', tot.total_count,
      'main_count', tot.main_count
    )
    from agg, tot
  $fmt$, format('public.tm_rows_as_of_notc(%L::date)', _effective_asof), _where_sql, _safe_offset, _safe_offset + _safe_limit, _derived_expr, _sort_sql,
        _effective_asof, _effective_asof, _sort_sql);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'main_count', 0));
end;
$function$;

DO $mig$
DECLARE d text;
BEGIN
  FOR d IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('tm_items_search_ids','tm_items_facets','tm_my_workspace_counts')
  LOOP
    EXECUTE replace(d, 'tm_rows_as_of(', 'tm_rows_as_of_notc(');
  END LOOP;
END $mig$;