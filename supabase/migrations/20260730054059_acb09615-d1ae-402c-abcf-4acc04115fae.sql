CREATE OR REPLACE FUNCTION public.abd_judge_v1(_row abd_items_raw, _as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_active smallint := NULL;
  v_stage text := NULL;
  v_stage_kind text := NULL;
  v_bucket text := NULL;
  v_delay text[] := '{}';
  v_late text[] := '{}';
  v_primary text := NULL;
  v_needs_plan boolean := false;
  v_needs_revise boolean := false;
  v_revise_src smallint := NULL;
  v_rs_missing boolean := false;
  v_ur_days integer := NULL;
  v_raw_up text;
  v_norm text;
  v_mismatch boolean;
  v_comp text := NULL;
  v_comp_grp text := NULL;
  ds_p date; ds_a date; df_p date; df_a date; sb_p date; sb_a date; rs_p date; rs_a date; rr char(1);
BEGIN
  v_raw_up := CASE WHEN _row.latest_status IS NULL THEN NULL ELSE upper(btrim(_row.latest_status)) END;
  v_norm := CASE WHEN v_raw_up IN ('A','B','C') THEN v_raw_up ELSE NULL END;
  v_mismatch := COALESCE(v_raw_up IS NOT NULL AND v_raw_up NOT IN ('A','B','C'), false);

  IF _row.r3_draft_start_actual IS NOT NULL OR _row.r3_draft_finish_actual IS NOT NULL
     OR _row.r3_submission_actual IS NOT NULL OR _row.r3_dar_actual IS NOT NULL
     OR _row.r2_response_result IN ('B','C') THEN
    v_active := 3;
  ELSIF _row.r2_draft_start_actual IS NOT NULL OR _row.r2_draft_finish_actual IS NOT NULL
     OR _row.r2_submission_actual IS NOT NULL OR _row.r2_dar_actual IS NOT NULL
     OR _row.r1_response_result IN ('B','C') THEN
    v_active := 2;
  ELSE
    v_active := 1;
  END IF;

  -- completed_stage: 마지막으로 실제 일어난 사실 (라운드 높은 것 우선, 같은 라운드 내 후행 단계 우선)
  IF _row.r3_dar_actual IS NOT NULL THEN v_comp := 'RS3';
  ELSIF _row.r3_submission_actual IS NOT NULL THEN v_comp := 'SB3';
  ELSIF _row.r3_draft_finish_actual IS NOT NULL THEN v_comp := 'DF3';
  ELSIF _row.r3_draft_start_actual IS NOT NULL THEN v_comp := 'DS3';
  ELSIF _row.r2_dar_actual IS NOT NULL THEN v_comp := 'RS2';
  ELSIF _row.r2_submission_actual IS NOT NULL THEN v_comp := 'SB2';
  ELSIF _row.r2_draft_finish_actual IS NOT NULL THEN v_comp := 'DF2';
  ELSIF _row.r2_draft_start_actual IS NOT NULL THEN v_comp := 'DS2';
  ELSIF _row.r1_dar_actual IS NOT NULL THEN v_comp := 'RS1';
  ELSIF _row.r1_submission_actual IS NOT NULL THEN v_comp := 'SB1';
  ELSIF _row.r1_draft_finish_actual IS NOT NULL THEN v_comp := 'DF1';
  ELSIF _row.r1_draft_start_actual IS NOT NULL THEN v_comp := 'DS1';
  END IF;

  IF _row.is_terminated THEN
    v_comp := 'TM' || v_active::text;
    v_comp_grp := 'TM';
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'RESUBMIT'||v_active::text, 'bucket_top', 'RESUBMIT',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', v_comp, 'completed_stage_group', v_comp_grp
    );
  END IF;

  IF v_norm = 'A' THEN
    IF _row.r3_response_result = 'A' THEN v_active := 3;
    ELSIF _row.r2_response_result = 'A' THEN v_active := 2;
    ELSE v_active := 1;
    END IF;
    RETURN jsonb_build_object(
      'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
      'current_stage', 'Approved', 'bucket_top', 'Approved',
      'delay_bucket', '{}'::text[], 'delay_late', '{}'::text[], 'primary_delay', NULL,
      'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
      'rs_result_missing', false, 'ur_aging_days', NULL,
      'completed_stage', 'Approved', 'completed_stage_group', 'APPROVED'
    );
  END IF;

  v_comp_grp := CASE WHEN v_comp IS NULL THEN NULL ELSE left(v_comp, 2) END;

  IF v_active = 1 THEN
    ds_p := _row.r1_draft_start_plan; ds_a := _row.r1_draft_start_actual;
    df_p := _row.r1_draft_finish_plan; df_a := _row.r1_draft_finish_actual;
    sb_p := _row.r1_submission_plan; sb_a := _row.r1_submission_actual;
    rs_p := _row.r1_dar_plan; rs_a := _row.r1_dar_actual; rr := _row.r1_response_result;
  ELSIF v_active = 2 THEN
    ds_p := _row.r2_draft_start_plan; ds_a := _row.r2_draft_start_actual;
    df_p := _row.r2_draft_finish_plan; df_a := _row.r2_draft_finish_actual;
    sb_p := _row.r2_submission_plan; sb_a := _row.r2_submission_actual;
    rs_p := _row.r2_dar_plan; rs_a := _row.r2_dar_actual; rr := _row.r2_response_result;
  ELSE
    ds_p := _row.r3_draft_start_plan; ds_a := _row.r3_draft_start_actual;
    df_p := _row.r3_draft_finish_plan; df_a := _row.r3_draft_finish_actual;
    sb_p := _row.r3_submission_plan; sb_a := _row.r3_submission_actual;
    rs_p := _row.r3_dar_plan; rs_a := _row.r3_dar_actual; rr := _row.r3_response_result;
  END IF;

  IF ds_a IS NULL THEN
    v_stage_kind := 'DS';
  ELSIF df_a IS NULL THEN
    v_stage_kind := 'DF';
  ELSIF sb_a IS NULL THEN
    v_stage_kind := 'SB';
  ELSE
    v_stage_kind := 'RS';
  END IF;
  v_stage := v_stage_kind || v_active::text;

  -- NS 폐지(2026-07-30): 실적 전무 도면도 R1 DS 로 귀속. bucket 'NS' 산출 금지.
  IF v_stage_kind = 'RS' THEN
    v_bucket := 'UR';
  ELSE
    v_bucket := 'DS';
  END IF;

  IF v_stage_kind = 'RS' THEN
    v_rs_missing := (rs_a IS NOT NULL AND rr IS NULL);
    IF rs_a IS NOT NULL THEN v_ur_days := v_today - rs_a;
    ELSIF sb_a IS NOT NULL THEN v_ur_days := v_today - sb_a;
    END IF;
  END IF;

  IF ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN v_delay := array_append(v_delay,'DS'); END IF;
  IF df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN v_delay := array_append(v_delay,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN v_delay := array_append(v_delay,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN v_delay := array_append(v_delay,'RS'); END IF;

  IF ds_p IS NOT NULL AND ds_a IS NOT NULL AND ds_a > ds_p THEN v_late := array_append(v_late,'DS'); END IF;
  IF df_p IS NOT NULL AND df_a IS NOT NULL AND df_a > df_p THEN v_late := array_append(v_late,'DF'); END IF;
  IF sb_p IS NOT NULL AND sb_a IS NOT NULL AND sb_a > sb_p THEN v_late := array_append(v_late,'SB'); END IF;
  IF rs_p IS NOT NULL AND rs_a IS NOT NULL AND rs_a > rs_p THEN v_late := array_append(v_late,'RS'); END IF;

  IF v_stage_kind = 'DS' AND ds_p IS NOT NULL AND ds_p < v_today AND ds_a IS NULL THEN
    v_primary := 'DS'||v_active::text;
  ELSIF v_stage_kind = 'DF' AND df_p IS NOT NULL AND df_p < v_today AND df_a IS NULL THEN
    v_primary := 'DF'||v_active::text;
  ELSIF v_stage_kind = 'SB' AND sb_p IS NOT NULL AND sb_p < v_today AND sb_a IS NULL THEN
    v_primary := 'SB'||v_active::text;
  ELSIF v_stage_kind = 'RS' AND rs_p IS NOT NULL AND rs_p < v_today AND rs_a IS NULL THEN
    v_primary := 'RS'||v_active::text;
  END IF;

  IF v_active = 2 AND _row.r1_response_result IN ('B','C')
     AND (_row.r2_draft_start_plan IS NULL OR _row.r2_draft_finish_plan IS NULL OR _row.r2_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 1;
  ELSIF v_active = 3 AND _row.r2_response_result IN ('B','C')
     AND (_row.r3_draft_start_plan IS NULL OR _row.r3_draft_finish_plan IS NULL OR _row.r3_submission_plan IS NULL) THEN
    v_needs_plan := true; v_delay := array_append(v_delay,'NoPlan'); v_needs_revise := true; v_revise_src := 2;
  END IF;

  RETURN jsonb_build_object(
    'latest_status_norm', v_norm, 'status_mismatch', v_mismatch, 'active_round', v_active,
    'current_stage', v_stage, 'bucket_top', v_bucket,
    'delay_bucket', v_delay, 'delay_late', v_late, 'primary_delay', v_primary,
    'needs_planning', v_needs_plan, 'needs_revise', v_needs_revise, 'revise_source_round', v_revise_src,
    'rs_result_missing', v_rs_missing, 'ur_aging_days', v_ur_days,
    'completed_stage', v_comp, 'completed_stage_group', v_comp_grp
  );
END;
$function$;

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
  IF _sg IN ('sg_ns','sgd_ns') THEN
    -- 하위호환 어댑터(2026-07-30 NS 폐지): 구 NS 그룹 딥링크 -> R1 DS(code DS1)
    _where := _where || ' and current_stage = ''DS1''';
    IF _sg = 'sgd_ns' THEN _where := _where || ' and primary_delay is not null'; END IF;
  ELSIF _sg LIKE 'sg~_%' ESCAPE '~' OR _sg LIKE 'sgd~_%' ESCAPE '~' THEN
    -- 스테이지 그룹(관리 축) 필터: sg_<code> = 재고, sgd_<code> = 그중 primary_delay 보유
    _where := _where || format(' and public.abd_stage_group(abd_items_raw.*) = %L', upper(split_part(_sg,'_',2)));
    IF _sg LIKE 'sgd~_%' ESCAPE '~' THEN
      _where := _where || ' and primary_delay is not null';
    END IF;
  ELSIF _sg IN ('approved') THEN
    _where := _where || ' and coalesce(bucket_top,''DS'') = ''Approved''';
  ELSIF _sg IN ('not_started','ns') THEN
    -- 하위호환 어댑터(2026-07-30 NS 폐지): 실적 전무 = current_stage 'DS1'
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
    _where := _where || ' and latest_status_norm is distinct from ''A'' and primary_delay like ''RS%''';
  ELSIF _sg = 'sb_delay' THEN
    _where := _where || ' and latest_status_norm is distinct from ''A'' and primary_delay like ''SB%''';
  ELSIF _sg = 'df_delay' THEN
    _where := _where || ' and latest_status_norm is distinct from ''A'' and primary_delay like ''DF%''';
  ELSIF _sg = 'ds_delay' THEN
    _where := _where || ' and latest_status_norm is distinct from ''A'' and primary_delay like ''DS%''';
  ELSIF _sg = 'no_plan' THEN
    _where := _where || ' and latest_status_norm is distinct from ''A'' and ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[]))';
  ELSIF _sg = 'delayed' THEN
    _where := _where || ' and latest_status_norm is distinct from ''A'' and (primary_delay is not null or ''NoPlan'' = any(coalesce(delay_bucket,''{}''::text[])))';
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
$function$;

CREATE OR REPLACE FUNCTION public.abd_stage_group(_row abd_items_raw)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 2026-07-30: NS 폐지. 실적 전무 도면도 current_stage 'DS1' -> 'DS' 그룹.
  SELECT CASE
    WHEN coalesce(_row.is_terminated,false) THEN 'RESUBMIT'
    WHEN coalesce(_row.bucket_top,'') = 'Approved' OR upper(btrim(coalesce(_row.latest_status,''))) = 'A' THEN 'APPROVED'
    ELSE left(coalesce(_row.current_stage,'DS'), 2)
  END
$function$;

CREATE OR REPLACE FUNCTION public.abd_stage_group_counts(_plots text[] DEFAULT NULL::text[], _teams text[] DEFAULT NULL::text[], _batch_no text[] DEFAULT NULL::text[])
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
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR r.team = ANY(_teams))
      AND (_batch_no IS NULL OR r.batch_no = ANY(_batch_no))
    GROUP BY 1,2,3
  ) s
$function$;

ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_change_log;
UPDATE public.abd_items_raw SET bucket_top = bucket_top WHERE bucket_top = 'NS';
ALTER TABLE public.abd_items_raw ENABLE TRIGGER trg_abd_change_log;