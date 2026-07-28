-- =====================================================================
-- TM KPI 판정 단일화 — 보완 마이그레이션 (Option A)
-- 소스: src/lib/task-management/kpi-utils.ts, derived.ts, TaskManagementRawDataPage.tsx
-- 규약: 클라이언트 술어를 의미 변경 없이 1:1 이식. jsonb 스칼라 반환.
-- 선행: 20260728100511 (tm_kpi_bucket_matches / tm_kpi_norm_actual / tm_kpi_tplan / tm_kpi_gap)
-- =====================================================================

-- ---------------------------------------------------------------------
-- helper: cumPlanProgress (derived.ts:107-113)
--   plan_progress 우선(clamp 0..1), NULL 이면 computeTPlan 폴백, 그마저도 NULL 이면 0
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_cum_plan(
  _plan_progress numeric,
  _plan_start date, _plan_end date, _plan_days integer,
  _as_of date
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE WHEN _plan_progress IS NULL THEN NULL
         ELSE GREATEST(0::numeric, LEAST(1::numeric, _plan_progress))
    END,
    public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of),
    0::numeric
  );
$$;
COMMENT ON FUNCTION public.tm_kpi_cum_plan(numeric, date, date, integer, date)
IS 'derived.ts:107-113 cumPlanProgress 1:1 이식. plan_progress 우선 → computeTPlan 폴백 → 0.';

-- ---------------------------------------------------------------------
-- helper: dashboard-consistent auto_judgment (TaskManagementRawDataPage.tsx:687-703)
--   Raw Data 셀 표시 판정. Dashboard 쿼리가 plan_progress 를 미SELECT 하는 이유로
--   gap = normActual(actual) - computeTPlan(asOf) 로 산출됨(라인 697 근거).
--   isCompleted 는 kpi-utils.ts:36-38 을 재사용.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tm_kpi_dashboard_judgment(
  _actual_progress numeric,
  _plan_start date, _plan_end date, _plan_days integer,
  _auto_judgment text,
  _as_of date,
  _worsen_gap numeric,
  _caution_gap_buffer numeric
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  WITH d AS (
    SELECT
      (COALESCE(_actual_progress, 0) >= 1 OR _auto_judgment = '완료') AS is_completed,
      -- 라인 696-698: actual = cumActualProgress, plan = computeTPlan(asOf) ?? 0
      public.tm_kpi_norm_actual(_actual_progress)
        - COALESCE(public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of), 0::numeric)
        AS gap
  )
  SELECT CASE
    WHEN d.is_completed                                   THEN '완료'
    WHEN d.gap < COALESCE(_worsen_gap, -0.15)             THEN '악화'
    WHEN d.gap < 0                                        THEN '지연'
    WHEN d.gap < COALESCE(_caution_gap_buffer, 0.05)      THEN '주의'
    ELSE                                                       '정상'
  END
  FROM d;
$$;
COMMENT ON FUNCTION public.tm_kpi_dashboard_judgment(numeric, date, date, integer, text, date, numeric, numeric)
IS 'TaskManagementRawDataPage.tsx:687-703 computeDashboardAutoJudgment 1:1 이식. plan_progress 미사용(computeTPlan 기반). Raw Data 셀 표시 및 필터 소스 통일용.';


