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
    with filtered as materialized (
      select *, coalesce(main_task_no, task_no) as group_key
      from %s
      where %s
    ),
    mains_ordered as materialized (
      select group_key,
             row_number() over (order by min(discipline) nulls last, group_key) as rn
      from filtered
      group by group_key
    ),
    tot as materialized (
      select count(*)::bigint as total_count,
             count(distinct group_key)::bigint as main_count
      from filtered
    ),
    page_mains as materialized (
      select group_key from mains_ordered
      where rn > %s and rn <= %s
    ),
    page_rows as materialized (
      select f.*, (%s) as derived_auto_judgment
      from filtered f
      join page_mains pm using (group_key)
    ),
    tcset as materialized (
      select * from public.tm_actual_at_set(%L::date, (select array_agg(id) from page_rows))
    ),
    page_rows_tc as materialized (
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
    ),
    ordered as materialized (
      select * from page_rows_tc order by %s
    ),
    agg as (
      select coalesce(jsonb_agg(to_jsonb(ordered.*) - 'group_key'), '[]'::jsonb) as rows
      from ordered
    )
    select jsonb_build_object(
      'rows', agg.rows,
      'total_count', tot.total_count,
      'main_count', tot.main_count
    )
    from agg, tot
  $fmt$, format('public.tm_rows_as_of_notc(%L::date)', _effective_asof), _where_sql, _safe_offset, _safe_offset + _safe_limit, _derived_expr,
        _effective_asof, _effective_asof, _sort_sql);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'main_count', 0));
end;
$function$;