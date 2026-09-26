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
    FROM public.tm_rows_as_of_notc(p_as_of) r
  ) t;
$function$;