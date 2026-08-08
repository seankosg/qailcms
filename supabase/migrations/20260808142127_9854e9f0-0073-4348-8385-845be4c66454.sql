CREATE OR REPLACE FUNCTION public.tm_worktype_incomplete_counts(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _as_of date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_as_of date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  r jsonb;
BEGIN
  SELECT ARRAY(
    SELECT (elem::text)::uuid
    FROM jsonb_array_elements_text(
      COALESCE((SELECT public.tm_items_search_ids(_q, _filters, _include_inactive, 200000, NULL, NULL, NULL)), '[]'::jsonb)
    ) elem
  ) INTO v_ids;

  WITH scoped AS (
    SELECT v.*
    FROM public.v_task_management_raw_derived v
    WHERE v.id = ANY(v_ids)
      AND LOWER(COALESCE(v.level::text,'')) = 'sub'
      AND COALESCE(v.actual_progress, 0) < 1
  ),
  base AS (
    SELECT
      NULLIF(TRIM(COALESCE(s.row_type,'')), '') AS wt,
      NULLIF(TRIM(COALESCE(s.team,'')), '') AS team_key,
      COALESCE(public.tm_row_gap(s.level::text, s.discipline, s.task_no, s.plan_start, s.plan_end, s.plan_days, s.actual_progress, v_as_of), 0) < 0 AS delayed
    FROM scoped s
  ),
  per_team AS (
    SELECT wt, team_key, COUNT(*) AS c, COUNT(*) FILTER (WHERE delayed) AS d
    FROM base GROUP BY wt, team_key
  ),
  per_wt AS (
    SELECT
      wt,
      SUM(c) AS c,
      SUM(d) AS d,
      COALESCE(jsonb_agg(jsonb_build_object(
        'team', COALESCE(team_key,'미지정'),
        'isNull', team_key IS NULL,
        'count', c,
        'delayed', d
      ) ORDER BY c DESC, team_key) FILTER (WHERE c > 0), '[]'::jsonb) AS by_team
    FROM per_team GROUP BY wt
  )
  SELECT jsonb_build_object(
    'as_of', v_as_of,
    'total', COALESCE((SELECT SUM(c) FROM per_wt), 0),
    'delayed_total', COALESCE((SELECT SUM(d) FROM per_wt), 0),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'work_type', COALESCE(wt,'미지정'),
        'isNull', wt IS NULL,
        'count', c,
        'delayed', d,
        'by_team', by_team
      ) ORDER BY c DESC, wt)
      FROM per_wt
    ), '[]'::jsonb)
  ) INTO r;

  RETURN COALESCE(r, '{}'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_worktype_incomplete_counts(text, jsonb, boolean, date) TO authenticated;