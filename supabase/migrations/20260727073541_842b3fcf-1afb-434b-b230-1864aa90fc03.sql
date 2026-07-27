CREATE OR REPLACE FUNCTION public.tm_edit_record_daily(p_from date, p_to date)
RETURNS TABLE(user_id uuid, date_key date, edits_count integer, tasks_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    h.changed_by AS user_id,
    ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) AS date_key,
    COUNT(*)::int AS edits_count,
    COUNT(DISTINCT (h.discipline || '|' || h.task_no))::int AS tasks_count
  FROM public.task_management_status_history h
  WHERE h.source = 'manual'
    AND h.changed_by IS NOT NULL
    AND ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) BETWEEN p_from AND p_to
  GROUP BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tm_edit_record_daily(date, date) TO authenticated;