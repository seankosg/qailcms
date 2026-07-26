
CREATE OR REPLACE FUNCTION public.abd_items_search(
  _team text DEFAULT NULL::text,
  _status_group text DEFAULT NULL::text,
  _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL::text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100,
  _plot text DEFAULT NULL::text,
  _excluded_mode text DEFAULT 'hide'::text
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
_first boolean := true;
_filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
_token text; _field_sql text; _sf text; _sql text;
BEGIN
IF _team IS NOT NULL AND _team <> '' THEN
_where := _where || format(' and team = any(%L::text[])', string_to_array(_team, ','));
END IF;
IF _plot IN ('C','D') THEN _where := _where || format(' and plot = %L', _plot); END IF;

-- Base status_group column values
IF _status_group IN ('approved','in_progress','not_started') THEN
  _where := _where || format(' and status_group = %L', _status_group);
-- Dashboard row1 buckets
ELSIF _status_group = 'under_review' THEN
  _where := _where || ' and coalesce(bucket_top, ''NS'') = ''UR''';
ELSIF _status_group = 'drafting' THEN
  _where := _where || ' and coalesce(bucket_top, ''NS'') = ''DS''';
-- Dashboard row2 delay buckets: raw values in delay_bucket are RS/SB/DS/NoPlan (mapped to RS_DELAY etc in row2 RPC)
ELSIF _status_group = 'rs_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''RS'' = any(coalesce(delay_bucket, ''{}''::text[]))';
ELSIF _status_group = 'sb_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''SB'' = any(coalesce(delay_bucket, ''{}''::text[]))';
ELSIF _status_group = 'ds_delay' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''DS'' = any(coalesce(delay_bucket, ''{}''::text[]))';
ELSIF _status_group = 'no_plan' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ''NoPlan'' = any(coalesce(delay_bucket, ''{}''::text[]))';
ELSIF _status_group = 'delayed' THEN
  _where := _where || ' and latest_status_norm is distinct from ''A'' and ('
    || '''RS'' = any(coalesce(delay_bucket, ''{}''::text[]))'
    || ' or ''SB'' = any(coalesce(delay_bucket, ''{}''::text[]))'
    || ' or ''DS'' = any(coalesce(delay_bucket, ''{}''::text[]))'
    || ' or ''NoPlan'' = any(coalesce(delay_bucket, ''{}''::text[]))'
    || ')';
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
FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) LOOP
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
  SELECT coalesce(jsonb_agg(to_jsonb(p.*)), '[]'::jsonb), (SELECT c FROM counted)
  FROM paged p
$q$, _where, _sort_sql, _offset, _limit);

RETURN QUERY EXECUTE _sql;
END;
$function$;
