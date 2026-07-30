CREATE OR REPLACE FUNCTION public.abd_mask_future_actuals(_row abd_items_raw, _as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(k, 'null'::jsonb), '{}'::jsonb)
  FROM jsonb_each_text(to_jsonb(_row)) AS e(k, v)
  WHERE (k LIKE '%\_actual' OR k = 'approval_date')
    AND v IS NOT NULL AND v <> ''
    AND v::date > _as_of;
$function$;

CREATE OR REPLACE FUNCTION public.abd_rows_as_of(_as_of date DEFAULT NULL::date)
 RETURNS SETOF public.abd_items_raw
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  IF _as_of IS NULL OR _as_of >= v_now THEN
    RETURN QUERY SELECT * FROM public.abd_items_raw;
  ELSE
    RETURN QUERY
      SELECT p.*
      FROM public.abd_items_raw r
      CROSS JOIN LATERAL jsonb_populate_record(
        r.*,
        public.abd_judge_v1(r.*, _as_of) || public.abd_mask_future_actuals(r.*, _as_of)
      ) p;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_mask_future_actuals(abd_items_raw, date) TO authenticated, service_role;