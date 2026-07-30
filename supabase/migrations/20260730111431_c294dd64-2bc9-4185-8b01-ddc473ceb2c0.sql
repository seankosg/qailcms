-- 1) 공용 이벤트 소스: 매트릭스 셀과 드릴다운이 동일 술어를 공유한다.
CREATE OR REPLACE FUNCTION public.abd_progress_events(
  _as_of_date date,
  _plan_mode text DEFAULT 'baseline',
  _round text DEFAULT 'all'
)
RETURNS TABLE(item_id uuid, stage text, field text, edate date)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT (public.abd_judge_v1(r, _as_of_date)) AS judge, r.*
    FROM public.abd_items_raw r
    WHERE r.is_active = true
  ),
  expanded AS (
    SELECT b.id AS item_id,
           (b.judge->>'active_round')::int AS v_active,
           (b.judge->>'bucket_top')        AS bucket_top,
           v.rn, v.stage, v.pdate, v.adate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1,'draft_start'::text,  b.r1_draft_start_plan,  b.r1_draft_start_actual),
      (1,'draft_finish',       b.r1_draft_finish_plan, b.r1_draft_finish_actual),
      (1,'submission',         b.r1_submission_plan,   b.r1_submission_actual),
      (1,'dar',                b.r1_dar_plan,          b.r1_dar_actual),
      (2,'draft_start',        b.r2_draft_start_plan,  b.r2_draft_start_actual),
      (2,'draft_finish',       b.r2_draft_finish_plan, b.r2_draft_finish_actual),
      (2,'submission',         b.r2_submission_plan,   b.r2_submission_actual),
      (2,'dar',                b.r2_dar_plan,          b.r2_dar_actual),
      (3,'draft_start',        b.r3_draft_start_plan,  b.r3_draft_start_actual),
      (3,'draft_finish',       b.r3_draft_finish_plan, b.r3_draft_finish_actual),
      (3,'submission',         b.r3_submission_plan,   b.r3_submission_actual),
      (3,'dar',                b.r3_dar_plan,          b.r3_dar_actual)
    ) AS v(rn, stage, pdate, adate)
    WHERE _round = 'all'
       OR v.rn = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
  ),
  -- AP(Approval): 문서 단위 종결 이벤트. 라운드 무관.
  -- Actual = approval_date AND bucket_top='Approved'(현재 승인 유효분만).
  -- Plan = "현재 승인 전망"(이동 예측형): 미승인 → active_round 의 dar_plan,
  --        승인 → 승인 라운드(response_result='A')의 dar_plan 고정, 레거시는 NULL.
  docs AS (
    SELECT b.id AS item_id,
           (b.judge->>'bucket_top') AS bucket_top,
           CASE WHEN (b.judge->>'bucket_top') = 'Approved'
                THEN b.approval_date ELSE NULL END AS ap_actual,
           CASE
             WHEN b.r1_response_result = 'A' THEN b.r1_dar_plan
             WHEN b.r2_response_result = 'A' THEN b.r2_dar_plan
             WHEN b.r3_response_result = 'A' THEN b.r3_dar_plan
             WHEN (b.judge->>'bucket_top') = 'Approved' THEN NULL
             ELSE CASE (b.judge->>'active_round')::int
                    WHEN 1 THEN b.r1_dar_plan
                    WHEN 2 THEN b.r2_dar_plan
                    WHEN 3 THEN b.r3_dar_plan
                  END
           END AS ap_plan
    FROM base b
  )
  SELECT item_id, stage, 'planned'::text, pdate
  FROM expanded
  WHERE pdate IS NOT NULL
    AND (
      (_plan_mode = 'baseline' AND rn <= v_active)
      OR (_plan_mode <> 'baseline' AND rn = v_active
          AND bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date))
    )
  UNION ALL
  SELECT item_id, stage, 'actual'::text, adate
  FROM expanded
  WHERE adate IS NOT NULL
  UNION ALL
  SELECT item_id, 'approval'::text, 'planned'::text, ap_plan
  FROM docs
  WHERE ap_plan IS NOT NULL
    AND (_plan_mode = 'baseline' OR bucket_top <> 'Approved')
  UNION ALL
  SELECT item_id, 'approval'::text, 'actual'::text, ap_actual
  FROM docs
  WHERE ap_actual IS NOT NULL
$function$;

GRANT EXECUTE ON FUNCTION public.abd_progress_events(date, text, text) TO authenticated, service_role;

-- 2) 매트릭스 집계를 공용 이벤트 소스로 교체(시그니처 동일, 수치 동일).
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[], _bucket text,
  _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- 술어 정본 = public.abd_progress_events(). 드릴다운(abd_items_search 의
  -- stage_plan_range / stage_actual_range op)과 동일 소스를 공유한다. 사본 금지.
  WITH base AS (
    SELECT r.id,
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
          WHEN 'batch_no' THEN r.batch_no
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  ev AS (
    SELECT * FROM public.abd_progress_events(_as_of_date, _plan_mode, _round)
  )
  SELECT b.gk,
         CASE WHEN _bucket = 'week' THEN date_trunc('week', e.edate)::date ELSE e.edate END,
         e.stage,
         count(*) FILTER (WHERE e.field = 'planned')::int,
         count(*) FILTER (WHERE e.field = 'actual')::int
  FROM base b
  JOIN ev e ON e.item_id = b.id
  WHERE e.edate BETWEEN _range_start AND _range_end
  GROUP BY 1,2,3
$function$;

-- 3) 드릴다운: abd_items_search 에 셀 전용 필터 op 추가(시그니처 무변경).
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
  _cell_stage text; _cell_field text; _cell_mode text;
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

    -- Progress Matrix 셀 드릴다운 전용. 술어 정본은 public.abd_progress_events().
    -- value = { stage, field:'planned'|'actual', from, to, planMode:'baseline'|'remaining' }
    IF _op IN ('stage_plan_range','stage_actual_range') THEN
      IF _val IS NULL OR jsonb_typeof(_val) <> 'object' THEN CONTINUE; END IF;
      _cell_stage := _val->>'stage';
      _cell_field := coalesce(_val->>'field', CASE WHEN _op = 'stage_actual_range' THEN 'actual' ELSE 'planned' END);
      _cell_mode  := coalesce(_val->>'planMode', 'baseline');
      _from := _val->>'from'; _to := coalesce(_val->>'to', _val->>'from');
      IF coalesce(_cell_stage,'') = '' OR coalesce(_from,'') = '' THEN CONTINUE; END IF;
      IF NOT (_cell_stage = ANY(ARRAY['draft_start','draft_finish','submission','dar','approval'])) THEN
        RAISE EXCEPTION 'abd_items_search: unknown cell stage %', _cell_stage;
      END IF;
      IF NOT (_cell_field = ANY(ARRAY['planned','actual'])) THEN
        RAISE EXCEPTION 'abd_items_search: unknown cell field %', _cell_field;
      END IF;
      _where := _where || format(
        ' and abd_items_raw.id in (select e.item_id from public.abd_progress_events(%L::date, %L, ''all'') e'
        || ' where e.stage = %L and e.field = %L and e.edate between %L::date and %L::date)',
        coalesce(_as_of::text, current_date::text), _cell_mode, _cell_stage, _cell_field, _from, _to);
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