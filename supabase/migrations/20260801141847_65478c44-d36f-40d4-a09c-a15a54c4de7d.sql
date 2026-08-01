CREATE OR REPLACE FUNCTION public.defect_snag_dashboard_matrix_json(_plan_groups text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _as_of_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT COALESCE(_as_of_date, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of
  ), agg AS (
    SELECT
      d.plan_group::text,
      d.building::text,
      d.level_name::text,
      d.room_group::text,
      d.team::text,
      d.status_raw::text,
      count(*)::bigint AS cnt,
      count(*) FILTER (
        WHERE d.actual_rectified_date IS NOT NULL AND d.actual_rectified_date <= p.as_of
      )::bigint AS rect_cnt,
      count(*) FILTER (
        WHERE d.actual_closure_date IS NOT NULL AND d.actual_closure_date <= p.as_of
      )::bigint AS closed_cnt
    FROM public.defect_items_raw d CROSS JOIN p
    WHERE d.is_active = true
      AND (_plan_groups IS NULL OR d.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR d.team = ANY(_teams))
      AND (_as_of_date IS NULL OR d.data_date IS NULL OR d.data_date <= _as_of_date)
    GROUP BY 1,2,3,4,5,6
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg
$function$;