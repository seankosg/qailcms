ALTER TABLE public.restore_runs
  ADD COLUMN IF NOT EXISTS apply_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS apply_requested_by uuid;

CREATE OR REPLACE FUNCTION public.restore_claim_apply(_run_id uuid, _actor uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _claimed int;
BEGIN
  UPDATE public.restore_runs
     SET apply_requested_at = now(),
         apply_requested_by = _actor
   WHERE id = _run_id
     AND status = 'staging_verified'
     AND apply_requested_at IS NULL;
  GET DIAGNOSTICS _claimed = ROW_COUNT;
  RETURN _claimed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_claim_apply(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_claim_apply(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.restore_claim_apply(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.restore_claim_apply(uuid, uuid) TO service_role;