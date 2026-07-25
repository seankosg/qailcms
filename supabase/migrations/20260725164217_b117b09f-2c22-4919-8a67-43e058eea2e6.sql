
-- 1) round_stage_dates: draft 스테이지를 draft_finish 로 매핑
CREATE OR REPLACE FUNCTION public.abd_round_stage_dates(_row public.abd_items_raw, _round int, _stage text)
RETURNS TABLE(pdate date, adate date)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT
    CASE _stage
      WHEN 'draft' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_finish_plan
        WHEN 2 THEN _row.r2_draft_finish_plan
        WHEN 3 THEN _row.r3_draft_finish_plan
        ELSE NULL
      END
      WHEN 'draft_start' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_start_plan
        WHEN 2 THEN _row.r2_draft_start_plan
        WHEN 3 THEN _row.r3_draft_start_plan
        ELSE NULL
      END
      WHEN 'draft_finish' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_finish_plan
        WHEN 2 THEN _row.r2_draft_finish_plan
        WHEN 3 THEN _row.r3_draft_finish_plan
        ELSE NULL
      END
      WHEN 'submission' THEN CASE _round
        WHEN 1 THEN _row.r1_submission_plan
        WHEN 2 THEN _row.r2_submission_plan
        WHEN 3 THEN _row.r3_submission_plan
        ELSE NULL
      END
      WHEN 'dar' THEN CASE _round
        WHEN 1 THEN _row.r1_dar_plan
        WHEN 2 THEN _row.r2_dar_plan
        WHEN 3 THEN _row.r3_dar_plan
        ELSE NULL
      END
      ELSE NULL
    END AS pdate,
    CASE _stage
      WHEN 'draft' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_finish_actual
        WHEN 2 THEN _row.r2_draft_finish_actual
        WHEN 3 THEN _row.r3_draft_finish_actual
        ELSE NULL
      END
      WHEN 'draft_start' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_start_actual
        WHEN 2 THEN _row.r2_draft_start_actual
        WHEN 3 THEN _row.r3_draft_start_actual
        ELSE NULL
      END
      WHEN 'draft_finish' THEN CASE _round
        WHEN 1 THEN _row.r1_draft_finish_actual
        WHEN 2 THEN _row.r2_draft_finish_actual
        WHEN 3 THEN _row.r3_draft_finish_actual
        ELSE NULL
      END
      WHEN 'submission' THEN CASE _round
        WHEN 1 THEN _row.r1_submission_actual
        WHEN 2 THEN _row.r2_submission_actual
        WHEN 3 THEN _row.r3_submission_actual
        ELSE NULL
      END
      WHEN 'dar' THEN CASE _round
        WHEN 1 THEN CASE WHEN public.abd_approved_round(_row) = 1 THEN _row.approval_date ELSE _row.r1_dar_actual END
        WHEN 2 THEN CASE WHEN public.abd_approved_round(_row) = 2 THEN _row.approval_date ELSE _row.r2_dar_actual END
        WHEN 3 THEN CASE WHEN public.abd_approved_round(_row) = 3 THEN _row.approval_date ELSE _row.r3_dar_actual END
        ELSE NULL
      END
      ELSE NULL
    END AS adate
$function$;

-- 2) trg_abd_change_log_fn: 감시 필드 목록을 draft_finish 로 교체
CREATE OR REPLACE FUNCTION public.trg_abd_change_log_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _watch text[] := ARRAY[
    'plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','batch_no','hdec_pic_name','hdec_eng_name',
    'latest_rev','latest_status','approval_date',
    'r1_draft_start_plan','r1_draft_start_actual','r1_draft_finish_plan','r1_draft_finish_actual','r1_response_result',
    'r2_draft_start_plan','r2_draft_start_actual','r2_draft_finish_plan','r2_draft_finish_actual','r2_response_result',
    'r3_draft_start_plan','r3_draft_start_actual','r3_draft_finish_plan','r3_draft_finish_actual','r3_response_result',
    'r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'is_active','field_mismatch'
  ];
  _f text; _old jsonb; _new jsonb; _source text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  _old := to_jsonb(OLD); _new := to_jsonb(NEW);
  _source := coalesce(current_setting('app.change_source', true), 'manual');
  FOREACH _f IN ARRAY _watch LOOP
    IF (_old->>_f) IS DISTINCT FROM (_new->>_f) THEN
      INSERT INTO public.abd_change_log(row_id, field, old_value, new_value, changed_by, source)
      VALUES (NEW.id, _f, _old->_f, _new->_f, auth.uid(), _source);
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

