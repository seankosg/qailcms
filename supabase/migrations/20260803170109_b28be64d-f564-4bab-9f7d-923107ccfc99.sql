-- 1) 분류 정본: is_active=false 를 최우선 분기(취소 행은 latest_status='A' 라 뒤에 두면 Approved 로 샌다)
DROP FUNCTION IF EXISTS public.abd_bucket_of(text);
CREATE OR REPLACE FUNCTION public.abd_bucket_of(_bucket_top text, _is_active boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _is_active IS NOT TRUE THEN 'CANCELLED'
    WHEN _bucket_top = 'Approved' THEN 'Approved'
    WHEN _bucket_top = 'UR' THEN 'UR'
    WHEN _bucket_top = 'DS' THEN 'DS'
    ELSE 'RESUBMIT'
  END
$function$;

-- 2) counts: 6분할 · _include_inactive 폐기
DROP FUNCTION IF EXISTS public.abd_items_counts(text, boolean, text, date);
CREATE OR REPLACE FUNCTION public.abd_items_counts(_team text DEFAULT NULL::text, _plot text DEFAULT NULL::text, _as_of date DEFAULT NULL::date)
RETURNS TABLE(total_count bigint, approved_count bigint, ur_count bigint, ds_count bigint, resubmit_count bigint, cancelled_count bigint, latest_data_date text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top, is_active) = 'Approved')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top, is_active) = 'UR')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top, is_active) = 'DS')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top, is_active) = 'RESUBMIT')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top, is_active) = 'CANCELLED')::bigint,
    max(data_date)::text
  FROM public.abd_rows_as_of(_as_of)
  WHERE (_team IS NULL OR _team = '' OR team = ANY(string_to_array(_team, ',')))
    AND (_plot IS NULL OR plot = _plot);
$function$;

