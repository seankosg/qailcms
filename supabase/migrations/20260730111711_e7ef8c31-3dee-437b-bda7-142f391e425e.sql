CREATE OR REPLACE FUNCTION public.abd_progress_cell_ids(
  _stage text, _field text, _from date, _to date,
  _as_of date DEFAULT NULL::date, _plan_mode text DEFAULT 'baseline'
)
RETURNS TABLE(item_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- 술어 정본 = public.abd_progress_events(). 사본 금지.
  SELECT DISTINCT e.item_id
  FROM public.abd_progress_events(coalesce(_as_of, current_date), _plan_mode, 'all') e
  WHERE (_stage = 'all' OR e.stage = _stage)
    AND e.field = _field
    AND e.edate BETWEEN _from AND _to
$function$;

GRANT EXECUTE ON FUNCTION public.abd_progress_cell_ids(text, text, date, date, date, text) TO authenticated, service_role;