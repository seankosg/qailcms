
CREATE OR REPLACE FUNCTION public.defect_items_search(
  _status_group text DEFAULT 'unclosed'::text,
  _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100
)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
    'area_raw','trade_detail','aconex_comments','updated_at','created_at','classified_at',
    'building','room_group','level_name'
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
    with base as (
      select * from public.defect_items_raw where %s
    ),
    counted as (
      select count(*) over () as total_count, to_jsonb(t.*) as rows, t.*
      from base t
      order by %s
      offset %s limit %s
    )
    select rows, total_count from counted
  $fmt$, _where_sql, _sort_sql, _offset, _limit);

  return query execute _sql;
end;
$function$;

CREATE OR REPLACE FUNCTION public.defect_snag_dashboard_matrix(
  _plan_groups text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
)
RETURNS TABLE(
  plan_group text,
  building text,
  level_name text,
  room_group text,
  status_raw text,
  cnt bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    plan_group::text,
    building::text,
    level_name::text,
    room_group::text,
    status_raw::text,
    count(*)::bigint AS cnt
  FROM public.defect_items_raw
  WHERE is_active = true
    AND (_plan_groups IS NULL OR plan_group = ANY(_plan_groups))
    AND (_teams IS NULL OR team = ANY(_teams))
  GROUP BY 1,2,3,4,5
$$;

GRANT EXECUTE ON FUNCTION public.defect_snag_dashboard_matrix(text[], text[]) TO authenticated, service_role;
