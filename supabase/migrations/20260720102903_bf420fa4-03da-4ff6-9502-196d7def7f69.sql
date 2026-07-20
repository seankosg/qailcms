
CREATE OR REPLACE FUNCTION public.dmr_facets(
  _column text,
  _filters jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_cols text[] := ARRAY[
    'report_date','discipline','system_name','contractor_name','plot','direct_flag'
  ];
BEGIN
  IF NOT (_column = ANY(allowed_cols)) THEN
    RAISE EXCEPTION 'invalid column: %', _column;
  END IF;

  IF _column = 'direct_flag' THEN
    RETURN QUERY
    SELECT
      CASE WHEN cm.is_direct IS TRUE THEN 'direct'
           WHEN cm.is_direct IS FALSE THEN 'sub'
           ELSE 'unknown' END::text AS value,
      COUNT(*)::bigint AS cnt
    FROM public.dmr_entries e
    LEFT JOIN public.dmr_contractor_master cm ON cm.name = e.contractor_name
    GROUP BY 1
    ORDER BY 2 DESC;
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT COALESCE(%I::text, ''(empty)'') AS value, COUNT(*)::bigint AS cnt
     FROM public.dmr_entries
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 500',
    _column
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dmr_facets(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dmr_facets(text, jsonb) TO authenticated, service_role;

-- Useful composite indexes for common filter/sort combos
CREATE INDEX IF NOT EXISTS idx_dmr_entries_date_disc ON public.dmr_entries(report_date DESC, discipline);
CREATE INDEX IF NOT EXISTS idx_dmr_entries_system ON public.dmr_entries(system_name);
CREATE INDEX IF NOT EXISTS idx_dmr_entries_contractor ON public.dmr_entries(contractor_name);
CREATE INDEX IF NOT EXISTS idx_dmr_entries_plot ON public.dmr_entries(plot);
