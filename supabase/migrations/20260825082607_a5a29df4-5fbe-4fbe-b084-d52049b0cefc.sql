CREATE OR REPLACE FUNCTION public.restore_claim_staging(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
  v_status text;
BEGIN
  UPDATE public.restore_runs
     SET status = 'staging', updated_at = now()
   WHERE id = _run_id
     AND status = 'preflight_clean'
  RETURNING status INTO v_status;

  IF v_status IS NOT NULL THEN
    v_claimed := true;
  ELSE
    SELECT status INTO v_status FROM public.restore_runs WHERE id = _run_id;
  END IF;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'status', NULL, 'reason', 'RESTORE_RUN_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'status', v_status,
    'reason', CASE
      WHEN v_claimed THEN NULL
      WHEN v_status = 'staging' THEN 'RESTORE_STAGING_ALREADY_IN_PROGRESS'
      ELSE 'RESTORE_STAGING_NOT_CLAIMABLE'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_claim_staging(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_claim_staging(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.restore_claim_staging(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.restore_claim_staging(uuid) TO service_role;