-- =====================================================================
-- 1) tm_items_weighted_progress
-- kpi-utils.ts:89-101 weightedProgress 1:1 이식.
--   planned = Σ cumPlanProgress(r, asOf) / n * 100
--   actual  = Σ cumActualProgress(r)     / n * 100
-- 반환: { "planned_pct": <numeric>, "actual_pct": <numeric>, "sample_count": <int> }
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tm_items_weighted_progress(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _as_of date DEFAULT NULL
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
      select actual_progress, plan_progress, plan_start, plan_end, plan_days
      from public.v_task_management_raw_derived
      where %s
    ),
    agg as (
      select
        count(*)::bigint as n,
        -- kpi-utils.ts:93-96: sumPlan += cumPlanProgress ; sumActual += cumActualProgress
        coalesce(sum(public.tm_kpi_cum_plan(plan_progress, plan_start, plan_end, plan_days, %L::date)), 0) as sum_plan,
        coalesce(sum(public.tm_kpi_norm_actual(actual_progress)), 0) as sum_actual
      from filtered
    )
    select jsonb_build_object(
      'planned_pct',
        case when n = 0 then 0::numeric else round((sum_plan / n::numeric) * 100, 4) end,
      'actual_pct',
        case when n = 0 then 0::numeric else round((sum_actual / n::numeric) * 100, 4) end,
      'sample_count', n
    ) from agg
  $fmt$, _where, _effective_asof);

  execute _sql into _result;
  return coalesce(_result,
    jsonb_build_object('planned_pct', 0, 'actual_pct', 0, 'sample_count', 0));
end;
$function$;

COMMENT ON FUNCTION public.tm_items_weighted_progress(text, jsonb, boolean, date)
IS 'kpi-utils.ts:89-101 weightedProgress 1:1 이식. Σ/n * 100 (소수 4자리 반올림). 반환: jsonb {planned_pct, actual_pct, sample_count}.';

