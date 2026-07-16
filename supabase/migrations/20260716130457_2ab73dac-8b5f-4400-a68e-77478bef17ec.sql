-- ============================================================
-- Snag Progress 매트릭스 — 서버 사전 집계 RPC 및 헬퍼
-- ============================================================

-- ---------- 헬퍼 ----------
CREATE OR REPLACE FUNCTION public._snag_stage_planned_date(_row public.defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'start' THEN _row.planned_start_date
    WHEN 'completion' THEN _row.planned_completion_date
    WHEN 'closure' THEN _row.planned_closure_date
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_actual_date(_row public.defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'start' THEN _row.actual_start_date
    WHEN 'completion' THEN _row.actual_completion_date
    WHEN 'closure' THEN _row.actual_closure_date
    ELSE NULL
  END
$$;

-- Actual progress 정규화(0~1 vs 0~100)
CREATE OR REPLACE FUNCTION public._snag_progress_norm(_v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _v IS NULL THEN 0
    WHEN _v > 1 THEN _v
    ELSE _v * 100
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_done(_row public.defect_items_raw, _stage text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'closure' THEN _row.actual_closure_date IS NOT NULL
    WHEN 'completion' THEN
      _row.actual_completion_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR public._snag_progress_norm(_row.actual_progress_pct) >= 100
    WHEN 'start' THEN
      _row.actual_start_date IS NOT NULL
      OR _row.actual_completion_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR public._snag_progress_norm(_row.actual_progress_pct) > 0
    ELSE false
  END
$$;

-- Group by 차원 → 셀 값 텍스트
CREATE OR REPLACE FUNCTION public._snag_group_val(_row public.defect_items_raw, _dim text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(TRIM(CASE _dim
      WHEN 'team' THEN _row.team
      WHEN 'subcontractor_name' THEN _row.subcontractor_name
      WHEN 'subsub_name' THEN _row.subsub_name
      WHEN 'hdec_pic_name' THEN _row.hdec_pic_name
      WHEN 'hdec_eng_name' THEN _row.hdec_eng_name
      WHEN 'area_level' THEN _row.area_level
      WHEN 'main_trade' THEN _row.main_trade
      WHEN 'sub_trade' THEN _row.sub_trade
      WHEN 'work_type' THEN _row.work_type
      ELSE NULL
    END), ''),
    '(None)'
  )
$$;

-- ---------- 셀 집계 RPC ----------
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text
) RETURNS TABLE(
  group_key text[],
  bucket_iso date,
  stage text,
  plan_cnt integer,
  actual_cnt integer
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT r.*
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND r.status_group = 'unclosed'
      AND (
        _plan_groups IS NULL OR cardinality(_plan_groups) = 0
        OR r.plan_group = ANY(_plan_groups)
      )
      AND (
        _teams IS NULL OR cardinality(_teams) = 0
        OR r.team = ANY(_teams)
      )
      AND (
        _room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A')
           = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x)
      )
  ),
  stage_rows AS (
    SELECT
      b.*,
      s.stage,
      public._snag_stage_planned_date(b, s.stage) AS pdate,
      public._snag_stage_actual_date(b, s.stage)  AS adate,
      (
        public._snag_stage_actual_date(b, s.stage) IS NOT NULL
        AND public._snag_stage_actual_date(b, s.stage) <= _as_of_date
        AND public._snag_stage_done(b, s.stage)
      ) AS done_asof,
      (
        SELECT array_agg(public._snag_group_val(b, dim) ORDER BY ord)
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
      ) AS group_key
    FROM base b
    CROSS JOIN LATERAL unnest(ARRAY['start','completion','closure']) AS s(stage)
  ),
  plan_cells AS (
    SELECT
      sr.group_key,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', sr.pdate)::date ELSE sr.pdate END AS bucket_iso,
      sr.stage,
      count(*)::int AS plan_cnt
    FROM stage_rows sr
    WHERE sr.pdate IS NOT NULL
      AND sr.pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode = 'baseline' OR NOT sr.done_asof)
    GROUP BY 1, 2, 3
  ),
  actual_cells AS (
    SELECT
      sr.group_key,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', sr.adate)::date ELSE sr.adate END AS bucket_iso,
      sr.stage,
      count(*)::int AS actual_cnt
    FROM stage_rows sr
    WHERE sr.adate IS NOT NULL
      AND sr.adate BETWEEN _range_start AND _range_end
    GROUP BY 1, 2, 3
  )
  SELECT
    COALESCE(p.group_key, a.group_key)                       AS group_key,
    COALESCE(p.bucket_iso, a.bucket_iso)                     AS bucket_iso,
    COALESCE(p.stage, a.stage)                               AS stage,
    COALESCE(p.plan_cnt, 0)                                  AS plan_cnt,
    COALESCE(a.actual_cnt, 0)                                AS actual_cnt
  FROM plan_cells p
  FULL OUTER JOIN actual_cells a
    ON p.group_key = a.group_key
   AND p.bucket_iso = a.bucket_iso
   AND p.stage = a.stage
$$;

-- ---------- 그룹 · 스테이지 총량 RPC ----------
CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text
) RETURNS TABLE(
  group_key text[],
  stage text,
  total integer,
  done_upto integer,
  plan_upto integer,
  actual_upto integer
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT r.*
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND r.status_group = 'unclosed'
      AND (
        _plan_groups IS NULL OR cardinality(_plan_groups) = 0
        OR r.plan_group = ANY(_plan_groups)
      )
      AND (
        _teams IS NULL OR cardinality(_teams) = 0
        OR r.team = ANY(_teams)
      )
      AND (
        _room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A')
           = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x)
      )
  ),
  stage_rows AS (
    SELECT
      b.*,
      s.stage,
      public._snag_stage_planned_date(b, s.stage) AS pdate,
      public._snag_stage_actual_date(b, s.stage)  AS adate,
      (
        public._snag_stage_actual_date(b, s.stage) IS NOT NULL
        AND public._snag_stage_actual_date(b, s.stage) <= _as_of_date
        AND public._snag_stage_done(b, s.stage)
      ) AS done_asof,
      (
        SELECT array_agg(public._snag_group_val(b, dim) ORDER BY ord)
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
      ) AS group_key
    FROM base b
    CROSS JOIN LATERAL unnest(ARRAY['start','completion','closure']) AS s(stage)
  )
  SELECT
    group_key,
    stage,
    count(*)::int                                                                       AS total,
    count(*) FILTER (WHERE done_asof)::int                                              AS done_upto,
    count(*) FILTER (
      WHERE pdate IS NOT NULL AND pdate <= _as_of_date
        AND (_plan_mode = 'baseline' OR NOT done_asof)
    )::int                                                                              AS plan_upto,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int AS actual_upto
  FROM stage_rows
  GROUP BY group_key, stage
$$;

-- ---------- 성능 인덱스 ----------
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_progress_scope
  ON public.defect_items_raw (plan_group, team)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_planned_start
  ON public.defect_items_raw (planned_start_date)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_planned_completion
  ON public.defect_items_raw (planned_completion_date)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_planned_closure
  ON public.defect_items_raw (planned_closure_date)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_actual_start
  ON public.defect_items_raw (actual_start_date)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_actual_completion
  ON public.defect_items_raw (actual_completion_date)
  WHERE is_active = true AND status_group = 'unclosed';

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_actual_closure
  ON public.defect_items_raw (actual_closure_date)
  WHERE is_active = true AND status_group = 'unclosed';

-- ---------- 권한 ----------
GRANT EXECUTE ON FUNCTION public._snag_stage_planned_date(public.defect_items_raw, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._snag_stage_actual_date(public.defect_items_raw, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._snag_progress_norm(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public._snag_stage_done(public.defect_items_raw, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._snag_group_val(public.defect_items_raw, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals(text[], text[], text[], text[], date, text) TO authenticated;
