
-- 1) tplan: 창(plan_end-plan_start+1) 우선, plan_days 는 날짜 결손 시 폴백
CREATE OR REPLACE FUNCTION public.tm_kpi_tplan(_plan_start date, _plan_end date, _plan_days integer, _as_of date)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN _plan_start IS NULL THEN NULL::numeric
    WHEN _as_of IS NULL THEN NULL::numeric
    WHEN _as_of < _plan_start THEN 0::numeric
    WHEN _plan_end IS NOT NULL AND _as_of >= _plan_end THEN 1::numeric
    ELSE (
      SELECT CASE WHEN d IS NULL OR d <= 0 THEN NULL::numeric
             ELSE GREATEST(0::numeric, LEAST(1::numeric, (((_as_of - _plan_start) + 1)::numeric / d::numeric))) END
      FROM (
        SELECT COALESCE(
          CASE WHEN _plan_end IS NOT NULL THEN GREATEST(1, (_plan_end - _plan_start) + 1) END,
          NULLIF(_plan_days, 0)
        ) AS d
      ) x
    )
  END;
$function$;

-- 2) Main(하위 보유) 가중 계획: 실적 롤업과 동일 가중치 w = 하위 계획창 일수
CREATE OR REPLACE FUNCTION public.tm_main_tplan(_discipline text, _task_no text, _as_of date)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN COALESCE(SUM(w), 0) = 0 THEN NULL
              ELSE GREATEST(0::numeric, LEAST(1::numeric, SUM(w * tp) / SUM(w))) END
  FROM (
    SELECT GREATEST(COALESCE(s.plan_end - s.plan_start, 0) + 1, 1)::numeric AS w,
           COALESCE(public.tm_kpi_tplan(s.plan_start, s.plan_end, s.plan_days, _as_of), 0) AS tp
    FROM public.task_management_raw s
    WHERE s.discipline = _discipline AND s.main_task_no = _task_no AND s.level = 'sub'
  ) z;
$function$;

-- 3) 행 인식 tplan (정본 단일 진입점)
CREATE OR REPLACE FUNCTION public.tm_row_tplan(_level text, _discipline text, _task_no text,
  _plan_start date, _plan_end date, _plan_days integer, _as_of date)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(
    CASE WHEN LOWER(COALESCE(_level,'')) = 'main'
         THEN public.tm_main_tplan(_discipline, _task_no, _as_of) END,
    public.tm_kpi_tplan(_plan_start, _plan_end, _plan_days, _as_of));
$function$;

CREATE OR REPLACE FUNCTION public.tm_row_gap(_level text, _discipline text, _task_no text,
  _plan_start date, _plan_end date, _plan_days integer, _actual_progress numeric, _as_of date)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN public.tm_row_tplan(_level,_discipline,_task_no,_plan_start,_plan_end,_plan_days,_as_of) IS NULL
              THEN NULL::numeric
              ELSE public.tm_kpi_norm_actual(_actual_progress)
                 - public.tm_row_tplan(_level,_discipline,_task_no,_plan_start,_plan_end,_plan_days,_as_of) END;
$function$;

