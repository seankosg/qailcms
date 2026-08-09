CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(_mode text, _filter_value text, _today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE t.level = 'sub'
      AND CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT public.tm_kpi_norm_actual(b.actual_progress) AS act,
      b.actual_start, b.actual_finish, b.plan_start, b.plan_end,
      (b.auto_judgment = '완료') AS is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS is_started_raw,
      b.auto_judgment AS jd
    FROM base b
  )
  SELECT jsonb_build_object(
    'today_count', COUNT(*) FILTER (WHERE NOT is_completed AND (plan_start = _today OR plan_end = _today)),
    'delayed_count', COUNT(*) FILTER (WHERE jd IN ('지연','악화')),
    'upcoming_count', COUNT(*) FILTER (WHERE NOT is_completed AND plan_end IS NOT NULL AND (plan_end - _today) BETWEEN 1 AND 3),
    'in_progress_count', COUNT(*) FILTER (WHERE is_started_raw AND NOT is_completed),
    'completed_count', COUNT(*) FILTER (WHERE is_completed),
    'total_count', COUNT(*)
  ) FROM judged;
$function$;

CREATE OR REPLACE FUNCTION public.tm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE t.level = 'sub'
      AND CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  computed AS (
    SELECT b.*,
      (b.auto_judgment = '완료') AS _is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS _is_started_raw,
      b.auto_judgment AS _jd
    FROM base b
  ),
  filtered AS (
    SELECT c.* FROM computed c
    WHERE CASE _bucket
      WHEN 'today' THEN NOT c._is_completed AND (c.plan_start = _today OR c.plan_end = _today)
      WHEN 'delayed' THEN c._jd IN ('지연','악화')
      WHEN 'upcoming' THEN NOT c._is_completed AND c.plan_end IS NOT NULL AND (c.plan_end - _today) BETWEEN 1 AND 3
      WHEN 'in_progress' THEN NOT c._is_completed AND c._is_started_raw
      WHEN 'completed' THEN c._is_completed
      ELSE TRUE END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days, f.created_at,
      f.cum_plan_pct, f.cum_actual_pct, f.gap_pct, f.delay_days, f.team
    FROM filtered f ORDER BY f.task_no NULLS LAST LIMIT _limit OFFSET _offset
  ) sub;
$function$;

DROP FUNCTION IF EXISTS public.recalc_task_progress_charts(text);

CREATE OR REPLACE FUNCTION public.recalc_task_progress_charts(
  _discipline text DEFAULT NULL::text,
  _task_no text DEFAULT NULL::text
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n int := 0;
  npts int := 24;
  i int;
  ps date;
  pe date;
  dur numeric;
  x_s date;
  x_e date;
  plan_arr jsonb;
  actual_arr jsonb;
  d date;
  v numeric;
  start_anchor_date date;
  last_anchor_date date;
  last_anchor_val numeric;
  plan_at_dd numeric;
  actual_at_dd numeric;
  hist_pts jsonb;
  hist_count int;
BEGIN
  FOR r IN
    SELECT id, discipline, task_no, plan_start, plan_end,
           actual_start, actual_finish, actual_progress, data_date
    FROM public.task_management_raw
    WHERE (_discipline IS NULL OR discipline = _discipline)
      AND (_task_no IS NULL OR task_no = _task_no)
      AND task_no IS NOT NULL
  LOOP
    ps := r.plan_start;
    pe := r.plan_end;

    IF ps IS NULL OR pe IS NULL OR pe <= ps THEN
      plan_arr := '[]'::jsonb;
      plan_at_dd := NULL;
    ELSE
      dur := GREATEST(1, (pe - ps));
      plan_arr := '[]'::jsonb;
      FOR i IN 0..(npts - 1) LOOP
        d := ps + ((pe - ps) * i / (npts - 1))::int;
        v := LEAST(1.0, GREATEST(0.0, ((d - ps)::numeric) / dur));
        plan_arr := plan_arr || jsonb_build_object('d', to_char(d,'YYYY-MM-DD'), 'v', round(v,4));
      END LOOP;
      IF r.data_date IS NOT NULL THEN
        plan_at_dd := LEAST(1.0, GREATEST(0.0, ((r.data_date - ps)::numeric) / dur));
      ELSE
        plan_at_dd := NULL;
      END IF;
    END IF;

    start_anchor_date := COALESCE(r.actual_start, ps);
    last_anchor_date := r.data_date;
    last_anchor_val := r.actual_progress;

    actual_arr := '[]'::jsonb;

    IF start_anchor_date IS NOT NULL THEN
      actual_arr := actual_arr || jsonb_build_object(
        'd', to_char(start_anchor_date,'YYYY-MM-DD'),
        'v', 0
      );
    END IF;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'd', to_char((h.changed_at AT TIME ZONE 'Asia/Qatar')::date, 'YYYY-MM-DD'),
               'v', round(LEAST(1.0, GREATEST(0.0, COALESCE(NULLIF(h.new_value,''),'0')::numeric)), 4)
             )
             ORDER BY h.changed_at
           ), '[]'::jsonb),
           COUNT(*)
      INTO hist_pts, hist_count
      FROM public.task_management_status_history h
     WHERE h.discipline = r.discipline
       AND h.task_no = r.task_no
       AND h.field = 'actual_progress'
       AND h.new_value IS NOT NULL
       AND (start_anchor_date IS NULL OR (h.changed_at AT TIME ZONE 'Asia/Qatar')::date > start_anchor_date)
       AND (last_anchor_date IS NULL OR (h.changed_at AT TIME ZONE 'Asia/Qatar')::date < last_anchor_date);

    IF hist_count IS NOT NULL AND hist_count > 0 THEN
      actual_arr := actual_arr || hist_pts;
    END IF;

    IF last_anchor_date IS NOT NULL AND last_anchor_val IS NOT NULL THEN
      actual_arr := actual_arr || jsonb_build_object(
        'd', to_char(last_anchor_date,'YYYY-MM-DD'),
        'v', round(LEAST(1.0, GREATEST(0.0, last_anchor_val)), 4)
      );
    END IF;

    actual_at_dd := last_anchor_val;

    x_s := LEAST(
      COALESCE(ps, start_anchor_date, r.data_date),
      COALESCE(start_anchor_date, ps, r.data_date)
    );
    x_e := GREATEST(
      COALESCE(pe, r.data_date, start_anchor_date),
      COALESCE(r.data_date, pe, start_anchor_date)
    );

    INSERT INTO public.task_progress_chart_cache
      (discipline, task_no, plan_points, actual_points, x_start, x_end,
       last_plan_progress, last_actual_progress,
       last_plan_at_dd, last_actual_at_dd, updated_at)
    VALUES
      (r.discipline, r.task_no, plan_arr, actual_arr, x_s, x_e,
       CASE WHEN plan_arr = '[]'::jsonb THEN NULL ELSE 1.0 END,
       r.actual_progress,
       plan_at_dd, actual_at_dd, now())
    ON CONFLICT (discipline, task_no) DO UPDATE
      SET plan_points = EXCLUDED.plan_points,
          actual_points = EXCLUDED.actual_points,
          x_start = EXCLUDED.x_start,
          x_end = EXCLUDED.x_end,
          last_plan_progress = EXCLUDED.last_plan_progress,
          last_actual_progress = EXCLUDED.last_actual_progress,
          last_plan_at_dd = EXCLUDED.last_plan_at_dd,
          last_actual_at_dd = EXCLUDED.last_actual_at_dd,
          updated_at = now();

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recalc_task_progress_charts(text, text) TO authenticated, service_role;