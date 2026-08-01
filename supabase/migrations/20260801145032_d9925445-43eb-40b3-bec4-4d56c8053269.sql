-- 1) SM 진척 이벤트 정본 (ABD abd_progress_events 대응)
CREATE OR REPLACE FUNCTION public.snag_progress_events(_as_of_date date, _plan_mode text DEFAULT 'baseline'::text)
RETURNS TABLE(item_id uuid, stage text, field text, edate date)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  -- 술어 정본. defect_snag_progress_cells / snag_progress_cell_ids 가 공유한다. 사본 금지.
  WITH base AS (
    SELECT r.id,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date asd, r.actual_rectified_date acd, r.actual_closure_date axd
    FROM public.defect_items_raw r
    WHERE r.is_active = true
  ),
  ev AS (
    SELECT b.id, v.stage, v.p, v.a,
      public._snag_done_asof(v.stage, NULL, b.asd, b.acd, b.axd, NULL, _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text,  b.psd, b.asd),
      ('rectified',    b.pcd, b.acd),
      ('closure',      b.pxd, b.axd)
    ) AS v(stage, p, a)
  )
  SELECT id, stage, 'planned'::text, p FROM ev
  WHERE p IS NOT NULL AND (_plan_mode = 'baseline' OR NOT done_asof)
  UNION ALL
  SELECT id, stage, 'actual'::text, a FROM ev
  WHERE a IS NOT NULL
$function$;

-- 2) 셀 드릴다운 ID (ABD abd_progress_cell_ids 대응)
CREATE OR REPLACE FUNCTION public.snag_progress_cell_ids(
  _stage text, _field text, _from date, _to date,
  _as_of date DEFAULT NULL::date, _plan_mode text DEFAULT 'baseline'::text)
RETURNS TABLE(item_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- _stage: 'all' | 단일 스테이지 | 콤마 구분 목록(집계 셀)
  SELECT DISTINCT e.item_id
  FROM public.snag_progress_events(coalesce(_as_of, current_date), _plan_mode) e
  WHERE (_stage = 'all' OR e.stage = ANY(string_to_array(_stage, ',')))
    AND e.field = _field
    AND e.edate BETWEEN _from AND _to
$function$;

-- 3) 셀 집계를 이벤트 정본 경유 + 문서 단위 DISTINCT 로 교체.
--    집계행(stage = 'all|<스테이지조합>')을 서버가 문서 단위로 함께 제공한다.
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[], _teams text[], _room_groups text[], _group_by text[],
  _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  WITH b0 AS (
    SELECT r.id, r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
  ),
  base AS (
    SELECT b0.id, (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk
    FROM b0
  ),
  j AS (
    SELECT b.gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', e.edate)::date ELSE e.edate END AS bucket_iso,
      e.stage, e.field, e.item_id
    FROM base b
    JOIN public.snag_progress_events(_as_of_date, _plan_mode) e ON e.item_id = b.id
    WHERE e.edate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage,
    count(DISTINCT item_id) FILTER (WHERE field = 'planned')::int,
    count(DISTINCT item_id) FILTER (WHERE field = 'actual')::int
  FROM j GROUP BY 1, 2, 3
  UNION ALL
  SELECT j.gk, j.bucket_iso, 'all|' || c.combo,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'planned')::int,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'actual')::int
  FROM j
  JOIN (VALUES
    ('start'), ('rectified'), ('closure'),
    ('start,rectified'), ('start,closure'), ('rectified,closure'),
    ('start,rectified,closure')
  ) AS c(combo) ON j.stage = ANY(string_to_array(c.combo, ','))
  GROUP BY 1, 2, 3
$function$;

