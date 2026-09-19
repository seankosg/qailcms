DROP FUNCTION IF EXISTS public.defect_snag_stage_dates_json(text[], text[], date);

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
  -- 2026-09-19 교정: p_* = 잔여(미완료) 항목의 최대 계획일, a_* = 완료 항목의 최대 실적일.
  -- 완료 판정은 정본 _snag_done_asof 와 동일한 식(자기 스테이지 실적일 <= as-of).
  WITH base AS (
    SELECT
      d.*,
      COALESCE(_as_of_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
    FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND (_plan_groups IS NULL OR d.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR d.team = ANY(_teams))
      AND (_as_of_date IS NULL OR d.data_date IS NULL OR d.data_date <= _as_of_date)
  ), agg AS (
    SELECT
      b.building::text,
      b.level_name::text,
      b.room_group::text,
      CASE WHEN upper(trim(b.building)) = 'LIFT CABIN' THEN b.room::text END AS room,
      CASE WHEN upper(trim(b.building)) = 'LIFT CABIN' THEN b.subcontractor_name::text END AS subcontractor,
      b.team::text AS team,
      max(CASE WHEN b.actual_rectified_date IS NULL OR b.actual_rectified_date > b.asof
               THEN b.planned_rectified_date END)::text        AS p_rect,
      max(CASE WHEN b.actual_pre_inspection_date IS NULL OR b.actual_pre_inspection_date > b.asof
               THEN b.planned_pre_inspection_date END)::text   AS p_pre,
      max(CASE WHEN b.actual_dar_inspection_date IS NULL OR b.actual_dar_inspection_date > b.asof
               THEN b.planned_dar_inspection_date END)::text   AS p_dar,
      max(CASE WHEN b.actual_closure_date IS NULL OR b.actual_closure_date > b.asof
               THEN b.planned_closure_date END)::text          AS p_closed,
      max(CASE WHEN b.actual_ho_date IS NULL OR b.actual_ho_date > b.asof
               THEN b.planned_ho_date END)::text               AS p_ho,
      max(CASE WHEN b.actual_rectified_date <= b.asof THEN b.actual_rectified_date END)::text            AS a_rect,
      max(CASE WHEN b.actual_pre_inspection_date <= b.asof THEN b.actual_pre_inspection_date END)::text  AS a_pre,
      max(CASE WHEN b.actual_dar_inspection_date <= b.asof THEN b.actual_dar_inspection_date END)::text  AS a_dar,
      max(CASE WHEN b.actual_closure_date <= b.asof THEN b.actual_closure_date END)::text                AS a_closed,
      max(CASE WHEN b.actual_ho_date <= b.asof THEN b.actual_ho_date END)::text                          AS a_ho
    FROM base b
    GROUP BY 1,2,3,4,5,6
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg
$function$;

GRANT EXECUTE ON FUNCTION public.defect_snag_stage_dates_json(text[], text[], date) TO authenticated, service_role;