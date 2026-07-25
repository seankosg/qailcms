
-- 파일 경로: /tmp/combined.sql 참조. 내용 일괄 적용.
-- (SQL 본문은 도구 인자로 직접 삽입)

-- Note: This migration inlines the cleaned function definitions produced in /tmp/combined.sql
-- All references to r{1,2,3}_drafting_plan/actual have been removed.

CREATE OR REPLACE FUNCTION public.abd_progress_cells(_plots text[], _teams text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text)
 RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE WHEN UPPER(r.latest_status)='A' THEN
        CASE
          WHEN r.r3_dar_actual IS NOT NULL OR r.r3_dar_plan IS NOT NULL THEN 3
          WHEN r.r2_dar_actual IS NOT NULL OR r.r2_dar_plan IS NOT NULL THEN 2
          ELSE 1
        END
      END AS approved_round,
      r.r1_draft_start_plan AS r1_ds_p, r.r1_draft_start_actual AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sb_p, r.r1_submission_actual AS r1_sb_a,
      r.r1_dar_plan AS r1_rs_p, r.r1_dar_actual AS r1_rs_a,
      r.r2_draft_start_plan AS r2_ds_p, r.r2_draft_start_actual AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sb_p, r.r2_submission_actual AS r2_sb_a,
      r.r2_dar_plan AS r2_rs_p, r.r2_dar_actual AS r2_rs_a,
      r.r3_draft_start_plan AS r3_ds_p, r.r3_draft_start_actual AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sb_p, r.r3_submission_actual AS r3_sb_a,
      r.r3_dar_plan AS r3_rs_p, r.r3_dar_actual AS r3_rs_a,
      r.approval_date
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate,
           (s.adate IS NOT NULL AND s.adate <= _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sb_p, b.r1_sb_a),
      (1, 'dar',               b.r1_rs_p, CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_rs_a END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sb_p, b.r2_sb_a),
      (2, 'dar',               b.r2_rs_p, CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_rs_a END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sb_p, b.r3_sb_a),
      (3, 'dar',               b.r3_rs_p, CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_rs_a END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round = 'all' OR ('R' || s.round_num) = UPPER(_round)
  ),
  events AS (
    SELECT gk, CASE WHEN _bucket='week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso, stage, 1 AS p, 0 AS a
    FROM stage_expand
    WHERE pdate IS NOT NULL AND pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode='baseline' OR NOT done_asof)
    UNION ALL
    SELECT gk, CASE WHEN _bucket='week' THEN date_trunc('week', adate)::date ELSE adate END, stage, 0, 1
    FROM stage_expand
    WHERE adate IS NOT NULL AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events GROUP BY 1,2,3
$function$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(_plots text[], _teams text[], _group_by text[], _as_of_date date, _plan_mode text, _round text)
 RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE WHEN UPPER(r.latest_status)='A' THEN
        CASE
          WHEN r.r3_dar_actual IS NOT NULL OR r.r3_dar_plan IS NOT NULL THEN 3
          WHEN r.r2_dar_actual IS NOT NULL OR r.r2_dar_plan IS NOT NULL THEN 2
          ELSE 1
        END
      END AS approved_round,
      r.r1_draft_start_plan AS r1_ds_p, r.r1_draft_start_actual AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sb_p, r.r1_submission_actual AS r1_sb_a,
      r.r1_dar_plan AS r1_rs_p, r.r1_dar_actual AS r1_rs_a,
      r.r2_draft_start_plan AS r2_ds_p, r.r2_draft_start_actual AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sb_p, r.r2_submission_actual AS r2_sb_a,
      r.r2_dar_plan AS r2_rs_p, r.r2_dar_actual AS r2_rs_a,
      r.r3_draft_start_plan AS r3_ds_p, r.r3_draft_start_actual AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sb_p, r.r3_submission_actual AS r3_sb_a,
      r.r3_dar_plan AS r3_rs_p, r.r3_dar_actual AS r3_rs_a,
      r.approval_date
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sb_p, b.r1_sb_a),
      (1, 'dar',               b.r1_rs_p, CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_rs_a END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sb_p, b.r2_sb_a),
      (2, 'dar',               b.r2_rs_p, CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_rs_a END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sb_p, b.r3_sb_a),
      (3, 'dar',               b.r3_rs_p, CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_rs_a END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round = 'all' OR ('R' || s.round_num) = UPPER(_round)
  )
  SELECT gk, stage,
         COUNT(*) FILTER (WHERE pdate IS NOT NULL OR adate IS NOT NULL)::int,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int,
         COUNT(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date)::int,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int
  FROM stage_expand
  GROUP BY 1, 2
$function$;

-- abd_items_search: legacy 컬럼만 _allowed_cols 배열에서 제거
CREATE OR REPLACE FUNCTION public.abd_items_search(_team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _include_inactive boolean DEFAULT false, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100)
 RETURNS TABLE(rows jsonb, total_count bigint)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  _allowed_cols constant text[] := ARRAY[
    'id','team','plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','pic',
    'r1_draft_start_plan','r1_draft_start_actual','r1_draft_finish_plan','r1_draft_finish_actual','r1_response_result',
    'r2_draft_start_plan','r2_draft_start_actual','r2_draft_finish_plan','r2_draft_finish_actual','r2_response_result',
    'r3_draft_start_plan','r3_draft_start_actual','r3_draft_finish_plan','r3_draft_finish_actual','r3_response_result',
    'r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'latest_rev','latest_status','approval_date','status_group','is_active','field_mismatch','data_date','updated_at','created_at'
  ];
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','pic','dis','service','plot','latest_rev','latest_status',
    'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
  ];
  _where text := 'true';
  _sort_sql text := '';
  _first boolean := true;
  _filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
BEGIN
  IF _team IS NOT NULL AND _team <> '' THEN _where := _where || format(' and team = %L', _team); END IF;
  IF _status_group IN ('approved','in_progress','not_started') THEN _where := _where || format(' and status_group = %L', _status_group); END IF;
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
    _col := _filter->>'column'; _op := coalesce(_filter->>'op','in'); _val := _filter->'value';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
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

  FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) LOOP
    _col := _sort_item->>'column'; _op := lower(coalesce(_sort_item->>'dir','asc'));
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
    IF _op NOT IN ('asc','desc') THEN _op := 'asc'; END IF;
    IF _first THEN _sort_sql := ' order by '; _first := false; ELSE _sort_sql := _sort_sql || ', '; END IF;
    _sort_sql := _sort_sql || format('%I %s nulls last', _col, _op);
  END LOOP;
  IF _first THEN _sort_sql := ' order by updated_at desc nulls last, id desc'; END IF;

  _sql := format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) as rows, (select count(*) from public.abd_items_raw where %s)::bigint as total_count
     from (select * from public.abd_items_raw t
      where %s %s
      offset %L limit %L) t',
    _where, _where, _sort_sql, greatest(_offset, 0), least(coalesce(_limit,100), 2000)
  );
  RETURN QUERY EXECUTE _sql;
END $function$;
