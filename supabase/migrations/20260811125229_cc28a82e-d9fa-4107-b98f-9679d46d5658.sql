CREATE OR REPLACE FUNCTION public.backup_claim_run(_run_id uuid, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _claimed boolean := false;
  _row public.backup_run_log%ROWTYPE;
BEGIN
  INSERT INTO public.backup_run_log (id, status, snapshot_id, metadata)
  VALUES (_run_id, 'running', NULL, _metadata)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS _claimed = ROW_COUNT;

  SELECT * INTO _row FROM public.backup_run_log WHERE id = _run_id;

  RETURN jsonb_build_object(
    'claimed', _claimed,
    'run_id', _run_id,
    'status', _row.status,
    'snapshot_id', _row.snapshot_id,
    'started_at', _row.started_at,
    'finished_at', _row.finished_at,
    'error_message', _row.error_message,
    'metadata', _row.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backup_claim_run(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_claim_run(uuid, jsonb) TO service_role;