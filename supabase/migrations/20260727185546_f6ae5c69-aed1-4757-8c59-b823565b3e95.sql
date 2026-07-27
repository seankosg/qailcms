-- R1: TM server-side pagination RPCs (tm_items_search / tm_items_facets / tm_items_search_ids)
-- Source: v_task_management_raw_derived (security_invoker=on) — RLS inherited from base tables.
-- Pagination unit: Main Task (COALESCE(main_task_no, task_no)); subs are returned together with their parent main.
-- Return contract: row-per-record { rows jsonb, total_count bigint } — jsonb exception per AGENTS.md.

-- ============================================================
-- 1) tm_items_search
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_items_search(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _include_inactive boolean DEFAULT false
)
RETURNS TABLE(rows jsonb, total_count bigint)
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
    'milestone','milestone_date','plan_overdue','expected_finish','actual_overdue'
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
begin
  -- ALL sentinel: _limit NULL or <=0 => no limit (bounded by 5000 mains upstream)
  if _limit is null or _limit <= 0 then
    _safe_limit := 5000;
  else
    _safe_limit := least(_limit, 5000);
  end if;

  if not _include_inactive then
    _where_sql := _where_sql || ' and is_active = true';
  end if;

  -- global search (comma AND)
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
      if _field_sql <> '' then
        _where_sql := _where_sql || format(' and (%s)', _field_sql);
      end if;
    end loop;
  end if;

  -- filters
  for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;

    if _op = 'in' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))',
          _col, _val
        );
      end if;
    elsif _op = 'in_or_empty' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
          _col, _val, _col, _col
        );
      else
        _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
      end if;
    elsif _op = 'text' then
      if jsonb_typeof(_val) = 'string' then
        for _token in
          select trim(x) from regexp_split_to_table(_val #>> '{}', ',') as x where length(trim(x)) > 0
        loop
          _where_sql := _where_sql || format(' and %I::text ilike %L', _col, '%' || _token || '%');
        end loop;
      end if;
    elsif _op = 'empty' then
      _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'date_range' then
      if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
        _where_sql := _where_sql || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
        _where_sql := _where_sql || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then
        _where_sql := _where_sql || format(' and %I >= %s', _col, (_val->>'min'));
      end if;
      if _val ? 'max' then
        _where_sql := _where_sql || format(' and %I <= %s', _col, (_val->>'max'));
      end if;
    elsif _op = 'bool' then
      if jsonb_typeof(_val) = 'boolean' then
        _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
      end if;
    end if;
  end loop;

  -- sort (applied on final row set, not on main grouping)
  for _sort_item in select * from jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) loop
    _col := _sort_item->>'column';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;
    if not _first_sort then _sort_sql := _sort_sql || ', '; end if;
    _sort_sql := _sort_sql || format('%I %s nulls last', _col,
      case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    _first_sort := false;
  end loop;
  -- always keep sub grouping stable within a main
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
             row_number() over (
               order by min(discipline) nulls last, group_key
             ) as rn
      from filtered
      group by group_key
    ),
    total as (
      select count(*)::bigint as total_count from mains_ordered
    ),
    page_mains as (
      select group_key from mains_ordered
      where rn > %s and rn <= %s
    ),
    page_rows as (
      select f.* from filtered f
      join page_mains pm using (group_key)
      order by %s
    )
    select to_jsonb(page_rows.*) - 'group_key' as rows, total.total_count
    from page_rows cross join total
  $fmt$, _where_sql, _safe_offset, _safe_offset + _safe_limit, _sort_sql);

  return query execute _sql;
end;
$function$;

-- ============================================================
-- 2) tm_items_facets  — 11 approved axes
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_items_facets(
  _column text,
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false
)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
declare
  _allowed_facets constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment'
  ];
  _allowed_filter_cols constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _where text := 'true';
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _sql text;
begin
  if not (_column = any(_allowed_facets)) then
    raise exception 'Column % not allowed for facets', _column;
  end if;

  if not _include_inactive then
    _where := _where || ' and is_active = true';
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
      if _field_sql <> '' then _where := _where || format(' and (%s)', _field_sql); end if;
    end loop;
  end if;

  for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    if _col is null or not (_col = any(_allowed_filter_cols)) then continue; end if;
    -- cross-filter: skip self axis (client also strips it, but defensive)
    if _col = _column then continue; end if;

    if _op = 'in' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(
        ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
    elsif _op = 'in_or_empty' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
      _where := _where || format(
        ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
        _col, _val, _col, _col);
    elsif _op = 'empty' then
      _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
    end if;
  end loop;

  _sql := format(
    'select %I::text as value, count(*)::bigint as cnt
       from public.v_task_management_raw_derived
      where %s and %I is not null and %I::text <> ''''
      group by %I order by cnt desc, value asc limit 500',
    _column, _where, _column, _column, _column);

  return query execute _sql;
end;
$function$;

-- ============================================================
-- 3) tm_items_search_ids  — for Bulk Edit "select all matching"
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_items_search_ids(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _limit integer DEFAULT 100000
)
RETURNS TABLE(id uuid)
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
    'milestone','milestone_date','plan_overdue','expected_finish','actual_overdue'
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
      _where := _where || format(
        ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
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

  _sql := format(
    'select id from public.v_task_management_raw_derived where %s order by discipline nulls last, coalesce(main_task_no, task_no), sort_order nulls last limit %s',
    _where, _safe_limit);

  return query execute _sql;
end;
$function$;

-- ============================================================
-- Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION public.tm_items_search(text, jsonb, jsonb, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tm_items_facets(text, text, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tm_items_search_ids(text, jsonb, boolean, integer) TO authenticated, service_role;