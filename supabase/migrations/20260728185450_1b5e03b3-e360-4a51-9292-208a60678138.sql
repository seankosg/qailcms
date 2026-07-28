-- ===== ABD_JUDGE_V1: 정본 판정 함수 =====
-- 트리거 로직 1:1 이식. STABLE, SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.abd_judge_v1(_row public.abd_items_raw, _as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_active smallint := NULL;
  v_stage text := NULL;
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_needs_plan boolean := false;
  v_needs_revise boolean := false;
  v_revise_src smallint := NULL;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;
  v_raw_up text;
  v_norm text;
  v_mismatch boolean;
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_raw_up := CASE WHEN _row.latest_status IS NULL THEN NULL ELSE upper(btrim(_row.latest_status)) END;
  v_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  v_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  IF _row.r2_response_result IS NOT NULL OR _row.r3_draft_start_plan IS NOT NULL
     OR _row.r3_draft_finish_plan IS NOT NULL OR _row.r3_submission_plan IS NOT NULL
     OR _row.r3_draft_start_actual IS NOT NULL OR _row.r3_draft_finish_actual IS NOT NULL
     OR _row.r3_submission_actual IS NOT NULL OR _row.r3_dar_actual IS NOT NULL THEN
    v_active := 3;
  ELSIF _row.r1_response_result IS NOT NULL OR _row.r2_draft_start_plan IS NOT NULL
     OR _row.r2_draft_finish_plan IS NOT NULL OR _row.r2_submission_plan IS NOT NULL
     OR _row.r2_draft_start_actual IS NOT NULL OR _row.r2_draft_finish_actual IS NOT NULL
     OR _row.r2_submission_actual IS NOT NULL OR _row.r2_dar_actual IS NOT NULL THEN
    v_active := 2;
  ELSE
    v_active := 1;
  END IF;

  IF _row.is_terminated THEN
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm,
      'status_mismatch', v_mismatch,
      'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text,
      'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[],
      'needs_planning', false,
      'needs_revise', false,
      'revise_source_round', NULL,
      'rs_result_missing', false,
      'ur_aging_days', NULL
    );
  END IF;

  IF v_norm = 'A' THEN
    IF _row.r3_response_result = 'A' THEN v_active := 3;
    ELSIF _row.r2_response_result = 'A' THEN v_active := 2;
    ELSE v_active := 1;
    END IF;
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm,
      'status_mismatch', v_mismatch,
      'active_round', v_active,
      'current_stage', 'Approved',
      'bucket_top', 'Approved',
      'delay_bucket', '{}'::text[],
      'needs_planning', false,
      'needs_revise', false,
      'revise_source_round', NULL,
      'rs_result_missing', false,
      'ur_aging_days', NULL
    );
  END IF;

  IF v_active = 1 THEN
    ds_p := _row.r1_draft_start_plan; ds_a := _row.r1_draft_start_actual;
    df_p := _row.r1_draft_finish_plan; df_a := _row.r1_draft_finish_actual;
    sb_p := _row.r1_submission_plan; sb_a := _row.r1_submission_actual;
    rs_p := _row.r1_dar_plan; rs_a := _row.r1_dar_actual; rr := _row.r1_response_result;
  ELSIF v_active = 2 THEN
    ds_p := _row.r2_draft_start_plan; ds_a := _row.r2_draft_start_actual;
    df_p := _row.r2_draft_finish_plan; df_a := _row.r2_draft_finish_actual;
    sb_p := _row.r2_submission_plan; sb_a := _row.r2_submission_actual;
    rs_p := _row.r2_dar_plan; rs_a := _row.r2_dar_actual; rr := _row.r2_response_result;
  ELSE
    ds_p := _row.r3_draft_start_plan; ds_a := _row.r3_draft_start_actual;
    df_p := _row.r3_draft_finish_plan; df_a := _row.r3_draft_finish_actual;
    sb_p := _row.r3_submission_plan; sb_a := _row.r3_submission_actual;
    rs_p := _row.r3_dar_plan; rs_a := _row.r3_dar_actual; rr := _row.r3_response_result;
  END IF;

  IF sb_a IS NOT NULL AND (rs_a IS NULL OR rr IS NULL) THEN
    v_stage := 'UR'||v_active::text; v_bucket := 'UR';
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a;
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  ELSIF ds_a IS NOT NULL AND sb_a IS NULL THEN
    v_stage := 'DS'||v_active::text; v_bucket := 'DS';
  ELSIF _row.r1_draft_start_actual IS NULL AND _row.r1_draft_finish_actual IS NULL AND _row.r1_submission_actual IS NULL THEN
    v_stage := 'NS'; v_bucket := 'NS';
  ELSE
    v_stage := 'RS'||v_active::text; v_bucket := 'DS';
  END IF;

  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay,'DS'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL AND ds_a IS NOT NULL THEN v_delay := array_append(v_delay,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL AND sb_a IS NOT NULL THEN v_delay := array_append(v_delay,'RS'); END IF;

  IF v_active = 1 AND _row.r1_response_result IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 2 AND _row.r2_response_result IN ('B','C')
     AND (_row.r3_draft_start_plan IS NULL OR _row.r3_draft_finish_plan IS NULL OR _row.r3_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 2;
  END IF;

  RETURN jsonb_build_object(
    'latest_status_norm', v_norm,
    'status_mismatch', v_mismatch,
    'active_round', v_active,
    'current_stage', v_stage,
    'bucket_top', v_bucket,
    'delay_bucket', v_delay,
    'needs_planning', v_needs_plan,
    'needs_revise', v_needs_revise,
    'revise_source_round', v_revise_src,
    'rs_result_missing', v_rs_missing,
    'ur_aging_days', v_ur_days
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.abd_judge_v1(public.abd_items_raw, date) TO authenticated, service_role;

-- ===== 트리거: abd_judge_v1 결과를 NEW.*에 매핑 =====
CREATE OR REPLACE FUNCTION public.abd_compute_derived()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  j jsonb;
BEGIN
  j := public.abd_judge_v1(NEW, NULL);
  NEW.latest_status_norm   := NULLIF(j->>'latest_status_norm','');
  NEW.status_mismatch      := COALESCE((j->>'status_mismatch')::boolean, false);
  NEW.active_round         := NULLIF(j->>'active_round','')::smallint;
  NEW.current_stage        := NULLIF(j->>'current_stage','');
  NEW.bucket_top           := NULLIF(j->>'bucket_top','');
  NEW.delay_bucket         := ARRAY(SELECT jsonb_array_elements_text(COALESCE(j->'delay_bucket','[]'::jsonb)));
  NEW.needs_planning       := COALESCE((j->>'needs_planning')::boolean, false);
  NEW.needs_revise         := COALESCE((j->>'needs_revise')::boolean, false);
  NEW.revise_source_round  := NULLIF(j->>'revise_source_round','')::smallint;
  NEW.rs_result_missing    := COALESCE((j->>'rs_result_missing')::boolean, false);
  NEW.ur_aging_days        := NULLIF(j->>'ur_aging_days','')::integer;
  RETURN NEW;
END;
$fn$;

-- ===== abd_judge_at_date: 정본 경유로 재작성 =====
DROP FUNCTION IF EXISTS public.abd_judge_at_date(uuid[], date);
CREATE OR REPLACE FUNCTION public.abd_judge_at_date(_ids uuid[], _as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', r.id) || public.abd_judge_v1(r, _as_of)
    ),
    '[]'::jsonb
  )
  FROM public.abd_items_raw r
  WHERE r.id = ANY(_ids);
$fn$;

GRANT EXECUTE ON FUNCTION public.abd_judge_at_date(uuid[], date) TO authenticated, service_role;

-- ===== abd_items_search: _status_group→bucket_top 정본화 + _bucket 파라미터 =====
DROP FUNCTION IF EXISTS public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.abd_items_search(
  _team text DEFAULT NULL,
  _status_group text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _plot text DEFAULT NULL,
  _excluded_mode text DEFAULT 'hide',
  _bucket text[] DEFAULT NULL
)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
_allowed_cols constant text[] := ARRAY[
'id','team','plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
'document_title','abd_number','abd_ocs_no','hdec_pic_name','hdec_eng_name',
'r1_draft_start_plan','r1_draft_start_actual','r1_draft_finish_plan','r1_draft_finish_actual','r1_response_result',
'r2_draft_start_plan','r2_draft_start_actual','r2_draft_finish_plan','r2_draft_finish_actual','r2_response_result',
'r3_draft_start_plan','r3_draft_start_actual','r3_draft_finish_plan','r3_draft_finish_actual','r3_response_result',
'r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
'r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
'r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
'latest_rev','latest_status','approval_date','status_group','is_active','is_terminated','field_mismatch','data_date','updated_at','created_at'
];
_search_cols constant text[] := ARRAY[
'abd_number','abd_ocs_no','document_title','hdec_pic_name','hdec_eng_name','dis','service','plot','latest_rev','latest_status',
'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
];
_where text := 'true';
_sort_sql text := '';
_filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
_token text; _field_sql text; _sf text; _sql text;
_sg text;
BEGIN
IF _team IS NOT NULL AND _team <> '' THEN
_where := _where || format(' and team = any(%L::text[])', string_to_array(_team, ','));
END IF;
IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;

-- 정본화: _status_group을 stored bucket_top 기반으로 해석.
-- 하위호환 어휘(not_started/in_progress/approved) 그대로 수용.
_sg := lower(coalesce(_status_group,''));
IF _sg IN ('approved') THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') = ''Approved''';
ELSIF _sg IN ('not_started','ns') THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') = ''NS''';
ELSIF _sg IN ('in_progress','inprogress') THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') in (''DS'',''UR'',''RESUBMIT'')';
ELSIF _sg IN ('unapproved') THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') <> ''Approved''';
ELSIF _sg = 'under_review' THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') = ''UR''';
ELSIF _sg = 'drafting' THEN
  _where := _where || ' and coalesce(bucket_top,''NS'') = ''DS''';
ELSIF _sg = 'rs_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''RS'' = any(coalesce(delay_bucket,''{}''::text[]))';
ELSIF _sg = 'sb_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''SB'' = any(coalesce(delay_bucket,''{}''::text[]))';
ELSIF _sg = 'ds_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''DS'' = any(coalesce(delay_bucket,''{}''::text[]))';
ELSIF _sg = 'no_plan' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[]))';
ELSIF _sg = 'delayed' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ('
    || '''RS'' = any(coalesce(delay_bucket,''{}''::text[]))'
    || ' or ''SB'' = any(coalesce(delay_bucket,''{}''::text[]))'
    || ' or ''DS'' = any(coalesce(delay_bucket,''{}''::text[]))'
    || ' or ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[]))'
    || ')';
END IF;

-- 신규 _bucket 파라미터: 정본 버킷 다중선택 필터
IF _bucket IS NOT NULL AND array_length(_bucket,1) > 0 THEN
  _where := _where || format(' and coalesce(bucket_top,''NS'') = any(%L::text[])', _bucket);
END IF;

IF NOT _include_inactive THEN _where := _where || ' and is_active = true'; END IF;
IF _excluded_mode = 'only' THEN
_where := _where || ' and coalesce(is_terminated, false) = true';
ELSIF _excluded_mode = 'all' THEN
NULL;
ELSE
_where := _where || ' and coalesce(is_terminated, false) = false';
END IF;

IF _q IS NOT NULL AND length(trim(_q)) > 0 THEN
FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_q, ',') AS x WHERE length(trim(x)) > 0 LOOP
_field_sql := '';
FOREACH _sf IN ARRAY _search_cols LOOP
IF _field_sql <> '' THEN _field_sql := _field_sql || ' or '; END IF;
_field_sql := _field_sql || format('%I::text ilike %L', _sf, '%' || _token || '%');
END LOOP;
_where := _where || format(' and (%s)', _field_sql);
END LOOP;
END IF;

FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters,'[]'::jsonb)) LOOP
_col := _filter->>'column'; _op := coalesce(_filter->>'op','in'); _val := _filter->'value';
IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
IF _op = 'in' THEN
  IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
    _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
  END IF;
ELSIF _op = 'in_or_empty' THEN
  IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
    _where := _where || format(' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')', _col, _val, _col, _col);
  ELSE
    _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
  END IF;
ELSIF _op = 'text' THEN
  IF jsonb_typeof(_val) = 'string' THEN
    FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_val #>> '{}', ',') AS x WHERE length(trim(x)) > 0 LOOP
      _where := _where || format(' and %I::text ilike %L', _col, '%' || _token || '%');
    END LOOP;
  END IF;
ELSIF _op = 'empty' THEN
  _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
ELSIF _op = 'date_range' THEN
  IF _val ? 'emptyOnly' AND coalesce((_val->>'emptyOnly')::boolean, false) THEN
    _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
  ELSE
    IF _val ? 'from' AND (_val->>'from') <> '' THEN
      _where := _where || format(' and %I::date >= %L::date', _col, _val->>'from');
    END IF;
    IF _val ? 'to' AND (_val->>'to') <> '' THEN
      _where := _where || format(' and %I::date <= %L::date', _col, _val->>'to');
    END IF;
  END IF;
ELSIF _op = 'num_range' THEN
  IF _val ? 'min' AND (_val->>'min') <> '' THEN
    _where := _where || format(' and %I::numeric >= %L::numeric', _col, _val->>'min');
  END IF;
  IF _val ? 'max' AND (_val->>'max') <> '' THEN
    _where := _where || format(' and %I::numeric <= %L::numeric', _col, _val->>'max');
  END IF;
ELSIF _op = 'bool' THEN
  IF jsonb_typeof(_val) = 'boolean' THEN
    _where := _where || format(' and %I = %L', _col, (_val #>> '{}')::boolean);
  END IF;
END IF;
END LOOP;

_sort_sql := '';
FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort,'[]'::jsonb)) LOOP
_col := _sort_item->>'column';
IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
IF _sort_sql <> '' THEN _sort_sql := _sort_sql || ', '; END IF;
_sort_sql := _sort_sql || format('%I %s NULLS LAST', _col,
  CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'desc' ELSE 'asc' END);
END LOOP;
IF _sort_sql = '' THEN _sort_sql := 'sl_no asc NULLS LAST'; END IF;

_sql := format($q$
  WITH filtered AS (
    SELECT * FROM abd_items_raw WHERE %s
  ), counted AS (
    SELECT count(*)::bigint AS c FROM filtered
  ), paged AS (
    SELECT * FROM filtered ORDER BY %s OFFSET %s LIMIT %s
  )
  SELECT to_jsonb(p.*) AS rows, (SELECT c FROM counted) AS total_count
  FROM paged p
$q$, _where, _sort_sql, _offset, _limit);

RETURN QUERY EXECUTE _sql;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text, text[]) TO authenticated, service_role;

-- ===== 백필: 정본 판정과 stored 4컬럼이 불일치하는 행만 UPDATE =====
DO $bf$
DECLARE
  v_total   bigint;
  v_diff    bigint;
  v_ratio   numeric;
BEGIN
  SELECT count(*) INTO v_total FROM public.abd_items_raw;

  CREATE TEMP TABLE _abd_bf_diff ON COMMIT DROP AS
  SELECT r.id,
         public.abd_judge_v1(r, NULL) AS j
  FROM public.abd_items_raw r;

  DELETE FROM _abd_bf_diff d
  USING public.abd_items_raw r
  WHERE d.id = r.id
    AND COALESCE(r.bucket_top,'')          IS NOT DISTINCT FROM COALESCE(d.j->>'bucket_top','')
    AND COALESCE(r.current_stage,'')       IS NOT DISTINCT FROM COALESCE(d.j->>'current_stage','')
    AND COALESCE(r.active_round::text,'')  IS NOT DISTINCT FROM COALESCE(d.j->>'active_round','')
    AND COALESCE(r.latest_status_norm,'')  IS NOT DISTINCT FROM COALESCE(d.j->>'latest_status_norm','')
    AND COALESCE(r.needs_planning,false)   IS NOT DISTINCT FROM COALESCE((d.j->>'needs_planning')::boolean,false)
    AND COALESCE(r.needs_revise,false)     IS NOT DISTINCT FROM COALESCE((d.j->>'needs_revise')::boolean,false)
    AND COALESCE(array_to_string(r.delay_bucket,','),'') IS NOT DISTINCT FROM
        COALESCE((SELECT string_agg(x,',') FROM jsonb_array_elements_text(COALESCE(d.j->'delay_bucket','[]'::jsonb)) x),'');

  SELECT count(*) INTO v_diff FROM _abd_bf_diff;
  v_ratio := CASE WHEN v_total=0 THEN 0 ELSE v_diff::numeric / v_total END;
  RAISE NOTICE 'ABD backfill: total=%, diff=%, ratio=%', v_total, v_diff, v_ratio;

  IF v_ratio > 0.30 THEN
    RAISE NOTICE 'ABD backfill: SKIP UPDATE (diff ratio > 30%%). Function/trigger changes still applied.';
  ELSE
    UPDATE public.abd_items_raw r
    SET latest_status_norm  = NULLIF(d.j->>'latest_status_norm',''),
        status_mismatch     = COALESCE((d.j->>'status_mismatch')::boolean, false),
        active_round        = NULLIF(d.j->>'active_round','')::smallint,
        current_stage       = NULLIF(d.j->>'current_stage',''),
        bucket_top          = NULLIF(d.j->>'bucket_top',''),
        delay_bucket        = ARRAY(SELECT jsonb_array_elements_text(COALESCE(d.j->'delay_bucket','[]'::jsonb))),
        needs_planning      = COALESCE((d.j->>'needs_planning')::boolean, false),
        needs_revise        = COALESCE((d.j->>'needs_revise')::boolean, false),
        revise_source_round = NULLIF(d.j->>'revise_source_round','')::smallint,
        rs_result_missing   = COALESCE((d.j->>'rs_result_missing')::boolean, false),
        ur_aging_days       = NULLIF(d.j->>'ur_aging_days','')::integer
    FROM _abd_bf_diff d
    WHERE r.id = d.id;
    RAISE NOTICE 'ABD backfill: UPDATED % rows', v_diff;
  END IF;
END
$bf$;
