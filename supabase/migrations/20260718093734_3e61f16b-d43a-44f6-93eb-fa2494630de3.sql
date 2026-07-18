
-- 1) abd_change_log INSERT: require changed_by = auth.uid()
DROP POLICY IF EXISTS abd_change_log_insert ON public.abd_change_log;
CREATE POLICY abd_change_log_insert ON public.abd_change_log
  FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() OR public.is_admin_or_super(auth.uid()));

-- 2) spare_part_field_config: remove public/anon SELECT policy
DROP POLICY IF EXISTS "Anyone can view spare_part_field_config" ON public.spare_part_field_config;

-- 3) Fix mutable search_path on _snag_progress_norm
ALTER FUNCTION public._snag_progress_norm(numeric) SET search_path = public;

-- 4) Revoke anon EXECUTE on all SECURITY DEFINER functions in public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END $$;
