ALTER FUNCTION public.abd_progress_totals(text[],text[],text[],date,text,text,text[]) SECURITY INVOKER;
ALTER FUNCTION public.abd_progress_totals_json(text[],text[],text[],date,text,text,text[]) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.abd_progress_totals(text[],text[],text[],date,text,text,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abd_progress_totals_json(text[],text[],text[],date,text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_progress_totals(text[],text[],text[],date,text,text,text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_progress_totals_json(text[],text[],text[],date,text,text,text[]) TO authenticated, service_role;