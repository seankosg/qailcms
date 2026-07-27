-- =========================================================================
-- C1 사전: v_task_management_raw_derived 확장 + tm_items_* RPC 화이트리스트/연산 확장
-- UI 변경 없음. 파생 필드는 클라이언트 현행 로직(classifyStart/Finish, computeDailyPlan)과 동일 공식.
-- =========================================================================

-- 1) 뷰 재작성 (기존 컬럼 유지 + stage_start/stage_finish/expected_progress_today 3필드 추가)
DROP VIEW IF EXISTS public.v_task_management_raw_derived CASCADE;
CREATE VIEW public.v_task_management_raw_derived
WITH (security_invoker = on) AS
WITH cfg AS (SELECT plot, kind, target_date FROM public.tm_milestone_config),
     bd  AS (SELECT COALESCE((SELECT value_int FROM public.tm_alarm_settings WHERE key='warning_buffer_days'), 7) AS buffer_days)
SELECT
  t.*,
  c.target_date AS milestone_date,
  public.tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days) AS plan_overdue,
  public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
  public.tm_classify_overdue(
    public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date),
    c.target_date, bd.buffer_days
  ) AS actual_overdue,

  -- ── stage-progress 파생 (기준일: 행 data_date, 없으면 Doha 오늘) ──
  -- classifyStart 와 완전 동일 로직 (TaskStageProgress.tsx:32-44)
  CASE
    WHEN t.actual_start IS NOT NULL AND t.plan_start IS NOT NULL AND t.actual_start > t.plan_start THEN 'completed_late'
    WHEN t.actual_start IS NOT NULL THEN 'completed'
    WHEN t.plan_start IS NULL THEN 'empty'
    WHEN t.plan_start <= COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) THEN 'delay'
    ELSE 'plan'
  END AS stage_start,

  -- classifyFinish 와 완전 동일 로직 (TaskStageProgress.tsx:46-59)
  CASE
    WHEN t.actual_finish IS NOT NULL AND t.plan_end IS NOT NULL AND t.actual_finish > t.plan_end THEN 'completed_late'
    WHEN t.actual_finish IS NOT NULL THEN 'completed'
    WHEN t.plan_end IS NOT NULL AND t.plan_end <= COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) THEN 'delay'
    WHEN t.actual_start IS NOT NULL
     AND (t.plan_end IS NULL OR t.plan_end > COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date)) THEN 'wip'
    WHEN t.plan_end IS NULL THEN 'empty'
    ELSE 'plan'
  END AS stage_finish,

  -- T.Plan (일할 증분) = 1 / duration_days (달력일) — computeDailyPlan(derived.ts:134) 과 동일
  CASE
    WHEN t.plan_days IS NOT NULL AND t.plan_days > 0
      THEN (1.0::numeric / t.plan_days)
    WHEN t.plan_start IS NOT NULL AND t.plan_end IS NOT NULL AND t.plan_end >= t.plan_start
      THEN (1.0::numeric / GREATEST(1, (t.plan_end - t.plan_start) + 1))
    ELSE NULL
  END AS expected_progress_today

FROM public.task_management_raw t
CROSS JOIN bd
LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone;

GRANT SELECT ON public.v_task_management_raw_derived TO authenticated;


-- =========================================================================
-- 2) tm_items_search — 화이트리스트에 파생 3필드 추가 + not_empty 연산자
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tm_items_search(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _include_inactive boolean DEFAULT false
)
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
    'data_date','sort_order','source_file','imported_at','is_rollup','is_active',
    'team','location','floor_level','owner_user_id','hdec_pic_name','hdec_eng_name',
    'cum_plan_pct','cum_actual_pct','gap_pct','delay_days','alarm_reason',
    'milestone','milestone_date','plan_overdue','expected_finish','actual_overdue',
    'stage_start','stage_finish','expected_progress_today'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
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
  _sql text;
  _result jsonb;
