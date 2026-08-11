DROP FUNCTION IF EXISTS public.tm_rows_as_of(date);

CREATE FUNCTION public.tm_rows_as_of(_as_of date)
RETURNS TABLE(
  id uuid, task_no text, main_task_no text, level text, discipline text, category text, plot text,
  task_name text, risk text, sub_task_desc text, row_type text, status_manual text,
  plan_start date, plan_end date, plan_days integer, actual_start date, actual_progress numeric,
  plan_progress numeric, progress_variance numeric, forecast_end date, slip_days integer,
  auto_judgment text, data_date date, sort_order integer, source_file text,
  imported_at timestamptz, imported_by uuid, created_at timestamptz, updated_at timestamptz,
  auto_judgment_import text, is_rollup boolean, source_import_log_id uuid, is_active boolean,
  team text, location text, floor_level text, actual_finish date, actual_duration integer,
  owner_user_id uuid, hdec_pic_name text, hdec_eng_name text,
  cum_plan_pct numeric, cum_actual_pct numeric, gap_pct numeric, delay_days integer,
  alarm_reason text, milestone text, milestone_date date, plan_overdue text, expected_finish date,
  actual_overdue text, stage_start text, stage_finish text, expected_progress_today numeric,
  effective_pic text, original_pic text, delegated_from text, is_delegated boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  th AS (
    SELECT public.tm_resolve_caution(NULL) AS caution, public.tm_resolve_worsen(NULL) AS worsen
  ),
  calc AS MATERIALIZED (
    SELECT v.*, p.asof, th.caution, th.worsen,
      dg.to_pic AS deleg_to, dg.from_pic AS deleg_from,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof) AS tplan,
      public.tm_kpi_norm_actual(v.actual_progress) AS act_n
    FROM public.v_task_management_raw_derived v
    CROSS JOIN p CROSS JOIN th
    LEFT JOIN LATERAL (
      SELECT d.to_pic, d.from_pic
        FROM public.tm_pic_delegations d
       WHERE d.task_raw_id = v.id
         AND d.status = 'active'
         AND p.asof BETWEEN d.start_date AND d.end_date
       ORDER BY d.created_at DESC
       LIMIT 1
    ) dg ON true
  )
  SELECT
    c.id, c.task_no, c.main_task_no, c.level, c.discipline, c.category, c.plot, c.task_name,
    c.risk, c.sub_task_desc, c.row_type, c.status_manual, c.plan_start, c.plan_end, c.plan_days,
    c.actual_start, c.actual_progress,
    c.plan_progress, c.progress_variance, c.forecast_end, c.slip_days,
    public.tm_kpi_judgment_g(
      c.act_n,
      c.actual_finish,
      c.actual_start,
      c.plan_start, c.asof,
      CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END,
      c.caution, c.worsen) AS auto_judgment,
    c.data_date, c.sort_order, c.source_file, c.imported_at, c.imported_by, c.created_at, c.updated_at,
    c.auto_judgment_import, c.is_rollup, c.source_import_log_id, c.is_active, c.team, c.location, c.floor_level,
    c.actual_finish,
    c.actual_duration, c.owner_user_id, c.hdec_pic_name, c.hdec_eng_name,
    c.tplan AS cum_plan_pct,
    c.act_n AS cum_actual_pct,
    CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END AS gap_pct,
    c.delay_days,
    c.alarm_reason,
    c.milestone, c.milestone_date, c.plan_overdue, c.expected_finish, c.actual_overdue,
    CASE
      WHEN c.actual_start IS NOT NULL AND c.plan_start IS NOT NULL AND c.actual_start > c.plan_start THEN 'completed_late'
      WHEN c.actual_start IS NOT NULL THEN 'completed'
      WHEN c.plan_start IS NULL THEN 'empty'
      WHEN c.plan_start <= c.asof THEN 'delay'
      ELSE 'plan' END AS stage_start,
    CASE
      WHEN c.actual_finish IS NOT NULL AND c.plan_end IS NOT NULL AND c.actual_finish > c.plan_end THEN 'completed_late'
      WHEN c.actual_finish IS NOT NULL THEN 'completed'
      WHEN c.plan_end IS NOT NULL AND c.plan_end <= c.asof THEN 'delay'
      WHEN c.actual_start IS NOT NULL AND (c.plan_end IS NULL OR c.plan_end > c.asof) THEN 'wip'
      WHEN c.plan_end IS NULL THEN 'empty'
      ELSE 'plan' END AS stage_finish,
    c.expected_progress_today,
    COALESCE(c.deleg_to, c.hdec_pic_name) AS effective_pic,
    c.hdec_pic_name AS original_pic,
    c.deleg_from AS delegated_from,
    (c.deleg_to IS NOT NULL) AS is_delegated
  FROM calc c;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_rows_as_of(date) TO authenticated, anon, service_role;

-- 검색/필터/정렬 허용 컬럼에 유효 PIC 계열 추가 (기존 정의를 문자열 치환해 재생성)
DO $do$
DECLARE r record; def text; newdef text;
BEGIN
  FOR r IN
    SELECT oid, proname FROM pg_proc
     WHERE proname IN ('tm_items_search','tm_items_search_ids','tm_items_facets')
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := replace(def,
      $$'hdec_pic_name','hdec_eng_name'$$,
      $$'hdec_pic_name','hdec_eng_name','effective_pic','original_pic','is_delegated'$$);
    IF newdef = def THEN
      RAISE EXCEPTION '허용 컬럼 치환 실패: %', r.proname;
    END IF;
    EXECUTE newdef;
  END LOOP;
END $do$;

-- MWS: 담당자 모드는 유효 PIC 기준. 목록에는 내가 위임한 업무도 보이되 집계에서는 제외.
CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(_mode text, _filter_value text, _today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE t.level = 'sub'
      AND CASE WHEN _mode = 'pic' THEN t.effective_pic = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT public.tm_kpi_norm_actual(b.actual_progress) AS act,
      b.actual_start, b.actual_finish, b.plan_start, b.plan_end,
      (b.auto_judgment = '완료') AS is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS is_started_raw,
      b.auto_judgment AS jd
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
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE t.level = 'sub'
      AND CASE WHEN _mode = 'pic'
                 THEN t.effective_pic = _filter_value
                   OR (t.is_delegated AND t.original_pic = _filter_value)
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  computed AS (
    SELECT b.*,
      (b.auto_judgment = '완료') AS _is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS _is_started_raw,
      b.auto_judgment AS _jd
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
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days, f.created_at,
      f.cum_plan_pct, f.cum_actual_pct, f.gap_pct, f.delay_days, f.team,
      f.effective_pic, f.original_pic, f.delegated_from, f.is_delegated
    FROM filtered f ORDER BY f.task_no NULLS LAST LIMIT _limit OFFSET _offset
  ) sub;
$function$;