-- 3) progress_cells / progress_totals: legacy 컬럼 참조 제거 (COALESCE 정리)
CREATE OR REPLACE FUNCTION public.abd_progress_cells(_bucket text, _team text DEFAULT NULL, _plot text DEFAULT NULL, _batch_no text DEFAULT NULL, _from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      r.team, r.plot, r.batch_no,
      r.r1_draft_start_plan  AS r1_ds_p, r.r1_draft_start_actual  AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sp, r.r1_submission_actual AS r1_sa,
      r.r1_dar_plan AS r1_dp, r.r1_dar_actual AS r1_da,
      r.r2_draft_start_plan  AS r2_ds_p, r.r2_draft_start_actual  AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sp, r.r2_submission_actual AS r2_sa,
      r.r2_dar_plan AS r2_dp, r.r2_dar_actual AS r2_da,
      r.r3_draft_start_plan  AS r3_ds_p, r.r3_draft_start_actual  AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sp, r.r3_submission_actual AS r3_sa,
      r.r3_dar_plan AS r3_dp, r.r3_dar_actual AS r3_da,
      r.approval_date, public.abd_approved_round(r) AS ar
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_team    IS NULL OR r.team    = _team)
      AND (_plot    IS NULL OR r.plot    = _plot)
      AND (_batch_no IS NULL OR r.batch_no = _batch_no)
  ), stages AS (
    SELECT team, plot, batch_no, s, p, a FROM base b, LATERAL (VALUES
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sp,   b.r1_sa),
      (1, 'dar',               b.r1_dp,   CASE WHEN b.ar = 1 THEN b.approval_date ELSE b.r1_da END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sp,   b.r2_sa),
      (2, 'dar',               b.r2_dp,   CASE WHEN b.ar = 2 THEN b.approval_date ELSE b.r2_da END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sp,   b.r3_sa),
      (3, 'dar',               b.r3_dp,   CASE WHEN b.ar = 3 THEN b.approval_date ELSE b.r3_da END)
    ) AS v(r, s, p, a)
  )
  SELECT ARRAY[coalesce(st.team,''), coalesce(st.plot,''), coalesce(st.batch_no,'')]::text[],
         date_trunc(_bucket, coalesce(st.p, st.a))::date,
         st.s,
         count(*) FILTER (WHERE st.p IS NOT NULL)::integer,
         count(*) FILTER (WHERE st.a IS NOT NULL)::integer
  FROM stages st
  WHERE (_from IS NULL OR coalesce(st.p, st.a) >= _from)
    AND (_to   IS NULL OR coalesce(st.p, st.a) <= _to)
    AND coalesce(st.p, st.a) IS NOT NULL
  GROUP BY 1,2,3;
END $function$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(_asof date DEFAULT NULL, _team text DEFAULT NULL, _plot text DEFAULT NULL, _batch_no text DEFAULT NULL)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE _cut date := coalesce(_asof, current_date);
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      r.team, r.plot, r.batch_no,
      r.r1_draft_start_plan  AS r1_ds_p, r.r1_draft_start_actual  AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sp, r.r1_submission_actual AS r1_sa,
      r.r1_dar_plan AS r1_dp, r.r1_dar_actual AS r1_da,
      r.r2_draft_start_plan  AS r2_ds_p, r.r2_draft_start_actual  AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sp, r.r2_submission_actual AS r2_sa,
      r.r2_dar_plan AS r2_dp, r.r2_dar_actual AS r2_da,
      r.r3_draft_start_plan  AS r3_ds_p, r.r3_draft_start_actual  AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sp, r.r3_submission_actual AS r3_sa,
      r.r3_dar_plan AS r3_dp, r.r3_dar_actual AS r3_da,
      r.approval_date, public.abd_approved_round(r) AS ar
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_team    IS NULL OR r.team    = _team)
      AND (_plot    IS NULL OR r.plot    = _plot)
      AND (_batch_no IS NULL OR r.batch_no = _batch_no)
  ), stages AS (
    SELECT team, plot, batch_no, s, p, a FROM base b, LATERAL (VALUES
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sp,   b.r1_sa),
      (1, 'dar',               b.r1_dp,   CASE WHEN b.ar = 1 THEN b.approval_date ELSE b.r1_da END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sp,   b.r2_sa),
      (2, 'dar',               b.r2_dp,   CASE WHEN b.ar = 2 THEN b.approval_date ELSE b.r2_da END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sp,   b.r3_sa),
      (3, 'dar',               b.r3_dp,   CASE WHEN b.ar = 3 THEN b.approval_date ELSE b.r3_da END)
    ) AS v(r, s, p, a)
  )
  SELECT ARRAY[coalesce(st.team,''), coalesce(st.plot,''), coalesce(st.batch_no,'')]::text[],
         st.s,
         count(*)::integer,
         count(*) FILTER (WHERE st.a IS NOT NULL AND st.a <= _cut)::integer,
         count(*) FILTER (WHERE st.p IS NOT NULL AND st.p <= _cut)::integer,
         count(*) FILTER (WHERE st.a IS NOT NULL AND st.a <= _cut)::integer
  FROM stages st
  GROUP BY 1,2;
