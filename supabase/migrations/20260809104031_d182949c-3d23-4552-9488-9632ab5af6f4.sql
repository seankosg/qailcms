-- 2026-08-09 one-time OCS recovery path closure (idempotent)
REVOKE EXECUTE ON FUNCTION public.abd_ocs_recover_20260809(uuid, uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.abd_ocs_recover_20260809_dryrun() FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.abd_ocs_recover_20260809_precheck() FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.abd_ocs_recover_20260809(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.abd_ocs_recover_20260809_dryrun() TO service_role;
GRANT EXECUTE ON FUNCTION public.abd_ocs_recover_20260809_precheck() TO service_role;