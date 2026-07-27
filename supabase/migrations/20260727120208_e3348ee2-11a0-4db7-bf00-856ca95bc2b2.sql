drop function if exists public.defect_items_search_ids(text, boolean, text, jsonb, integer);

-- ---------------------------------------------------------------------------
-- 반환 계약: jsonb 단일 값 (id 문자열 배열). Data API 행 상한 비적용.
-- 안전선 _limit(기본 100k, 최대 200k) 은 실행시 SQL 내부 LIMIT 로 유지.
-- ---------------------------------------------------------------------------
create or replace function public.defect_items_search_ids(
  _status_group text default 'unclosed',
  _include_inactive boolean default false,
  _q text default null,
  _filters jsonb default '[]'::jsonb,
  _limit integer default 100000
)
returns jsonb
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
    'updated_description','updated_by_name','issue_no','forms','ir','podium_area',
    'start_status'
  ];
  _search_cols constant text[] := array[
    'source_issue_no','subcontractor_issue_no','subcontractor_issue_source','team','area_type','area_level',
    'area_location','location_raw','main_trade','sub_trade','work_type','classification_source',
    'trade_detail','description','defect_type','status_raw','rectified_status','priority','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','captured_by_name','closure_status','remarks','hdec_comments',
    'aconex_comments','item','assigned_to','created_by_name','plan_title','building','room','room_group',
    'level_name','defect_location','updated_description','updated_by_name','issue_no'
  ];
  _start_status_expr constant text :=
    'CASE '
      'WHEN lower(trim(status_raw)) IN '
        '(''rectified'',''complete'',''completed'',''closed'',''verified'') THEN ''Done'' '
      'WHEN actual_start_date IS NOT NULL '
        'OR COALESCE(actual_progress_pct,0) > 0 '
        'OR actual_rectified_date IS NOT NULL '
        'OR actual_closure_date IS NOT NULL THEN ''Done'' '
      'WHEN planned_start_date IS NOT NULL '
        'AND planned_start_date <= (now() at time zone ''Asia/Qatar'')::date THEN ''Delay'' '
      'WHEN planned_start_date IS NOT NULL THEN ''Planned'' '
      'ELSE NULL END';
  _where_sql text := 'true';
  _sql text;
  _filter jsonb;
  _col text;
  _op text;
  _val jsonb;
  _token text;
  _field_sql text;
  _search_field text;
  _col_ref text;
  _safe_limit integer := greatest(1, least(coalesce(_limit, 100000), 200000));
  _result jsonb;
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

    if _col = 'start_status' then
      _col_ref := '(' || _start_status_expr || ')';
    else
      _col_ref := format('%I', _col);
    end if;

    if _op = 'in' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and %s::text = any(array(select jsonb_array_elements_text(%L::jsonb)))',
          _col_ref, _val
        );
      end if;
    elsif _op = 'in_or_empty' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and (%s::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %s is null or %s::text = '''')',
          _col_ref, _val, _col_ref, _col_ref
        );
      else
        _where_sql := _where_sql || format(' and (%s is null or %s::text = '''')', _col_ref, _col_ref);
      end if;
    elsif _op = 'text' then
      if jsonb_typeof(_val) = 'string' then
        for _token in
          select trim(x) from regexp_split_to_table(_val #>> '{}', ',') as x where length(trim(x)) > 0
        loop
          _where_sql := _where_sql || format(' and %s::text ilike %L', _col_ref, '%' || _token || '%');
        end loop;
      end if;
    elsif _op = 'empty' then
      _where_sql := _where_sql || format(' and (%s is null or %s::text = '''')', _col_ref, _col_ref);
    elsif _op = 'date_range' then
      if _col = 'start_status' then continue; end if;
      if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
        _where_sql := _where_sql || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
        _where_sql := _where_sql || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _col = 'start_status' then continue; end if;
      if _val ? 'min' then
        _where_sql := _where_sql || format(' and %I >= %s', _col, _val->>'min');
      end if;
      if _val ? 'max' then
        _where_sql := _where_sql || format(' and %I <= %s', _col, _val->>'max');
      end if;
    elsif _op = 'bool' then
      if _col = 'start_status' then continue; end if;
      if jsonb_typeof(_val) = 'boolean' then
        _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
      end if;
    end if;
  end loop;

  _sql := format($fmt$
    select coalesce(jsonb_agg(id::text), '[]'::jsonb)
    from (
      select id
      from public.defect_items_raw
      where %s
      limit %s
    ) t
  $fmt$, _where_sql, _safe_limit);

  execute _sql into _result;
  return coalesce(_result, '[]'::jsonb);
end;
$function$;

grant execute on function public.defect_items_search_ids(text, boolean, text, jsonb, integer) to authenticated, service_role;