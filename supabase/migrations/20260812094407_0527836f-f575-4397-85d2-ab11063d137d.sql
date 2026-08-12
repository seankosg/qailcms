DROP FUNCTION IF EXISTS public.dmr_facets(text, jsonb);

CREATE OR REPLACE FUNCTION public.dmr_facets(_column text, _filters jsonb DEFAULT '[]'::jsonb, _scope text DEFAULT 'all')
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
  -- Raw Data(=import) 와 Raw Data 2(=entry) 는 서로의 행을 절대 보지 않는다
  scope_pred text := CASE
    WHEN _scope = 'import' THEN 'task_no IS NULL'
    WHEN _scope = 'entry' THEN 'task_no IS NOT NULL'
    ELSE 'true'
  END;
BEGIN
  IF NOT (_column = ANY(allowed_cols)) THEN
    RAISE EXCEPTION 'invalid column: %', _column;
  END IF;

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
       ORDER BY 2 DESC',
      replace(scope_pred, 'task_no', 'e.task_no')
    );
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT COALESCE(%I::text, ''(empty)'') AS value, COUNT(*)::bigint AS cnt
     FROM public.dmr_entries
     WHERE %s
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 500',
    _column, scope_pred
  );
END;
$function$;