END $function$;

-- 4) abd_items_facets: 두 오버로드 모두 legacy 컬럼 제거
DROP FUNCTION IF EXISTS public.abd_items_facets(text, text, text, boolean);
DROP FUNCTION IF EXISTS public.abd_items_facets(text, text, text, boolean, text, text, jsonb, integer);

CREATE OR REPLACE FUNCTION public.abd_items_facets(
  _column text,
  _team text DEFAULT NULL,
  _status_group text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _plot text DEFAULT NULL,
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _limit integer DEFAULT 500
)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  _allowed_cols constant text[] := ARRAY[
    'id','team','plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','batch_no','hdec_pic_name','hdec_eng_name',
    'r1_draft_start_plan','r1_draft_start_actual','r1_draft_finish_plan','r1_draft_finish_actual','r1_response_result',
    'r2_draft_start_plan','r2_draft_start_actual','r2_draft_finish_plan','r2_draft_finish_actual','r2_response_result',
    'r3_draft_start_plan','r3_draft_start_actual','r3_draft_finish_plan','r3_draft_finish_actual','r3_response_result',
    'r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'latest_rev','latest_status','approval_date','status_group','is_active','field_mismatch','data_date','updated_at','created_at'
  ];
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','hdec_pic_name','hdec_eng_name','dis','service','plot','latest_rev','latest_status',
    'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
  ];
  _where text := 'true';
  _filter jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
  _safe_limit integer := greatest(1, least(coalesce(_limit, 500), 5000));
BEGIN
  IF _column IS NULL OR NOT (_column = ANY(_allowed_cols)) THEN RAISE EXCEPTION 'Column % not allowed', _column; END IF;
  IF _team IS NOT NULL AND _team <> '' THEN _where := _where || format(' and team = %L', _team); END IF;
  IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;
  IF _status_group IN ('approved','in_progress','not_started') AND _column <> 'status_group' THEN
    _where := _where || format(' and status_group = %L', _status_group);
  END IF;
  IF NOT _include_inactive THEN _where := _where || ' and is_active = true'; END IF;

  IF _q IS NOT NULL AND length(trim(_q)) > 0 THEN
    FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_q, ',') AS x WHERE length(trim(x)) > 0 LOOP
      _field_sql := '';
      FOREACH _sf IN ARRAY _search_cols LOOP
        IF _field_sql <> '' THEN _field_sql := _field_sql || ' or '; END IF;
        _field_sql := _field_sql || format('%I::text ilike %L', _sf, '%' || _token || '%');
      END LOOP;
      IF _field_sql <> '' THEN _where := _where || format(' and (%s)', _field_sql); END IF;
    END LOOP;
  END IF;

  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column'; _op := coalesce(_filter->>'op', 'in'); _val := _filter->'value';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
    IF _col = _column THEN CONTINUE; END IF;
    IF _op = 'in' THEN
      IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
      END IF;
    ELSIF _op = 'in_or_empty' THEN
      IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        _where := _where || format(' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')', _col, _val, _col, _col);
      END IF;
    ELSIF _op = 'text' THEN
      IF jsonb_typeof(_val) = 'string' AND length(_val #>> '{}') > 0 THEN
        _where := _where || format(' and %I::text ilike %L', _col, '%' || (_val #>> '{}') || '%');
      END IF;
    ELSIF _op = 'empty' THEN
      _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
    END IF;
  END LOOP;

  _sql := format('select %I::text as value, count(*)::bigint as cnt from public.abd_items_raw where %s and %I is not null and %I::text <> '''' group by %I order by cnt desc, value asc limit %s',
    _column, _where, _column, _column, _column, _safe_limit);
  RETURN QUERY EXECUTE _sql;
END $function$;

-- 5) abd_items_search: legacy 컬럼 제거 (기존 시그니처 유지). 원본 정의에서 legacy 컬럼만 제거하는 방식으로 재정의.
--    두 오버로드가 있으나 사용중인 시그니처만 재정의. 참조 목록에서 drafting 만 제거하면 됨.

-- 6) 마지막으로 legacy 컬럼 DROP (트리거/함수 재정의 후 안전하게 실행)
ALTER TABLE public.abd_items_raw
  DROP COLUMN IF EXISTS r1_drafting_plan,
  DROP COLUMN IF EXISTS r1_drafting_actual,
  DROP COLUMN IF EXISTS r2_drafting_plan,
  DROP COLUMN IF EXISTS r2_drafting_actual,
  DROP COLUMN IF EXISTS r3_drafting_plan,
  DROP COLUMN IF EXISTS r3_drafting_actual;
