
-- P1-2: 뷰의 stage_start/stage_finish 에서 data_date 폴백 제거 (도하 오늘 기준)
CREATE OR REPLACE VIEW public.v_task_management_raw_derived AS
 WITH cfg AS (
         SELECT tm_milestone_config.plot, tm_milestone_config.kind, tm_milestone_config.target_date
           FROM tm_milestone_config
        ), bd AS (
         SELECT COALESCE(( SELECT tm_alarm_settings.value_int FROM tm_alarm_settings
                  WHERE tm_alarm_settings.key = 'warning_buffer_days'::text), 7) AS buffer_days
        )
 SELECT t.id, t.task_no, t.main_task_no, t.level, t.discipline, t.category, t.plot, t.task_name,
    t.risk, t.sub_task_desc, t.row_type, t.status_manual, t.plan_start, t.plan_end, t.plan_days,
    t.actual_start, t.actual_progress, t.plan_progress, t.progress_variance, t.forecast_end, t.slip_days,
    t.auto_judgment, t.data_date, t.sort_order, t.source_file, t.imported_at, t.imported_by,
    t.created_at, t.updated_at, t.auto_judgment_import, t.is_rollup, t.source_import_log_id, t.is_active,
    t.team, t.location, t.floor_level, t.actual_finish, t.actual_duration, t.owner_user_id,
    t.hdec_pic_name, t.hdec_eng_name, t.cum_plan_pct, t.cum_actual_pct, t.gap_pct, t.delay_days,
    t.alarm_reason, t.milestone, c.target_date AS milestone_date,
        CASE WHEN COALESCE(t.actual_progress, 0::numeric) >= 1::numeric OR t.actual_finish IS NOT NULL THEN NULL::text
             ELSE tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days) END AS plan_overdue,
    tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
        CASE WHEN COALESCE(t.actual_progress, 0::numeric) >= 1::numeric OR t.actual_finish IS NOT NULL THEN NULL::text
             ELSE tm_classify_overdue(tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date), c.target_date, bd.buffer_days) END AS actual_overdue,
        CASE
            WHEN t.actual_start IS NOT NULL AND t.plan_start IS NOT NULL AND t.actual_start > t.plan_start THEN 'completed_late'::text
            WHEN t.actual_start IS NOT NULL THEN 'completed'::text
            WHEN t.plan_start IS NULL THEN 'empty'::text
            WHEN t.plan_start <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar'::text)::date THEN 'delay'::text
            ELSE 'plan'::text
        END AS stage_start,
        CASE
            WHEN t.actual_finish IS NOT NULL AND t.plan_end IS NOT NULL AND t.actual_finish > t.plan_end THEN 'completed_late'::text
            WHEN t.actual_finish IS NOT NULL THEN 'completed'::text
            WHEN t.plan_end IS NOT NULL AND t.plan_end <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar'::text)::date THEN 'delay'::text
            WHEN t.actual_start IS NOT NULL AND (t.plan_end IS NULL OR t.plan_end > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qatar'::text)::date) THEN 'wip'::text
            WHEN t.plan_end IS NULL THEN 'empty'::text
            ELSE 'plan'::text
        END AS stage_finish,
        CASE
            WHEN t.plan_days IS NOT NULL AND t.plan_days > 0 THEN 1.0 / t.plan_days::numeric
            WHEN t.plan_start IS NOT NULL AND t.plan_end IS NOT NULL AND t.plan_end >= t.plan_start THEN 1.0 / GREATEST(1, t.plan_end - t.plan_start + 1)::numeric
            ELSE NULL::numeric
        END AS expected_progress_today
   FROM task_management_raw t
     CROSS JOIN bd
     LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone;

-- P1-1: tm_rows_as_of 의 past 분기 전면 제거. 실적은 원본, 기준일은 계획/판정에만 작용.
-- ★status_history 를 참조하지 말 것. 감사 로그 전용.
CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
 RETURNS SETOF v_task_management_raw_derived
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  calc AS (
    SELECT v.*, p.asof,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof) AS tplan
    FROM public.v_task_management_raw_derived v CROSS JOIN p
  )
  SELECT
    c.id, c.task_no, c.main_task_no, c.level, c.discipline, c.category, c.plot, c.task_name,
    c.risk, c.sub_task_desc, c.row_type, c.status_manual, c.plan_start, c.plan_end, c.plan_days,
    c.actual_start, c.actual_progress,
    c.plan_progress, c.progress_variance, c.forecast_end, c.slip_days,
    public.tm_kpi_judgment_g(
      public.tm_kpi_norm_actual(c.actual_progress),
      c.actual_finish,
      c.actual_start,
      c.plan_start, c.asof,
      CASE WHEN c.tplan IS NULL THEN NULL ELSE public.tm_kpi_norm_actual(c.actual_progress) - c.tplan END,
      NULL, NULL) AS auto_judgment,
    c.data_date, c.sort_order, c.source_file, c.imported_at, c.imported_by, c.created_at, c.updated_at,
    c.auto_judgment_import, c.is_rollup, c.source_import_log_id, c.is_active, c.team, c.location, c.floor_level,
    c.actual_finish,
    c.actual_duration, c.owner_user_id, c.hdec_pic_name, c.hdec_eng_name,
    c.tplan AS cum_plan_pct,
    public.tm_kpi_norm_actual(c.actual_progress) AS cum_actual_pct,
    CASE WHEN c.tplan IS NULL THEN NULL ELSE public.tm_kpi_norm_actual(c.actual_progress) - c.tplan END AS gap_pct,
    c.delay_days,
    c.alarm_reason,
    c.milestone, c.milestone_date, c.plan_overdue, c.expected_finish, c.actual_overdue,
    -- P1-2: 기준일 기반 stage 재계산
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
    c.expected_progress_today
  FROM calc c;
$function$;
