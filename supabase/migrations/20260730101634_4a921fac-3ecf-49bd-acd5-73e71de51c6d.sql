-- ============ 1) Raw Data 검색/패싯/카운트 ============
DROP FUNCTION IF EXISTS public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text, text[]);
DROP FUNCTION IF EXISTS public.abd_items_facets(text, text, text, boolean, text, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.abd_items_counts(text, boolean, text);

CREATE OR REPLACE FUNCTION public.abd_items_counts(_team text DEFAULT NULL::text, _include_inactive boolean DEFAULT false, _plot text DEFAULT NULL::text, _as_of date DEFAULT NULL::date)
 RETURNS TABLE(approved_count bigint, in_progress_count bigint, not_started_count bigint, total_count bigint, excluded_count bigint, latest_data_date text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    count(*) FILTER (WHERE NOT COALESCE(is_terminated,false) AND coalesce(bucket_top,'') = 'Approved')::bigint,
    count(*) FILTER (WHERE NOT COALESCE(is_terminated,false) AND coalesce(bucket_top,'') <> 'Approved' AND completed_stage IS NOT NULL)::bigint,
    count(*) FILTER (WHERE NOT COALESCE(is_terminated,false) AND coalesce(bucket_top,'') <> 'Approved' AND completed_stage IS NULL)::bigint,
    count(*) FILTER (WHERE NOT COALESCE(is_terminated,false))::bigint,
    count(*) FILTER (WHERE COALESCE(is_terminated,false))::bigint,
    max(data_date)::text
  FROM public.abd_rows_as_of(_as_of)
  WHERE (_team IS NULL OR _team = '' OR team = ANY(string_to_array(_team, ',')))
    AND (_plot IS NULL OR plot = _plot)
    AND (_include_inactive OR is_active = true);
$function$;

CREATE OR REPLACE FUNCTION public.abd_items_facets(_column text, _team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _include_inactive boolean DEFAULT false, _plot text DEFAULT NULL::text, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _limit integer DEFAULT 500, _as_of date DEFAULT NULL::date)
 RETURNS TABLE(value text, cnt bigint)
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
  _filter jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
  _src text := format('public.abd_rows_as_of(%L::date) abd_items_raw', _as_of);
  _safe_limit integer := greatest(1, least(coalesce(_limit, 500), 5000));
BEGIN
  IF _column IS NULL OR NOT (_column = ANY(_allowed_cols)) THEN
    RAISE EXCEPTION 'abd_items_facets: unknown facet column %', _column
      USING HINT = 'Add to abd_items_raw schema or public.abd_derived_cols()';
  END IF;

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
    IF _col IS NULL THEN CONTINUE; END IF;
    IF _col = 'status_group' THEN CONTINUE; END IF;
    IF _col = _column THEN CONTINUE; END IF;
    IF NOT (_col = ANY(_allowed_cols)) THEN
      RAISE EXCEPTION 'abd_items_facets: unknown filter column %', _col
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

  _sql := format($q$
    with src as (select * from %s),
    base as (
      select %I::text as value, count(*)::bigint as cnt
        from src abd_items_raw
        where %s and %I is not null and %I::text <> ''
        group by %I
    ),
    empty_row as (
      select '__EMPTY__'::text as value, count(*)::bigint as cnt
        from src abd_items_raw
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
  $q$, _src, _column, _where, _column, _column, _column, _where, _column, _column, _safe_limit);

  RETURN QUERY EXECUTE _sql;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_items_search(_team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _include_inactive boolean DEFAULT false, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100, _plot text DEFAULT NULL::text, _excluded_mode text DEFAULT 'hide'::text, _bucket text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
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
  _src text := format('public.abd_rows_as_of(%L::date) abd_items_raw', _as_of);
  _cols text[]; _c text; _from text; _to text; _or text;
BEGIN
  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = any(%L::text[])', string_to_array(_team, ','));
  END IF;
  IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;

  _sg := lower(coalesce(_status_group,''));
  IF _sg IN ('sg_ns','sgd_ns') THEN
    _where := _where || ' and current_stage = ''DS1''';
    IF _sg = 'sgd_ns' THEN _where := _where || ' and primary_delay is not null'; END IF;
  ELSIF _sg LIKE 'sg~_%' ESCAPE '~' OR _sg LIKE 'sgd~_%' ESCAPE '~' THEN
    _where := _where || format(' and public.abd_stage_group(abd_items_raw.*) = %L', upper(split_part(_sg,'_',2)));
    IF _sg LIKE 'sgd~_%' ESCAPE '~' THEN
      _where := _where || ' and primary_delay is not null';
    END IF;
  ELSIF _sg IN ('approved') THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') = ''Approved''';
  ELSIF _sg IN ('not_started','ns') THEN
    _where := _where || ' and current_stage = ''DS1''';
  ELSIF _sg IN ('in_progress','inprogress') THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') in (''DS'',''UR'',''RESUBMIT'')';
  ELSIF _sg IN ('unapproved') THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') <> ''Approved''';
  ELSIF _sg = 'under_review' THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') = ''UR''';
  ELSIF _sg = 'drafting' THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') = ''DS''';
  ELSIF _sg = 'rs_delay' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and primary_delay like ''RS%''';
  ELSIF _sg = 'sb_delay' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and primary_delay like ''SB%''';
  ELSIF _sg = 'df_delay' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and primary_delay like ''DF%''';
  ELSIF _sg = 'ds_delay' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and primary_delay like ''DS%''';
  ELSIF _sg = 'no_plan' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[]))';
  ELSIF _sg = 'delayed' THEN
    _where := _where || ' and coalesce(bucket_top,'''') <> ''Approved'' and (primary_delay is not null or ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[])))';
  ELSIF _sg <> '' AND _sg <> 'all' THEN
    RAISE EXCEPTION 'abd_items_search: unknown status_group %', _status_group
      USING HINT = 'allowed: approved,in_progress,not_started,unapproved,under_review,drafting,rs_delay,sb_delay,df_delay,ds_delay,no_plan,delayed,sg_*,sgd_*';
  END IF;

  IF _bucket IS NOT NULL AND array_length(_bucket,1) > 0 THEN
    _where := _where || format(' and coalesce(bucket_top,''DS'') = any(%L::text[])', _bucket);
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

  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column'; _op := coalesce(_filter->>'op', 'in'); _val := _filter->'value';

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
    IF _col = 'status_group' THEN CONTINUE; END IF;
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
    'WITH filtered AS (SELECT abd_items_raw.* FROM %s WHERE %s) '
    || 'SELECT to_jsonb(t), (SELECT count(*) FROM filtered) FROM ('
    || 'SELECT * FROM filtered ORDER BY %s LIMIT %s OFFSET %s'
    || ') t',
    _src, _where, _sort_sql, greatest(1, least(_limit, 5000)), greatest(0, _offset)
  );
  RETURN QUERY EXECUTE _sql;
END;
$function$;

-- ============ 2) 대시보드 / Progress 스트립 ============
DROP FUNCTION IF EXISTS public.abd_stage_group_counts(text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_stage_group_counts(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'stage_group', sg, 'stage', stage, 'team', team, 'total', total, 'delayed', delayed
         ) ORDER BY sg, stage, team), '[]'::jsonb)
  FROM (
    SELECT public.abd_stage_group(r.*) AS sg,
           coalesce(r.current_stage,'') AS stage,
           coalesce(r.team,'') AS team,
           count(*)::bigint AS total,
           count(r.primary_delay)::bigint AS delayed
    FROM public.abd_rows_as_of(_as_of) r
    WHERE r.is_active = true
      AND (_plots IS NULL OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR r.team = ANY(_teams))
      AND (_batch_no IS NULL OR r.batch_no = ANY(_batch_no))
    GROUP BY 1,2,3
  ) s
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_row1_json(text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_row1_json(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT COALESCE(bucket_top,'DS') AS bucket_top, team
    FROM public.abd_rows_as_of(_as_of)
    WHERE is_active
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), agg AS (
    SELECT bucket_top AS bucket, NULL::text AS team, count(*) AS cnt FROM base GROUP BY bucket_top
    UNION ALL SELECT 'TOTAL', NULL, count(*) FROM base
    UNION ALL SELECT bucket_top, team, count(*) FROM base GROUP BY bucket_top, team
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg;
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_row2_json(text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_row2_json(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT team, primary_delay, needs_planning
    FROM public.abd_rows_as_of(_as_of)
    WHERE is_active
      AND COALESCE(bucket_top,'') <> 'Approved'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), tagged AS (
    SELECT team, left(primary_delay,2) || '_DELAY' AS b FROM base WHERE primary_delay IS NOT NULL
    UNION ALL
    SELECT team, 'NO_PLAN'::text FROM base WHERE needs_planning
  ), agg AS (
    SELECT b AS bucket, NULL::text AS team, count(*) AS cnt FROM tagged GROUP BY b
    UNION ALL SELECT 'TOTAL_DELAY', NULL, count(*) FROM tagged WHERE b <> 'NO_PLAN'
    UNION ALL SELECT b, team, count(*) FROM tagged GROUP BY b, team
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg;
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_status_dist(text[], text[]);
DROP FUNCTION IF EXISTS public.abd_dashboard_status_dist(text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_status_dist(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS TABLE(status text, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(latest_status_norm, CASE WHEN current_stage = 'NO_HISTORY' THEN 'NO_HISTORY' ELSE 'NS' END), count(*)
  FROM public.abd_rows_as_of(_as_of)
  WHERE is_active
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
    AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  GROUP BY 1;
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_crosscut(text[], text[]);
DROP FUNCTION IF EXISTS public.abd_dashboard_crosscut(text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_crosscut(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS TABLE(dis text, service text, bucket text, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT dis, service, bucket_top, delay_bucket
    FROM public.abd_rows_as_of(_as_of)
    WHERE is_active
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  )
  SELECT dis, service, 'TOTAL'::text, count(*) FROM base GROUP BY dis, service
  UNION ALL
  SELECT dis, service, 'APPROVED'::text, count(*) FROM base WHERE COALESCE(bucket_top,'')='Approved' GROUP BY dis, service
  UNION ALL
  SELECT dis, service, 'DELAYED'::text, count(*) FROM base WHERE COALESCE(array_length(delay_bucket,1),0) > 0 GROUP BY dis, service;
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_attention_lists(text[], text[], integer, text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_attention_lists(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _limit integer DEFAULT 20, _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT * FROM public.abd_rows_as_of(_as_of)
    WHERE is_active
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), u AS (
    (SELECT 'needs_planning'::text AS list_kind, id, team, plot, abd_number, document_title,
            current_stage, ur_aging_days, latest_status, hdec_pic_name
     FROM src WHERE needs_planning ORDER BY updated_at DESC LIMIT _limit)
    UNION ALL
    (SELECT 'needs_revise'::text, id, team, plot, abd_number, document_title,
            current_stage, ur_aging_days, latest_status, hdec_pic_name
     FROM src WHERE needs_revise ORDER BY updated_at DESC LIMIT _limit)
    UNION ALL
    (SELECT 'ur_aging'::text, id, team, plot, abd_number, document_title,
            current_stage, ur_aging_days, latest_status, hdec_pic_name
     FROM src WHERE bucket_top='UR' AND ur_aging_days IS NOT NULL
     ORDER BY ur_aging_days DESC NULLS LAST LIMIT _limit)
    UNION ALL
    (SELECT 'status_mismatch'::text, id, team, plot, abd_number, document_title,
            current_stage, ur_aging_days, latest_status, hdec_pic_name
     FROM src WHERE status_mismatch = true ORDER BY updated_at DESC LIMIT _limit)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb) FROM u;
$function$;

DROP FUNCTION IF EXISTS public.abd_dashboard_judgment_mix(text[], text[]);
CREATE OR REPLACE FUNCTION public.abd_dashboard_judgment_mix(_batch_no text[] DEFAULT NULL::text[], _plots text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
 RETURNS TABLE(stage text, total bigint, approved bigint, normal bigint, caution bigint, delayed bigint, critical bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_warn int;
  v_late int;
BEGIN
  SELECT COALESCE(ur_aging_warn_days, 3), COALESCE(ur_aging_late_days, 7)
    INTO v_warn, v_late
  FROM public.abd_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
  v_warn := COALESCE(v_warn, 3);
  v_late := COALESCE(v_late, 7);

  RETURN QUERY
  WITH base AS (
    SELECT
      COALESCE(NULLIF(UPPER(r.current_stage), ''), 'NS') AS stg_raw,
      COALESCE(r.bucket_top,'') AS bkt,
      COALESCE(r.ur_aging_days, 0) AS aging
    FROM public.abd_rows_as_of(_as_of) r
    WHERE true
      AND (_batch_no IS NULL OR r.batch_no = ANY(_batch_no))
      AND (_plots    IS NULL OR r.plot     = ANY(_plots))
  ),
  norm AS (
    SELECT
      CASE
        WHEN stg_raw = 'NO_HISTORY' THEN 'NO_HISTORY'
        WHEN bkt = 'Approved' THEN 'Approved'
        WHEN bkt = 'UR' THEN 'UR'
        ELSE 'DS'
      END AS stage,
      CASE
        WHEN stg_raw = 'NO_HISTORY' THEN '이력 없음'
        WHEN bkt = 'Approved' THEN '완료'
        WHEN bkt = 'UR' AND aging >= v_late * 2 THEN '위험'
        WHEN bkt = 'UR' AND aging >= v_late THEN '지연'
        WHEN bkt = 'UR' AND aging >= v_warn THEN '주의'
        ELSE '정상'
      END AS jdg
    FROM base
  )
  SELECT
    s.stage,
    COUNT(n.stage)::bigint AS total,
    COUNT(*) FILTER (WHERE n.jdg = '완료')::bigint AS approved,
    COUNT(*) FILTER (WHERE n.jdg = '정상')::bigint AS normal,
    COUNT(*) FILTER (WHERE n.jdg = '주의')::bigint AS caution,
    COUNT(*) FILTER (WHERE n.jdg = '지연')::bigint AS delayed,
    COUNT(*) FILTER (WHERE n.jdg = '위험')::bigint AS critical
  FROM (VALUES ('NS'),('DS'),('UR'),('Approved'),('NO_HISTORY')) AS s(stage)
  LEFT JOIN norm n ON n.stage = s.stage
  GROUP BY s.stage
  HAVING s.stage <> 'NO_HISTORY' OR COUNT(n.stage) > 0
  ORDER BY CASE s.stage WHEN 'NS' THEN 1 WHEN 'DS' THEN 2 WHEN 'UR' THEN 3 WHEN 'Approved' THEN 4 ELSE 5 END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_items_search(text,text,boolean,text,jsonb,jsonb,integer,integer,text,text,text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_items_facets(text,text,text,boolean,text,text,jsonb,integer,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_items_counts(text,boolean,text,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_stage_group_counts(text[],text[],text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row1_json(text[],text[],text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row2_json(text[],text[],text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_status_dist(text[],text[],text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_crosscut(text[],text[],text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_attention_lists(text[],text[],integer,text[],date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_judgment_mix(text[],text[],date) TO authenticated, service_role;