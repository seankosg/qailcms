-- ============================================================
-- Defect Raw Data: SHAW-style search/filter behavior refinement
-- ============================================================

create or replace function public.defect_items_search(
  _status_group text default 'unclosed',
  _include_inactive boolean default false,
  _q text default null,
  _filters jsonb default '[]'::jsonb,
  _sort jsonb default '[]'::jsonb,
  _offset int default 0,
  _limit int default 100
) returns table (
  rows jsonb,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  _allowed_cols constant text[] := array[
    'id','source_issue_no','team','status_raw','status_group','completion_status','closure_status',
    'priority','hdec_verification','hdec_reason','classification','category','defect_type','item',
    'description','location_raw','area_type','area_level','area_location','location_reference',
    'plan_title','plan_group','main_trade','sub_trade','work_type','assigned_to','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','created_by_name','created_by_team_name',
    'created_date','due_by','planned_start_date','planned_completion_date','planned_closure_date',
    'actual_start_date','actual_completion_date','actual_closure_date','planned_progress_pct',
    'actual_progress_pct','last_updated_at','remarks','hdec_comments','is_critical','data_date',
    'is_active','captured_by_name','classification_source','subcontractor_issue_no','subcontractor_issue_source',
    'area_raw','trade_detail','aconex_comments','updated_at','created_at','classified_at'
  ];
  _search_cols constant text[] := array[
    'source_issue_no','subcontractor_issue_no','subcontractor_issue_source','team','area_type','area_level',
    'area_location','location_raw','area_raw','main_trade','sub_trade','work_type','classification_source',
    'trade_detail','description','defect_type','status_raw','completion_status','priority','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','captured_by_name','closure_status','remarks','hdec_comments',
    'aconex_comments','item','assigned_to','created_by_name','plan_title'
  ];
  _sort_sql text := '';
  _where_sql text := 'true';
  _sql text;
  _filter jsonb;
  _sort_item jsonb;
  _col text;
  _op text;
  _val jsonb;
  _first_sort boolean := true;
  _token text;
  _field_sql text;
  _search_field text;
begin
  if _status_group in ('unclosed','closed') then
    _where_sql := _where_sql || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where_sql := _where_sql || ' and is_active = true';
  end if;

  -- SHAW-style global search: comma-separated tokens are AND-combined.
  -- Each token may match any searchable field.
  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(x) from regexp_split_to_table(_q, ',') as x where length(trim(x)) > 0
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
      if _val ? 'emptyOnly' and coalesce((_val->>'emptyOnly')::boolean, false) then
        _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
      else
        if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
          _where_sql := _where_sql || format(' and %I::date >= %L::date', _col, _val->>'from');
        end if;
        if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
          _where_sql := _where_sql || format(' and %I::date <= %L::date', _col, _val->>'to');
        end if;
      end if;
    elsif _op = 'num_range' then
      if _val ? 'emptyOnly' and coalesce((_val->>'emptyOnly')::boolean, false) then
        _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
      else
        if _val ? 'min' then
          _where_sql := _where_sql || format(' and %I::numeric >= %L::numeric', _col, _val->>'min');
        end if;
        if _val ? 'max' then
          _where_sql := _where_sql || format(' and %I::numeric <= %L::numeric', _col, _val->>'max');
        end if;
      end if;
    elsif _op = 'bool' then
      _where_sql := _where_sql || format(' and %I = %L::boolean', _col, _val #>> '{}');
    end if;
  end loop;

  for _sort_item in select * from jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) loop
    _col := _sort_item->>'column';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;
    if _first_sort then
      _sort_sql := format(' order by %I %s nulls last', _col,
        case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
      _first_sort := false;
    else
      _sort_sql := _sort_sql || format(', %I %s nulls last', _col,
        case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    end if;
  end loop;
  if _first_sort then
    _sort_sql := ' order by source_issue_no asc nulls last';
  end if;

  _sql := format(
    'select to_jsonb(t) as rows, count(*) over () as total_count
       from public.defect_items_raw t
      where %s
      %s
      offset %L limit %L',
    _where_sql, _sort_sql, greatest(_offset, 0), least(coalesce(_limit,100), 1000)
  );

  return query execute _sql;
end;
$$;

grant execute on function public.defect_items_search(text, boolean, text, jsonb, jsonb, int, int) to authenticated;
grant execute on function public.defect_items_search(text, boolean, text, jsonb, jsonb, int, int) to service_role;

create or replace function public.defect_items_facets(
  _column text,
  _status_group text default 'unclosed',
  _include_inactive boolean default false
) returns table (value text, cnt bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  _allowed_cols constant text[] := array[
    'team','status_raw','completion_status','closure_status','priority','hdec_verification',
    'classification','category','defect_type','area_type','area_level','area_location',
    'main_trade','sub_trade','work_type','subcontractor_name','subsub_name','hdec_pic_name',
    'hdec_eng_name','plan_title','plan_group','created_by_name','created_by_team_name',
    'assigned_to','classification_source','item','captured_by_name','subcontractor_issue_no',
    'subcontractor_issue_source','area_raw','trade_detail','aconex_comments','hdec_reason'
  ];
  _where text := 'true';
  _sql text;
begin
  if not (_column = any(_allowed_cols)) then
    raise exception 'Column % not allowed for facets', _column;
  end if;

  if _status_group in ('unclosed','closed') then
    _where := _where || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where := _where || ' and is_active = true';
  end if;

  _sql := format(
    'select %I::text as value, count(*)::bigint as cnt
       from public.defect_items_raw
      where %s and %I is not null and %I::text <> ''''
      group by %I
      order by cnt desc, value asc
      limit 500',
    _column, _where, _column, _column, _column
  );
  return query execute _sql;
end;
$$;

grant execute on function public.defect_items_facets(text, text, boolean) to authenticated;
grant execute on function public.defect_items_facets(text, text, boolean) to service_role;