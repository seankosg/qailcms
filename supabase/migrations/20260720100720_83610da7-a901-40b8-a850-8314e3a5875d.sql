REVOKE EXECUTE ON FUNCTION public.has_role_backup(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_backup_tables() FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role_backup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_backup_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role_backup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_backup_tables() TO service_role;