-- 4) gap 주입형 판정 (판정 사다리 단일 소스)
CREATE OR REPLACE FUNCTION public.tm_kpi_judgment_g(_actual_progress numeric, _actual_finish date,
  _actual_start date, _plan_start date, _as_of date, _gap numeric,
  _caution_buffer numeric DEFAULT NULL, _worsen_gap numeric DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN (COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL) THEN '완료'
    WHEN (_plan_start IS NOT NULL AND _as_of IS NOT NULL AND _plan_start > _as_of)
         AND NOT (_actual_start IS NOT NULL OR COALESCE(_actual_progress,0) > 0) THEN '정상'
    WHEN _gap IS NULL THEN '정상'
    WHEN _gap < public.tm_resolve_worsen(_worsen_gap) THEN '악화'
    WHEN _gap < 0 THEN '지연'
    WHEN _gap < public.tm_resolve_caution(_caution_buffer) THEN '주의'
    ELSE '정상' END;
$function$;

CREATE OR REPLACE FUNCTION public.tm_kpi_bucket_matches_g(_bucket text, _actual_progress numeric,
  _actual_finish date, _actual_start date, _plan_start date, _plan_end date, _as_of date,
  _gap numeric, _caution_buffer numeric DEFAULT NULL, _worsen_gap numeric DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH d AS (
    SELECT (COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL) AS is_completed,
           (_actual_start IS NOT NULL) AS is_started,
           (_plan_start IS NOT NULL AND _as_of IS NOT NULL AND _plan_start <= _as_of) AS is_planned_started,
           (_plan_end IS NOT NULL AND _as_of IS NOT NULL AND _plan_end < _as_of) AS is_plan_end_past,
           _gap AS gap,
           public.tm_kpi_judgment_g(_actual_progress,_actual_finish,_actual_start,_plan_start,_as_of,_gap,_caution_buffer,_worsen_gap) AS judgment
  )
  SELECT CASE _bucket
    WHEN 'completed'          THEN d.is_completed
    WHEN 'wip'                THEN d.is_started AND NOT d.is_completed
    WHEN 'not_started'        THEN NOT d.is_started AND NOT d.is_completed
    WHEN 'planned_started'    THEN d.is_planned_started
    WHEN 'actual_started'     THEN d.is_started
    WHEN 'in_delay'           THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
    WHEN 'behind'             THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
    WHEN 'start_delayed'      THEN NOT d.is_completed AND d.judgment IN ('지연','악화') AND d.is_planned_started AND NOT d.is_started
    WHEN 'completion_overdue' THEN NOT d.is_completed AND d.judgment IN ('지연','악화') AND d.is_plan_end_past
    WHEN 'critical'           THEN NOT d.is_completed AND d.judgment = '악화'
    WHEN 'no_plan_start'      THEN _plan_start IS NULL
    WHEN 'no_plan_end'        THEN _plan_end IS NULL
    WHEN 'j_caution'          THEN d.judgment = '주의'
    WHEN 'j_normal'           THEN d.judgment = '정상'
    WHEN 'j_delay'            THEN d.judgment = '지연'
    WHEN 'j_worse'            THEN d.judgment = '악화'
    WHEN 'j_completed'        THEN d.judgment = '완료'
    ELSE TRUE END
  FROM d;
$function$;

-- 5) tm_rows_as_of: cum_plan/gap/judgment 를 항상 행 인식 정본으로 재계산
CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
RETURNS SETOF v_task_management_raw_derived LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH p AS (
    SELECT (_as_of IS NOT NULL AND _as_of < (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS past,
           COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  base AS (
    SELECT v.*, p.past, p.asof,
      CASE WHEN p.past THEN r.hist_actual ELSE v.actual_progress END AS eff_actual,
      (p.past AND r.hist_actual IS NULL) AS no_hist
    FROM public.v_task_management_raw_derived v
    CROSS JOIN p
    LEFT JOIN public.tm_actual_at_date(_as_of) r ON p.past AND r.id = v.id
  ),
  calc AS (
    SELECT b.*,
      public.tm_row_tplan(b.level::text, b.discipline, b.task_no, b.plan_start, b.plan_end, b.plan_days, b.asof) AS tplan
    FROM base b
  )
  SELECT
    c.id, c.task_no, c.main_task_no, c.level, c.discipline, c.category, c.plot, c.task_name,
    c.risk, c.sub_task_desc, c.row_type, c.status_manual, c.plan_start, c.plan_end, c.plan_days,
    CASE WHEN c.past THEN CASE WHEN COALESCE(c.eff_actual,0) > 0 THEN c.actual_start END ELSE c.actual_start END AS actual_start,
    CASE WHEN c.past THEN c.eff_actual ELSE c.actual_progress END AS actual_progress,
    c.plan_progress, c.progress_variance, c.forecast_end, c.slip_days,
    CASE WHEN c.no_hist THEN NULL
         ELSE public.tm_kpi_judgment_g(
           c.eff_actual,
           CASE WHEN public.tm_kpi_norm_actual(c.eff_actual) >= 1 THEN c.actual_finish END,
           CASE WHEN public.tm_kpi_norm_actual(c.eff_actual) > 0 THEN c.actual_start END,
           c.plan_start, c.asof,
           CASE WHEN c.tplan IS NULL THEN NULL ELSE public.tm_kpi_norm_actual(c.eff_actual) - c.tplan END,
           NULL, NULL) END AS auto_judgment,
    c.data_date, c.sort_order, c.source_file, c.imported_at, c.imported_by, c.created_at, c.updated_at,
    c.auto_judgment_import, c.is_rollup, c.source_import_log_id, c.is_active, c.team, c.location, c.floor_level,
    CASE WHEN c.past THEN CASE WHEN public.tm_kpi_norm_actual(c.eff_actual) >= 1 THEN c.actual_finish END ELSE c.actual_finish END AS actual_finish,
    c.actual_duration, c.owner_user_id, c.hdec_pic_name, c.hdec_eng_name,
    CASE WHEN c.no_hist THEN NULL ELSE c.tplan END AS cum_plan_pct,
    CASE WHEN c.no_hist THEN NULL ELSE public.tm_kpi_norm_actual(c.eff_actual) END AS cum_actual_pct,
    CASE WHEN c.no_hist OR c.tplan IS NULL THEN NULL ELSE public.tm_kpi_norm_actual(c.eff_actual) - c.tplan END AS gap_pct,
    c.delay_days,
    CASE WHEN c.no_hist THEN '이력 없음' ELSE c.alarm_reason END AS alarm_reason,
    c.milestone, c.milestone_date, c.plan_overdue, c.expected_finish, c.actual_overdue,
    c.stage_start, c.stage_finish, c.expected_progress_today
  FROM calc c;
$function$;

-- 6) tm_judge_at_date: 행 인식 tplan 사용
CREATE OR REPLACE FUNCTION public.tm_judge_at_date(p_data_date date, p_task_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH d AS (SELECT COALESCE(p_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS as_of),
  r AS (
    SELECT t.id, t.level, t.discipline, t.task_no, t.plan_start, t.plan_end, t.plan_days,
           t.actual_start, t.actual_finish, a.hist_actual, a.actual_source
    FROM public.task_management_raw t
    JOIN public.tm_actual_at_date(p_data_date, p_task_ids) a ON a.id = t.id
    WHERE t.is_active IS NOT FALSE
      AND (p_task_ids IS NULL OR t.id = ANY(p_task_ids))
  ),
  j AS (
    SELECT r.id, r.actual_source,
      public.tm_row_tplan(r.level::text, r.discipline, r.task_no, r.plan_start, r.plan_end, r.plan_days, d.as_of) AS cum_plan_pct,
      public.tm_kpi_norm_actual(r.hist_actual) AS cum_actual_pct,
      public.tm_row_gap(r.level::text, r.discipline, r.task_no, r.plan_start, r.plan_end, r.plan_days, r.hist_actual, d.as_of) AS gap_pct,
      public.tm_kpi_judgment_g(
        r.hist_actual,
        CASE WHEN r.hist_actual >= 1 THEN r.actual_finish END,
        CASE WHEN r.hist_actual > 0 THEN r.actual_start END,
        r.plan_start, d.as_of,
        public.tm_row_gap(r.level::text, r.discipline, r.task_no, r.plan_start, r.plan_end, r.plan_days, r.hist_actual, d.as_of),
        NULL, NULL) AS auto_judgment,
      CASE
        WHEN r.hist_actual >= 1 AND r.actual_finish IS NOT NULL AND r.plan_end IS NOT NULL
             AND r.actual_finish > r.plan_end THEN (r.actual_finish - r.plan_end)
        WHEN COALESCE(r.hist_actual,0) < 1 AND r.plan_end IS NOT NULL AND d.as_of > r.plan_end
             THEN (d.as_of - r.plan_end)
        ELSE 0 END AS delay_days
    FROM r, d
  )
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT j.id,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.cum_plan_pct END   AS cum_plan_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.cum_actual_pct END AS cum_actual_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.gap_pct END        AS gap_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.auto_judgment END  AS auto_judgment,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.delay_days END     AS delay_days,
      CASE WHEN j.actual_source = 'none' THEN '이력 없음'
           ELSE 'Gap ' || round(COALESCE(j.gap_pct,0)*100, 1) || '%' END     AS alarm_reason,
      j.actual_source
    FROM j
  ) x;
$function$;

-- 7) KPI 카운트/검색: tm_rows_as_of 의 gap_pct 를 판정 소스로 사용
CREATE OR REPLACE FUNCTION public.tm_items_counts(_q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false, _task_scope text DEFAULT 'all'::text, _as_of date DEFAULT NULL::date,
  _caution_buffer numeric DEFAULT NULL::numeric, _worsen_gap numeric DEFAULT NULL::numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_ids uuid[];
  v_asof date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  r jsonb;
BEGIN
  SELECT ARRAY(
    SELECT (elem::text)::uuid
    FROM jsonb_array_elements_text(
      COALESCE((SELECT public.tm_items_search_ids(_q, _filters, _include_inactive, 200000, NULL, NULL, NULL)), '[]'::jsonb)
    ) elem
  ) INTO v_ids;

  WITH scoped AS (
    SELECT t.* FROM public.tm_rows_as_of(v_asof) t
    WHERE t.id = ANY(v_ids)
      AND (_task_scope = 'all'
        OR (_task_scope = 'main' AND LOWER(COALESCE(t.level::text,'')) = 'main')
        OR (_task_scope = 'sub'  AND LOWER(COALESCE(t.level::text,'')) = 'sub'))
  ),
  judged AS (
    SELECT s.id,
      (COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL) AS is_completed,
      (s.actual_start IS NOT NULL) AS is_started,
      (s.plan_start IS NOT NULL AND s.plan_start <= v_asof) AS is_planned_started,
      (s.plan_end IS NOT NULL AND s.plan_end < v_asof) AS is_plan_end_past,
      public.tm_kpi_judgment_g(s.actual_progress, s.actual_finish, s.actual_start,
        s.plan_start, v_asof, s.gap_pct, _caution_buffer, _worsen_gap) AS judgment,
      (s.alarm_reason IS NOT DISTINCT FROM '이력 없음') AS no_hist,
      (s.plan_start IS NULL) AS no_plan_start,
      (s.plan_end IS NULL) AS no_plan_end
    FROM scoped s
  )
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'no_history', COUNT(*) FILTER (WHERE no_hist),
    'completed', COUNT(*) FILTER (WHERE NOT no_hist AND is_completed),
    'wip', COUNT(*) FILTER (WHERE NOT no_hist AND is_started AND NOT is_completed),
    'not_started', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_started AND NOT is_completed),
    'planned_started', COUNT(*) FILTER (WHERE NOT no_hist AND is_planned_started),
    'actual_started', COUNT(*) FILTER (WHERE NOT no_hist AND is_started),
    'in_delay', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_completed AND judgment IN ('지연','악화')),
    'behind', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_completed AND judgment IN ('지연','악화')),
    'start_delayed', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_completed AND judgment IN ('지연','악화') AND is_planned_started AND NOT is_started),
    'completion_overdue', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_completed AND judgment IN ('지연','악화') AND is_plan_end_past),
    'critical', COUNT(*) FILTER (WHERE NOT no_hist AND NOT is_completed AND judgment = '악화'),
    'no_plan_start', COUNT(*) FILTER (WHERE NOT no_hist AND no_plan_start),
    'no_plan_end', COUNT(*) FILTER (WHERE NOT no_hist AND no_plan_end),
    'j_caution', COUNT(*) FILTER (WHERE NOT no_hist AND judgment = '주의'),
    'j_normal', COUNT(*) FILTER (WHERE NOT no_hist AND judgment = '정상'),
    'j_delay', COUNT(*) FILTER (WHERE NOT no_hist AND judgment = '지연'),
    'j_worse', COUNT(*) FILTER (WHERE NOT no_hist AND judgment = '악화'),
    'j_completed', COUNT(*) FILTER (WHERE NOT no_hist AND judgment = '완료'),
    'as_of', v_asof,
    'task_scope', _task_scope
  ) INTO r FROM judged;

  RETURN COALESCE(r, jsonb_build_object('total', 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tm_items_counts_by_team(_q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false, _task_scope text DEFAULT 'all'::text, _as_of date DEFAULT NULL::date,
  _caution_buffer numeric DEFAULT 0.05, _worsen_gap numeric DEFAULT '-0.15'::numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_ids uuid[];
  v_asof date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  r jsonb;
BEGIN
  SELECT ARRAY(
    SELECT (elem::text)::uuid
    FROM jsonb_array_elements_text(
      COALESCE((SELECT public.tm_items_search_ids(_q, _filters, _include_inactive, 200000, NULL, NULL, NULL)), '[]'::jsonb)
    ) elem
  ) INTO v_ids;

  WITH scoped AS (
    SELECT t.* FROM public.tm_rows_as_of(v_asof) t
    WHERE t.id = ANY(v_ids)
      AND (_task_scope = 'all'
        OR (_task_scope = 'main' AND LOWER(COALESCE(t.level::text,'')) = 'main')
        OR (_task_scope = 'sub'  AND LOWER(COALESCE(t.level::text,'')) = 'sub'))
  ),
  judged AS (
    SELECT NULLIF(TRIM(COALESCE(s.team,'')), '') AS team_key,
      (COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL) AS is_completed,
      (s.actual_start IS NOT NULL) AS is_started,
      (s.plan_start IS NOT NULL AND s.plan_start <= v_asof) AS is_planned_started,
      (s.plan_end IS NOT NULL AND s.plan_end < v_asof) AS is_plan_end_past,
      public.tm_kpi_judgment_g(s.actual_progress, s.actual_finish, s.actual_start,
        s.plan_start, v_asof, s.gap_pct, _caution_buffer, _worsen_gap) AS judgment
    FROM scoped s
  ),
  per_team AS (
    SELECT team_key,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')) AS in_delay,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화') AND is_planned_started AND NOT is_started) AS start_delayed,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화') AND is_plan_end_past) AS completion_overdue,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment = '악화') AS critical_delay,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')) AS behind_schedule
    FROM judged GROUP BY team_key
  ),
  as_json AS (
    SELECT jsonb_build_object(
      'in_delay', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', in_delay) ORDER BY in_delay DESC NULLS LAST, team_key) FILTER (WHERE in_delay > 0), '[]'::jsonb),
      'start_delayed', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', start_delayed) ORDER BY start_delayed DESC NULLS LAST, team_key) FILTER (WHERE start_delayed > 0), '[]'::jsonb),
      'completion_overdue', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', completion_overdue) ORDER BY completion_overdue DESC NULLS LAST, team_key) FILTER (WHERE completion_overdue > 0), '[]'::jsonb),
      'critical_delay', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', critical_delay) ORDER BY critical_delay DESC NULLS LAST, team_key) FILTER (WHERE critical_delay > 0), '[]'::jsonb),
      'behind_schedule', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', behind_schedule) ORDER BY behind_schedule DESC NULLS LAST, team_key) FILTER (WHERE behind_schedule > 0), '[]'::jsonb)
    ) AS payload
    FROM per_team
  )
  SELECT payload INTO r FROM as_json;

  RETURN COALESCE(r, jsonb_build_object('in_delay','[]'::jsonb,'start_delayed','[]'::jsonb,
    'completion_overdue','[]'::jsonb,'critical_delay','[]'::jsonb,'behind_schedule','[]'::jsonb));
