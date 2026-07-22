DROP FUNCTION IF EXISTS public.defect_snag_dashboard_matrix(text[], text[]);

CREATE OR REPLACE FUNCTION public.defect_snag_dashboard_matrix(
  _plan_groups text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL,
  _as_of_date date DEFAULT NULL
)
RETURNS TABLE(
  plan_group text,
  building text,
  level_name text,
  room_group text,
  status_raw text,
  cnt bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    plan_group::text,
    building::text,
    level_name::text,
    room_group::text,
    status_raw::text,
    count(*)::bigint AS cnt
  FROM public.defect_items_raw
  WHERE is_active = true
    AND (_plan_groups IS NULL OR plan_group = ANY(_plan_groups))
    AND (_teams IS NULL OR team = ANY(_teams))
    AND (_as_of_date IS NULL OR data_date IS NULL OR data_date <= _as_of_date)
  GROUP BY 1,2,3,4,5
$$;

GRANT EXECUTE ON FUNCTION public.defect_snag_dashboard_matrix(text[], text[], date) TO authenticated, service_role;