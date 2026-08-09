-- ── 1) done_asof: 6단계 지원 (구 시그니처 DROP 후 재생성) ────────────
DROP FUNCTION IF EXISTS public._snag_done_asof(text, text, date, date, date, numeric, date);

CREATE OR REPLACE FUNCTION public._snag_done_asof(
  _stage text, _sr text, _asd date, _acd date, _axd date, _pnorm numeric, _as_of date,
  _apd date DEFAULT NULL, _add date DEFAULT NULL, _ahd date DEFAULT NULL
)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  -- A안(2026-07-30 확정): done 은 해당 스테이지 '자기 실적일' 만 인정한다.
  SELECT CASE _stage
    WHEN 'start'          THEN (_asd IS NOT NULL AND _asd <= _as_of)
    WHEN 'rectified'      THEN (_acd IS NOT NULL AND _acd <= _as_of)
    WHEN 'pre_inspection' THEN (_apd IS NOT NULL AND _apd <= _as_of)
    WHEN 'dar_inspection' THEN (_add IS NOT NULL AND _add <= _as_of)
    WHEN 'closure'        THEN (_axd IS NOT NULL AND _axd <= _as_of)
    WHEN 'ho'             THEN (_ahd IS NOT NULL AND _ahd <= _as_of)
    ELSE false
  END
$function$;

-- ── 2) progress events: 6단계 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.snag_progress_events(_as_of_date date, _plan_mode text DEFAULT 'baseline'::text)
RETURNS TABLE(item_id uuid, stage text, field text, edate date)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  -- 술어 정본. defect_snag_progress_cells / snag_progress_cell_ids 가 공유한다. 사본 금지.
  WITH base AS (
    SELECT r.id,
      r.planned_start_date psd, r.planned_rectified_date pcd,
      r.planned_pre_inspection_date ppd, r.planned_dar_inspection_date pdd,
      r.planned_closure_date pxd, r.planned_ho_date phd,
      r.actual_start_date asd, r.actual_rectified_date acd,
      r.actual_pre_inspection_date apd, r.actual_dar_inspection_date add_,
      r.actual_closure_date axd, r.actual_ho_date ahd
    FROM public.defect_items_raw r
    WHERE r.is_active = true
  ),
  ev AS (
    SELECT b.id, v.stage, v.p, v.a,
      public._snag_done_asof(v.stage, NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd) AS done_asof
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text,     b.psd, b.asd),
      ('rectified',       b.pcd, b.acd),
      ('pre_inspection',  b.ppd, b.apd),
      ('dar_inspection',  b.pdd, b.add_),
      ('closure',         b.pxd, b.axd),
      ('ho',              b.phd, b.ahd)
    ) AS v(stage, p, a)
  )
  SELECT id, stage, 'planned'::text, p FROM ev
  WHERE p IS NOT NULL AND (_plan_mode = 'baseline' OR NOT done_asof)
  UNION ALL
  SELECT id, stage, 'actual'::text, a FROM ev
  WHERE a IS NOT NULL
$function$;

-- ── 3) progress cells: 집계 조합을 6단계 멱집합으로 일반화 ────────────
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _include_agg boolean DEFAULT false)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  WITH b0 AS (
    SELECT r.id, r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
  ),
  base AS (
    SELECT b0.id, (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk
    FROM b0
  ),
  j AS (
    SELECT b.gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', e.edate)::date ELSE e.edate END AS bucket_iso,
      e.stage, e.field, e.item_id
    FROM base b
    JOIN public.snag_progress_events(_as_of_date, _plan_mode) e ON e.item_id = b.id
    WHERE e.edate BETWEEN _range_start AND _range_end
  ),
  combos AS (
    SELECT string_agg(st.stage, ',' ORDER BY st.ord) AS combo
    FROM generate_series(1, 63) AS i
    CROSS JOIN LATERAL unnest(ARRAY['start','rectified','pre_inspection','dar_inspection','closure','ho'])
      WITH ORDINALITY AS st(stage, ord)
    WHERE ((i >> (st.ord - 1)::int) & 1) = 1
    GROUP BY i
  )
  SELECT gk, bucket_iso, stage,
    count(DISTINCT item_id) FILTER (WHERE field = 'planned')::int,
    count(DISTINCT item_id) FILTER (WHERE field = 'actual')::int
  FROM j GROUP BY 1, 2, 3
  UNION ALL
  SELECT j.gk, j.bucket_iso, 'all|' || c.combo,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'planned')::int,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'actual')::int
  FROM j
  JOIN combos c ON j.stage = ANY(string_to_array(c.combo, ','))
  WHERE COALESCE(_include_agg, false)
  GROUP BY 1, 2, 3
$function$;