END;
$function$;

-- 8) MWS: 행 인식 gap 기반 판정
CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(_mode text, _filter_value text, _today date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT t.* FROM public.task_management_raw t
    WHERE CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT public.tm_kpi_norm_actual(b.actual_progress) AS act,
      b.actual_start, b.actual_finish, b.plan_start, b.plan_end,
      (public.tm_kpi_norm_actual(b.actual_progress) >= 1.0 OR b.actual_finish IS NOT NULL) AS is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS is_started_raw,
      public.tm_kpi_judgment_g(b.actual_progress, b.actual_finish, b.actual_start, b.plan_start, _today,
        public.tm_row_gap(b.level::text, b.discipline, b.task_no, b.plan_start, b.plan_end, b.plan_days, b.actual_progress, _today),
        NULL, NULL) AS jd
    FROM base b
  )
  SELECT jsonb_build_object(
    'today_count', COUNT(*) FILTER (WHERE NOT is_completed AND (plan_start = _today OR plan_end = _today)),
    'delayed_count', COUNT(*) FILTER (WHERE jd IN ('지연','악화')),
    'upcoming_count', COUNT(*) FILTER (WHERE NOT is_completed AND plan_end IS NOT NULL AND (plan_end - _today) BETWEEN 1 AND 3),
    'in_progress_count', COUNT(*) FILTER (WHERE is_started_raw AND NOT is_completed),
    'completed_count', COUNT(*) FILTER (WHERE is_completed),
    'total_count', COUNT(*)
  ) FROM judged;
