DO $do$
DECLARE
  r record;
  src text;
BEGIN
  FOR r IN
    SELECT oid, pg_get_functiondef(oid) AS def
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'abd_dashboard_row1','abd_dashboard_row2','abd_dashboard_status_dist',
        'abd_dashboard_crosscut','abd_dashboard_judgment_mix',
        'abd_dashboard_approval_trend','abd_dashboard_overdue_heatmap',
        'abd_dashboard_attention_lists'
      )
      AND pg_get_functiondef(oid) ILIKE '%is_terminated%'
  LOOP
    src := replace(r.def, ' AND NOT COALESCE(is_terminated,false)', '');
    src := replace(src, 'WHERE COALESCE(r.is_terminated, false) = false', 'WHERE true');
    IF src ILIKE '%is_terminated%' THEN
      RAISE EXCEPTION 'unhandled is_terminated filter in %', r.oid::regprocedure;
    END IF;
    EXECUTE src;
  END LOOP;
END
$do$;