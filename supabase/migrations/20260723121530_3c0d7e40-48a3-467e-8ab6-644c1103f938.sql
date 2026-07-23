
-- 1) 컬럼 추가
ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS hdec_pic_name text,
  ADD COLUMN IF NOT EXISTS hdec_eng_name text;

-- 2) 기존 pic 값 이관: 한글 포함 여부로 자동 분배
UPDATE public.abd_items_raw
   SET hdec_pic_name = CASE WHEN pic ~ '[가-힣]' THEN pic ELSE hdec_pic_name END,
       hdec_eng_name = CASE WHEN pic IS NOT NULL AND pic !~ '[가-힣]' THEN pic ELSE hdec_eng_name END
 WHERE pic IS NOT NULL;

-- 3) 함수 재작성 (pic → hdec_pic_name / hdec_eng_name)
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
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _allowed_cols constant text[] := ARRAY[
    'id','team','plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','batch_no','hdec_pic_name','hdec_eng_name',
    'r1_drafting_plan','r1_drafting_actual','r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_drafting_plan','r2_drafting_actual','r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_drafting_plan','r3_drafting_actual','r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
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
  IF _column IS NULL OR NOT (_column = ANY(_allowed_cols)) THEN
    RAISE EXCEPTION 'Column % not allowed', _column;
  END IF;

  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = %L', _team);
  END IF;
  IF _plot IN ('C','D') THEN
    _where := _where || format(' and plot = %L', _plot);
  END IF;
  IF _status_group IN ('approved','in_progress','not_started') AND _column <> 'status_group' THEN
    _where := _where || format(' and status_group = %L', _status_group);
  END IF;
  IF NOT _include_inactive THEN
    _where := _where || ' and is_active = true';
  END IF;

  IF _q IS NOT NULL AND length(trim(_q)) > 0 THEN
    FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_q, ',') AS x WHERE length(trim(x)) > 0 LOOP
      _field_sql := '';
      FOREACH _sf IN ARRAY _search_cols LOOP
        IF _field_sql <> '' THEN _field_sql := _field_sql || ' or '; END IF;
        _field_sql := _field_sql || format('%I::text ilike %L', _sf, '%' || _token || '%');
      END LOOP;
      IF _field_sql <> '' THEN
        _where := _where || format(' and (%s)', _field_sql);
      END IF;
    END LOOP;
  END IF;

  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
    IF _col = _column THEN CONTINUE; END IF;

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
        IF _val ? 'from' AND length(coalesce(_val->>'from','')) > 0 THEN
          _where := _where || format(' and %I::date >= %L::date', _col, _val->>'from');
        END IF;
        IF _val ? 'to' AND length(coalesce(_val->>'to','')) > 0 THEN
          _where := _where || format(' and %I::date <= %L::date', _col, _val->>'to');
        END IF;
      END IF;
    ELSIF _op = 'num_range' THEN
      IF _val ? 'min' THEN _where := _where || format(' and %I::numeric >= %L::numeric', _col, _val->>'min'); END IF;
      IF _val ? 'max' THEN _where := _where || format(' and %I::numeric <= %L::numeric', _col, _val->>'max'); END IF;
    ELSIF _op = 'bool' THEN
      _where := _where || format(' and %I = %L::boolean', _col, _val #>> '{}');
    END IF;
  END LOOP;

  _sql := format(
    'select %I::text as value, count(*)::bigint as cnt
       from public.abd_items_raw
      where %s and %I is not null and %I::text <> ''''
      group by %I
      order by cnt desc, value asc
      limit %s',
    _column, _where, _column, _column, _column, _safe_limit
  );
  RETURN QUERY EXECUTE _sql;
END $$;

GRANT EXECUTE ON FUNCTION public.abd_items_facets(text, text, text, boolean, text, text, jsonb, integer) TO anon, authenticated;

-- 4) Progress cells/totals: 'pic' 그룹 키를 hdec_pic_name / hdec_eng_name 로 교체
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[],
  _bucket text, _range_start date, _range_end date,
  _as_of_date date, _plan_mode text, _round text
) RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
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
      r.r1_drafting_plan, r.r1_drafting_actual, r.r1_submission_plan, r.r1_submission_actual, r.r1_dar_plan, r.r1_dar_actual,
      r.r2_drafting_plan, r.r2_drafting_actual, r.r2_submission_plan, r.r2_submission_actual, r.r2_dar_plan, r.r2_dar_actual,
      r.r3_drafting_plan, r.r3_drafting_actual, r.r3_submission_plan, r.r3_submission_actual, r.r3_dar_plan, r.r3_dar_actual,
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
      (1, 'draft'::text,      b.r1_drafting_plan,   b.r1_drafting_actual),
      (1, 'submission',       b.r1_submission_plan, b.r1_submission_actual),
      (1, 'dar',              b.r1_dar_plan,        CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_dar_actual END),
      (2, 'draft',            b.r2_drafting_plan,   b.r2_drafting_actual),
      (2, 'submission',       b.r2_submission_plan, b.r2_submission_actual),
      (2, 'dar',              b.r2_dar_plan,        CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_dar_actual END),
      (3, 'draft',            b.r3_drafting_plan,   b.r3_drafting_actual),
      (3, 'submission',       b.r3_submission_plan, b.r3_submission_actual),
      (3, 'dar',              b.r3_dar_plan,        CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_dar_actual END)
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

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[],
  _as_of_date date, _plan_mode text, _round text
) RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
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
      r.r1_drafting_plan, r.r1_drafting_actual, r.r1_submission_plan, r.r1_submission_actual, r.r1_dar_plan, r.r1_dar_actual,
      r.r2_drafting_plan, r.r2_drafting_actual, r.r2_submission_plan, r.r2_submission_actual, r.r2_dar_plan, r.r2_dar_actual,
      r.r3_drafting_plan, r.r3_drafting_actual, r.r3_submission_plan, r.r3_submission_actual, r.r3_dar_plan, r.r3_dar_actual,
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
      (1, 'draft'::text,      b.r1_drafting_plan,   b.r1_drafting_actual),
      (1, 'submission',       b.r1_submission_plan, b.r1_submission_actual),
      (1, 'dar',              b.r1_dar_plan,        CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_dar_actual END),
      (2, 'draft',            b.r2_drafting_plan,   b.r2_drafting_actual),
      (2, 'submission',       b.r2_submission_plan, b.r2_submission_actual),
      (2, 'dar',              b.r2_dar_plan,        CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_dar_actual END),
      (3, 'draft',            b.r3_drafting_plan,   b.r3_drafting_actual),
      (3, 'submission',       b.r3_submission_plan, b.r3_submission_actual),
      (3, 'dar',              b.r3_dar_plan,        CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_dar_actual END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round='all' OR ('R' || s.round_num) = UPPER(_round)
  )
  SELECT gk, stage,
    count(*)::int,
    count(*) FILTER (WHERE done_asof)::int,
    count(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND (_plan_mode='baseline' OR NOT done_asof))::int,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int
  FROM stage_expand GROUP BY gk, stage
$function$;

-- 5) 이제 pic 컬럼 삭제 (모든 참조 제거 후)
ALTER TABLE public.abd_items_raw DROP COLUMN IF EXISTS pic;

-- 6) Field Config 갱신
DELETE FROM public.abd_field_config WHERE field_key = 'pic';
INSERT INTO public.abd_field_config (field_key, label, "group", data_type, editable, visible, sort_order)
VALUES
  ('hdec_pic_name','HDEC PIC','content','text',true,true,81),
  ('hdec_eng_name','HDEC ENG','content','text',true,true,82)
ON CONFLICT (field_key) DO UPDATE SET
  label = EXCLUDED.label,
  "group" = EXCLUDED."group",
  data_type = EXCLUDED.data_type,
  editable = EXCLUDED.editable,
  visible = EXCLUDED.visible,
  sort_order = EXCLUDED.sort_order;

-- 7) Header mappings 갱신 (기존 pic 매핑 삭제 + 새 매핑 추가)
DELETE FROM public.abd_header_mappings WHERE target_field = 'pic';
