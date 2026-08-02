DO $mig$
DECLARE
  fn text;
  src text;
  newsrc text;
  cnt int;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'trg_task_actual_duration_fn',
    'abd_items_search',
    'snag_progress_cell_ids',
    'abd_progress_cell_ids',
    'defect_items_search',
    'tm_judge_snapshot_at_date'
  ] LOOP
    SELECT count(*) INTO cnt
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
    IF cnt <> 1 THEN
      RAISE EXCEPTION 'expected exactly 1 overload for %, found %', fn, cnt;
    END IF;

    SELECT pg_get_functiondef(p.oid) INTO src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;

    newsrc := regexp_replace(src, '\mcurrent_date\M', '(current_timestamp AT TIME ZONE ''Asia/Qatar'')::date', 'g');

    IF newsrc = src THEN
      RAISE EXCEPTION 'no current_date occurrence replaced in %', fn;
    END IF;

    EXECUTE newsrc;
  END LOOP;
END
$mig$;