-- 3) dashboard row1: 모집단 전건(취소 포함)
CREATE OR REPLACE FUNCTION public.abd_dashboard_row1_json(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT public.abd_bucket_of(bucket_top, is_active) AS bucket_top, team
    FROM public.abd_rows_as_of(_as_of)
    WHERE (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), agg AS (
    SELECT bucket_top AS bucket, NULL::text AS team, count(*) AS cnt FROM base GROUP BY bucket_top
    UNION ALL SELECT 'TOTAL', NULL, count(*) FROM base
    UNION ALL SELECT bucket_top, team, count(*) FROM base GROUP BY bucket_top, team
    UNION ALL SELECT 'TOTAL', team, count(*) FROM base GROUP BY team
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg;
$function$;

-- 4) facets: _include_inactive 폐기
DROP FUNCTION IF EXISTS public.abd_items_facets(text, text, text, boolean, text, text, jsonb, integer, date);
CREATE OR REPLACE FUNCTION public.abd_items_facets(_column text, _team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _plot text DEFAULT NULL::text, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _limit integer DEFAULT 500, _as_of date DEFAULT NULL::date)
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

-- 5) search: _include_inactive 폐기 · cancelled 상태 · 지연 계열은 취소 명시 제외
DROP FUNCTION IF EXISTS public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text[], date);
CREATE OR REPLACE FUNCTION public.abd_items_search(_team text DEFAULT NULL::text, _status_group text DEFAULT NULL::text, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100, _plot text DEFAULT NULL::text, _bucket text[] DEFAULT NULL::text[], _as_of date DEFAULT NULL::date)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _allowed_cols text[] := public.abd_allowed_cols();
  _cell_stages constant text[] := ARRAY['all','draft_start','draft_finish','submission','dar','approval'];
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','hdec_pic_name','hdec_eng_name','dis','service','plot','latest_rev','latest_status',
    'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
  ];
  _bk constant text := 'public.abd_bucket_of(bucket_top, is_active)';
  _where text := 'true';
  _sort_sql text := '';
  _filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
  _sg text;
  _src text := format('public.abd_rows_as_of(%L::date) abd_items_raw', _as_of);
  _cols text[]; _c text; _from text; _to text; _or text;
  _cell_stage text; _cell_field text; _cell_mode text; _cs text;
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
    _where := _where || format(' and %s = ''Approved''', _bk);
  ELSIF _sg IN ('not_started','ns') THEN
    _where := _where || ' and current_stage = ''DS1''';
  ELSIF _sg IN ('in_progress','inprogress') THEN
    _where := _where || format(' and %s in (''DS'',''UR'',''RESUBMIT'')', _bk);
  ELSIF _sg IN ('unapproved') THEN
    _where := _where || format(' and %s in (''DS'',''UR'',''RESUBMIT'')', _bk);
  ELSIF _sg = 'under_review' THEN
    _where := _where || format(' and %s = ''UR''', _bk);
  ELSIF _sg = 'resubmit' THEN
    _where := _where || format(' and %s = ''RESUBMIT''', _bk);
  ELSIF _sg = 'drafting' THEN
    _where := _where || format(' and %s = ''DS''', _bk);
  ELSIF _sg = 'cancelled' THEN
    _where := _where || format(' and %s = ''CANCELLED''', _bk);
  ELSIF _sg = 'rs_delay' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and primary_delay like ''RS%%''', _bk);
  ELSIF _sg = 'sb_delay' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and primary_delay like ''SB%%''', _bk);
  ELSIF _sg = 'df_delay' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and primary_delay like ''DF%%''', _bk);
  ELSIF _sg = 'ds_delay' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and primary_delay like ''DS%%''', _bk);
  ELSIF _sg = 'no_plan' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[]))', _bk);
  ELSIF _sg = 'delayed' THEN
    _where := _where || format(' and %s not in (''Approved'',''CANCELLED'') and (primary_delay is not null or ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[])))', _bk);
  ELSIF _sg <> '' AND _sg <> 'all' THEN
    RAISE EXCEPTION 'abd_items_search: unknown status_group %', _status_group
      USING HINT = 'allowed: approved,in_progress,not_started,unapproved,under_review,drafting,resubmit,cancelled,rs_delay,sb_delay,df_delay,ds_delay,no_plan,delayed,sg_*,sgd_*';
  END IF;

  IF _bucket IS NOT NULL AND array_length(_bucket,1) > 0 THEN
    _where := _where || format(' and %s = any(%L::text[])', _bk, _bucket);
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

    IF _op IN ('stage_plan_range','stage_actual_range') THEN
      IF _val IS NULL OR jsonb_typeof(_val) <> 'object' THEN CONTINUE; END IF;
      _cell_stage := _val->>'stage';
      _cell_field := coalesce(_val->>'field', CASE WHEN _op = 'stage_actual_range' THEN 'actual' ELSE 'planned' END);
      _cell_mode  := coalesce(_val->>'planMode', 'baseline');
      _from := _val->>'from'; _to := coalesce(_val->>'to', _val->>'from');
      IF coalesce(_cell_stage,'') = '' OR coalesce(_from,'') = '' THEN CONTINUE; END IF;
      FOREACH _cs IN ARRAY string_to_array(_cell_stage, ',') LOOP
        IF NOT (_cs = ANY(_cell_stages)) THEN
          RAISE EXCEPTION 'abd_items_search: unknown cell stage %', _cs;
        END IF;
      END LOOP;
      IF NOT (_cell_field = ANY(ARRAY['planned','actual'])) THEN
        RAISE EXCEPTION 'abd_items_search: unknown cell field %', _cell_field;
      END IF;
      IF NOT (_cell_mode = ANY(ARRAY['baseline','remaining'])) THEN
        RAISE EXCEPTION 'abd_items_search: unknown cell plan mode %', _cell_mode;
      END IF;
      _where := _where || format(
        ' and abd_items_raw.id in (select item_id from public.abd_progress_cell_ids(%L, %L, %L::date, %L::date, %L::date, %L))',
        _cell_stage, _cell_field, _from, _to, coalesce(_as_of::text, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date::text), _cell_mode);
      CONTINUE;
    END IF;

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
    IF _col = 'status_group' THEN
      IF _op = 'in' AND jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        SELECT array_agg(b) INTO _cols FROM (
          SELECT CASE x
                   WHEN 'approved' THEN 'Approved'
                   WHEN 'under_review' THEN 'UR'
                   WHEN 'drafting' THEN 'DS'
                   WHEN 'resubmit' THEN 'RESUBMIT'
                   WHEN 'cancelled' THEN 'CANCELLED'
                 END AS b
          FROM jsonb_array_elements_text(_val) AS x
        ) s WHERE b IS NOT NULL;
        IF _cols IS NOT NULL AND array_length(_cols,1) > 0 THEN
          _where := _where || format(' and %s = any(%L::text[])', _bk, _cols);
        END IF;
      END IF;
      CONTINUE;
    END IF;
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