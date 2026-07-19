create index if not exists defect_items_raw_active_group_issue_asc_idx
  on public.defect_items_raw (is_active, status_group, source_issue_no asc);

create or replace function public.defect_items_facets(
  _column text,
  _status_group text default 'unclosed'::text,
  _include_inactive boolean default false
)
returns table(value text, cnt bigint)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  _allowed_cols constant text[] := array[
    'team','status_raw','rectified_status','closure_status','priority','hdec_verification',
    'classification','category','defect_type','area_type','area_level','area_location',
    'main_trade','sub_trade','work_type','subcontractor_name','subsub_name','hdec_pic_name',
    'hdec_eng_name','plan_title','plan_group','created_by_name','created_by_team_name',
    'assigned_to','classification_source','item','captured_by_name','subcontractor_issue_no',
    'subcontractor_issue_source','trade_detail','aconex_comments','hdec_reason',
    'source_issue_no','issue_no','description','location_raw','defect_location',
    'location_reference','podium_area','building','room','room_group','level_name',
    'ir','forms','review_flag','updated_status','updated_description','updated_by_name',
    'remarks','hdec_comments','status_group'
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
$function$;

create or replace function public.defect_items_search(
  _status_group text default 'unclosed'::text,
  _include_inactive boolean default false,
  _q text default null::text,
  _filters jsonb default '[]'::jsonb,
  _sort jsonb default '[]'::jsonb,
  _offset integer default 0,
  _limit integer default 100
)
returns table(rows jsonb, total_count bigint)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  _allowed_cols constant text[] := array[
    'id','source_issue_no','team','status_raw','status_group','rectified_status','closure_status',
    'priority','hdec_verification','hdec_reason','classification','category','defect_type','item',
    'description','location_raw','area_type','area_level','area_location','location_reference',
    'plan_title','plan_group','main_trade','sub_trade','work_type','assigned_to','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','created_by_name','created_by_team_name',
    'created_date','due_by','planned_start_date','planned_rectified_date','planned_closure_date',
    'actual_start_date','actual_rectified_date','actual_closure_date','planned_progress_pct',
    'actual_progress_pct','last_updated_at','remarks','hdec_comments','is_critical','data_date',
    'is_active','captured_by_name','classification_source','subcontractor_issue_no','subcontractor_issue_source',
    'trade_detail','aconex_comments','updated_at','created_at','classified_at',
    'building','room','room_group','level_name','review_flag','defect_location','updated_status',
    'updated_description','updated_by_name','issue_no','forms','ir','podium_area'
  ];
  _search_cols constant text[] := array[
    'source_issue_no','subcontractor_issue_no','subcontractor_issue_source','team','area_type','area_level',
    'area_location','location_raw','main_trade','sub_trade','work_type','classification_source',
    'trade_detail','description','defect_type','status_raw','rectified_status','priority','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','captured_by_name','closure_status','remarks','hdec_comments',
    'aconex_comments','item','assigned_to','created_by_name','plan_title','building','room','room_group',
    'level_name','defect_location','updated_description','updated_by_name','issue_no'
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
  _safe_limit integer := greatest(1, least(coalesce(_limit, 100), 5000));
  _safe_offset integer := greatest(0, coalesce(_offset, 0));
begin
  if _status_group in ('unclosed','closed') then
    _where_sql := _where_sql || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where_sql := _where_sql || ' and is_active = true';
  end if;

  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(both '"' from trim(x))
      from regexp_split_to_table(_q, ',') as x
      where length(trim(both '"' from trim(x))) > 0
    loop
      if _token ~ '^[0-9]+$' then
        _where_sql := _where_sql || format(' and source_issue_no ilike %L', '%' || _token || '%');
      else
        _field_sql := '';
        foreach _search_field in array _search_cols loop
          if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
          _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
        end loop;
        if _field_sql <> '' then
          _where_sql := _where_sql || format(' and (%s)', _field_sql);
        end if;
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
      if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
        _where_sql := _where_sql || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
        _where_sql := _where_sql || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then
        _where_sql := _where_sql || format(' and %I >= %s', _col, _val->>'min');
      end if;
      if _val ? 'max' then
        _where_sql := _where_sql || format(' and %I <= %s', _col, _val->>'max');
      end if;
    elsif _op = 'bool' then
      if jsonb_typeof(_val) = 'boolean' then
        _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
      end if;
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
  if _sort_sql = '' then _sort_sql := 'source_issue_no asc'; end if;

  _sql := format($fmt$
    with filtered as (
      select id from public.defect_items_raw where %s
    ),
    total as (
      select count(*)::bigint as total_count from filtered
    ),
    page_rows as (
      select t.*
      from public.defect_items_raw t
      join filtered f using (id)
      order by %s
      offset %s limit %s
    )
    select to_jsonb(page_rows.*) as rows, total.total_count
    from page_rows
    cross join total
  $fmt$, _where_sql, _sort_sql, _safe_offset, _safe_limit);

  return query execute _sql;
end;
$function$;

create or replace function public.defect_items_dashboard_summary(_include_inactive boolean default false)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with filtered as (
    select data_date, status_group, is_critical, due_by, team
    from public.defect_items_raw
    where _include_inactive or is_active = true
  ),
  agg as (
    select
      max(data_date)::text as latest_data_date,
      count(*) filter (where status_group = 'unclosed')::bigint as unclosed_count,
      count(*) filter (where status_group = 'closed')::bigint as closed_count,
      count(*) filter (where is_critical = true and status_group = 'unclosed')::bigint as critical_pending,
      count(*) filter (where status_group = 'unclosed' and due_by is not null and due_by < current_date)::bigint as overdue_count
    from filtered
  ),
  by_team as (
    select jsonb_object_agg(team, cnt) as data
    from (
      select team, count(*)::bigint as cnt
      from filtered
      where status_group = 'unclosed' and team is not null and team <> ''
      group by team
    ) x
  )
  select jsonb_build_object(
    'latest_data_date', agg.latest_data_date,
    'unclosed_count', agg.unclosed_count,
    'closed_count', agg.closed_count,
    'critical_pending', agg.critical_pending,
    'overdue_count', agg.overdue_count,
    'by_team', coalesce(by_team.data, '{}'::jsonb)
  )
  from agg cross join by_team;
$function$;

analyze public.defect_items_raw;