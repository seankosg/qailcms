REVOKE ALL ON FUNCTION public.trg_task_main_no_cascade_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_task_main_no_cascade_fn() FROM anon;
GRANT EXECUTE ON FUNCTION public.trg_task_main_no_cascade_fn() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_task_main_no_cascade_fn() TO service_role;