begin
  if _limit is null or _limit <= 0 then _safe_limit := 5000;
  else _safe_limit := least(_limit, 5000); end if;

  if not _include_inactive then _where_sql := _where_sql || ' and is_active = true'; end if;

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
        _where_sql := _where_sql || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to',''))>0 then
        _where_sql := _where_sql || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then _where_sql := _where_sql || format(' and %I >= %s', _col, _val->>'min'); end if;
      if _val ? 'max' then _where_sql := _where_sql || format(' and %I <= %s', _col, _val->>'max'); end if;
    elsif _op = 'bool' and jsonb_typeof(_val)='boolean' then
      _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
    end if;
  end loop;

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

  _sql := format($fmt$
    with filtered as (
      select *, coalesce(main_task_no, task_no) as group_key
      from public.v_task_management_raw_derived
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
      select f.* from filtered f
      join page_mains pm using (group_key)
      order by %s
    ),
    agg as (
      select coalesce(jsonb_agg(to_jsonb(page_rows.*) - 'group_key'), '[]'::jsonb) as rows
      from page_rows
    )
    select jsonb_build_object(
      'rows', agg.rows,
      'total_count', tot.total_count,
      'main_count', tot.main_count
    )
    from agg cross join tot
  $fmt$, _where_sql, _safe_offset, _safe_offset + _safe_limit, _sort_sql);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('rows','[]'::jsonb,'total_count',0,'main_count',0));
end;
$function$;


-- =========================================================================
-- 3) tm_items_search_ids — 화이트리스트 확장 + not_empty
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tm_items_search_ids(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _limit integer DEFAULT 100000
)
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
    'team','location','floor_level','owner_user_id','hdec_pic_name','hdec_eng_name',
    'cum_plan_pct','cum_actual_pct','gap_pct','delay_days',
    'milestone','milestone_date','plan_overdue','expected_finish','actual_overdue',
    'stage_start','stage_finish','expected_progress_today'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _where text := 'true';
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _safe_limit int := greatest(1, least(coalesce(_limit,100000), 200000));
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
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;

    if _op = 'in' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
    elsif _op = 'in_or_empty' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(
        ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
        _col, _val, _col, _col);
    elsif _op = 'text' and jsonb_typeof(_val) = 'string' then
      for _token in select trim(x) from regexp_split_to_table(_val #>> '{}', ',') as x where length(trim(x))>0 loop
        _where := _where || format(' and %I::text ilike %L', _col, '%' || _token || '%');
      end loop;
    elsif _op = 'empty' then
      _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'not_empty' then
      _where := _where || format(' and (%I is not null and %I::text <> '''')', _col, _col);
    elsif _op = 'date_range' then
      if _val ? 'from' and length(coalesce(_val->>'from',''))>0 then
        _where := _where || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to',''))>0 then
        _where := _where || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then _where := _where || format(' and %I >= %s', _col, _val->>'min'); end if;
      if _val ? 'max' then _where := _where || format(' and %I <= %s', _col, _val->>'max'); end if;
    elsif _op = 'bool' and jsonb_typeof(_val)='boolean' then
      _where := _where || format(' and %I = %L', _col, (_val::text)::boolean);
    end if;
  end loop;

  _sql := format($fmt$
    select coalesce(jsonb_agg(id::text order by discipline nulls last, coalesce(main_task_no, task_no), sort_order nulls last), '[]'::jsonb)
    from (
      select id, discipline, main_task_no, task_no, sort_order
      from public.v_task_management_raw_derived
      where %s
      limit %s
    ) s
  $fmt$, _where, _safe_limit);

  execute _sql into _result;
  return coalesce(_result, '[]'::jsonb);
end;
$function$;


-- =========================================================================
-- 4) tm_items_facets — 4축 추가 (category, row_type, level, floor_level) + not_empty
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tm_items_facets(
  _columns text[],
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false
) RETURNS TABLE(axis text, value text, cnt bigint)
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


-- =========================================================================
-- 5) Grants (재승인)
-- =========================================================================
GRANT EXECUTE ON FUNCTION public.tm_items_search(text, jsonb, jsonb, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tm_items_search_ids(text, jsonb, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tm_items_facets(text[], text, jsonb, boolean) TO authenticated, anon, service_role;