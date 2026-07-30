-- 1) gap: as-of 계획 평가(tm_kpi_tplan) 정본. 저장 plan_progress 참조 제거.
--    계획 평가 불가 → NULL (클라 computeVariance 와 동일 계약)
CREATE OR REPLACE FUNCTION public.tm_kpi_gap(_actual_progress numeric, _plan_progress numeric, _plan_start date, _plan_end date, _plan_days integer, _as_of date)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- _plan_progress 는 하위호환 시그니처 유지용이며 계산에 사용하지 않는다(임포트 스냅샷).
  SELECT CASE
    WHEN public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of) IS NULL THEN NULL::numeric
    ELSE public.tm_kpi_norm_actual(_actual_progress)
         - public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of)
  END;
$function$;

-- 2) cum plan: as-of 평가값. 평가 불가 시 0 (클라 cumPlanProgress = computeTPlan ?? 0)
CREATE OR REPLACE FUNCTION public.tm_kpi_cum_plan(_plan_progress numeric, _plan_start date, _plan_end date, _plan_days integer, _as_of date)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of), 0::numeric);
$function$;

-- 3) counts_by_bucket: 구 10인자 bucket_matches 호출 → 현행 11인자(as-of/caution/worsen)
CREATE OR REPLACE FUNCTION public.tm_items_counts_by_bucket(_q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _include_inactive boolean DEFAULT false, _as_of date DEFAULT NULL::date, _thresholds jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  _allowed_filter_cols constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level','stage_start','stage_finish'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _where text := 'true';
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _worsen_gap numeric := public.tm_resolve_worsen((_thresholds->>'worsen_gap')::numeric);
  _caution numeric := public.tm_resolve_caution((_thresholds->>'caution_gap_buffer')::numeric);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
  _args text;
  _sql text;
  _result jsonb;
begin
  if not _include_inactive then _where := _where || ' and is_active = true'; end if;

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
      if _field_sql <> '' then _where := _where || format(' and (%s)', _field_sql); end if;
    end loop;
  end if;

  for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    if _col is null or not (_col = any(_allowed_filter_cols)) then continue; end if;

    if _op = 'in' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
    elsif _op = 'in_or_empty' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(
        ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
        _col, _val, _col, _col);
    elsif _op = 'empty' then
      _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'not_empty' then
      _where := _where || format(' and (%I is not null and %I::text <> '''')', _col, _col);
    end if;
  end loop;

  _args := format(
    'actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, %L::date, %s::numeric, %s::numeric',
    _effective_asof, _caution, _worsen_gap);

  _sql := format($fmt$
    with filtered as (
      select actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress
      from public.v_task_management_raw_derived
      where %1$s
    ),
    flags as (
      select
        public.tm_kpi_bucket_matches('completed', %2$s)          as f_completed,
        public.tm_kpi_bucket_matches('wip', %2$s)                as f_wip,
        public.tm_kpi_bucket_matches('not_started', %2$s)        as f_not_started,
        public.tm_kpi_bucket_matches('planned_started', %2$s)    as f_planned_started,
        public.tm_kpi_bucket_matches('actual_started', %2$s)     as f_actual_started,
        public.tm_kpi_bucket_matches('in_delay', %2$s)           as f_in_delay,
        public.tm_kpi_bucket_matches('start_delayed', %2$s)      as f_start_delayed,
        public.tm_kpi_bucket_matches('completion_overdue', %2$s) as f_completion_overdue,
        public.tm_kpi_bucket_matches('critical', %2$s)           as f_critical,
        public.tm_kpi_bucket_matches('behind', %2$s)             as f_behind,
        public.tm_kpi_bucket_matches('no_plan_start', %2$s)      as f_no_plan_start,
        public.tm_kpi_bucket_matches('no_plan_end', %2$s)        as f_no_plan_end
      from filtered
    )
    select jsonb_build_object(
      'total',              count(*),
      'completed',          count(*) filter (where f_completed),
      'wip',                count(*) filter (where f_wip),
      'not_started',        count(*) filter (where f_not_started),
      'planned_started',    count(*) filter (where f_planned_started),
      'actual_started',     count(*) filter (where f_actual_started),
      'in_delay',           count(*) filter (where f_in_delay),
      'start_delayed',      count(*) filter (where f_start_delayed),
      'completion_overdue', count(*) filter (where f_completion_overdue),
      'critical',           count(*) filter (where f_critical),
      'behind',             count(*) filter (where f_behind),
      'no_plan_start',      count(*) filter (where f_no_plan_start),
      'no_plan_end',        count(*) filter (where f_no_plan_end),
      'as_of',              %3$L::text,
      'worsen_gap',         %4$s::numeric
    )
    from flags
  $fmt$, _where, _args, _effective_asof::text, _worsen_gap);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('total', 0));
end;
$function$;

-- 4) facets: kpi_mode 절의 구 시그니처 호출 정정
CREATE OR REPLACE FUNCTION public.tm_items_facets(_columns text[], _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _include_inactive boolean DEFAULT false, _kpi_mode text DEFAULT NULL::text, _as_of date DEFAULT NULL::date, _thresholds jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(axis text, value text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  _allowed_facets constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level',
    'stage_start','stage_finish'
  ];
  _allowed_filter_cols constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level',
    'stage_start','stage_finish'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _base_where text := 'true';
  _where text;
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _axis text;
  _union text := '';
  _worsen_gap numeric := public.tm_resolve_worsen((_thresholds->>'worsen_gap')::numeric);
  _caution numeric := public.tm_resolve_caution((_thresholds->>'caution_gap_buffer')::numeric);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
  _kpi_clause text := '';
  _sql text;
begin
  if _columns is null or array_length(_columns, 1) is null then return; end if;

  if not _include_inactive then _base_where := _base_where || ' and is_active = true'; end if;

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
      if _field_sql <> '' then _base_where := _base_where || format(' and (%s)', _field_sql); end if;
    end loop;
  end if;

  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _kpi_clause := format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, %L::date, %s::numeric, %s::numeric)',
      _kpi_mode, _effective_asof, _caution, _worsen_gap
    );
    _base_where := _base_where || _kpi_clause;
  end if;

  foreach _axis in array _columns loop
    if not (_axis = any(_allowed_facets)) then continue; end if;

    _where := _base_where;

    for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
      _col := _filter->>'column';
      _op  := coalesce(_filter->>'op', 'in');
      _val := _filter->'value';
      if _col is null or not (_col = any(_allowed_filter_cols)) then continue; end if;
      if _col = _axis then continue; end if;

      if _op = 'in' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
      elsif _op = 'in_or_empty' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where := _where || format(
          ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
          _col, _val, _col, _col);
      elsif _op = 'empty' then
        _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
      elsif _op = 'not_empty' then
        _where := _where || format(' and (%I is not null and %I::text <> '''')', _col, _col);
      end if;
    end loop;

    if _union <> '' then _union := _union || ' UNION ALL '; end if;
    _union := _union || format(
      'select %L::text as axis, %I::text as value, count(*)::bigint as cnt
         from public.v_task_management_raw_derived
        where %s and %I is not null and %I::text <> ''''
        group by %I',
      _axis, _axis, _where, _axis, _axis, _axis);
  end loop;

  if _union = '' then return; end if;

  _sql := 'select axis, value, cnt from (' || _union || ') u order by axis asc, cnt desc, value asc';
  return query execute _sql;
end;
$function$;

-- 5) MWS rows: delayed/completed 판정을 정본(tm_kpi_judgment)으로 위임 (저장 plan_progress/auto_judgment 참조 제거)
CREATE OR REPLACE FUNCTION public.tm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.*
    FROM public.task_management_raw t
    WHERE CASE
      WHEN _mode = 'pic'  THEN t.hdec_pic_name = _filter_value
      WHEN _mode = 'team' THEN t.team          = _filter_value
      ELSE TRUE
    END
  ),
  computed AS (
    SELECT
      b.*,
      public.tm_kpi_norm_actual(b.actual_progress) AS _act,
      (public.tm_kpi_norm_actual(b.actual_progress) >= 1.0 OR b.actual_finish IS NOT NULL) AS _is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS _is_started_raw,
      public.tm_kpi_judgment(
        b.actual_progress, b.actual_finish, b.actual_start,
        b.plan_start, b.plan_end, b.plan_days, b.plan_progress,
        _today, NULL::numeric, NULL::numeric
      ) AS _jd
    FROM base b
  ),
  filtered AS (
    SELECT c.*
    FROM computed c
    WHERE
      CASE _bucket
        WHEN 'today' THEN
          NOT c._is_completed AND (c.plan_start = _today OR c.plan_end = _today)
        WHEN 'delayed' THEN
          c._jd IN ('지연','악화')
        WHEN 'upcoming' THEN
          NOT c._is_completed
          AND c.plan_end IS NOT NULL
          AND (c.plan_end - _today) BETWEEN 1 AND 3
        WHEN 'in_progress' THEN
          NOT c._is_completed AND c._is_started_raw
        WHEN 'completed' THEN
          c._is_completed
        ELSE TRUE
      END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) - '_act' - '_is_completed' - '_is_started_raw' - '_jd'
                            ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days,
      f.created_at,
      f._act, f._is_completed, f._is_started_raw, f._jd
    FROM filtered f
    ORDER BY f.task_no NULLS LAST
    LIMIT _limit OFFSET _offset
  ) sub;
$function$;
