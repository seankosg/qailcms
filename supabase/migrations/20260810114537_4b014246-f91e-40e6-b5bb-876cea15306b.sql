CREATE OR REPLACE FUNCTION public.abd_ocs_v3_verify()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_grant jsonb;
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'abd_ocs_v3_verify: authentication required';
  END IF;

  IF public.has_role(v_uid, 'admin'::app_role) THEN
    v_ok := true;
  ELSIF public.abd_ocs_can_manage(v_uid) THEN
    v_ok := true;
  ELSE
    -- RCL 정본: ABD 모듈 import 권한을 어느 스코프로든 보유하면 허용
    v_grant := public.rcl_grants_impl(v_uid, 'ABD', 'import');
    v_ok := coalesce((v_grant->>'own')::boolean, false)
         OR coalesce((v_grant->>'own_team')::boolean, false)
         OR coalesce((v_grant->>'other_team')::boolean, false);
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'abd_ocs_v3_verify: ABD OCS import permission required';
  END IF;

  RETURN public.abd_ocs_v3_verify_internal();
END;
$function$;

REVOKE ALL ON FUNCTION public.abd_ocs_v3_verify() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_v3_verify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_v3_verify() TO service_role;