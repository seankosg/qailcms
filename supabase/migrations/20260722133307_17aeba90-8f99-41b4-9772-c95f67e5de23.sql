CREATE OR REPLACE FUNCTION public.defect_data_dates()
RETURNS TABLE(d date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT data_date::date AS d
  FROM public.defect_items_raw
  WHERE is_active = true AND data_date IS NOT NULL
  ORDER BY d DESC
$$;
GRANT EXECUTE ON FUNCTION public.defect_data_dates() TO authenticated, anon;