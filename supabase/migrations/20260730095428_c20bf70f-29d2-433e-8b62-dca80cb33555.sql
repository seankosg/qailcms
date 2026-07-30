-- 1) 정본 이력 해석기 (단일 소스)
CREATE OR REPLACE FUNCTION public.tm_actual_at_date(_as_of date, _ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(id uuid, hist_actual numeric, actual_source text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  WITH d AS (SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS as_of),
  base AS (
    SELECT t.id FROM public.task_management_raw t
    WHERE t.is_active IS NOT FALSE AND (_ids IS NULL OR t.id = ANY(_ids))
  ),
  ab AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id AS tid, h.new_value::numeric AS v
    FROM public.task_management_status_history h, d
    WHERE h.field = 'actual_progress' AND h.new_value IS NOT NULL
      AND (h.changed_at AT TIME ZONE 'Asia/Qatar')::date <= d.as_of
    ORDER BY h.task_raw_id, h.changed_at DESC
  ),
  af AS (
    SELECT DISTINCT ON (h.task_raw_id) h.task_raw_id AS tid, h.old_value::numeric AS v
    FROM public.task_management_status_history h, d
    WHERE h.field = 'actual_progress' AND h.old_value IS NOT NULL
      AND (h.changed_at AT TIME ZONE 'Asia/Qatar')::date > d.as_of
    ORDER BY h.task_raw_id, h.changed_at ASC
  )
  SELECT b.id,
         COALESCE(ab.v, af.v) AS hist_actual,
         CASE WHEN COALESCE(ab.v, af.v) IS NULL THEN 'none' ELSE 'history' END AS actual_source
  FROM base b LEFT JOIN ab ON ab.tid = b.id LEFT JOIN af ON af.tid = b.id;
$fn$;

-- 2) as-of 실적 반영 행 소스 (뷰와 동일 컬럼 계약). none 행 표식 = alarm_reason = '이력 없음'
CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
RETURNS SETOF public.v_task_management_raw_derived
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $fn$
DECLARE v_today date := (current_timestamp AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  IF _as_of IS NULL OR _as_of >= v_today THEN
    RETURN QUERY SELECT * FROM public.v_task_management_raw_derived;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (jsonb_populate_record(NULL::public.v_task_management_raw_derived,
    to_jsonb(v) || CASE WHEN r.hist_actual IS NULL THEN
      jsonb_build_object(
        'actual_progress', NULL, 'actual_start', NULL, 'actual_finish', NULL,
        'cum_actual_pct', NULL, 'cum_plan_pct', NULL, 'gap_pct', NULL,
        'auto_judgment', NULL, 'alarm_reason', '이력 없음')
    ELSE
      jsonb_build_object(
        'actual_progress', r.hist_actual,
        'actual_start',  CASE WHEN r.hist_actual > 0  THEN v.actual_start  END,
        'actual_finish', CASE WHEN r.hist_actual >= 1 THEN v.actual_finish END,
        'cum_actual_pct', public.tm_kpi_norm_actual(r.hist_actual),
        'cum_plan_pct',   public.tm_kpi_tplan(v.plan_start, v.plan_end, v.plan_days, _as_of),
        'gap_pct',        public.tm_kpi_gap(r.hist_actual, v.plan_progress, v.plan_start, v.plan_end, v.plan_days, _as_of),
        'auto_judgment',  public.tm_kpi_judgment(
                            r.hist_actual,
                            CASE WHEN r.hist_actual >= 1 THEN v.actual_finish END,
                            CASE WHEN r.hist_actual > 0  THEN v.actual_start  END,
                            v.plan_start, v.plan_end, v.plan_days, v.plan_progress,
                            _as_of, NULL, NULL))
    END)).*
  FROM public.v_task_management_raw_derived v
  LEFT JOIN public.tm_actual_at_date(_as_of) r ON r.id = v.id;
END;
$fn$;

-- 3) tm_judge_at_date — 정본 이력 해석기 + tm_kpi_judgment 로 통일
CREATE OR REPLACE FUNCTION public.tm_judge_at_date(p_data_date date, p_task_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  WITH d AS (SELECT COALESCE(p_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS as_of),
  r AS (
    SELECT t.id, t.plan_start, t.plan_end, t.plan_days, t.plan_progress,
           t.actual_start, t.actual_finish,
           a.hist_actual, a.actual_source
    FROM public.task_management_raw t
    JOIN public.tm_actual_at_date(p_data_date, p_task_ids) a ON a.id = t.id
    WHERE t.is_active IS NOT FALSE
      AND (p_task_ids IS NULL OR t.id = ANY(p_task_ids))
  ),
  j AS (
    SELECT r.id, r.actual_source,
      public.tm_kpi_tplan(r.plan_start, r.plan_end, r.plan_days, d.as_of) AS cum_plan_pct,
      public.tm_kpi_norm_actual(r.hist_actual) AS cum_actual_pct,
      public.tm_kpi_gap(r.hist_actual, r.plan_progress, r.plan_start, r.plan_end, r.plan_days, d.as_of) AS gap_pct,
      public.tm_kpi_judgment(
        r.hist_actual,
        CASE WHEN r.hist_actual >= 1 THEN r.actual_finish END,
        CASE WHEN r.hist_actual > 0  THEN r.actual_start  END,
        r.plan_start, r.plan_end, r.plan_days, r.plan_progress,
        d.as_of, NULL, NULL) AS auto_judgment,
      CASE
        WHEN r.hist_actual >= 1 AND r.actual_finish IS NOT NULL AND r.plan_end IS NOT NULL
             AND r.actual_finish > r.plan_end THEN (r.actual_finish - r.plan_end)
        WHEN COALESCE(r.hist_actual,0) < 1 AND r.plan_end IS NOT NULL AND d.as_of > r.plan_end
             THEN (d.as_of - r.plan_end)
        ELSE 0 END AS delay_days
    FROM r, d
  )
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT j.id,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.cum_plan_pct END   AS cum_plan_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.cum_actual_pct END AS cum_actual_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.gap_pct END        AS gap_pct,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.auto_judgment END  AS auto_judgment,
      CASE WHEN j.actual_source = 'none' THEN NULL ELSE j.delay_days END     AS delay_days,
      CASE WHEN j.actual_source = 'none' THEN '이력 없음'
           ELSE 'Gap ' || round(COALESCE(j.gap_pct,0)*100, 1) || '%' END     AS alarm_reason,
      j.actual_source
    FROM j
  ) x;
$fn$;

-- 4) 검색/집계 RPC 행 소스를 tm_rows_as_of 로 교체 (시그니처 불변)
DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='tm_items_counts';
  IF position('FROM public.v_task_management_raw_derived t' in def)=0 THEN RAISE EXCEPTION 'counts src'; END IF;
  def := replace(def, 'FROM public.v_task_management_raw_derived t', 'FROM public.tm_rows_as_of(v_asof) t');
  IF position('(s.plan_start IS NULL) AS no_plan_start,' in def)=0 THEN RAISE EXCEPTION 'counts nps'; END IF;
  def := replace(def, '(s.plan_start IS NULL) AS no_plan_start,',
    $q$(s.alarm_reason IS NOT DISTINCT FROM '이력 없음') AS no_hist,
      (s.plan_start IS NULL) AS no_plan_start,$q$);
  def := replace(def, 'COUNT(*) FILTER (WHERE ', 'COUNT(*) FILTER (WHERE NOT no_hist AND ');
  IF position($q$'total',              COUNT(*),$q$ in def)=0 THEN RAISE EXCEPTION 'counts total'; END IF;
  def := replace(def, $q$'total',              COUNT(*),$q$,
    $q$'total',              COUNT(*),
    'no_history',         COUNT(*) FILTER (WHERE no_hist),$q$);
  EXECUTE def;
