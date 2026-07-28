-- =====================================================================
-- TM KPI 판정 SQL 진실원 이식
-- 소스: src/lib/task-management/kpi-utils.ts (라인 인용은 각 함수 내 주석)
-- 규약: kpi-utils 술어를 의미 변경 없이 이식. 클라이언트가 정본이며 SQL은 이식본.
-- =====================================================================

-- ---------------------------------------------------------------------
-- helper 1: actual_progress 정규화 (kpi-utils.ts 는 완료 판정에 raw 값을 사용하고
--            gap 계산에는 normActual 을 사용함 — derived.ts:82-88 normActual 원본)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_norm_actual(_v numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  -- derived.ts:83-88 normActual: n>1 ? n/100 : n, then clamp [0,1]
  SELECT GREATEST(0::numeric, LEAST(1::numeric,
    CASE WHEN COALESCE(_v, 0) > 1 THEN COALESCE(_v, 0) / 100.0
         ELSE COALESCE(_v, 0) END
  ));
$$;

-- ---------------------------------------------------------------------
-- helper 2: computeTPlan (derived.ts:62-80)
-- 계산 불가 시 NULL 반환
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_tplan(
  _plan_start date, _plan_end date, _plan_days integer, _as_of date
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  -- derived.ts:62-80 computeTPlan
  SELECT CASE
    WHEN _plan_start IS NULL THEN NULL::numeric
    WHEN _as_of IS NULL THEN NULL::numeric
    WHEN _as_of < _plan_start THEN 0::numeric
    WHEN _plan_end IS NOT NULL AND _as_of >= _plan_end THEN 1::numeric
    ELSE (
      SELECT CASE
        WHEN d IS NULL OR d <= 0 THEN NULL::numeric
        ELSE GREATEST(0::numeric, LEAST(1::numeric,
          (((_as_of - _plan_start) + 1)::numeric / d::numeric)
        ))
      END
      FROM (
        SELECT COALESCE(
          NULLIF(_plan_days, 0),
          CASE WHEN _plan_end IS NOT NULL THEN GREATEST(1, (_plan_end - _plan_start) + 1) END
        ) AS d
      ) x
    )
  END;
$$;

-- ---------------------------------------------------------------------
-- helper 3: computeVariance / gapAt (derived.ts:119-130, kpi-utils.ts:23-26)
-- gap = normActual(actual) - (normActual(plan_progress) OR computeTPlan)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_gap(
  _actual_progress numeric,
  _plan_progress   numeric,
  _plan_start date, _plan_end date, _plan_days integer,
  _as_of date
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.tm_kpi_norm_actual(_actual_progress)
       - COALESCE(
           CASE WHEN _plan_progress IS NULL THEN NULL
                ELSE public.tm_kpi_norm_actual(_plan_progress)
           END,
           public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of),
           0::numeric
         );
$$;

-- ---------------------------------------------------------------------
-- 정본 판정 함수: tm_kpi_bucket_matches
-- kpi-utils.ts 술어 1:1 이식 (라인 인용은 각 branch 내 주석)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_bucket_matches(
  _bucket text,
  _actual_progress numeric,
  _actual_start   date,
  _plan_start     date,
  _plan_end       date,
  _plan_days      integer,
  _plan_progress  numeric,
  _auto_judgment  text,
  _as_of          date,
  _worsen_gap     numeric
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  WITH d AS (
    SELECT
      -- kpi-utils.ts:36-38 isCompleted: raw actual_progress >= 1 OR auto_judgment='완료'
      (COALESCE(_actual_progress, 0) >= 1 OR _auto_judgment = '완료') AS is_completed,
      -- kpi-utils.ts:40-42 isStarted: actual_start IS NOT NULL
      (_actual_start IS NOT NULL) AS is_started,
      -- kpi-utils.ts:44-47 isPlannedStartedBy: plan_start <= as_of
      (_plan_start IS NOT NULL AND _as_of IS NOT NULL AND _plan_start <= _as_of) AS is_planned_started,
      -- kpi-utils.ts:53-56 isCompletionOverdue: plan_end < as_of AND NOT completed
      (_plan_end IS NOT NULL AND _as_of IS NOT NULL AND _plan_end < _as_of) AS is_plan_end_past,
      public.tm_kpi_gap(_actual_progress, _plan_progress, _plan_start, _plan_end, _plan_days, _as_of) AS gap
  )
  SELECT CASE _bucket
    -- kpi-utils.ts statusOf (78-82) & 카드 카운트 (134-137)
    WHEN 'completed'          THEN d.is_completed
    WHEN 'wip'                THEN d.is_started AND NOT d.is_completed
    WHEN 'not_started'        THEN NOT d.is_started AND NOT d.is_completed
    -- kpi-utils.ts:138 plannedStartedByAsOf (unconditional count)
    WHEN 'planned_started'    THEN d.is_planned_started
    -- kpi-utils.ts:139 actuallyStarted
    WHEN 'actual_started'     THEN d.is_started
    -- kpi-utils.ts:73-76 isInDelay = isBehindSchedule = NOT completed AND gap < 0
    WHEN 'in_delay'           THEN NOT d.is_completed AND d.gap < 0
    WHEN 'behind'             THEN NOT d.is_completed AND d.gap < 0
    -- kpi-utils.ts:49-51 isStartDelayed ∩ isInDelay (kpi-utils.ts:143)
    WHEN 'start_delayed'      THEN (NOT d.is_completed AND d.gap < 0)
                                   AND d.is_planned_started AND NOT d.is_started
    -- kpi-utils.ts:53-56 isCompletionOverdue ∩ isInDelay (kpi-utils.ts:144)
    WHEN 'completion_overdue' THEN (NOT d.is_completed AND d.gap < 0)
                                   AND d.is_plan_end_past
    -- kpi-utils.ts:63-71 isCriticalDelay = NOT completed AND gap < worsen_gap
    WHEN 'critical'           THEN NOT d.is_completed AND d.gap < COALESCE(_worsen_gap, -0.15)
    -- 딥링크 부가 모드 (kpi-utils.ts:181-182)
    WHEN 'no_plan_start'      THEN _plan_start IS NULL
    WHEN 'no_plan_end'        THEN _plan_end IS NULL
    ELSE TRUE  -- 알 수 없는 버킷은 필터하지 않음 (하위호환)
  END
  FROM d;
$$;

COMMENT ON FUNCTION public.tm_kpi_bucket_matches(text, numeric, date, date, date, integer, numeric, text, date, numeric)
IS 'TM KPI 판정 정본. src/lib/task-management/kpi-utils.ts 술어 1:1 이식. 클라이언트 computeKpi 및 modeToColumnFilters 대체. 의미 변경 시 kpi-utils.ts 원본 수정 후 이식.';


-- ---------------------------------------------------------------------
-- 전 버킷 카운트 (KPI 카드용, jsonb 스칼라)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_items_counts_by_bucket(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _as_of date DEFAULT NULL,
  _thresholds jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
declare
  _allowed_filter_cols constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level','stage_start','stage_finish'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _where text := 'true';
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _worsen_gap numeric := COALESCE((_thresholds->>'worsen_gap')::numeric, -0.15);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
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
    if _col is null or not (_col = any(_allowed_filter_cols)) then continue; end if;

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

  _sql := format($fmt$
    with filtered as (
      select
        actual_progress, actual_start, plan_start, plan_end, plan_days,
        plan_progress, auto_judgment
      from public.v_task_management_raw_derived
      where %s
    ),
    flags as (
      select
        public.tm_kpi_bucket_matches('completed',          actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_completed,
        public.tm_kpi_bucket_matches('wip',                actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_wip,
        public.tm_kpi_bucket_matches('not_started',        actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_not_started,
        public.tm_kpi_bucket_matches('planned_started',    actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_planned_started,
        public.tm_kpi_bucket_matches('actual_started',     actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_actual_started,
        public.tm_kpi_bucket_matches('in_delay',           actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_in_delay,
        public.tm_kpi_bucket_matches('start_delayed',      actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_start_delayed,
        public.tm_kpi_bucket_matches('completion_overdue', actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_completion_overdue,
        public.tm_kpi_bucket_matches('critical',           actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_critical,
        public.tm_kpi_bucket_matches('behind',             actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_behind,
        public.tm_kpi_bucket_matches('no_plan_start',      actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_no_plan_start,
        public.tm_kpi_bucket_matches('no_plan_end',        actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_no_plan_end
      from filtered
    )
    select jsonb_build_object(
      'total',              count(*),
      'completed',          count(*) filter (where f_completed),
      'wip',                count(*) filter (where f_wip),
      'not_started',        count(*) filter (where f_not_started),
      'planned_started',    count(*) filter (where f_planned_started),
      'actual_started',     count(*) filter (where f_actual_started),
      'in_delay',           count(*) filter (where f_in_delay),
      'start_delayed',      count(*) filter (where f_start_delayed),
      'completion_overdue', count(*) filter (where f_completion_overdue),
      'critical',           count(*) filter (where f_critical),
      'behind',             count(*) filter (where f_behind),
      'no_plan_start',      count(*) filter (where f_no_plan_start),
      'no_plan_end',        count(*) filter (where f_no_plan_end),
      'as_of',              %L::text,
      'worsen_gap',         %s::numeric
    )
    from flags
  $fmt$,
    _where,
    _effective_asof, _worsen_gap, _effective_asof, _worsen_gap, _effective_asof, _worsen_gap,
    _effective_asof, _worsen_gap, _effective_asof, _worsen_gap, _effective_asof, _worsen_gap,
    _effective_asof, _worsen_gap, _effective_asof, _worsen_gap, _effective_asof, _worsen_gap,
    _effective_asof, _worsen_gap, _effective_asof, _worsen_gap, _effective_asof, _worsen_gap,
    _effective_asof::text, _worsen_gap
  );

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('total', 0));
end;
$function$;

COMMENT ON FUNCTION public.tm_items_counts_by_bucket(text, jsonb, boolean, date, jsonb)
IS 'TM KPI 카드용 전 버킷 카운트. jsonb 스칼라 반환(PostgREST 1,000행 상한 비적용). 카드→드릴다운 일치성 보장을 위해 tm_items_search 와 동일 필터 파이프라인 및 tm_kpi_bucket_matches 판정을 사용.';


-- ---------------------------------------------------------------------
-- tm_items_search 확장 — _kpi_mode / _as_of / _thresholds 추가
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_items_search(
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _include_inactive boolean DEFAULT false,
  _kpi_mode text DEFAULT NULL,
  _as_of date DEFAULT NULL,
  _thresholds jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
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
  _worsen_gap numeric := COALESCE((_thresholds->>'worsen_gap')::numeric, -0.15);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
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

  -- NEW: KPI 모드 필터 (tm_kpi_bucket_matches 로 서버 판정)
  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _where_sql := _where_sql || format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric)',
      _kpi_mode, _effective_asof, _worsen_gap
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


-- ---------------------------------------------------------------------
-- tm_items_search_ids 확장 — 동일 파라미터
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_items_search_ids(
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _limit integer DEFAULT 100000,
  _kpi_mode text DEFAULT NULL,
  _as_of date DEFAULT NULL,
  _thresholds jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
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
  _worsen_gap numeric := COALESCE((_thresholds->>'worsen_gap')::numeric, -0.15);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
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

  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _where := _where || format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric)',
      _kpi_mode, _effective_asof, _worsen_gap
    );
  end if;

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


-- ---------------------------------------------------------------------
-- tm_items_facets 확장 — 동일 파라미터 (KPI 모드 적용 후 도메인 계산)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_items_facets(
  _columns text[],
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _kpi_mode text DEFAULT NULL,
  _as_of date DEFAULT NULL,
  _thresholds jsonb DEFAULT NULL
) RETURNS TABLE(axis text, value text, cnt bigint)
LANGUAGE plpgsql STABLE
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
  _worsen_gap numeric := COALESCE((_thresholds->>'worsen_gap')::numeric, -0.15);
  _effective_asof date := COALESCE(_as_of, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar')::date);
  _kpi_clause text := '';
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

  if _kpi_mode is not null and length(trim(_kpi_mode)) > 0 then
    _kpi_clause := format(
      ' and public.tm_kpi_bucket_matches(%L, actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric)',
      _kpi_mode, _effective_asof, _worsen_gap
    );
    _base_where := _base_where || _kpi_clause;
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

-- ---------------------------------------------------------------------
-- 권한 (기존 함수 grants 는 유지, 신규 함수만 명시 grant)
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.tm_kpi_norm_actual(numeric)          TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_kpi_tplan(date, date, integer, date) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_kpi_gap(numeric, numeric, date, date, integer, date) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_kpi_bucket_matches(text, numeric, date, date, date, integer, numeric, text, date, numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_items_counts_by_bucket(text, jsonb, boolean, date, jsonb) TO authenticated, anon, service_role;