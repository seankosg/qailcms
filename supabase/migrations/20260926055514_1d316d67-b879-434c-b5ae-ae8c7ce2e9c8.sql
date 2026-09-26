DROP FUNCTION IF EXISTS public.abd_progress_cum_json(text[], text[], text, date, date, date, text, text);

CREATE FUNCTION public.abd_progress_cum_json(
  _plots text[],
  _teams text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text,
  _round text,
  _stages text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH base AS MATERIALIZED (
    SELECT r.id
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  ev AS MATERIALIZED (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.abd_progress_events(_as_of_date, _plan_mode, _round) e
    JOIN base b ON b.id = e.item_id
    WHERE (e.field = 'planned' OR e.edate <= _as_of_date)
      AND (_stages IS NULL OR cardinality(_stages) = 0 OR e.stage = ANY(_stages))
  ),
  firsts AS (
    SELECT item_id, stage, field, min(edate) AS first_date
    FROM ev
    GROUP BY 1,2,3
  ),
  daily AS (
    SELECT stage, first_date AS d,
      count(*) FILTER (WHERE field = 'planned') AS p,
      count(*) FILTER (WHERE field = 'actual') AS a
    FROM firsts
    GROUP BY 1,2
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
      CASE WHEN _bucket = 'week' THEN g::date + 6 ELSE g::date END AS bucket_end
    FROM generate_series(
      _range_start::timestamp,
      _range_end::timestamp,
      CASE WHEN _bucket = 'week' THEN interval '7 day' ELSE interval '1 day' END
    ) g
  ),
  all_stages(stage) AS (
    VALUES ('draft_start'),('draft_finish'),('submission'),('dar'),('approval')
  ),
  selected_stages AS (
    SELECT stage
    FROM all_stages
    WHERE _stages IS NULL OR cardinality(_stages) = 0 OR stage = ANY(_stages)
  ),
  pts AS (
    SELECT s.stage, b.bucket_end AS d, 0::bigint AS p, 0::bigint AS a, b.bucket_iso
    FROM buckets b
    CROSS JOIN selected_stages s
    UNION ALL
    SELECT stage, d, p, a, NULL::date
    FROM daily
  ),
  run AS (
    SELECT stage, bucket_iso,
      sum(p) OVER w AS cp,
      sum(a) OVER w AS ca
    FROM pts
    WINDOW w AS (
      PARTITION BY stage
      ORDER BY d, (bucket_iso IS NOT NULL)
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket_iso', bucket_iso,
    'stage', stage,
    'cum_plan', cp::int,
    'cum_actual', ca::int
  ) ORDER BY stage, bucket_iso), '[]'::jsonb)
  FROM run
  WHERE bucket_iso IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.abd_progress_cum_json(text[],text[],text,date,date,date,text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_progress_cum_json(text[],text[],text,date,date,date,text,text,text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[], _teams text[], _room_groups text[], _group_by text[],
  _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text,
  _include_agg boolean DEFAULT false, _buildings text[] DEFAULT NULL::text[],
  _agg_stages text[] DEFAULT NULL::text[]
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
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
  events AS MATERIALIZED (
    SELECT b.id AS item_id, b.gk, v.stage, v.field, v.edate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text, 'planned'::text,
        CASE WHEN _plan_mode = 'remaining' AND b.asd IS NOT NULL
          AND public._snag_done_asof('start', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.asd ELSE b.psd END, b.psd),
      ('rectified', 'planned',
        CASE WHEN _plan_mode = 'remaining' AND b.acd IS NOT NULL
          AND public._snag_done_asof('rectified', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.acd ELSE b.pcd END, b.pcd),
      ('pre_inspection', 'planned',
        CASE WHEN _plan_mode = 'remaining' AND b.apd IS NOT NULL
          AND public._snag_done_asof('pre_inspection', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.apd ELSE b.ppd END, b.ppd),
      ('dar_inspection', 'planned',
        CASE WHEN _plan_mode = 'remaining' AND b.add_ IS NOT NULL
          AND public._snag_done_asof('dar_inspection', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.add_ ELSE b.pdd END, b.pdd),
      ('closure', 'planned',
        CASE WHEN _plan_mode = 'remaining' AND b.axd IS NOT NULL
          AND public._snag_done_asof('closure', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.axd ELSE b.pxd END, b.pxd),
      ('ho', 'planned',
        CASE WHEN _plan_mode = 'remaining' AND b.ahd IS NOT NULL
          AND public._snag_done_asof('ho', NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
          THEN b.ahd ELSE b.phd END, b.phd),
      ('start', 'actual', b.asd, b.asd),
      ('rectified', 'actual', b.acd, b.acd),
      ('pre_inspection', 'actual', b.apd, b.apd),
      ('dar_inspection', 'actual', b.add_, b.add_),
      ('closure', 'actual', b.axd, b.axd),
      ('ho', 'actual', b.ahd, b.ahd)
    ) AS v(stage, field, edate, raw_plan)
    WHERE v.edate BETWEEN _range_start AND _range_end
      AND (v.field = 'actual' OR v.raw_plan IS NOT NULL)
  ),
  j AS MATERIALIZED (
    SELECT gk,
      CASE _bucket
        WHEN 'week' THEN date_trunc('week', edate)::date
        WHEN 'month' THEN date_trunc('month', edate)::date
        ELSE edate
      END AS bucket_iso,
      stage, field, item_id,
      CASE stage
        WHEN 'start' THEN 1 WHEN 'rectified' THEN 2 WHEN 'pre_inspection' THEN 4
        WHEN 'dar_inspection' THEN 8 WHEN 'closure' THEN 16 WHEN 'ho' THEN 32 ELSE 0
      END AS bit
    FROM events
  ),
  ju AS (
    SELECT gk, bucket_iso, stage, field, item_id
    FROM j
    GROUP BY 1,2,3,4,5
  ),
  im AS (
    SELECT gk, bucket_iso, field, item_id, bit_or(bit) AS mask
    FROM j
    WHERE COALESCE(_include_agg, false)
    GROUP BY 1,2,3,4
  ),
  mm AS (
    SELECT gk, bucket_iso, field, mask, count(*)::int AS c
    FROM im
    GROUP BY 1,2,3,4
  ),
  requested_combo AS (
    SELECT
      sum(CASE s.stage
        WHEN 'start' THEN 1 WHEN 'rectified' THEN 2 WHEN 'pre_inspection' THEN 4
        WHEN 'dar_inspection' THEN 8 WHEN 'closure' THEN 16 WHEN 'ho' THEN 32 ELSE 0
      END)::int AS m,
      string_agg(s.stage, ',' ORDER BY s.ord) AS combo
    FROM unnest(ARRAY['start','rectified','pre_inspection','dar_inspection','closure','ho'])
      WITH ORDINALITY AS s(stage, ord)
    WHERE s.stage = ANY(COALESCE(_agg_stages, ARRAY[]::text[]))
  ),
  combos AS (
    SELECT i AS m, (
      SELECT string_agg(st.stage, ',' ORDER BY st.ord)
      FROM unnest(ARRAY['start','rectified','pre_inspection','dar_inspection','closure','ho'])
        WITH ORDINALITY AS st(stage, ord)
      WHERE ((i >> (st.ord - 1)::int) & 1) = 1
    ) AS combo
    FROM generate_series(1,63) AS i
    WHERE _agg_stages IS NULL OR cardinality(_agg_stages) = 0
    UNION ALL
    SELECT m, combo
    FROM requested_combo
    WHERE _agg_stages IS NOT NULL AND cardinality(_agg_stages) > 0 AND m > 0
  )
  SELECT gk, bucket_iso, stage,
    count(*) FILTER (WHERE field = 'planned')::int,
    count(*) FILTER (WHERE field = 'actual')::int
  FROM ju
  GROUP BY 1,2,3
  UNION ALL
  SELECT mm.gk, mm.bucket_iso, 'all|' || c.combo,
    COALESCE(sum(mm.c) FILTER (WHERE mm.field = 'planned'), 0)::int,
    COALESCE(sum(mm.c) FILTER (WHERE mm.field = 'actual'), 0)::int
  FROM mm
  JOIN combos c ON (mm.mask & c.m) <> 0
  WHERE COALESCE(_include_agg, false)
  GROUP BY 1,2,3
$function$;

REVOKE ALL ON FUNCTION public.defect_snag_progress_cells(text[],text[],text[],text[],text,date,date,date,text,boolean,text[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[],text[],text[],text[],text,date,date,date,text,boolean,text[],text[]) TO authenticated, service_role;