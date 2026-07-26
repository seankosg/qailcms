CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(_plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL)
RETURNS TABLE(bucket text, team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH base AS (
    SELECT team, delay_bucket, needs_planning
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND latest_status_norm IS DISTINCT FROM 'A'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), unn AS (
    SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS raw FROM base
  ), filtered AS (
    SELECT team,
      CASE raw
        WHEN 'RS' THEN 'RS_DELAY'
        WHEN 'SB' THEN 'SB_DELAY'
        WHEN 'DS' THEN 'DS_DELAY'
        WHEN 'NoPlan' THEN 'NO_PLAN'
      END AS b
    FROM unn
    WHERE raw IN ('RS','SB','DS','NoPlan')
  )
  SELECT b, NULL::text, count(*) FROM filtered GROUP BY b
  UNION ALL
  SELECT 'TOTAL_DELAY', NULL, count(*) FROM filtered
  UNION ALL
  SELECT b, team, count(*) FROM filtered GROUP BY b, team;
$$;