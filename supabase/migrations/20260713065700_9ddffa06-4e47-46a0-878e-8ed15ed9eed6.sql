
-- ============================================================
-- Defect Raw Data: server-side pagination foundation
-- ============================================================

-- 1. status_group generated column
alter table public.defect_items_raw
  add column if not exists status_group text
  generated always as (
    case when lower(trim(status_raw)) = 'closed' then 'closed' else 'unclosed' end
  ) stored;

-- 2. Extensions
create extension if not exists pg_trgm;

-- 3. Indexes for status_group + common filter/sort paths
create index if not exists defect_items_raw_active_group_issue_desc_idx
  on public.defect_items_raw (is_active, status_group, source_issue_no desc);

create index if not exists defect_items_raw_active_group_closure_desc_idx
  on public.defect_items_raw (is_active, status_group, actual_closure_date desc);

create index if not exists defect_items_raw_active_group_team_idx
  on public.defect_items_raw (is_active, status_group, team);

create index if not exists defect_items_raw_active_group_sub_idx
  on public.defect_items_raw (is_active, status_group, subcontractor_name);

create index if not exists defect_items_raw_active_group_arealevel_idx
  on public.defect_items_raw (is_active, status_group, area_level);

create index if not exists defect_items_raw_active_group_hdec_pic_idx
  on public.defect_items_raw (is_active, status_group, hdec_pic_name);

create index if not exists defect_items_raw_active_group_priority_idx
  on public.defect_items_raw (is_active, status_group, priority);

create index if not exists defect_items_raw_data_date_idx
  on public.defect_items_raw (data_date);

-- 4. Trigram indexes for global search
create index if not exists defect_items_raw_desc_trgm_idx
  on public.defect_items_raw using gin (description gin_trgm_ops);
create index if not exists defect_items_raw_issueno_trgm_idx
  on public.defect_items_raw using gin (source_issue_no gin_trgm_ops);
create index if not exists defect_items_raw_location_trgm_idx
  on public.defect_items_raw using gin (location_raw gin_trgm_ops);
create index if not exists defect_items_raw_area_location_trgm_idx
  on public.defect_items_raw using gin (area_location gin_trgm_ops);
create index if not exists defect_items_raw_sub_trgm_idx
  on public.defect_items_raw using gin (subcontractor_name gin_trgm_ops);
create index if not exists defect_items_raw_hdec_pic_trgm_idx
  on public.defect_items_raw using gin (hdec_pic_name gin_trgm_ops);
create index if not exists defect_items_raw_remarks_trgm_idx
  on public.defect_items_raw using gin (remarks gin_trgm_ops);

-- ============================================================
-- 5. RPC: defect_items_search
-- Whitelist of columns allowed for filter/sort (mirrors DEFECT_COLUMNS.key)
-- ============================================================
create or replace function public.defect_items_search(
  _status_group text default 'unclosed',      -- 'unclosed' | 'closed' | 'all'
  _include_inactive boolean default false,
  _q text default null,
  _filters jsonb default '[]'::jsonb,          -- [{column, op, value}]
  _sort jsonb default '[]'::jsonb,             -- [{column, desc}]
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
    'is_active','captured_by_name','classification_source','subcontractor_issue_no'
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
begin
  -- status_group filter
  if _status_group in ('unclosed','closed') then
    _where_sql := _where_sql || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where_sql := _where_sql || ' and is_active = true';
  end if;

  -- global search (q) using ILIKE across searchable fields
  if _q is not null and length(trim(_q)) > 0 then
    _where_sql := _where_sql || format(
      ' and (source_issue_no ilike %1$L or description ilike %1$L or location_raw ilike %1$L
             or area_location ilike %1$L or subcontractor_name ilike %1$L or hdec_pic_name ilike %1$L
             or plan_title ilike %1$L or assigned_to ilike %1$L or remarks ilike %1$L
             or hdec_comments ilike %1$L or item ilike %1$L or defect_type ilike %1$L
             or created_by_name ilike %1$L)',
      '%' || _q || '%'
    );
  end if;

  -- Column filters
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
    elsif _op = 'text' then
      if jsonb_typeof(_val) = 'string' then
        _where_sql := _where_sql || format(' and %I::text ilike %L', _col, '%' || (_val #>> '{}') || '%');
      end if;
    elsif _op = 'empty' then
      _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'date_range' then
      if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
        _where_sql := _where_sql || format(' and %I::date >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
        _where_sql := _where_sql || format(' and %I::date <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then
        _where_sql := _where_sql || format(' and %I::numeric >= %L::numeric', _col, _val->>'min');
      end if;
      if _val ? 'max' then
        _where_sql := _where_sql || format(' and %I::numeric <= %L::numeric', _col, _val->>'max');
      end if;
    elsif _op = 'bool' then
      _where_sql := _where_sql || format(' and %I = %L::boolean', _col, _val #>> '{}');
    end if;
  end loop;

  -- Sort
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
    _sort_sql := ' order by source_issue_no desc nulls last';
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

-- ============================================================
-- 6. RPC: defect_items_facets — distinct values + counts for a single column
-- ============================================================
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
    'assigned_to','classification_source','item'
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

-- ============================================================
-- 7. RPC: defect_items_counts — Unclosed / Closed / total
-- ============================================================
create or replace function public.defect_items_counts(
  _include_inactive boolean default false
) returns table (
  unclosed_count bigint,
  closed_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where status_group = 'unclosed')::bigint as unclosed_count,
    count(*) filter (where status_group = 'closed')::bigint as closed_count,
    count(*)::bigint as total_count
  from public.defect_items_raw
  where _include_inactive or is_active = true;
$$;

grant execute on function public.defect_items_counts(boolean) to authenticated;
grant execute on function public.defect_items_counts(boolean) to service_role;

-- ============================================================
-- 8. RPC: defect_items_dashboard_summary
-- ============================================================
create or replace function public.defect_items_dashboard_summary(
  _include_inactive boolean default false
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select * from public.defect_items_raw
     where _include_inactive or is_active = true
  ),
  agg as (
    select
      max(data_date)::text as latest_data_date,
      count(*) filter (where status_group = 'unclosed')::bigint as unclosed_count,
      count(*) filter (where status_group = 'closed')::bigint as closed_count,
      count(*) filter (where is_critical = true and status_group = 'unclosed')::bigint as critical_pending,
      count(*) filter (where status_group = 'unclosed' and due_by is not null and due_by < current_date)::bigint as overdue_count
    from base
  ),
  by_team as (
    select team, count(*)::bigint as cnt
      from base where status_group = 'unclosed' and team is not null and team <> ''
      group by team
  )
  select jsonb_build_object(
    'latest_data_date', (select latest_data_date from agg),
    'unclosed_count', (select unclosed_count from agg),
    'closed_count', (select closed_count from agg),
    'critical_pending', (select critical_pending from agg),
    'overdue_count', (select overdue_count from agg),
    'by_team', coalesce((select jsonb_object_agg(team, cnt) from by_team), '{}'::jsonb)
  );
$$;

grant execute on function public.defect_items_dashboard_summary(boolean) to authenticated;
grant execute on function public.defect_items_dashboard_summary(boolean) to service_role;
