
CREATE OR REPLACE FUNCTION public.abd_items_search(
  _team text DEFAULT NULL,
  _status_group text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _plot text DEFAULT NULL
)
RETURNS TABLE(rows jsonb, total_count bigint)
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
  _sort_sql text := '';
  _first boolean := true;
  _filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
BEGIN
  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = %L', _team);
  END IF;
  IF _plot IN ('C','D') THEN
    _where := _where || format(' and plot = %L', _plot);
  END IF;
  IF _status_group IN ('approved','in_progress','not_started') THEN
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
      _where := _where || format(' and (%s)', _field_sql);
    END LOOP;
  END IF;

  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
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

  FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) LOOP
    _col := _sort_item->>'column';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
    IF _first THEN
      _sort_sql := format(' order by %I %s nulls last', _col, CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'desc' ELSE 'asc' END);
      _first := false;
    ELSE
      _sort_sql := _sort_sql || format(', %I %s nulls last', _col, CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'desc' ELSE 'asc' END);
    END IF;
  END LOOP;
  IF _first THEN _sort_sql := ' order by team asc, plot asc, sl_no asc nulls last'; END IF;

  _sql := format(
    'select to_jsonb(t) as rows, count(*) over () as total_count
       from public.abd_items_raw t
      where %s %s
      offset %L limit %L',
    _where, _sort_sql, greatest(_offset, 0), least(coalesce(_limit,100), 2000)
  );
  RETURN QUERY EXECUTE _sql;
END $$;

CREATE OR REPLACE FUNCTION public.abd_items_facets(
  _column text,
  _team text DEFAULT NULL,
  _status_group text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _plot text DEFAULT NULL
)
RETURNS TABLE(value text, cnt bigint) LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _allowed constant text[] := ARRAY['team','plot','dis','service','pic','latest_rev','latest_status','status_group','doc_ax','doc_axx'];
  _where text := 'true'; _sql text;
BEGIN
  IF NOT (_column = ANY(_allowed)) THEN RAISE EXCEPTION 'Column % not allowed', _column; END IF;
  IF _team IS NOT NULL THEN _where := _where || format(' and team = %L', _team); END IF;
  IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;
  IF _status_group IS NOT NULL THEN _where := _where || format(' and status_group = %L', _status_group); END IF;
  IF NOT _include_inactive THEN _where := _where || ' and is_active = true'; END IF;
  _sql := format('select %I::text as value, count(*)::bigint as cnt from public.abd_items_raw where %s and %I is not null and %I::text <> '''' group by %I order by cnt desc, value asc limit 500',
    _column, _where, _column, _column, _column);
  RETURN QUERY EXECUTE _sql;
END $$;

CREATE OR REPLACE FUNCTION public.abd_items_counts(
  _team text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _plot text DEFAULT NULL
)
RETURNS TABLE(approved_count bigint, in_progress_count bigint, not_started_count bigint, total_count bigint, latest_data_date text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE status_group = 'approved')::bigint,
    count(*) FILTER (WHERE status_group = 'in_progress')::bigint,
    count(*) FILTER (WHERE status_group = 'not_started')::bigint,
    count(*)::bigint,
    max(data_date)::text
  FROM public.abd_items_raw
  WHERE (_team IS NULL OR team = _team)
    AND (_plot IS NULL OR plot = _plot)
    AND (_include_inactive OR is_active = true);
$$;
