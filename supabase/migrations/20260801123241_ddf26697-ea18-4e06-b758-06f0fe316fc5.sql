CREATE OR REPLACE FUNCTION public.tm_rows_as_of_json(p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  FROM public.tm_rows_as_of(p_as_of) r;
$function$;