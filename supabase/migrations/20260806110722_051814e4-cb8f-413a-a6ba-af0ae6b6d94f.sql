DO $mig$
DECLARE
  fn record;
  def text;
  newdef text;
BEGIN
  FOR fn IN
    SELECT oid, proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('tm_items_search','tm_items_search_ids')
  LOOP
    def := pg_get_functiondef(fn.oid);
    newdef := replace(def, 'format('' and %I >= %L::date''', 'format('' and (%I)::date >= %L::date''');
    newdef := replace(newdef, 'format('' and %I <= %L::date''', 'format('' and (%I)::date <= %L::date''');
    IF newdef = def THEN
      RAISE NOTICE 'no date_range change for %', fn.proname;
    ELSE
      EXECUTE newdef;
    END IF;
  END LOOP;
END
$mig$;