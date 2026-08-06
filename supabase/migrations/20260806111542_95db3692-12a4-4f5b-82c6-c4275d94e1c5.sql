CREATE OR REPLACE FUNCTION public.tm_classify_overdue(target date, mstone date, buffer_days integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN target IS NULL OR mstone IS NULL THEN NULL
    WHEN target <= mstone - buffer_days THEN 'SAFE'
    WHEN target <= mstone THEN 'RISK'
    ELSE 'WARNING'
  END
$$;

CREATE OR REPLACE VIEW public.v_task_management_raw_derived AS
 WITH cfg AS (
         SELECT tm_milestone_config.plot,
            tm_milestone_config.kind,
            tm_milestone_config.target_date
           FROM tm_milestone_config
        ), bd AS (
         SELECT COALESCE(( SELECT tm_alarm_settings.value_int
                   FROM tm_alarm_settings
                  WHERE tm_alarm_settings.key = 'warning_buffer_days'::text), 7) AS buffer_days
        ), sub_roll AS (
         SELECT s.main_task_no,
            max(
                CASE s.po
                    WHEN 'WARNING'::text THEN 3
                    WHEN 'RISK'::text THEN 2
                    WHEN 'SAFE'::text THEN 1
                    WHEN 'PASS'::text THEN 0
                    ELSE NULL::integer
                END) AS po_rank,
            max(
                CASE s.ao
                    WHEN 'WARNING'::text THEN 3
                    WHEN 'RISK'::text THEN 2
                    WHEN 'SAFE'::text THEN 1
                    WHEN 'PASS'::text THEN 0
                    ELSE NULL::integer
                END) AS ao_rank
           FROM ( SELECT r.main_task_no,
                        CASE
                            WHEN r.actual_finish IS NOT NULL OR COALESCE(r.actual_progress, 0::numeric) >= 1::numeric THEN 'PASS'::text
                            ELSE tm_classify_overdue(r.plan_end, c2.target_date, b.buffer_days)
                        END AS po,
                        CASE
                            WHEN r.actual_finish IS NOT NULL OR COALESCE(r.actual_progress, 0::numeric) >= 1::numeric THEN 'PASS'::text
                            ELSE tm_classify_overdue(COALESCE(r.actual_finish, tm_expected_finish(r.actual_start, r.actual_finish, r.actual_progress, r.data_date)), c2.target_date, b.buffer_days)
                        END AS ao
                   FROM task_management_raw r
                     CROSS JOIN bd b
                     LEFT JOIN cfg c2 ON c2.plot = r.plot AND c2.kind = r.milestone
                  WHERE r.level = 'sub'::text AND r.is_active AND r.main_task_no IS NOT NULL) s
          GROUP BY s.main_task_no
        )
 SELECT t.id,
    t.task_no,
    t.main_task_no,
    t.level,
    t.discipline,
    t.category,
    t.plot,
    t.task_name,
    t.risk,
    t.sub_task_desc,
    t.row_type,
    t.status_manual,
    t.plan_start,
    t.plan_end,
    t.plan_days,
    t.actual_start,
    t.actual_progress,
    t.plan_progress,
    t.progress_variance,
    t.forecast_end,
    t.slip_days,
    t.auto_judgment,
    t.data_date,
    t.sort_order,
    t.source_file,
    t.imported_at,
    t.imported_by,
    t.created_at,
    t.updated_at,
    t.auto_judgment_import,
    t.is_rollup,
    t.source_import_log_id,
    t.is_active,
    t.team,
    t.location,
    t.floor_level,
    t.actual_finish,
    t.actual_duration,
    t.owner_user_id,
    t.hdec_pic_name,
    t.hdec_eng_name,
    t.cum_plan_pct,
    t.cum_actual_pct,
    t.gap_pct,
    t.delay_days,
    t.alarm_reason,
    t.milestone,
    c.target_date AS milestone_date,
        CASE
            WHEN t.level = 'main'::text AND sr.main_task_no IS NOT NULL THEN
            CASE sr.po_rank
                WHEN 3 THEN 'WARNING'::text
                WHEN 2 THEN 'RISK'::text
                WHEN 1 THEN 'SAFE'::text
                WHEN 0 THEN 'PASS'::text
                ELSE NULL::text
            END
            WHEN t.actual_finish IS NOT NULL OR COALESCE(t.actual_progress, 0::numeric) >= 1::numeric THEN 'PASS'::text
            ELSE tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days)
        END AS plan_overdue,
    tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
        CASE
            WHEN t.level = 'main'::text AND sr.main_task_no IS NOT NULL THEN
            CASE sr.ao_rank
                WHEN 3 THEN 'WARNING'::text
                WHEN 2 THEN 'RISK'::text
                WHEN 1 THEN 'SAFE'::text
                WHEN 0 THEN 'PASS'::text
                ELSE NULL::text
            END
            WHEN t.actual_finish IS NOT NULL OR COALESCE(t.actual_progress, 0::numeric) >= 1::numeric THEN 'PASS'::text
            ELSE tm_classify_overdue(COALESCE(t.actual_finish, tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date)), c.target_date, bd.buffer_days)
        END AS actual_overdue,
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
     LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone
     LEFT JOIN sub_roll sr ON t.level = 'main'::text AND sr.main_task_no = t.task_no;