DROP FUNCTION IF EXISTS public.abd_items_facets(text, text, text, boolean, text);

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
    'document_title','abd_number','abd_ocs_no','pic',
    'r1_drafting_plan','r1_drafting_actual','r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_drafting_plan','r2_drafting_actual','r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_drafting_plan','r3_drafting_actual','r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'latest_rev','latest_status','approval_date','status_group','is_active','field_mismatch','data_date','updated_at','created_at'
  ];
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','pic','dis','service','plot','latest_rev','latest_status',
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
  -- status_group as scope only when facet is not for status_group itself
  IF _status_group IN ('approved','in_progress','not_started') AND _column <> 'status_group' THEN
    _where := _where || format(' and status_group = %L', _status_group);
  END IF;
  IF NOT _include_inactive THEN
    _where := _where || ' and is_active = true';
  END IF;

  -- global search (_q)
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

  -- column filters (self excluded)
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