END $do$;

DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='tm_items_search';
  IF position('from public.v_task_management_raw_derived' in def)=0 THEN RAISE EXCEPTION 'search src'; END IF;
  def := replace(def, 'from public.v_task_management_raw_derived', 'from %s');
  IF position('$fmt$, _where_sql, _safe_offset' in def)=0 THEN RAISE EXCEPTION 'search args'; END IF;
  def := replace(def, '$fmt$, _where_sql, _safe_offset',
    $q$$fmt$, format('public.tm_rows_as_of(%L::date)', _effective_asof), _where_sql, _safe_offset$q$);
  IF position($q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    );$q$ in def)=0 THEN RAISE EXCEPTION 'search kpi'; END IF;
  def := replace(def, $q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    );$q$,
    $q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    ) || ' and alarm_reason is distinct from ''이력 없음''';$q$);
  EXECUTE def;
END $do$;

DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='tm_items_search_ids';
  IF position('from public.v_task_management_raw_derived' in def)=0 THEN RAISE EXCEPTION 'ids src'; END IF;
  def := replace(def, 'from public.v_task_management_raw_derived', 'from %s');
  IF position('$fmt$, _where, _safe_limit);' in def)=0 THEN RAISE EXCEPTION 'ids args'; END IF;
  def := replace(def, '$fmt$, _where, _safe_limit);',
    $q$$fmt$, format('public.tm_rows_as_of(%L::date)', _effective_asof), _where, _safe_limit);$q$);
  IF position($q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    );$q$ in def)=0 THEN RAISE EXCEPTION 'ids kpi'; END IF;
  def := replace(def, $q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    );$q$,
    $q$_kpi_mode, _effective_asof, _caution_gap_buffer, _worsen_gap
    ) || ' and alarm_reason is distinct from ''이력 없음''';$q$);
  EXECUTE def;