-- ── 4) progress totals: 6단계 + No Plan 마스크 ───────────────────────
DROP FUNCTION IF EXISTS public.defect_snag_progress_totals_json(text[], text[], text[], text[], date, text);
DROP FUNCTION IF EXISTS public.defect_snag_progress_totals(text[], text[], text[], text[], date, text);

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer, no_plan integer, np_mask jsonb)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH b0 AS (
    SELECT r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type,
      r.planned_start_date psd, r.planned_rectified_date pcd,
      r.planned_pre_inspection_date ppd, r.planned_dar_inspection_date pdd,
      r.planned_closure_date pxd, r.planned_ho_date phd,
      r.actual_start_date asd, r.actual_rectified_date acd,
      r.actual_pre_inspection_date apd, r.actual_dar_inspection_date add_,
      r.actual_closure_date axd, r.actual_ho_date ahd
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
  ),
  base AS (
    SELECT (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk,
      psd, pcd, ppd, pdd, pxd, phd, asd, acd, apd, add_, axd, ahd
    FROM b0
  ),
  flags AS (
    SELECT gk, psd, pcd, ppd, pdd, pxd, phd,
      (asd IS NOT NULL AND asd  <= _as_of_date) AS s_done,
      (acd IS NOT NULL AND acd  <= _as_of_date) AS r_done,
      (apd IS NOT NULL AND apd  <= _as_of_date) AS p_done,
      (add_ IS NOT NULL AND add_ <= _as_of_date) AS d_done,
      (axd IS NOT NULL AND axd  <= _as_of_date) AS c_done,
      (ahd IS NOT NULL AND ahd  <= _as_of_date) AS h_done,
      (psd IS NULL AND asd IS NULL) AS s_np,
      (pcd IS NULL AND acd IS NULL) AS r_np,
      (ppd IS NULL AND apd IS NULL) AS p_np,
      (pdd IS NULL AND add_ IS NULL) AS d_np,
      (pxd IS NULL AND axd IS NULL) AS c_np,
      (phd IS NULL AND ahd IS NULL) AS h_np
    FROM base
  ),
  agg AS (
    SELECT gk,
      count(*)::int AS total,
      count(*) FILTER (WHERE s_done)::int AS sdc,
      count(*) FILTER (WHERE r_done)::int AS rdc,
      count(*) FILTER (WHERE p_done)::int AS pdc,
      count(*) FILTER (WHERE d_done)::int AS ddc,
      count(*) FILTER (WHERE c_done)::int AS cdc,
      count(*) FILTER (WHERE h_done)::int AS hdc,
      count(*) FILTER (WHERE psd IS NOT NULL AND psd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT s_done))::int AS sp,
      count(*) FILTER (WHERE pcd IS NOT NULL AND pcd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT r_done))::int AS rp,
      count(*) FILTER (WHERE ppd IS NOT NULL AND ppd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT p_done))::int AS pp,
      count(*) FILTER (WHERE pdd IS NOT NULL AND pdd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT d_done))::int AS dp,
      count(*) FILTER (WHERE pxd IS NOT NULL AND pxd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT c_done))::int AS cp,
      count(*) FILTER (WHERE phd IS NOT NULL AND phd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT h_done))::int AS hp,
      count(*) FILTER (WHERE s_np)::int AS snp,
      count(*) FILTER (WHERE r_np)::int AS rnp,
      count(*) FILTER (WHERE p_np)::int AS pnp,
      count(*) FILTER (WHERE d_np)::int AS dnp,
      count(*) FILTER (WHERE c_np)::int AS cnp,
      count(*) FILTER (WHERE h_np)::int AS hnp
    FROM flags GROUP BY gk
  ),
  masks AS (
    SELECT gk, jsonb_object_agg(mask::text, cnt) AS np_mask
    FROM (
      SELECT gk,
        (CASE WHEN s_np THEN 1 ELSE 0 END)
        + (CASE WHEN r_np THEN 2 ELSE 0 END)
        + (CASE WHEN p_np THEN 4 ELSE 0 END)
        + (CASE WHEN d_np THEN 8 ELSE 0 END)
        + (CASE WHEN c_np THEN 16 ELSE 0 END)
        + (CASE WHEN h_np THEN 32 ELSE 0 END) AS mask,
        count(*)::int AS cnt
      FROM flags GROUP BY 1, 2
    ) m GROUP BY gk
  )
  SELECT a.gk, s.stage, a.total, s.done_cnt, s.plan_cnt, s.done_cnt, s.np_cnt,
         COALESCE(mk.np_mask, '{}'::jsonb)
  FROM agg a
  LEFT JOIN masks mk ON mk.gk IS NOT DISTINCT FROM a.gk
  CROSS JOIN LATERAL (VALUES
    ('start'::text,     a.sdc, a.sp, a.snp),
    ('rectified',       a.rdc, a.rp, a.rnp),
    ('pre_inspection',  a.pdc, a.pp, a.pnp),
    ('dar_inspection',  a.ddc, a.dp, a.dnp),
    ('closure',         a.cdc, a.cp, a.cnp),
    ('ho',              a.hdc, a.hp, a.hnp)
  ) AS s(stage, done_cnt, plan_cnt, np_cnt)
$function$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals_json(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH rows AS (
    SELECT group_key, stage, total, done_upto, plan_upto, actual_upto, no_plan, np_mask
    FROM public.defect_snag_progress_totals(_plan_groups, _teams, _room_groups, _group_by, _as_of_date, _plan_mode)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) FROM rows
$function$;