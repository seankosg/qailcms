
CREATE OR REPLACE FUNCTION public.tm_items_counts_by_team(
  _q                 text     DEFAULT NULL,
  _filters           jsonb    DEFAULT '[]'::jsonb,
  _include_inactive  boolean  DEFAULT FALSE,
  _task_scope        text     DEFAULT 'all',
  _as_of             date     DEFAULT NULL,
  _caution_buffer    numeric  DEFAULT 0.05,
  _worsen_gap        numeric  DEFAULT -0.15
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_asof date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  r jsonb;
BEGIN
  SELECT ARRAY(
    SELECT (elem::text)::uuid
    FROM jsonb_array_elements_text(
      COALESCE(
        (SELECT public.tm_items_search_ids(_q, _filters, _include_inactive, 200000, NULL, NULL, NULL)),
        '[]'::jsonb
      )
    ) elem
  ) INTO v_ids;

  WITH scoped AS (
    SELECT t.*
    FROM public.v_task_management_raw_derived t
    WHERE t.id = ANY(v_ids)
      AND (
        _task_scope = 'all'
        OR (_task_scope = 'main' AND LOWER(COALESCE(t.level::text,'')) = 'main')
        OR (_task_scope = 'sub'  AND LOWER(COALESCE(t.level::text,'')) = 'sub')
      )
  ),
  judged AS (
    SELECT
      NULLIF(TRIM(COALESCE(s.team,'')), '') AS team_key,
      (COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL) AS is_completed,
      (s.actual_start IS NOT NULL)                                        AS is_started,
      (s.plan_start IS NOT NULL AND s.plan_start <= v_asof)               AS is_planned_started,
      (s.plan_end   IS NOT NULL AND s.plan_end   <  v_asof)               AS is_plan_end_past,
      public.tm_kpi_judgment(
        s.actual_progress, s.actual_finish, s.actual_start,
        s.plan_start, s.plan_end, s.plan_days, s.plan_progress,
        v_asof, _caution_buffer, _worsen_gap
      ) AS judgment
    FROM scoped s
  ),
  per_team AS (
    SELECT
      team_key,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화'))                       AS in_delay,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')
                          AND is_planned_started AND NOT is_started)                                AS start_delayed,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화') AND is_plan_end_past) AS completion_overdue,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment = '악화')                                AS critical_delay,
      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화'))                       AS behind_schedule
    FROM judged
    GROUP BY team_key
  ),
  as_json AS (
    SELECT
      jsonb_build_object(
        'in_delay',            COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', in_delay)
                                        ORDER BY in_delay DESC NULLS LAST, team_key)
                                        FILTER (WHERE in_delay > 0), '[]'::jsonb),
        'start_delayed',       COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', start_delayed)
                                        ORDER BY start_delayed DESC NULLS LAST, team_key)
                                        FILTER (WHERE start_delayed > 0), '[]'::jsonb),
        'completion_overdue',  COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', completion_overdue)
                                        ORDER BY completion_overdue DESC NULLS LAST, team_key)
                                        FILTER (WHERE completion_overdue > 0), '[]'::jsonb),
        'critical_delay',      COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', critical_delay)
                                        ORDER BY critical_delay DESC NULLS LAST, team_key)
                                        FILTER (WHERE critical_delay > 0), '[]'::jsonb),
        'behind_schedule',     COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'),'isNull', team_key IS NULL,'count', behind_schedule)
                                        ORDER BY behind_schedule DESC NULLS LAST, team_key)
                                        FILTER (WHERE behind_schedule > 0), '[]'::jsonb)
      ) AS payload
    FROM per_team
  )
  SELECT payload INTO r FROM as_json;

  RETURN COALESCE(r, jsonb_build_object(
    'in_delay','[]'::jsonb,'start_delayed','[]'::jsonb,
    'completion_overdue','[]'::jsonb,'critical_delay','[]'::jsonb,'behind_schedule','[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.tm_items_counts_by_team(text, jsonb, boolean, text, date, numeric, numeric)
  TO authenticated, service_role, anon;
