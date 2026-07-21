
-- Atomic queued -> running claim for backup runs
CREATE OR REPLACE FUNCTION public.claim_backup_run(_run_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.backup_run_log
     SET status = 'running',
         started_at = now()
   WHERE id = _run_id
     AND status = 'queued'
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.claim_backup_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_backup_run(uuid) TO service_role;

-- Claim the next queued snapshot job (oldest first)
CREATE OR REPLACE FUNCTION public.claim_next_queued_backup_run()
RETURNS TABLE(id uuid, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _meta jsonb;
BEGIN
  SELECT r.id, r.metadata
    INTO _id, _meta
    FROM public.backup_run_log r
   WHERE r.status = 'queued'
   ORDER BY r.started_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF _id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.backup_run_log
     SET status = 'running',
         started_at = now()
   WHERE backup_run_log.id = _id;

  RETURN QUERY SELECT _id, _meta;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_queued_backup_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_queued_backup_run() TO service_role;

-- Every minute, poke the runner route to drain the queue
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qail-drain-backup-queue') THEN
    PERFORM cron.unschedule('qail-drain-backup-queue');
  END IF;
END $$;

SELECT cron.schedule(
  'qail-drain-backup-queue',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--c5d84672-611a-4a97-92e3-1b90576d9b68.lovable.app/api/public/backup/run-queued-snapshot',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cndwdHJ0ZGxoZXlleWFmdXpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NTQ5NDYsImV4cCI6MjA5OTEzMDk0Nn0.9mgkCYQpMJ7HflSrVir_781Z_e4Tt_WEFHGhTxCWKkA"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
