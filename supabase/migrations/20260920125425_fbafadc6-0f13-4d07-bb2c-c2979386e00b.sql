-- 2026-09-20: Snag Remaining 기준을 "삭제형"에서 "이동형"으로 교정.
--  이전: 기준일까지 완료된 단계의 계획 이벤트를 제거 → 계획 누계가 100%에 수렴하지 않고 과거 구간이 소급 하락.
--  이후: 계획 이벤트를 제거하지 않고 실제 완료일 위치로 이동 → 계획 모집단 불변, 과거 구간 고정.
--  완료 판정은 정본 public._snag_done_asof 만 사용(사본 금지).

CREATE OR REPLACE FUNCTION public.snag_progress_events(_as_of_date date, _plan_mode text DEFAULT 'baseline'::text)
 RETURNS TABLE(item_id uuid, stage text, field text, edate date)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
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
  -- remaining = 이동형: 완료된 단계의 계획일을 실제 완료일로 치환(모집단은 계획일 보유 항목 그대로)
  SELECT id, stage, 'planned'::text,
         CASE WHEN _plan_mode = 'remaining' AND done_asof AND a IS NOT NULL THEN a ELSE p END
  FROM ev
  WHERE p IS NOT NULL
  UNION ALL
  SELECT id, stage, 'actual'::text, a FROM ev
  WHERE a IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.snag_progress_events(_as_of_date date, _plan_mode text, _range_start date, _range_end date, _plan_groups text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _room_groups text[] DEFAULT NULL::text[], _buildings text[] DEFAULT NULL::text[])
 RETURNS TABLE(item_id uuid, stage text, field text, edate date)
 LANGUAGE sql
 STABLE PARALLEL SAFE ROWS 200000
 SET search_path TO 'public'
AS $function$
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
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  ev AS (
    SELECT b.id, v.stage, v.a,
      CASE WHEN _plan_mode = 'remaining'
                 AND v.a IS NOT NULL
                 AND public._snag_done_asof(v.stage, NULL, b.asd, b.acd, b.axd, NULL, _as_of_date, b.apd, b.add_, b.ahd)
           THEN v.a ELSE v.p END AS p_eff,
      v.p AS p_raw
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
  SELECT id, stage, 'planned'::text, p_eff FROM ev
  WHERE p_raw IS NOT NULL AND p_eff BETWEEN _range_start AND _range_end
  UNION ALL
  SELECT id, stage, 'actual'::text, a FROM ev
  WHERE a IS NOT NULL AND a BETWEEN _range_start AND _range_end
$function$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text, _buildings text[] DEFAULT NULL::text[])
 RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer, no_plan integer, np_mask jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
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
      public._snag_done_asof('start',          NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS s_done,
      public._snag_done_asof('rectified',      NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS r_done,
      public._snag_done_asof('pre_inspection', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS p_done,
      public._snag_done_asof('dar_inspection', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS d_done,
      public._snag_done_asof('closure',        NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS c_done,
      public._snag_done_asof('ho',             NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd) AS h_done,
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
      -- remaining = 이동형: 완료된 단계는 계획을 실제 완료일(≤ as-of)로 옮겨 계상 → 항상 누계에 포함
      count(*) FILTER (WHERE psd IS NOT NULL AND (psd <= _as_of_date OR (_plan_mode <> 'baseline' AND s_done)))::int AS sp,
      count(*) FILTER (WHERE pcd IS NOT NULL AND (pcd <= _as_of_date OR (_plan_mode <> 'baseline' AND r_done)))::int AS rp,
      count(*) FILTER (WHERE ppd IS NOT NULL AND (ppd <= _as_of_date OR (_plan_mode <> 'baseline' AND p_done)))::int AS pp,
      count(*) FILTER (WHERE pdd IS NOT NULL AND (pdd <= _as_of_date OR (_plan_mode <> 'baseline' AND d_done)))::int AS dp,
      count(*) FILTER (WHERE pxd IS NOT NULL AND (pxd <= _as_of_date OR (_plan_mode <> 'baseline' AND c_done)))::int AS cp,
      count(*) FILTER (WHERE phd IS NOT NULL AND (phd <= _as_of_date OR (_plan_mode <> 'baseline' AND h_done)))::int AS hp,
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