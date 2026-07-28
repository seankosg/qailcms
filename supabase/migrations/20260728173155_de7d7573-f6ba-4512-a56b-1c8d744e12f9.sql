-- 1) Revoke execute on dangerous backup/admin SECURITY DEFINER functions
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.backup_truncate_table(text)',
    'public.backup_disable_triggers(text)',
    'public.backup_enable_triggers(text)',
    'public.backup_insert_rows_from_json(text, jsonb)',
    'public.get_backup_tables()',
    'public.claim_backup_run(uuid)',
    'public.claim_next_queued_backup_run()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 2) Re-register auto-drain cron with shared secret header instead of anon apikey
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
    headers := '{"Content-Type": "application/json", "x-backup-secret": "94f21be7e58611eeb1067ae84da362115cc3c5e7442d4471bf64ec09f7942d56"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

-- 3) Re-register daily auto snapshot cron if present (defensive - may not exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qail-auto-snapshot-daily') THEN
    PERFORM cron.unschedule('qail-auto-snapshot-daily');
    PERFORM cron.schedule(
      'qail-auto-snapshot-daily',
      '50 20 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://project--c5d84672-611a-4a97-92e3-1b90576d9b68.lovable.app/api/public/backup/auto-snapshot',
        headers := '{"Content-Type": "application/json", "x-backup-secret": "94f21be7e58611eeb1067ae84da362115cc3c5e7442d4471bf64ec09f7942d56"}'::jsonb,
        body := '{"trigger":"scheduled"}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;