CREATE OR REPLACE FUNCTION public.abd_items_facets(
  _column text,
  _team text DEFAULT NULL::text,
  _status_group text DEFAULT NULL::text,
  _include_inactive boolean DEFAULT false,
  _plot text DEFAULT NULL::text,
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _limit integer DEFAULT 500
)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
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
  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = any(%L::text[])', string_to_array(_team, ','));
  END IF;
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
        _where := _where || format(' and %I = %L::boolean', _col, _val::text);
      END IF;
    END IF;
  END LOOP;

  -- 값별 카운트 + (Empty) 카운트를 함께 반환. Empty > 0 일 때만 노출되도록 HAVING 필터.
  _sql := format($q$
    with base as (
      select %I::text as value, count(*)::bigint as cnt
        from public.abd_items_raw
        where %s and %I is not null and %I::text <> ''
        group by %I
    ),
    empty_row as (
      select '__EMPTY__'::text as value, count(*)::bigint as cnt
        from public.abd_items_raw
        where %s and (%I is null or %I::text = '')
        having count(*) > 0
    )
    select value, cnt from (
      select value, cnt, 0 as sort_group from empty_row
      union all
      select value, cnt, 1 as sort_group from base
    ) t
    order by sort_group asc, cnt desc, value asc
    limit %s
  $q$, _column, _where, _column, _column, _column, _where, _column, _column, _safe_limit);

  RETURN QUERY EXECUTE _sql;
END;
$function$;