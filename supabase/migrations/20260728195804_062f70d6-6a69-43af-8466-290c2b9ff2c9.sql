CREATE OR REPLACE FUNCTION public.abd_items_search(_team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _include_inactive boolean DEFAULT false, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100, _plot text DEFAULT NULL::text, _excluded_mode text DEFAULT 'hide'::text, _bucket text[] DEFAULT NULL::text[])
 RETURNS TABLE(rows jsonb, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  -- 파생 컬럼 추가 시 public.abd_derived_cols() 를 갱신할 것.
  _allowed_cols text[] := public.abd_allowed_cols();
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','hdec_pic_name','hdec_eng_name','dis','service','plot','latest_rev','latest_status',
    'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
  ];
  _where text := 'true';
  _sort_sql text := '';
  _filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
  _sg text;
  _cols text[]; _c text; _from text; _to text; _or text;
BEGIN
  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = any(%L::text[])', string_to_array(_team, ','));
  END IF;
  IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;

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
      IF _field_sql <> '' THEN _where := _where || format(' and (%s)', _field_sql); END IF;
    END LOOP;
  END IF;

  -- 필터: 미허용 컬럼은 즉시 실패
  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column'; _op := coalesce(_filter->>'op', 'in'); _val := _filter->'value';

    -- date_range_or: multi-column OR range. column 필드는 무시하고 value.columns[] 사용.
    IF _op = 'date_range_or' THEN
      IF _val IS NULL OR jsonb_typeof(_val) <> 'object' THEN CONTINUE; END IF;
      IF jsonb_typeof(_val->'columns') <> 'array' THEN CONTINUE; END IF;
      _from := _val->>'from'; _to := _val->>'to';
      IF coalesce(_from,'') = '' AND coalesce(_to,'') = '' THEN CONTINUE; END IF;
      SELECT array_agg(x) INTO _cols FROM jsonb_array_elements_text(_val->'columns') AS x;
      IF _cols IS NULL OR array_length(_cols,1) = 0 THEN CONTINUE; END IF;
      _or := '';
      FOREACH _c IN ARRAY _cols LOOP
        IF NOT (_c = ANY(_allowed_cols)) THEN
          RAISE EXCEPTION 'abd_items_search: unknown filter column % (date_range_or)', _c
            USING HINT = 'Add to abd_items_raw schema or public.abd_derived_cols()';
        END IF;
        IF _or <> '' THEN _or := _or || ' or '; END IF;
        _or := _or || '(';
        IF coalesce(_from,'') <> '' THEN
          _or := _or || format('%I::date >= %L::date', _c, _from);
        ELSE
          _or := _or || 'true';
        END IF;
        IF coalesce(_to,'') <> '' THEN
          _or := _or || format(' and %I::date <= %L::date', _c, _to);
        END IF;
        _or := _or || ')';
      END LOOP;
      _where := _where || format(' and (%s)', _or);
      CONTINUE;
    END IF;

    IF _col IS NULL THEN CONTINUE; END IF;
    IF _col = 'status_group' THEN CONTINUE; END IF; -- 특수: 상단 status_group 파라미터로 우회
    IF NOT (_col = ANY(_allowed_cols)) THEN
      RAISE EXCEPTION 'abd_items_search: unknown filter column %', _col
        USING HINT = 'Add to abd_items_raw schema or public.abd_derived_cols()';
    END IF;
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
      IF _val ? 'min' AND length(coalesce(_val->>'min','')) > 0 THEN
        _where := _where || format(' and %I::numeric >= %L::numeric', _col, _val->>'min');
      END IF;
      IF _val ? 'max' AND length(coalesce(_val->>'max','')) > 0 THEN
        _where := _where || format(' and %I::numeric <= %L::numeric', _col, _val->>'max');
      END IF;
    ELSIF _op = 'bool' THEN
      IF jsonb_typeof(_val) = 'boolean' THEN
        _where := _where || format(' and %I = %L::boolean', _col, _val::text);
      END IF;
    END IF;
  END LOOP;

  -- 정렬: 미허용 컬럼은 즉시 실패
  _sort_sql := '';
  FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) LOOP
    _col := _sort_item->>'column';
    IF _col IS NULL THEN CONTINUE; END IF;
    IF NOT (_col = ANY(_allowed_cols)) THEN
      RAISE EXCEPTION 'abd_items_search: unknown sort column %', _col
        USING HINT = 'Add to abd_items_raw schema or public.abd_derived_cols()';
    END IF;
    IF _sort_sql <> '' THEN _sort_sql := _sort_sql || ', '; END IF;
    _sort_sql := _sort_sql || format('%I %s NULLS LAST', _col, CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'DESC' ELSE 'ASC' END);
  END LOOP;
  IF _sort_sql = '' THEN _sort_sql := 'sl_no ASC NULLS LAST, abd_number ASC'; END IF;

  _sql := format(
    'WITH filtered AS (SELECT * FROM public.abd_items_raw WHERE %s) '
    || 'SELECT to_jsonb(t), (SELECT count(*) FROM filtered) FROM ('
    || 'SELECT * FROM filtered ORDER BY %s LIMIT %s OFFSET %s'
    || ') t',
    _where, _sort_sql, greatest(1, least(_limit, 5000)), greatest(0, _offset)
  );
  RETURN QUERY EXECUTE _sql;
END;
$function$