$function$;

CREATE OR REPLACE FUNCTION public.tm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT t.* FROM public.task_management_raw t
    WHERE CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  computed AS (
    SELECT b.*,
      public.tm_kpi_norm_actual(b.actual_progress) AS _act,
      (public.tm_kpi_norm_actual(b.actual_progress) >= 1.0 OR b.actual_finish IS NOT NULL) AS _is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS _is_started_raw,
      public.tm_kpi_judgment_g(b.actual_progress, b.actual_finish, b.actual_start, b.plan_start, _today,
        public.tm_row_gap(b.level::text, b.discipline, b.task_no, b.plan_start, b.plan_end, b.plan_days, b.actual_progress, _today),
        NULL, NULL) AS _jd
    FROM base b
  ),
  filtered AS (
    SELECT c.* FROM computed c
    WHERE CASE _bucket
      WHEN 'today' THEN NOT c._is_completed AND (c.plan_start = _today OR c.plan_end = _today)
      WHEN 'delayed' THEN c._jd IN ('지연','악화')
      WHEN 'upcoming' THEN NOT c._is_completed AND c.plan_end IS NOT NULL AND (c.plan_end - _today) BETWEEN 1 AND 3
      WHEN 'in_progress' THEN NOT c._is_completed AND c._is_started_raw
      WHEN 'completed' THEN c._is_completed
      ELSE TRUE END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) - '_act' - '_is_completed' - '_is_started_raw' - '_jd' ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days, f.created_at,
      f._act, f._is_completed, f._is_started_raw, f._jd
    FROM filtered f ORDER BY f.task_no NULLS LAST LIMIT _limit OFFSET _offset
  ) sub;
