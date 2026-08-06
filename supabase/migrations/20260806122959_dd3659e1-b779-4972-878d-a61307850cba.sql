CREATE OR REPLACE FUNCTION public.tm_milestone_overdue_counts(
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false,
  _task_scope text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
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
      AND (_task_scope = 'all'
        OR (_task_scope = 'main' AND LOWER(COALESCE(v.level::text,'')) = 'main')
        OR (_task_scope = 'sub'  AND LOWER(COALESCE(v.level::text,'')) = 'sub'))
  ),
  base AS (
    SELECT
      NULLIF(TRIM(COALESCE(s.team,'')), '') AS team_key,
      UPPER(COALESCE(NULLIF(TRIM(s.plan_overdue),''), 'NONE')) AS p,
      UPPER(COALESCE(NULLIF(TRIM(s.actual_overdue),''), 'NONE')) AS a
    FROM scoped s
  ),
  totals AS (
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM base),
      'plan', jsonb_build_object(
        'WARNING', COUNT(*) FILTER (WHERE p='WARNING'),
        'RISK',    COUNT(*) FILTER (WHERE p='RISK'),
        'SAFE',    COUNT(*) FILTER (WHERE p='SAFE'),
        'PASS',    COUNT(*) FILTER (WHERE p='PASS'),
        'NONE',    COUNT(*) FILTER (WHERE p='NONE')
      ),
      'actual', jsonb_build_object(
        'WARNING', COUNT(*) FILTER (WHERE a='WARNING'),
        'RISK',    COUNT(*) FILTER (WHERE a='RISK'),
        'SAFE',    COUNT(*) FILTER (WHERE a='SAFE'),
        'PASS',    COUNT(*) FILTER (WHERE a='PASS'),
        'NONE',    COUNT(*) FILTER (WHERE a='NONE')
      )
    ) AS payload
    FROM base
  ),
  plan_team AS (
    SELECT jsonb_object_agg(k, arr) AS payload FROM (
      SELECT k, COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'), 'isNull', team_key IS NULL, 'count', c) ORDER BY c DESC, team_key) FILTER (WHERE c > 0), '[]'::jsonb) AS arr
      FROM (
        SELECT p AS k, team_key, COUNT(*) AS c FROM base GROUP BY p, team_key
      ) t GROUP BY k
    ) z
  ),
  actual_team AS (
    SELECT jsonb_object_agg(k, arr) AS payload FROM (
      SELECT k, COALESCE(jsonb_agg(jsonb_build_object('team', COALESCE(team_key,'미지정'), 'isNull', team_key IS NULL, 'count', c) ORDER BY c DESC, team_key) FILTER (WHERE c > 0), '[]'::jsonb) AS arr
      FROM (
        SELECT a AS k, team_key, COUNT(*) AS c FROM base GROUP BY a, team_key
      ) t GROUP BY k
    ) z
  )
  SELECT (SELECT payload FROM totals)
    || jsonb_build_object(
         'plan_by_team', COALESCE((SELECT payload FROM plan_team), '{}'::jsonb),
         'actual_by_team', COALESCE((SELECT payload FROM actual_team), '{}'::jsonb)
       )
  INTO r;

  RETURN COALESCE(r, '{}'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_milestone_overdue_counts(text, jsonb, boolean, text) TO authenticated, service_role;