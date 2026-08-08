CREATE OR REPLACE FUNCTION public.tm_items_kpi_bundle(
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _task_scope text DEFAULT 'all'::text,
  _as_of date DEFAULT NULL::date,
  _caution_buffer numeric DEFAULT NULL::numeric,
  _worsen_gap numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
      NULLIF(TRIM(COALESCE(s.team,'')), '') AS team_key,
      (s.actual_finish IS NOT NULL) AS is_completed,
      (s.actual_start IS NOT NULL) AS is_started,
      (s.plan_start IS NOT NULL AND s.plan_start <= v_asof) AS is_planned_started,
      (s.plan_end IS NOT NULL AND s.plan_end < v_asof) AS is_plan_end_past,
      public.tm_kpi_judgment_g(s.actual_progress, s.actual_finish, s.actual_start,
        s.plan_start, v_asof, s.gap_pct, _caution_buffer, _worsen_gap) AS judgment,
      (s.alarm_reason IS NOT DISTINCT FROM '이력 없음') AS no_hist,
      (s.plan_start IS NULL) AS no_plan_start,
      (s.plan_end IS NULL) AS no_plan_end
    FROM scoped s
  ),
  counts AS (
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
    ) AS payload
    FROM judged
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
  by_team AS (
    SELECT jsonb_build_object(
      'in_delay', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', in_delay) ORDER BY in_delay DESC NULLS LAST, team_key) FILTER (WHERE in_delay > 0), '[]'::jsonb),
      'start_delayed', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', start_delayed) ORDER BY start_delayed DESC NULLS LAST, team_key) FILTER (WHERE start_delayed > 0), '[]'::jsonb),
      'completion_overdue', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', completion_overdue) ORDER BY completion_overdue DESC NULLS LAST, team_key) FILTER (WHERE completion_overdue > 0), '[]'::jsonb),
      'critical_delay', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', critical_delay) ORDER BY critical_delay DESC NULLS LAST, team_key) FILTER (WHERE critical_delay > 0), '[]'::jsonb),
      'behind_schedule', COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', behind_schedule) ORDER BY behind_schedule DESC NULLS LAST, team_key) FILTER (WHERE behind_schedule > 0), '[]'::jsonb)
    ) AS payload
    FROM per_team
  )
  SELECT jsonb_build_object(
    'counts', COALESCE((SELECT payload FROM counts), jsonb_build_object('total', 0)),
    'by_team', COALESCE((SELECT payload FROM by_team), jsonb_build_object('in_delay','[]'::jsonb,'start_delayed','[]'::jsonb,'completion_overdue','[]'::jsonb,'critical_delay','[]'::jsonb,'behind_schedule','[]'::jsonb))
  ) INTO r;

  RETURN r;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_items_kpi_bundle(text, jsonb, boolean, text, date, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tm_items_kpi_bundle(text, jsonb, boolean, text, date, numeric, numeric) TO service_role;