$function$;

-- 9) Main 저장 파생: 가중 계획 기준으로 재계산
CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $function$
declare
  agg record;
  worst_sub text;
  worst_main text;
  worst text;
  rank_order text[] := array['악화','지연','주의','정상','완료'];
  _ad integer;
  _data_date date;
  _plan_days integer;
  _actual_progress numeric;
  _plan_start date;
  _plan_end date;
  _actual_start date;
  _actual_finish date;
  _slip_days integer;
  _as_of date;
  _tplan numeric;
  _act numeric;
  _gap numeric;
  _judg text;
  _delay integer;
begin
  if _parent_task_no is null then return; end if;

  select
    sum(least(1, greatest(0, coalesce(actual_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(least(1, greatest(0, coalesce(plan_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps,
    max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_,
    max(actual_finish) as af_,
    bool_and(actual_finish is not null or least(1, greatest(0, coalesce(actual_progress,0))) >= 1) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline and main_task_no = _parent_task_no and level = 'sub';

  if agg.cnt = 0 then return; end if;

  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := ((current_timestamp AT TIME ZONE 'Asia/Qatar')::date - agg.as_) + 1;
  end if;

  select r into worst_sub from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_parent_task_no and level='sub' and auto_judgment = x.r
  ) order by idx limit 1;

  select data_date, plan_days, actual_progress, plan_start, plan_end, actual_start, actual_finish, slip_days
    into _data_date, _plan_days, _actual_progress, _plan_start, _plan_end, _actual_start, _actual_finish, _slip_days
  from public.task_management_raw
  where discipline = _discipline and task_no = _parent_task_no and level = 'main' limit 1;

  _as_of := coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);
  _act := public.tm_kpi_norm_actual(coalesce(agg.ap, _actual_progress));
  -- 정본: 하위 가중 누계 계획 (실적 롤업과 동일 가중치)
  _tplan := public.tm_main_tplan(_discipline, _parent_task_no, _as_of);
  _gap := case when _tplan is null then null else _act - _tplan end;
  _judg := public.tm_kpi_judgment_g(
    _act,
    case when agg.all_finished then coalesce(_actual_finish, agg.af_) else _actual_finish end,
    coalesce(_actual_start, agg.as_),
    coalesce(_plan_start, agg.ps), _as_of, _gap, NULL, NULL);
  _delay := case
    when _act >= 1 and coalesce(_actual_finish, agg.af_) is not null and coalesce(_plan_end, agg.pe) is not null
         and coalesce(_actual_finish, agg.af_) > coalesce(_plan_end, agg.pe)
      then coalesce(_actual_finish, agg.af_) - coalesce(_plan_end, agg.pe)
    when _act < 1 and coalesce(_plan_end, agg.pe) is not null and _as_of > coalesce(_plan_end, agg.pe)
      then _as_of - coalesce(_plan_end, agg.pe)
    else 0 end;

  worst_main := _judg;
  if not agg.all_finished and worst_main = '완료' then
    worst_main := coalesce(worst_sub, '정상');
  end if;

  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where x.r = coalesce(worst_sub, '정상') or x.r = coalesce(worst_main, '정상')
  order by idx limit 1;

  update public.task_management_raw
     set actual_progress = coalesce(agg.ap, actual_progress),
         plan_progress   = coalesce(agg.pp, plan_progress),
         plan_start      = coalesce(plan_start, agg.ps),
         plan_end        = coalesce(plan_end, agg.pe),
         plan_days       = coalesce(plan_days, agg.pd::int),
         actual_start    = coalesce(actual_start, agg.as_),
         actual_finish   = case when agg.all_finished then coalesce(actual_finish, agg.af_) else actual_finish end,
         actual_duration = _ad,
         forecast_end    = coalesce(forecast_end, agg.fe),
         slip_days       = coalesce(slip_days, agg.sd),
         auto_judgment   = coalesce(worst, auto_judgment),
         cum_plan_pct    = _tplan,
         cum_actual_pct  = _act,
         gap_pct         = _gap,
         delay_days      = _delay,
         alarm_reason    = case when _gap is null then '계획정보 부족' else 'Gap ' || round(_gap*100, 1) || '%' end,
         updated_at      = now()
   where discipline = _discipline and task_no = _parent_task_no and level = 'main';
end;
$function$;
