
-- 1) Add verification columns
ALTER TABLE public.task_progress_chart_cache
  ADD COLUMN IF NOT EXISTS last_plan_at_dd numeric,
  ADD COLUMN IF NOT EXISTS last_actual_at_dd numeric;

-- 2) Redefine recalc function
CREATE OR REPLACE FUNCTION public.recalc_task_progress_charts(_discipline text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND task_no IS NOT NULL
  LOOP
    ps := r.plan_start;
    pe := r.plan_end;

    -- ===== Plan curve (calendar-day linear 0..1) =====
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

    -- ===== Actual curve =====
    -- Start anchor: actual_start if present, else plan_start (reverse-daily inference)
    start_anchor_date := COALESCE(r.actual_start, ps);
    -- Last anchor: data_date + actual_progress if present
    last_anchor_date := r.data_date;
    last_anchor_val := r.actual_progress;

    actual_arr := '[]'::jsonb;

    IF start_anchor_date IS NOT NULL THEN
      actual_arr := actual_arr || jsonb_build_object(
        'd', to_char(start_anchor_date,'YYYY-MM-DD'),
        'v', 0
      );
    END IF;

    -- Mid snapshots from status_history (calendar date via Doha TZ)
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

    -- ===== X domain =====
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
$$;

GRANT EXECUTE ON FUNCTION public.recalc_task_progress_charts(text) TO authenticated, service_role;

-- 3) Full recompute with new logic
SELECT public.recalc_task_progress_charts(NULL);
