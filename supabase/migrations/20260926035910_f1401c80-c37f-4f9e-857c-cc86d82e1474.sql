-- 1) 정본 tm_rows_as_of_notc 내부 최적화 (결과 동일 검증 완료: 2,269행 불일치 0)
CREATE OR REPLACE FUNCTION public.tm_rows_as_of_notc(_as_of date)
 RETURNS TABLE(id uuid, task_no text, main_task_no text, level text, discipline text, category text, plot text, task_name text, risk text, sub_task_desc text, row_type text, status_manual text, plan_start date, plan_end date, plan_days integer, actual_start date, actual_progress numeric, plan_progress numeric, progress_variance numeric, forecast_end date, slip_days integer, auto_judgment text, data_date date, sort_order integer, source_file text, imported_at timestamp with time zone, imported_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, auto_judgment_import text, is_rollup boolean, source_import_log_id uuid, is_active boolean, team text, location text, floor_level text, actual_finish date, actual_duration integer, owner_user_id uuid, hdec_pic_name text, hdec_eng_name text, cum_plan_pct numeric, cum_actual_pct numeric, gap_pct numeric, delay_days integer, alarm_reason text, milestone text, milestone_date date, plan_overdue text, expected_finish date, actual_overdue text, stage_start text, stage_finish text, expected_progress_today numeric, effective_pic text, original_pic text, delegated_from text, is_delegated boolean)
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
  -- main 과업의 가중 계획을 행별 함수 호출 대신 한 번에 집계 (tm_main_tplan 과 동일 산식)
  main_tp AS (
    SELECT z.discipline, z.main_task_no,
           CASE WHEN COALESCE(SUM(z.w), 0) = 0 THEN NULL
                ELSE GREATEST(0::numeric, LEAST(1::numeric, SUM(z.w * z.tp) / SUM(z.w))) END AS tplan
    FROM (
      SELECT s.discipline, s.main_task_no,
             GREATEST(COALESCE(s.plan_end - s.plan_start, 0) + 1, 1)::numeric AS w,
             COALESCE(public.tm_kpi_tplan(s.plan_start, s.plan_end, s.plan_days, p.asof), 0) AS tp
      FROM public.task_management_raw s
      CROSS JOIN p
      WHERE s.level = 'sub' AND s.main_task_no IS NOT NULL
    ) z
    GROUP BY z.discipline, z.main_task_no
  ),
  calc AS MATERIALIZED (
    SELECT v.*, p.asof, th.caution, th.worsen,
      dg.to_pic AS deleg_to, dg.from_pic AS deleg_from,
      COALESCE(
        CASE WHEN LOWER(COALESCE(v.level, '')) = 'main' THEN m.tplan END,
        public.tm_kpi_tplan(v.plan_start, v.plan_end, v.plan_days, p.asof)
      ) AS tplan,
      public.tm_kpi_norm_actual(v.actual_progress) AS act_n
    FROM public.v_task_management_raw_derived v
    CROSS JOIN p CROSS JOIN th
    LEFT JOIN main_tp m ON m.discipline = v.discipline AND m.main_task_no = v.task_no
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
      c.act_n, c.actual_finish, c.actual_start, c.plan_start, c.asof,
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

-- 2) 프로젝트 대시보드 전용 경량 조회 — 정본 tm_rows_as_of 결과에서 필요한 열만 투영 (집계식 신설 없음)
CREATE OR REPLACE FUNCTION public.tm_dashboard_items_json(p_as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(t ORDER BY t.sort_order), '[]'::jsonb)
  FROM (
    SELECT r.id, r.task_no, r.main_task_no, r.level, r.discipline, r.plot, r.team,
           r.row_type, r.hdec_pic_name, r.hdec_eng_name, r.effective_pic,
           r.plan_start, r.plan_end, r.plan_days,
           r.actual_start, r.actual_finish, r.actual_progress,
           r.auto_judgment, r.cum_plan_pct, r.cum_actual_pct, r.gap_pct,
           r.data_date, r.sort_order
    FROM public.tm_rows_as_of(p_as_of) r
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_dashboard_items_json(date) TO authenticated;