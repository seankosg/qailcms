DROP FUNCTION IF EXISTS public.dmr_facets(text, jsonb, text);

CREATE OR REPLACE FUNCTION public.dmr_facets(
  _column text,
  _filters jsonb DEFAULT '[]'::jsonb,
  _scope text DEFAULT 'all',
  _q text DEFAULT ''
)
 RETURNS TABLE(value text, cnt bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed_cols text[] := ARRAY[
    'report_date','discipline','system_name','contractor_name','plot','direct_flag',
    'task_no','task_name','task_level','work_category','pic_name','headcount_kind',
    'tc_plan_pct','tc_actual_pct','tplan_pct','tactual_pct','task_data_date'
  ];
  scope_pred text := CASE
    WHEN _scope = 'import' THEN 'e.task_no IS NULL'
    WHEN _scope = 'entry' THEN 'e.task_no IS NOT NULL'
    ELSE 'true'
  END;
  where_sql text := scope_pred;
  f jsonb;
  fcol text;
  fop text;
  fval jsonb;
  arr text[];
  term text;
  qq text := coalesce(btrim(_q), '');
BEGIN
  IF NOT (_column = ANY(allowed_cols)) THEN
    RAISE EXCEPTION 'invalid column: %', _column;
  END IF;

  IF qq <> '' THEN
    where_sql := where_sql || format(
      ' AND (e.system_name ILIKE %L OR e.contractor_name ILIKE %L)',
      '%' || qq || '%', '%' || qq || '%');
  END IF;

  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb))
  LOOP
    fcol := f->>'column';
    fop  := f->>'op';
    fval := f->'value';
    -- 자기 자신 컬럼은 제외(크로스 필터 표준)
    CONTINUE WHEN fcol IS NULL OR fcol = _column;
    IF NOT (fcol = ANY(allowed_cols)) THEN
      RAISE EXCEPTION 'invalid filter column: %', fcol;
    END IF;

    IF fcol = 'direct_flag' THEN
      SELECT array_agg(x) INTO arr FROM jsonb_array_elements_text(coalesce(fval, '[]'::jsonb)) t(x);
      IF arr IS NOT NULL AND array_length(arr, 1) > 0 THEN
        where_sql := where_sql || format(
          ' AND (CASE WHEN cm.is_direct IS TRUE THEN ''direct'' WHEN cm.is_direct IS FALSE THEN ''sub'' ELSE ''unknown'' END) = ANY(%L::text[])',
          arr);
      END IF;
      CONTINUE;
    END IF;

    IF fop = 'in' THEN
      SELECT array_agg(x) INTO arr FROM jsonb_array_elements_text(coalesce(fval, '[]'::jsonb)) t(x);
      IF arr IS NOT NULL AND array_length(arr, 1) > 0 THEN
        IF '(empty)' = ANY(arr) OR '__EMPTY__' = ANY(arr) THEN
          where_sql := where_sql || format(
            ' AND (e.%I::text = ANY(%L::text[]) OR e.%I IS NULL OR e.%I::text = '''')',
            fcol, arr, fcol, fcol);
        ELSE
          where_sql := where_sql || format(' AND e.%I::text = ANY(%L::text[])', fcol, arr);
        END IF;
      END IF;
    ELSIF fop = 'empty' THEN
      where_sql := where_sql || format(' AND (e.%I IS NULL OR e.%I::text = '''')', fcol, fcol);
    ELSIF fop = 'text' THEN
      FOR term IN SELECT btrim(t) FROM unnest(string_to_array(coalesce(fval #>> '{}', ''), ',')) t
      LOOP
        IF term <> '' THEN
          where_sql := where_sql || format(' AND e.%I::text ILIKE %L', fcol, '%' || term || '%');
        END IF;
      END LOOP;
    ELSIF fop = 'date_range' THEN
      IF coalesce(fval->>'from', '') <> '' THEN
        where_sql := where_sql || format(' AND e.%I >= %L::date', fcol, fval->>'from');
      END IF;
      IF coalesce(fval->>'to', '') <> '' THEN
        where_sql := where_sql || format(' AND e.%I <= %L::date', fcol, fval->>'to');
      END IF;
    ELSIF fop = 'num_range' THEN
      IF coalesce(fval->>'min', '') <> '' THEN
        where_sql := where_sql || format(' AND e.%I >= %L::numeric', fcol, fval->>'min');
      END IF;
      IF coalesce(fval->>'max', '') <> '' THEN
        where_sql := where_sql || format(' AND e.%I <= %L::numeric', fcol, fval->>'max');
      END IF;
    END IF;
  END LOOP;

  IF _column = 'direct_flag' THEN
    RETURN QUERY EXECUTE format(
      'SELECT CASE WHEN cm.is_direct IS TRUE THEN ''direct''
                   WHEN cm.is_direct IS FALSE THEN ''sub''
                   ELSE ''unknown'' END::text AS value,
              COUNT(*)::bigint AS cnt
       FROM public.dmr_entries e
       LEFT JOIN public.dmr_contractor_master cm ON cm.name = e.contractor_name
       WHERE %s
       GROUP BY 1
       ORDER BY 2 DESC', where_sql);
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT CASE WHEN e.%I IS NULL OR e.%I::text = '''' THEN ''__EMPTY__'' ELSE e.%I::text END AS value,
            COUNT(*)::bigint AS cnt
     FROM public.dmr_entries e
     LEFT JOIN public.dmr_contractor_master cm ON cm.name = e.contractor_name
     WHERE %s
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 500',
    _column, _column, _column, where_sql);
END;
$function$;