END $do$;

DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='tm_items_counts_by_bucket';
  IF position('from public.v_task_management_raw_derived' in def)=0 THEN RAISE EXCEPTION 'cb src'; END IF;
  def := replace(def, 'from public.v_task_management_raw_derived', 'from %5$s');
  def := replace(def, 'select actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress
      from %5$s',
    'select actual_progress, actual_finish, actual_start, plan_start, plan_end, plan_days, plan_progress, alarm_reason
      from %5$s');
  IF position('$fmt$, _where, _args, _effective_asof::text, _worsen_gap);' in def)=0 THEN RAISE EXCEPTION 'cb args'; END IF;
  def := replace(def, '$fmt$, _where, _args, _effective_asof::text, _worsen_gap);',
    $q$$fmt$, _where, _args, _effective_asof::text, _worsen_gap, format('public.tm_rows_as_of(%L::date)', _effective_asof));$q$);
  IF position('      from filtered
    )' in def)=0 THEN RAISE EXCEPTION 'cb flags'; END IF;
  def := replace(def, '      from filtered
    )',
    $q$      from filtered where alarm_reason is distinct from '이력 없음'
    )$q$);
  EXECUTE def;
END $do$;

DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='tm_items_facets';
  IF position('from public.v_task_management_raw_derived' in def)=0 THEN RAISE EXCEPTION 'facets src'; END IF;
  def := replace(def, 'from public.v_task_management_raw_derived', 'from public.tm_rows_as_of(%L::date)');
  IF position('_axis, _axis, _where, _axis, _axis, _axis);' in def)=0 THEN RAISE EXCEPTION 'facets args'; END IF;
  def := replace(def, '_axis, _axis, _where, _axis, _axis, _axis);', '_axis, _axis, _effective_asof, _where, _axis, _axis, _axis);');
  IF position($q$_kpi_mode, _effective_asof, _caution, _worsen_gap
    );$q$ in def)=0 THEN RAISE EXCEPTION 'facets kpi'; END IF;
  def := replace(def, $q$_kpi_mode, _effective_asof, _caution, _worsen_gap
    );$q$,
    $q$_kpi_mode, _effective_asof, _caution, _worsen_gap
    ) || ' and alarm_reason is distinct from ''이력 없음''';$q$);
  EXECUTE def;
END $do$;