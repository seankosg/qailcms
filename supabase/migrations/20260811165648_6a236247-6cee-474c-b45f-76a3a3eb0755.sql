CREATE OR REPLACE FUNCTION public.tm_effective_pic_map(_discipline text, _task_nos text[], _as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Qatar')::date))
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(t.task_no, jsonb_build_object(
           'effective_pic', COALESCE(d.to_pic, t.hdec_pic_name),
           'original_pic', t.hdec_pic_name,
           'is_delegated', (d.to_pic IS NOT NULL)
         )), '{}'::jsonb)
    FROM public.task_management_raw t
    LEFT JOIN LATERAL (
      SELECT dd.to_pic
        FROM public.tm_pic_delegations dd
       WHERE dd.task_raw_id = t.id
         AND dd.status = 'active'
         AND _as_of BETWEEN dd.start_date AND dd.end_date
       ORDER BY dd.created_at DESC
       LIMIT 1
    ) d ON true
   WHERE t.discipline = _discipline
     AND t.task_no = ANY(_task_nos);
$$;

GRANT EXECUTE ON FUNCTION public.tm_effective_pic_map(text, text[], date) TO authenticated, service_role;