-- 4) defect_items_search / _ids 에 셀 드릴다운 연산자 추가
CREATE OR REPLACE FUNCTION public.defect_items_search(
  _status_group text DEFAULT 'unclosed'::text, _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0, _limit integer DEFAULT 100)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
  _cell_stages constant text[] := array['start','rectified','closure'];
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
  _col_ref text;
  _cell_stage text;
  _cell_field text;
  _cell_mode text;
  _cell_asof text;
  _cs text;
  _from text;
  _to text;
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

    -- Progress Matrix 셀 드릴다운 (술어 정본 = public.snag_progress_events)
    if _op in ('stage_plan_range','stage_actual_range') then
      if _val is null or jsonb_typeof(_val) <> 'object' then continue; end if;
      _cell_stage := _val->>'stage';
      _cell_field := coalesce(_val->>'field', case when _op = 'stage_actual_range' then 'actual' else 'planned' end);
      _cell_mode  := coalesce(_val->>'planMode', 'baseline');
      _cell_asof  := coalesce(nullif(_val->>'asOf',''), current_date::text);
      _from := _val->>'from'; _to := coalesce(_val->>'to', _val->>'from');
      if coalesce(_cell_stage,'') = '' or coalesce(_from,'') = '' then continue; end if;
      foreach _cs in array string_to_array(_cell_stage, ',') loop
        if not (_cs = any(_cell_stages)) then
          raise exception 'defect_items_search: unknown cell stage %', _cs;
        end if;
      end loop;
      if not (_cell_field = any(array['planned','actual'])) then
        raise exception 'defect_items_search: unknown cell field %', _cell_field;
      end if;
      if not (_cell_mode = any(array['baseline','remaining'])) then
        raise exception 'defect_items_search: unknown cell plan mode %', _cell_mode;
      end if;
      _where_sql := _where_sql || format(
        ' and defect_items_raw.id in (select item_id from public.snag_progress_cell_ids(%L, %L, %L::date, %L::date, %L::date, %L))',
        _cell_stage, _cell_field, _from, _to, _cell_asof, _cell_mode);
      continue;
    end if;

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

  for _sort_item in select * from jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) loop
    _col := _sort_item->>'column';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;
    if not _first_sort then _sort_sql := _sort_sql || ', '; end if;
    if _col = 'start_status' then
      _sort_sql := _sort_sql || format('(%s) %s nulls last', _start_status_expr,
        case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    else
      _sort_sql := _sort_sql || format('%I %s nulls last', _col,
        case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    end if;
    _first_sort := false;
  end loop;
  if _sort_sql = '' then _sort_sql := 'source_issue_no asc'; end if;

  _sql := format($fmt$
    with total as (
      select count(*)::bigint as total_count
      from public.defect_items_raw
      where %s
    ),
    page_rows as (
      select *
      from public.defect_items_raw
      where %s
      order by %s
      offset %s limit %s
    )
    select to_jsonb(page_rows.*) as rows, total.total_count
    from page_rows
    cross join total
  $fmt$, _where_sql, _where_sql, _sort_sql, _safe_offset, _safe_limit);

  return query execute _sql;
end;
$function$;

CREATE OR REPLACE FUNCTION public.defect_items_search_ids(
  _status_group text DEFAULT 'unclosed'::text, _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _limit integer DEFAULT 100000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
  _cell_stages constant text[] := array['start','rectified','closure'];
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
  _cell_stage text;
  _cell_field text;
  _cell_mode text;
  _cell_asof text;
  _cs text;
  _from text;
  _to text;
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

    if _op in ('stage_plan_range','stage_actual_range') then
      if _val is null or jsonb_typeof(_val) <> 'object' then continue; end if;
      _cell_stage := _val->>'stage';
      _cell_field := coalesce(_val->>'field', case when _op = 'stage_actual_range' then 'actual' else 'planned' end);
      _cell_mode  := coalesce(_val->>'planMode', 'baseline');
      _cell_asof  := coalesce(nullif(_val->>'asOf',''), current_date::text);
      _from := _val->>'from'; _to := coalesce(_val->>'to', _val->>'from');
      if coalesce(_cell_stage,'') = '' or coalesce(_from,'') = '' then continue; end if;
      foreach _cs in array string_to_array(_cell_stage, ',') loop
        if not (_cs = any(_cell_stages)) then
          raise exception 'defect_items_search_ids: unknown cell stage %', _cs;
        end if;
      end loop;
      if not (_cell_field = any(array['planned','actual'])) then
        raise exception 'defect_items_search_ids: unknown cell field %', _cell_field;
      end if;
      if not (_cell_mode = any(array['baseline','remaining'])) then
        raise exception 'defect_items_search_ids: unknown cell plan mode %', _cell_mode;
      end if;
      _where_sql := _where_sql || format(
        ' and defect_items_raw.id in (select item_id from public.snag_progress_cell_ids(%L, %L, %L::date, %L::date, %L::date, %L))',
        _cell_stage, _cell_field, _from, _to, _cell_asof, _cell_mode);
      continue;
    end if;

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