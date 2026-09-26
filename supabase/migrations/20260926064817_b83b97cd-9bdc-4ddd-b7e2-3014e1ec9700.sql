DROP FUNCTION IF EXISTS public.defect_snag_progress_totals_json(text[], text[], text[], text[], date, text, text[]);
DROP FUNCTION IF EXISTS public.defect_snag_progress_totals(text[], text[], text[], text[], date, text, text[]);

CREATE FUNCTION public.defect_snag_progress_totals(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text DEFAULT 'remaining'::text,
  _buildings text[] DEFAULT NULL::text[],
  _stages text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  group_key text[],
  stage text,
  total integer,
  done_upto integer,
  plan_upto integer,
  actual_upto integer,
  no_plan integer,
  np_mask jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH base AS MATERIALIZED (
    SELECT r.id,
      r.planned_start_date psd, r.planned_rectified_date pcd,
      r.planned_pre_inspection_date ppd, r.planned_dar_inspection_date pdd,
      r.planned_closure_date pxd, r.planned_ho_date phd,
      r.actual_start_date asd, r.actual_rectified_date acd,
      r.actual_pre_inspection_date apd, r.actual_dar_inspection_date add_,
      r.actual_closure_date axd, r.actual_ho_date ahd,
      (
        SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
          WHEN 'team' THEN r.team
          WHEN 'room_group' THEN r.room_group
          WHEN 'subcontractor_name' THEN r.subcontractor_name
          WHEN 'subsub_name' THEN r.subsub_name
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'area_level' THEN r.area_level
          WHEN 'main_trade' THEN r.main_trade
          WHEN 'sub_trade' THEN r.sub_trade
          WHEN 'work_type' THEN r.work_type
        END), ''), '(None)') ORDER BY u.ord)
        FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)
      ) AS gk
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  stage_rows AS MATERIALIZED (
    SELECT b.id, b.gk, v.stage, v.p, v.a, v.bit,
      public._snag_done_asof(v.stage, NULL, b.asd, b.acd, b.axd, NULL,
        _as_of_date, b.apd, b.add_, b.ahd) AS done_asof,
      (v.a IS NOT NULL AND v.a <= _as_of_date) AS actual_asof,
      (v.p IS NULL AND v.a IS NULL) AS no_plan
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text,          b.psd, b.asd,  1),
      ('rectified',            b.pcd, b.acd,  2),
      ('pre_inspection',       b.ppd, b.apd,  4),
      ('dar_inspection',       b.pdd, b.add_,  8),
      ('closure',              b.pxd, b.axd, 16),
      ('ho',                   b.phd, b.ahd, 32)
    ) AS v(stage, p, a, bit)
    WHERE _stages IS NULL OR cardinality(_stages) = 0 OR v.stage = ANY(_stages)
  ),
  stage_agg AS (
    SELECT gk, stage,
      count(*)::int AS total,
      count(*) FILTER (WHERE done_asof)::int AS done_upto,
      count(*) FILTER (
        WHERE p IS NOT NULL
          AND (p <= _as_of_date OR (_plan_mode <> 'baseline' AND done_asof))
      )::int AS plan_upto,
      count(*) FILTER (WHERE actual_asof)::int AS actual_upto,
      count(*) FILTER (WHERE no_plan)::int AS no_plan
    FROM stage_rows
    GROUP BY gk, stage
  ),
  item_masks AS (
    SELECT gk, id, COALESCE(bit_or(bit) FILTER (WHERE no_plan), 0)::int AS mask
    FROM stage_rows
    GROUP BY gk, id
  ),
  masks AS (
    SELECT gk, jsonb_object_agg(mask::text, cnt) AS np_mask
    FROM (
      SELECT gk, mask, count(*)::int AS cnt
      FROM item_masks
      GROUP BY gk, mask
    ) m
    GROUP BY gk
  )
  SELECT a.gk, a.stage, a.total, a.done_upto, a.plan_upto, a.actual_upto, a.no_plan,
    COALESCE(m.np_mask, '{}'::jsonb)
  FROM stage_agg a
  LEFT JOIN masks m ON m.gk IS NOT DISTINCT FROM a.gk
$function$;

CREATE FUNCTION public.defect_snag_progress_totals_json(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text DEFAULT 'remaining'::text,
  _buildings text[] DEFAULT NULL::text[],
  _stages text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT group_key, stage, total, done_upto, plan_upto, actual_upto, no_plan, np_mask
    FROM public.defect_snag_progress_totals(
      _plan_groups, _teams, _room_groups, _group_by, _as_of_date, _plan_mode, _buildings, _stages
    )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) FROM rows
$function$;

REVOKE ALL ON FUNCTION public.defect_snag_progress_totals(text[],text[],text[],text[],date,text,text[],text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.defect_snag_progress_totals_json(text[],text[],text[],text[],date,text,text[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals(text[],text[],text[],text[],date,text,text[],text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals_json(text[],text[],text[],text[],date,text,text[],text[]) TO authenticated, service_role;