GRANT EXECUTE ON FUNCTION public.tm_items_weighted_progress(text, jsonb, boolean, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tm_items_weighted_progress(text, jsonb, boolean, date) TO service_role;


-- =====================================================================
-- 2) tm_items_counts_by_bucket_by_team
-- kpi-utils.ts:222-247 computeKpiBreakdownByTeam 1:1 이식.
--   대상 버킷: in_delay, start_delayed, completion_overdue, critical, behind
--   팀 라벨: NULL 또는 공백 → '미지정' (is_null=true), else 원문.
--   정렬: kpi-utils.ts:215-220 sortEntries — count DESC, team ASC.
-- 반환:
--   { "<bucket>": [ { "team": "...", "is_null": bool, "count": int }, ... ], ... }
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tm_items_counts_by_bucket_by_team(
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
        team, actual_progress, actual_start, plan_start, plan_end, plan_days,
        plan_progress, auto_judgment
      from public.v_task_management_raw_derived
      where %s
    ),
    flagged as (
      select
        -- kpi-utils.ts:199-203 teamKey: 공백 trim → '' 이면 미지정/is_null
        case when coalesce(nullif(btrim(team), ''), NULL) is null then '미지정' else btrim(team) end as team_key,
        (coalesce(nullif(btrim(team), ''), NULL) is null) as is_null,
        public.tm_kpi_bucket_matches('in_delay',           actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_in_delay,
        public.tm_kpi_bucket_matches('start_delayed',      actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_start_delayed,
        public.tm_kpi_bucket_matches('completion_overdue', actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_completion_overdue,
        public.tm_kpi_bucket_matches('critical',           actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_critical,
        public.tm_kpi_bucket_matches('behind',             actual_progress, actual_start, plan_start, plan_end, plan_days, plan_progress, auto_judgment, %L::date, %s::numeric) as f_behind
      from filtered
    ),
    per_team as (
      select team_key, bool_or(is_null) as is_null,
        count(*) filter (where f_in_delay)           as c_in_delay,
        count(*) filter (where f_start_delayed)      as c_start_delayed,
        count(*) filter (where f_completion_overdue) as c_completion_overdue,
        count(*) filter (where f_critical)           as c_critical,
        count(*) filter (where f_behind)             as c_behind
      from flagged
      group by team_key
    ),
    -- kpi-utils.ts:215-220 sortEntries: count DESC, team ASC
    sorted_in_delay as (
      select jsonb_agg(jsonb_build_object('team', team_key, 'is_null', is_null, 'count', c_in_delay)
                       order by c_in_delay desc, team_key asc) as arr
      from per_team where c_in_delay > 0
    ),
    sorted_start_delayed as (
      select jsonb_agg(jsonb_build_object('team', team_key, 'is_null', is_null, 'count', c_start_delayed)
                       order by c_start_delayed desc, team_key asc) as arr
      from per_team where c_start_delayed > 0
    ),
    sorted_completion_overdue as (
      select jsonb_agg(jsonb_build_object('team', team_key, 'is_null', is_null, 'count', c_completion_overdue)
                       order by c_completion_overdue desc, team_key asc) as arr
      from per_team where c_completion_overdue > 0
    ),
    sorted_critical as (
      select jsonb_agg(jsonb_build_object('team', team_key, 'is_null', is_null, 'count', c_critical)
                       order by c_critical desc, team_key asc) as arr
      from per_team where c_critical > 0
    ),
    sorted_behind as (
      select jsonb_agg(jsonb_build_object('team', team_key, 'is_null', is_null, 'count', c_behind)
                       order by c_behind desc, team_key asc) as arr
      from per_team where c_behind > 0
    )
    select jsonb_build_object(
      'in_delay',           coalesce((select arr from sorted_in_delay), '[]'::jsonb),
      'start_delayed',      coalesce((select arr from sorted_start_delayed), '[]'::jsonb),
      'completion_overdue', coalesce((select arr from sorted_completion_overdue), '[]'::jsonb),
      'critical',           coalesce((select arr from sorted_critical), '[]'::jsonb),
      'behind',             coalesce((select arr from sorted_behind), '[]'::jsonb)
    )
  $fmt$, _where,
       _effective_asof, _worsen_gap,
       _effective_asof, _worsen_gap,
       _effective_asof, _worsen_gap,
       _effective_asof, _worsen_gap,
       _effective_asof, _worsen_gap);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object(
    'in_delay','[]'::jsonb,'start_delayed','[]'::jsonb,
    'completion_overdue','[]'::jsonb,'critical','[]'::jsonb,'behind','[]'::jsonb));
end;
$function$;

COMMENT ON FUNCTION public.tm_items_counts_by_bucket_by_team(text, jsonb, boolean, date, jsonb)
IS 'kpi-utils.ts:222-247 computeKpiBreakdownByTeam 1:1 이식. 팀 라벨 미지정 규칙(199-203) + sortEntries(215-220: count DESC, team ASC) 준수. 반환: jsonb {<bucket>:[{team,is_null,count}]}.';

GRANT EXECUTE ON FUNCTION public.tm_items_counts_by_bucket_by_team(text, jsonb, boolean, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tm_items_counts_by_bucket_by_team(text, jsonb, boolean, date, jsonb) TO service_role;


-- =====================================================================
-- 3) tm_items_search 확장 — rows[] 각 행에 derived_auto_judgment 컬럼 삽입
--    _as_of AND _thresholds 가 모두 전달된 경우: tm_kpi_dashboard_judgment 결과.
--    아니면: 기존 stored auto_judgment 값 그대로(하위호환).
--    기존 컬럼/시그니처/정렬/필터 로직은 불변. rows 구조에만 파생 필드 1개 추가.
-- =====================================================================
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

  -- derived_auto_judgment expression: 컨텍스트 있을 때만 서버 계산
  if _has_derived_ctx then
    _derived_expr := format(
      'public.tm_kpi_dashboard_judgment(actual_progress, plan_start, plan_end, plan_days, auto_judgment, %L::date, %s::numeric, %s::numeric)',
      _effective_asof, _worsen_gap, _caution_gap_buffer);
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
    from agg cross join tot
  $fmt$, _where_sql, _safe_offset, _safe_offset + _safe_limit, _derived_expr, _sort_sql);

  execute _sql into _result;
  return coalesce(_result, jsonb_build_object('rows','[]'::jsonb,'total_count',0,'main_count',0));
end;
$function$;

COMMENT ON FUNCTION public.tm_items_search(text, jsonb, jsonb, integer, integer, boolean, text, date, jsonb)
IS 'rows[] 각 행에 derived_auto_judgment 필드 삽입. _as_of AND _thresholds 전달 시 tm_kpi_dashboard_judgment 결과, 미전달 시 stored auto_judgment 값 그대로(하위호환). 기존 시그니처/정렬/필터/kpi_mode 필터 불변.';
