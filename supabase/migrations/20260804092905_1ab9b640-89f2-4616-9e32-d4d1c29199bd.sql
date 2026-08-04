CREATE TABLE IF NOT EXISTS public.rcl_legacy_fn_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fn_name text NOT NULL,
  fn_args text NOT NULL,
  fn_def text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rcl_legacy_fn_backup TO authenticated;
GRANT ALL ON public.rcl_legacy_fn_backup TO service_role;
ALTER TABLE public.rcl_legacy_fn_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rcl_legacy_fn_backup_admin_read ON public.rcl_legacy_fn_backup;
CREATE POLICY rcl_legacy_fn_backup_admin_read ON public.rcl_legacy_fn_backup
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.rcl_legacy_fn_backup (fn_name, fn_args, fn_def)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('can_edit_row','can_view_row','is_row_owner')
  AND NOT EXISTS (
    SELECT 1 FROM public.rcl_legacy_fn_backup b
    WHERE b.fn_name = p.proname AND b.fn_args = pg_get_function_identity_arguments(p.oid)
  );

CREATE OR REPLACE FUNCTION public.rcl_module_of_table(_table_name text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT module FROM public.rcl_module_config WHERE table_name = _table_name LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_edit_row(_user_id uuid, _table_name text, _row_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_module text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _table_name !~ '^[a-z_]+$' THEN RETURN false; END IF;

  v_module := public.rcl_module_of_table(_table_name);
  IF v_module IS NULL THEN
    RETURN public.rcl_highest_role(_user_id) IN ('admin','superuser');
  END IF;

  RETURN public.rcl_can(_user_id, v_module, _row_id, 'write');
END $function$;

CREATE OR REPLACE FUNCTION public.can_view_row(_user_id uuid, _table_name text, _row_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_module text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _table_name !~ '^[a-z_]+$' THEN RETURN false; END IF;

  v_module := public.rcl_module_of_table(_table_name);
  IF v_module IS NULL THEN
    RETURN public.rcl_highest_role(_user_id) IN ('admin','superuser','senior_user','user','super_guest');
  END IF;

  RETURN public.rcl_can(_user_id, v_module, _row_id, 'read');
END $function$;

DROP FUNCTION IF EXISTS public.rcl_role_counts();
CREATE OR REPLACE FUNCTION public.rcl_role_counts()
RETURNS TABLE(role text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ur.role::text, count(*)::bigint
  FROM public.user_roles ur GROUP BY ur.role
$$;
GRANT EXECUTE ON FUNCTION public.rcl_role_counts() TO authenticated;