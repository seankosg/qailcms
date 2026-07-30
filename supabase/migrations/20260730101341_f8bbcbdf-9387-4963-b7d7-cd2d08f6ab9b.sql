CREATE OR REPLACE FUNCTION public.abd_rows_as_of(_as_of date DEFAULT NULL::date)
 RETURNS SETOF public.abd_items_raw
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  IF _as_of IS NULL OR _as_of = v_now THEN
    RETURN QUERY SELECT * FROM public.abd_items_raw;
  ELSE
    RETURN QUERY
      SELECT p.*
      FROM public.abd_items_raw r
      CROSS JOIN LATERAL jsonb_populate_record(r.*, public.abd_judge_v1(r.*, _as_of)) p;
  END IF;
END;
$function$;