-- ============================================================
-- 1) tm_items_search: _ids uuid[] 파라미터 추가 (구 시그니처 DROP)
-- ============================================================
DROP FUNCTION IF EXISTS public.tm_items_search(
  text, jsonb, jsonb, integer, integer, boolean, text, date, jsonb
);

CREATE OR REPLACE FUNCTION public.tm_items_search(
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _include_inactive boolean DEFAULT false,
  _kpi_mode text DEFAULT NULL::text,
  _as_of date DEFAULT NULL::date,
  _thresholds jsonb DEFAULT NULL::jsonb,
  _ids uuid[] DEFAULT NULL
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
  _worsen_gap numeric := COALESCE((_thresholds->>'worsen_gap')::numeric, -0.15);
  _caution_gap_buffer numeric := COALESCE((_thresholds->>'caution_gap_buffer')::numeric, 0.05);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
  _has_derived_ctx boolean := (_as_of IS NOT NULL AND _thresholds IS NOT NULL);
  _derived_expr text;
  _sql text;
  _result jsonb;
begin
  if _limit is null or _limit <= 0 then _safe_limit := 5000;
  else _safe_limit := least(_limit, 5000); end if;

  if not _include_inactive then _where_sql := _where_sql || ' and is_active = true'; end if;

  -- 신규: _ids 필터 (단건/다건 행 재조회)
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

  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _where_sql := _where_sql || format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, %L::date, %s::numeric, %s::numeric)',
      _kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    );
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
      select f.*, (%s) as derived_auto_judgment
      from filtered f
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
    from agg, tot
  $fmt$, _where_sql, _safe_offset, _safe_offset + _safe_limit, _derived_expr, _sort_sql);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'main_count', 0));
end;
$function$;

-- ============================================================
-- 2) tm_my_workspace_counts: delayed 판정을 tm_kpi_judgment 정본에 위임
--    (완료/미래시작 예외/gap 기반 판정 모두 정본과 동일)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(_mode text, _filter_value text, _today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      t.actual_progress,
      t.actual_start,
      t.actual_finish,
      t.auto_judgment,
      t.plan_start,
      t.plan_end,
      t.plan_days,
      t.plan_progress
    FROM public.task_management_raw t
    WHERE CASE
      WHEN _mode = 'pic'  THEN t.hdec_pic_name = _filter_value
      WHEN _mode = 'team' THEN t.team          = _filter_value
      ELSE TRUE
    END
  ),
  norm AS (
    SELECT
      LEAST(1.0, GREATEST(0.0,
        CASE
          WHEN COALESCE(actual_progress, 0) > 1 THEN COALESCE(actual_progress,0)/100.0
          ELSE COALESCE(actual_progress, 0)
        END
      ))::numeric AS act,
      actual_start,
      actual_finish,
      auto_judgment,
      plan_start,
      plan_end,
      plan_days,
      plan_progress
    FROM base
  ),
  judged AS (
    SELECT
      act,
      actual_start,
      actual_finish,
      plan_start,
      plan_end,
      -- 완료: raw 필드만으로 판정 (auto_judgment 의존 제거 — tm_kpi_judgment 계약과 동일)
      (act >= 1.0 OR actual_finish IS NOT NULL) AS is_completed,
      (act > 0 OR actual_start IS NOT NULL)     AS is_started_raw,
      -- 정본 위임: 지연/악화 버킷 = KPI in_delay 모집단
      public.tm_kpi_judgment(
        act, actual_finish, actual_start,
        plan_start, plan_end, plan_days, plan_progress,
        _today, 0.05::numeric, -0.15::numeric
      ) AS jd
    FROM norm
  )
  SELECT jsonb_build_object(
    'today_count',       COUNT(*) FILTER (WHERE NOT is_completed AND (plan_start = _today OR plan_end = _today)),
    'delayed_count',     COUNT(*) FILTER (WHERE jd IN ('지연','악화')),
    'upcoming_count',    COUNT(*) FILTER (WHERE NOT is_completed AND plan_end IS NOT NULL AND (plan_end - _today) BETWEEN 1 AND 3),
    'in_progress_count', COUNT(*) FILTER (WHERE is_started_raw AND NOT is_completed),
    'completed_count',   COUNT(*) FILTER (WHERE is_completed),
    'total_count',       COUNT(*)
  )
  FROM judged;
$function$;

-- 오버로드 유일성 확인용 코멘트 (배포 후 실측 검증)
COMMENT ON FUNCTION public.tm_items_search(text, jsonb, jsonb, integer, integer, boolean, text, date, jsonb, uuid[])
  IS 'Server-paginated TM search. Accepts _ids uuid[] for single/multi-row refresh with same _as_of/_thresholds context.';
COMMENT ON FUNCTION public.tm_my_workspace_counts(text, text, date)
  IS 'MWS counts. delayed_count delegates to tm_kpi_judgment (== KPI in_delay bucket).';