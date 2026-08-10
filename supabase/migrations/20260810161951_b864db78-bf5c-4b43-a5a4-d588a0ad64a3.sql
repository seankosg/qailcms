CREATE OR REPLACE FUNCTION public.defect_snag_stage_dates_json(
  _plan_groups text[] DEFAULT NULL::text[],
  _teams text[] DEFAULT NULL::text[],
  _as_of_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT
      d.building::text,
      d.level_name::text,
      d.room_group::text,
      CASE WHEN upper(trim(d.building)) = 'LIFT CABIN' THEN d.room::text END AS room,
      CASE WHEN upper(trim(d.building)) = 'LIFT CABIN' THEN d.subcontractor_name::text END AS subcontractor,
      d.team::text AS team,
      max(d.planned_rectified_date)::text        AS p_rect,
      max(d.planned_pre_inspection_date)::text   AS p_pre,
      max(d.planned_dar_inspection_date)::text   AS p_dar,
      max(d.planned_closure_date)::text          AS p_closed,
      max(d.planned_ho_date)::text               AS p_ho,
      max(d.actual_rectified_date)::text         AS a_rect,
      max(d.actual_pre_inspection_date)::text    AS a_pre,
      max(d.actual_dar_inspection_date)::text    AS a_dar,
      max(d.actual_closure_date)::text           AS a_closed,
      max(d.actual_ho_date)::text                AS a_ho
    FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND (_plan_groups IS NULL OR d.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR d.team = ANY(_teams))
      AND (_as_of_date IS NULL OR d.data_date IS NULL OR d.data_date <= _as_of_date)
    GROUP BY 1,2,3,4,5,6
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg
$function$;