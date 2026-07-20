
DO $mig$
DECLARE _rec record; _def text; _kind text := 'task_management';
BEGIN
  FOR _rec IN
    SELECT oid, proname FROM pg_proc
     WHERE proname IN ('rollback_task_management_import','preview_rollback_task_management_import')
       AND pronamespace='public'::regnamespace
  LOOP
    _def := pg_get_functiondef(_rec.oid);
    _def := regexp_replace(
      _def,
      'IF NOT public\.has_role\(_user,\s*''admin''\) THEN',
      'IF NOT public.can_rollback_import_batch(_batch_id, ' || quote_literal(_kind) || ') THEN'
    );
    _def := regexp_replace(
      _def,
      'IF NOT public\.has_role\(auth\.uid\(\),\s*''admin''\) THEN',
      'IF NOT public.can_rollback_import_batch(_batch_id, ' || quote_literal(_kind) || ') THEN'
    );
    EXECUTE _def;
  END LOOP;
END $mig$;
